import { extractBearerToken } from "../auth/supabase.js";
import { desktopAuthProvider } from "../auth/desktopProvider.js";
import { requireDesktopFeature } from "../auth/desktop.js";
import { streamChatCompletion } from "../crofai/client.js";
import { HttpError, parseJsonBody, readRawBody, sendJson } from "../http/responses.js";
import { resolveProvider } from "../providers.js";
import { apiUsageWindow } from "../saas/billing.js";
import { getCurrentEntitlement } from "../saas/entitlements.js";
import { pipeProviderStreamAndAccumulate } from "../saas/messages/stream.js";
import { publicPlan } from "../saas/plans.js";
import { createCrofaiUsageMeter } from "../saas/usageMeter.js";
import { validatedAudioDuration } from "../speech/audio.js";
import { callSarvam } from "./speech.js";
import { desktopAuthContext, requireDesktopContext } from "./context.js";
import { enforceRateLimit } from "../http/rateLimit.js";

const MAX_CHAT_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MAX_AUDIO_BYTES = 5 * 1024 * 1024;
const MAX_DESKTOP_IMAGES = 4;
const MAX_SCREENSHOT_EDGE = 2560;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function errorCode(status) {
  return ({
    401: "session_expired", 402: "plan_required", 409: "request_conflict",
    413: "request_too_large", 426: "update_required", 429: "usage_exhausted",
    503: "provider_unavailable"
  })[status] || "request_failed";
}

export function sendDesktopProblem(res, error, config) {
  if (res.headersSent) { res.end(); return; }
  const status = Number.isInteger(error?.status) ? error.status : 500;
  const details = error?.details && typeof error.details === "object" ? error.details : {};
  sendJson(res, status, {
    error: {
      code: details.code || errorCode(status),
      message: error?.message || "Unexpected server error.",
      retryable: details.retryable ?? [429, 503].includes(status)
    },
    ...(status === 426 ? {
      minimum_version: config.desktop.minimumWindowsVersion,
      latest_version: config.desktop.latestWindowsVersion,
      download_url: config.desktop.windowsDownloadUrl
    } : {})
  });
}

function header(req, name) {
  const value = req.headers[name];
  return String(Array.isArray(value) ? value[0] : value || "").trim();
}

function semverParts(value) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(value);
  return match ? match.slice(1).map(Number) : null;
}

function compareSemver(left, right) {
  const a = semverParts(left);
  const b = semverParts(right);
  if (!a || !b) return null;
  for (let index = 0; index < 3; index += 1) if (a[index] !== b[index]) return a[index] - b[index];
  return 0;
}

function requireClientHeaders(req, config, { requestId = false } = {}) {
  const version = header(req, "x-klui-client-version");
  if (!version || compareSemver(version, config.desktop.minimumWindowsVersion) === null) {
    throw new HttpError(426, "Update Klui Anything to continue.");
  }
  if (compareSemver(version, config.desktop.minimumWindowsVersion) < 0) {
    throw new HttpError(426, "This version of Klui Anything is no longer supported.");
  }
  const id = header(req, "x-klui-request-id");
  if (requestId && !UUID_PATTERN.test(id)) throw new HttpError(400, "A valid X-Klui-Request-Id is required.");
  return { version, requestId: id };
}

function pngDimensions(bytes) {
  if (bytes.length < 24 || bytes.toString("ascii", 1, 4) !== "PNG") return null;
  return { width: bytes.readUInt32BE(16), height: bytes.readUInt32BE(20) };
}

function jpegDimensions(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null;
  let offset = 2;
  while (offset + 9 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1];
    if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
      return { width: bytes.readUInt16BE(offset + 7), height: bytes.readUInt16BE(offset + 5) };
    }
    if (marker === 0xd8 || marker === 0xd9) { offset += 2; continue; }
    if (offset + 4 > bytes.length) break;
    const length = bytes.readUInt16BE(offset + 2);
    if (length < 2) break;
    offset += 2 + length;
  }
  return null;
}

function webpDimensions(bytes) {
  if (bytes.length < 30 || bytes.toString("ascii", 0, 4) !== "RIFF" || bytes.toString("ascii", 8, 12) !== "WEBP") return null;
  const kind = bytes.toString("ascii", 12, 16);
  if (kind === "VP8X") {
    return {
      width: 1 + bytes.readUIntLE(24, 3),
      height: 1 + bytes.readUIntLE(27, 3)
    };
  }
  if (kind === "VP8L" && bytes.length >= 25 && bytes[20] === 0x2f) {
    const bits = bytes.readUInt32LE(21);
    return { width: 1 + (bits & 0x3fff), height: 1 + ((bits >>> 14) & 0x3fff) };
  }
  if (kind === "VP8 " && bytes.length >= 30 && bytes[23] === 0x9d && bytes[24] === 0x01 && bytes[25] === 0x2a) {
    return { width: bytes.readUInt16LE(26) & 0x3fff, height: bytes.readUInt16LE(28) & 0x3fff };
  }
  return null;
}

