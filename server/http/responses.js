export class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.details = details;
  }
}

export function sendJson(res, status, data) {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

/**
 * The text of an error that may reach a client, directly or through a stored message.
 * Database errors name tables, constraints and SQL states, so only the messages our own
 * functions raise on purpose (P0001) pass; the rest are logged here instead.
 */
export function publicErrorMessage(error, fallback = "Unexpected server error") {
  if (error?.database && error.details?.code !== "P0001") {
    console.error("Database request failed:", error.details);
    return "Database request failed.";
  }
  return error?.message || fallback;
}

/** A machine-readable error code for clients; SQL state codes stay on the server. */
export function publicErrorCode(error) {
  return error?.database ? undefined : error?.details?.code;
}

export function sendProblem(res, error) {
  if (res.headersSent) {
    res.end();
    return;
  }

  const status = Number.isInteger(error?.status) ? error.status : 500;
  if (error?.database) {
    sendJson(res, status, { error: publicErrorMessage(error) });
    return;
  }
  sendJson(res, status, {
    error: error?.message || "Unexpected server error",
    details: error?.details
  });
}

export async function parseJsonBody(req, maxBytes = 1024 * 1024) {
  const raw = await readRawBody(req, maxBytes);
  if (!raw.length) return {};

  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body must be valid JSON.");
  }
}

export async function readRawBody(req, maxBytes = 1024 * 1024) {
  const chunks = [];
  let size = 0;

  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) {
      throw new HttpError(413, "Request body is too large.");
    }
    chunks.push(chunk);
  }

  return chunks.length ? Buffer.concat(chunks) : Buffer.alloc(0);
}
