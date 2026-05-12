async function readProblem(response) {
  try {
    const json = await response.json();
    return json.error || "Request failed.";
  } catch {
    return response.statusText || "Request failed.";
  }
}

function authHeaders(settings) {
  return settings.apiKey ? { "x-crofai-key": settings.apiKey } : {};
}

export async function fetchConfig() {
  const response = await fetch("/api/config");
  if (!response.ok) throw new Error(await readProblem(response));
  return response.json();
}

export async function fetchModels(settings) {
  const params = new URLSearchParams({ baseUrl: settings.baseUrl });
  const response = await fetch(`/api/models?${params.toString()}`, {
    headers: authHeaders(settings)
  });

  if (!response.ok) throw new Error(await readProblem(response));
  return response.json();
}

export async function streamChat(payload, settings, { signal, onEvent }) {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...authHeaders(settings)
    },
    body: JSON.stringify({ ...payload, baseUrl: settings.baseUrl }),
    signal
  });

  if (!response.ok) throw new Error(await readProblem(response));
  if (!response.body) throw new Error("Streaming is not available in this browser.");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
    const events = buffer.split("\n\n");
    buffer = events.pop() || "";

    for (const event of events) {
      const data = event
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");

      if (!data) continue;
      if (data === "[DONE]") return;
      onEvent(JSON.parse(data));
    }
  }
}
