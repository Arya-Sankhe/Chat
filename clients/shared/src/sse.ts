import type { StreamEvent } from "./types";

/* Incremental parser for the server's SSE framing: events separated by a blank
   line, payload in `data:` lines, `[DONE]` as the terminator. */
export class SseParser {
  private buffer = "";
  done = false;

  /** Feeds decoded text and returns the complete events it finished. */
  push(text: string): StreamEvent[] {
    if (this.done) return [];
    this.buffer += text.replace(/\r\n/g, "\n");
    const blocks = this.buffer.split("\n\n");
    this.buffer = blocks.pop() ?? "";
    const events: StreamEvent[] = [];
    for (const block of blocks) {
      const data = block
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trim())
        .join("\n");
      if (!data) continue;
      if (data === "[DONE]") {
        this.done = true;
        break;
      }
      events.push(JSON.parse(data) as StreamEvent);
    }
    return events;
  }
}

/** `readError` maps failures of the read itself; parse errors and throws from
    `onEvent` pass through untouched. */
export async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onEvent: (event: StreamEvent) => void,
  readError: (error: unknown) => unknown = (error) => error
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  try {
    while (!parser.done) {
      const { done, value } = await reader.read().catch((error: unknown) => { throw readError(error); });
      if (done) break;
      for (const event of parser.push(decoder.decode(value, { stream: true }))) onEvent(event);
    }
  } finally {
    // Stops the network read when [DONE] arrives before the body closes.
    if (parser.done) await reader.cancel().catch(() => {});
  }
}