function validateDataImage(value) {
  const url = typeof value === "string" ? value : value?.url;
  if (typeof url !== "string") throw new HttpError(400, "Image input is invalid.");
  if (/^https?:/i.test(url)) throw new HttpError(400, "Remote image URLs are not accepted.");
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/i.exec(url);
  if (!match) throw new HttpError(400, "Only PNG, JPEG, or WebP desktop images are accepted.");
  const bytes = Math.floor(match[2].length * 3 / 4) - (match[2].endsWith("==") ? 2 : match[2].endsWith("=") ? 1 : 0);
  if (bytes > MAX_IMAGE_BYTES) throw new HttpError(413, "A desktop image is too large.");
  const decoded = Buffer.from(match[2], "base64");
  const dimensions = match[1].toLowerCase() === "image/png"
    ? pngDimensions(decoded)
    : match[1].toLowerCase() === "image/jpeg"
      ? jpegDimensions(decoded)
      : webpDimensions(decoded);
  if (!dimensions || dimensions.width < 1 || dimensions.height < 1) throw new HttpError(400, "A desktop image is malformed.");
  if (Math.max(dimensions.width, dimensions.height) > MAX_SCREENSHOT_EDGE) {
    throw new HttpError(413, "Desktop screenshots must be at most 2560 pixels on the longest edge.");
  }
  return dimensions;
}

export function desktopChatReservationCredits(body, config) {
  let imageTokens = 0;
  for (const message of body.messages) if (Array.isArray(message.content)) {
    for (const part of message.content) if (part?.type === "image_url" || part?.image_url) {
      const { width, height } = validateDataImage(part.image_url);
      imageTokens += 85 + (170 * Math.ceil(width / 512) * Math.ceil(height / 512));
    }
  }
  const structuredBytes = Buffer.byteLength(JSON.stringify({
    messages: body.messages,
    tools: body.tools,
    tool_choice: body.tool_choice
  }, (key, value) => key === "url" && typeof value === "string" && value.startsWith("data:") ? "" : value));
  // One token per remaining UTF-8 byte is deliberately conservative for text,
  // with padding for provider framing that is not present in the JSON request.
  const inputTokens = structuredBytes + imageTokens + 1024;
  if (inputTokens > config.desktop.maxInputTokens) throw new HttpError(413, "The desktop chat context is too large.");
  const ceiling = (
    (inputTokens * config.desktop.maxPromptPricePerMillion)
    + (config.desktop.maxCompletionTokens * config.desktop.maxCompletionPricePerMillion)
  ) / 1_000_000;
  if (ceiling > config.desktop.chatReservationCredits) throw new HttpError(413, "The desktop chat context exceeds the funded request ceiling.");
  return Math.ceil(ceiling * 100_000_000) / 100_000_000;
}

export function validatedChatBody(body, config) {
  if (body?.stream !== true) throw new HttpError(400, "Desktop chat must use streaming.");
  if (body?.model !== "klui-desktop-agent") throw new HttpError(400, "Unknown desktop model.");
  if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 128) {
    throw new HttpError(400, "Desktop chat messages are invalid.");
  }
  let imageCount = 0;
  for (const message of body.messages) {
    if (!message || !["developer", "system", "user", "assistant", "tool"].includes(message.role)) throw new HttpError(400, "A desktop chat message is invalid.");
    if (Array.isArray(message.content)) for (const part of message.content) {
      if (part?.type === "image_url" || part?.image_url) {
        imageCount += 1;
        if (imageCount > MAX_DESKTOP_IMAGES) throw new HttpError(413, "A desktop request contains too many images.");
        validateDataImage(part.image_url);
      }
    }
  }
  const tools = body.tools === undefined ? undefined : body.tools;
  if (tools !== undefined && (!Array.isArray(tools) || tools.length > 64 || JSON.stringify(tools).length > 256 * 1024)) {
    throw new HttpError(413, "Desktop tool definitions are too large.");
  }
  return {
    model: config.desktop.model,
    messages: body.messages,
    ...(tools ? { tools } : {}),
    ...(body.tool_choice !== undefined ? { tool_choice: body.tool_choice } : {}),
    stream: true,
    max_tokens: config.desktop.maxCompletionTokens,
    reasoning_effort: "high",
    provider: {
      max_price: {
        prompt: config.desktop.maxPromptPricePerMillion,
        completion: config.desktop.maxCompletionPricePerMillion
      }
    }
  };
}

