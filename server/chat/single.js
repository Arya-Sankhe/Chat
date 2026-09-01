import { Script } from "node:vm";

import { HttpError } from "../http/responses.js";
import { OPENROUTER_NITRO_MODEL } from "../providers.js";
import { pipeProviderStreamAndAccumulate, writeProviderEvent } from "../saas/messages.js";

export async function streamSingleChat({ chatRequest, crofai, config, provider, signal, res, includeReasoning = false }) {
  const upstream = await crofai.streamChatCompletion({
    apiKey: provider?.apiKey || config.serverApiKey,
    baseUrl: provider?.baseUrl || config.defaultBaseUrl,
    body: chatRequest,
    providerId: provider?.id,
    signal
  });
  if (!upstream.body) throw new HttpError(502, `${provider?.label || "Klui"} returned an empty response stream.`);
  const accumulated = await pipeProviderStreamAndAccumulate(upstream, res, { includeReasoning });
  return { accumulated, citations: [], providers: [], toolCallCount: 0 };
}

export function hasCompletedVisualizeBlock(content) {
  const match = String(content || "").match(/```visualize[ \t]*\r?\n([\s\S]*?)\r?\n```/i);
  return Boolean(match?.[1]?.trim());
}

function finishVisualizeBlock(result, res, includeReasoning) {
  const content = String(result?.accumulated?.content || "");
  if (hasCompletedVisualizeBlock(content)) return true;
  if (!/```visualize[ \t]*\r?\n[\s\S]*<\/html\s*>\s*$/i.test(content)) return false;
  const suffix = "\n```";
  result.accumulated.content += suffix;
  writeProviderEvent(res, { choices: [{ delta: { content: suffix } }] }, { includeReasoning });
  return true;
}

// Catch code that cannot work in the offline iframe, then compile the inline
// scripts. This covers the common "valid code, black canvas" failure where a
// CDN dependency is silently blocked by the sandbox.
export function findVisualizeError(content) {
  const raw = String(content || "");
  const blocks = [...raw.matchAll(/```visualize[ \t]*\r?\n([\s\S]*?)\r?\n```/gi)];
  if ((raw.match(/```visualize[ \t]*\r?\n/gi) || []).length !== 1 || blocks.length !== 1) {
    return "Return exactly one complete visualization document.";
  }
  const doc = blocks[0][1] || "";
  if (Buffer.byteLength(doc, "utf8") > 120 * 1024) return "The visualization exceeds the 120 KiB limit.";
  if (/<script\b[^>]*\bsrc\s*=/i.test(doc)) return "External scripts cannot load in the offline visualization sandbox.";
  if (/<link\b[^>]*\bhref\s*=/i.test(doc)) return "External styles cannot load in the offline visualization sandbox.";
  if (/\b(?:src|href)\s*=\s*["']https?:/i.test(doc) || /(?:@import|url\s*\()\s*["']?https?:/i.test(doc)) {
    return "External assets cannot load in the offline visualization sandbox.";
  }
  if (/\b(?:fetch\s*\(|new\s+(?:WebSocket|EventSource)\s*\(|import\s*\()/i.test(doc)) {
    return "Network requests and imports cannot run in the offline visualization sandbox.";
  }
  for (const [, attrs = "", code = ""] of doc.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const type = attrs.match(/\btype\s*=\s*["']?([\w/+-]+)/i)?.[1]?.toLowerCase();
    if (type === "module") return "JavaScript modules cannot run in the offline visualization sandbox; use one inline classic script.";
    if (type && type !== "text/javascript" && type !== "application/javascript") continue;
    try {
      new Script(code, { filename: "widget.js" });
    } catch (err) {
      // Keep the source line + caret + message; drop Node-internal stack frames.
      const stack = String(err?.stack || err);
      const internals = stack.indexOf("\n    at ");
      return (internals < 0 ? stack : stack.slice(0, internals)).slice(0, 600);
    }
  }
  return "";
}

// Cheap first pass: ask the fast model to correct the parse error in place.
// One attempt, validated before use; the full-model repair below is the fallback.
async function fixVisualize({ content, visualizeError, crofai, config, provider, signal }) {
  try {
    const timeout = AbortSignal.timeout(25_000);
    const fixed = await crofai.chatCompletion({
      apiKey: provider?.apiKey || config.serverApiKey,
      baseUrl: provider?.baseUrl || config.defaultBaseUrl,
      providerId: provider?.id,
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      body: {
        model: OPENROUTER_NITRO_MODEL,
        reasoning: { enabled: false },
        temperature: 0,
        messages: [{
          role: "user",
          content: `The chat response below contains a visualization that cannot run in its offline sandbox:\n\n${visualizeError}\n\nOutput the entire response with that problem fixed using only inline browser-native HTML, CSS, SVG, canvas, and JavaScript: the same optional intro sentence, then one fenced \`\`\`visualize block with the complete document. Output nothing else.\n\n${content}`
        }]
      }
    });
    const candidate = String(fixed || "").trim();
    if (hasCompletedVisualizeBlock(candidate) && !findVisualizeError(candidate)) return candidate;
  } catch (error) {
    if (signal?.aborted) throw error;
    /* fall through to the full repair */
  }
  return "";
}

export async function ensureVisualizeResponse({ required, result, chatRequest, crofai, config, provider, signal, res, includeReasoning = false, onReset }) {
  if (!required) return result;
  const completed = finishVisualizeBlock(result, res, includeReasoning);
  const visualizeError = completed ? findVisualizeError(result.accumulated.content) : "";
  if (completed && !visualizeError) return result;
  if (completed) {
    const fixed = await fixVisualize({ content: result.accumulated.content, visualizeError, crofai, config, provider, signal });
    if (fixed) {
      signal?.throwIfAborted();
      onReset();
      writeProviderEvent(res, { choices: [{ delta: { content: fixed } }] }, { includeReasoning });
      return { ...result, accumulated: { ...result.accumulated, content: fixed } };
    }
  }
  signal?.throwIfAborted();
  onReset();
  const instruction = visualizeError
    ? `The document you returned fails before it can run:\n\n${visualizeError}\n\nReplace the previous response completely with a corrected version. Follow the active Visualize contract: return exactly one fenced \`visualize\` block containing a complete standalone HTML document that works offline with no imports or external assets. Do not explain, apologize, or return ordinary prose.`
    : "Replace the previous response completely. Follow the active Visualize contract now: return exactly one fenced `visualize` block containing a complete standalone HTML document. Do not explain, apologize, or return ordinary prose.";
  const retryRequest = {
    ...chatRequest,
    messages: [
      ...chatRequest.messages,
      { role: "assistant", content: String(result?.accumulated?.content || "").slice(-20_000) },
      { role: "user", content: instruction }
    ]
  };
  delete retryRequest.tools;
  delete retryRequest.tool_choice;
  const repaired = await streamSingleChat({ chatRequest: retryRequest, crofai, config, provider, signal, res, includeReasoning });
  if (!finishVisualizeBlock(repaired, res, includeReasoning) || findVisualizeError(repaired.accumulated.content)) {
    throw new HttpError(502, "Klui could not generate the interactive visualization. Try again.");
  }
  return { ...result, accumulated: repaired.accumulated };
}
