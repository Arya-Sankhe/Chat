import { HttpError } from "../http/responses.js";

export const DEFAULT_CROFAI_BASE_URL = "https://crof.ai/v1";

export const CROFAI_BASE_URLS = [
  "https://crof.ai/v1",
  "https://crof.ai/v2"
];

export const SUPPORTED_CHAT_PARAMS = ["max_tokens", "temperature", "top_p", "stop", "seed", "tools"];

const allowedBaseUrlSet = new Set(CROFAI_BASE_URLS);

export function normalizeBaseUrl(value = DEFAULT_CROFAI_BASE_URL) {
  const raw = String(value || DEFAULT_CROFAI_BASE_URL).trim().replace(/\/+$/, "");

  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new HttpError(400, "Klui API base URL is invalid.");
  }

  const normalized = `${url.origin}${url.pathname}`;
  if (!allowedBaseUrlSet.has(normalized)) {
    throw new HttpError(400, "Only Klui API endpoints are allowed.");
  }

  return normalized;
}