async function requirePrivacy(context, config, signal) {
  const consent = await context.db.getDesktopPrivacyConsent({
    accountId: context.user.id,
    oauthClientId: context.user.oauthClientId,
    policyVersion: config.desktop.privacyPolicyVersion
  }, { signal });
  if (!consent) throw new HttpError(403, "Desktop privacy consent is required.", { code: "privacy_consent_required", retryable: false });
}

export function desktopBetaAllowed(config, accountId) {
  const allowed = config.desktop?.betaAccountIds || [];
  return allowed.includes("*") || allowed.includes(String(accountId || "").toLowerCase());
}

function requireDesktopBetaAccess(context, config) {
  if (!desktopBetaAllowed(config, context.user.id)) {
    throw new HttpError(403, "This account is not enabled for the Klui Anything beta yet.", {
      code: "desktop_beta_not_enabled",
      retryable: false
    });
  }
}

export async function handleDesktopMe(req, res, config) {
  if (req.method !== "GET") throw new HttpError(405, "Method not allowed.");
  requireDesktopFeature(config, "oauthEnabled");
  requireClientHeaders(req, config);
  const context = await desktopAuthContext(req, config);
  const entitlement = await getCurrentEntitlement({ db: context.db, userId: context.user.id, plans: config.plans, access: config.access, signal: req.signal });
  const consent = await context.db.getDesktopPrivacyConsent({ accountId: context.user.id, oauthClientId: context.user.oauthClientId, policyVersion: config.desktop.privacyPolicyVersion }, { signal: req.signal }).catch(() => null);
  let usage = { used: 0, reserved: 0, remaining: 0, limit: 0, limited: true, resetAt: null };
  if (entitlement.plan) {
    const window = apiUsageWindow(entitlement.subscription, entitlement.plan);
    const row = await context.db.getApiWeeklyUsage(context.user.id, { periodStart: window.periodStart, weekIndex: window.weekIndex, signal: req.signal }).catch(() => null);
    const used = Number(row?.api_credit_used || 0);
    const reserved = Number(row?.api_credit_reserved || 0);
    const limit = Number(row?.api_credit_limit || window.weeklyLimit || 0);
    usage = { used, reserved, remaining: Math.max(0, limit - used - reserved), limit, limited: used + reserved >= limit, resetAt: window.weekEnd };
  }
  const eligible = Boolean(entitlement.active && entitlement.plan);
  const consented = Boolean(consent);
  const betaAllowed = desktopBetaAllowed(config, context.user.id);
  sendJson(res, 200, {
    account: { id: context.user.id, email: context.user.email },
    subscription: entitlement.subscription ? {
      status: entitlement.subscription.status,
      currentPeriodEnd: entitlement.subscription.current_period_end,
      cancelAtPeriodEnd: entitlement.subscription.cancel_at_period_end
    } : null,
    plan: entitlement.plan ? publicPlan(entitlement.plan) : null,
    usage,
    privacy: { policyVersion: config.desktop.privacyPolicyVersion, consentRequired: !consented },
    capabilities: {
      chat: betaAllowed && eligible && consented && config.desktop.chatEnabled,
      voice: betaAllowed && eligible && consented && config.desktop.sttEnabled,
      // Windows beta intentionally ships without the CUA driver. Keep the
      // capability explicit so a stale or modified client cannot advertise it.
      computerUse: false,
      maxAgentIterations: 20,
      maxCompletionTokens: config.desktop.maxCompletionTokens
    },
    versions: {
      minimum: config.desktop.minimumWindowsVersion,
      latest: config.desktop.latestWindowsVersion,
      downloadUrl: config.desktop.windowsDownloadUrl
    }
  });
}

