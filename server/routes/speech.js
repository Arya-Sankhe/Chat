import { HttpError, readRawBody, sendJson } from "../http/responses.js";
import { requireChatContext } from "./context.js";

const MAX_AUDIO_BYTES = 5 * 1024 * 1024;

function audioExtension(contentType) {
  if (contentType.includes("mp4")) return "m4a";
  if (contentType.includes("ogg")) return "ogg";
  if (contentType.includes("wav")) return "wav";
  return "webm";
}

async function callSarvam(config, audio, contentType, signal) {
  const form = new FormData();
  form.append("file", new Blob([audio], { type: contentType }), `speech.${audioExtension(contentType)}`);
  form.append("model", "saaras:v3");
  form.append("mode", "codemix");
  form.append("language_code", "unknown");

  return fetch(`${config.speech.baseUrl}/speech-to-text`, {
    method: "POST",
    headers: { "api-subscription-key": config.speech.apiKey },
    body: form,
    signal
  });
}

export async function handleSpeechToText(req, res, config) {
  if (req.method !== "POST") throw new HttpError(405, "Method not allowed.");
  if (!config.speech?.apiKey) throw new HttpError(503, "Speech transcription is not configured on the server.");

  await requireChatContext(req, config);
  const contentType = String(req.headers["content-type"] || "").split(";", 1)[0].trim().toLowerCase();
  if (!contentType.startsWith("audio/")) throw new HttpError(415, "An audio recording is required.");

  const audio = await readRawBody(req, MAX_AUDIO_BYTES);
  if (!audio.length) throw new HttpError(400, "The audio recording is empty.");

  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(45_000)]);
  let response;
  try {
    response = await callSarvam(config, audio, contentType, signal);
    if (response.status === 429 || response.status >= 500) {
      await response.body?.cancel();
      response = await callSarvam(config, audio, contentType, signal);
    }
  } catch (error) {
    if (signal.aborted) throw new HttpError(504, "Speech transcription timed out.");
    throw new HttpError(502, "Speech transcription is temporarily unavailable.");
  }

  if (!response.ok) throw new HttpError(502, "Speech transcription failed.");
  const payload = await response.json().catch(() => ({}));
  const transcript = String(payload.transcript || "").trim();
  if (!transcript) throw new HttpError(502, "Speech transcription returned no text.");
  sendJson(res, 200, { transcript });
}
