import { HttpError } from "../http/responses.js";

function authHeaders(apiKey) {
  const headers = {
    accept: "application/json"
  };

  if (apiKey) {
    headers.authorization = `Bearer ${apiKey}`;
  }

  return headers;
}

async function crofaiError(response) {
  const contentType = response.headers.get("content-type") || "";
  const text = await response.text();

  if (contentType.includes("application/json")) {
    try {
      const json = JSON.parse(text);
      return new HttpError(response.status, json?.error?.message || json?.error || `Klui request failed with ${response.status}.`, json);
    } catch {
      return new HttpError(response.status, `Klui request failed with ${response.status}.`, text.slice(0, 2000));
    }
  }

  return new HttpError(response.status, text.slice(0, 2000) || `Klui request failed with ${response.status}.`);
}

export async function listModels({ apiKey, baseUrl, signal }) {
  const response = await fetch(`${baseUrl}/models`, {
    method: "GET",
    headers: authHeaders(apiKey),
    signal
  });

  if (!response.ok) {
    throw await crofaiError(response);
  }

  return response.json();
}

export async function streamChatCompletion({ apiKey, baseUrl, body, signal }) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      ...authHeaders(apiKey),
      "content-type": "application/json"
    },
    body: JSON.stringify({ ...body, stream: true }),
    signal
  });

  if (!response.ok) {
    throw await crofaiError(response);
  }

  return response;
}

export async function chatCompletion({ apiKey, baseUrl, body, signal }) {
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      ...authHeaders(apiKey),
      "content-type": "application/json"
    },
    body: JSON.stringify({ ...body, stream: false }),
    signal
  });

  if (!response.ok) {
    throw await crofaiError(response);
  }

  const payload = await response.json();
  return payload?.choices?.[0]?.message?.content || "";
}