export async function handleDesktopChat(req, res, config) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  requireDesktopFeature(config, "chatEnabled");
  enforceRateLimit(req, "desktop-chat", 60);
  const { requestId } = requireClientHeaders(req, config, { requestId: true });
  const context = await requireDesktopContext(req, config);
  requireDesktopBetaAccess(context, config);
  await requirePrivacy(context, config, req.signal);
  const body = validatedChatBody(await parseJsonBody(req, MAX_CHAT_BYTES), config);
  const reservationCredits = desktopChatReservationCredits(body, config);
  const provider = resolveProvider("openrouter", config);
  const meter = createCrofaiUsageMeter({
    db: context.db,
    userId: context.user.id,
    subscription: context.subscription,
    plan: context.plan,
    meteringMode: "enforce",
    surface: context.user.surface,
    modality: "llm",
    oauthClientId: context.user.oauthClientId,
    reservationCredits,
    signal: AbortSignal.timeout(10 * 60_000),
    streamChatCompletionFn: streamChatCompletion
  });
  const upstream = await meter.streamChatCompletion({
    apiKey: provider.apiKey,
    baseUrl: provider.baseUrl,
    providerId: provider.id,
    body,
    requestId,
    signal: AbortSignal.timeout(10 * 60_000),
    maxAttempts: 1
  });
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-store",
    connection: "keep-alive",
    "x-accel-buffering": "no"
  });
  await pipeProviderStreamAndAccumulate(upstream, res, { includeReasoning: true });
  if (!res.destroyed && !res.writableEnded) res.end();
}

export async function handleDesktopSpeech(req, res, config) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  requireDesktopFeature(config, "sttEnabled");
  enforceRateLimit(req, "desktop-stt", 30);
  const { requestId } = requireClientHeaders(req, config, { requestId: true });
  const context = await requireDesktopContext(req, config);
  requireDesktopBetaAccess(context, config);
  await requirePrivacy(context, config, req.signal);
  const contentType = String(req.headers["content-type"] || "").split(";", 1)[0].toLowerCase();
  if (contentType !== "audio/wav" && contentType !== "audio/x-wav") throw new HttpError(415, "Desktop voice input must be WAV audio.");
  const audio = await readRawBody(req, MAX_AUDIO_BYTES);
  const durationSeconds = validatedAudioDuration(audio, contentType, { wavOnly: true, maxSeconds: 30 });
  const window = apiUsageWindow(context.subscription, context.plan);
  const credits = durationSeconds * config.speech.creditsPerSecond;
  const reservation = await context.db.reserveApiUsage({
    userId: context.user.id, requestId, subscriptionId: context.subscription?.id || null,
    planId: context.plan.id, surface: context.user.surface, modality: "stt",
    oauthClientId: context.user.oauthClientId, provider: "sarvam", model: "saaras:v3",
    ...window, reservedCredits: credits
  }, { signal: AbortSignal.timeout(15_000) });
  if (reservation?.duplicate) throw new HttpError(409, "This request ID has already been used.");
  if (!reservation?.allowed) throw new HttpError(429, "Voice and chat share your weekly allowance.");
  try {
    await context.db.markApiUsageSubmitted({ userId: context.user.id, requestId }, { signal: AbortSignal.timeout(15_000) });
  } catch {
    await context.db.releaseApiUsage({ userId: context.user.id, requestId }, { signal: AbortSignal.timeout(15_000) }).catch(() => {});
    throw new HttpError(503, "Usage metering is temporarily unavailable.");
  }
  let response;
  try {
    response = await callSarvam(config, audio, "audio/wav", AbortSignal.timeout(45_000));
  } catch (error) {
    await context.db.settleApiUsage({
      userId: context.user.id, requestId, costCredits: 0,
      costSource: "sarvam_provider_failure", usage: { duration_seconds: durationSeconds }, estimated: true
    }, { signal: AbortSignal.timeout(15_000) }).catch(() => {});
    throw new HttpError(503, "Speech transcription is temporarily unavailable.");
  }
  const payload = await response.json().catch(() => ({}));
  await context.db.settleApiUsage({
    userId: context.user.id, requestId, costCredits: response.ok ? credits : 0,
    costSource: response.ok ? "sarvam_duration" : "sarvam_provider_failure",
    usage: { duration_seconds: durationSeconds }, estimated: !response.ok
  }, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new HttpError(503, "Speech transcription is temporarily unavailable.");
  sendJson(res, 200, { transcript: String(payload.transcript || "").trim(), usage: { credits, durationSeconds } });
}

export async function handleDesktopLogout(req, res, config) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  requireClientHeaders(req, config);
  const context = await desktopAuthContext(req, config);
  const token = extractBearerToken(req.headers);
  const provider = desktopAuthProvider(config);
  const [grant] = await Promise.allSettled([
    provider.revokeClientGrant(token, context.user.providerClientId),
    provider.logoutSession(token)
  ]);
  if (grant.status === "rejected") throw new HttpError(503, "Klui could not revoke this desktop session. Try again.");
  sendJson(res, 200, { ok: true });
}
