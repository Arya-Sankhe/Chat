import { describe, expect, it } from "vitest";
import { SseParser, readSseStream } from "../src/sse";
import { applyStreamEvent, createLiveAssistant } from "../src/streamReducer";
import type { StreamEvent } from "../src/types";

const chunk = (content: string) => ({ choices: [{ delta: { content } }] });

describe("SSE parsing", () => {
  it("joins events split across network chunks and stops at [DONE]", async () => {
    const wire = `data: ${JSON.stringify(chunk("Hel"))}\r\n\r\ndata: ${JSON.stringify(chunk("lo"))}\n\ndata: [DONE]\n\ndata: ${JSON.stringify(chunk("!"))}\n\n`;
    const bytes = new TextEncoder().encode(wire);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        // Split mid-event and mid-codepoint boundaries alike.
        for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7));
        controller.close();
      }
    });
    const events: StreamEvent[] = [];
    await readSseStream(body, (event) => events.push(event));
    expect(events).toEqual([chunk("Hel"), chunk("lo")]);
  });

  it("ignores comment and heartbeat lines", () => {
    const parser = new SseParser();
    expect(parser.push(": ping\n\nevent: x\ndata: {\"type\":\"done\"}\n\n")).toEqual([{ type: "done" }]);
  });
});

describe("stream reducer", () => {
  it("builds an answer from deltas, tool results and a reset after the tool loop", () => {
    const message = createLiveAssistant("a");
    const events: StreamEvent[] = [
      { model: "m1", ...chunk("Let me search. ") },
      { type: "tool:start", toolCallId: "t1", name: "web_search", arguments: "{\"query\":\"klui\"}" },
      { type: "tool:result", toolCallId: "t1", citations: [{ index: 1, url: "https://a" }, { index: 2, url: "https://b" }] },
      { type: "tool:start", toolCallId: "t2", name: "web_search", arguments: "{}" },
      { type: "tool:result", toolCallId: "t2", citations: [{ index: 1, url: "https://c" }] },
      { type: "response:reset" },
      { choices: [{ delta: { reasoning: "thinking" } }] },
      chunk("Final answer."),
      { choices: [{ delta: {}, finish_reason: "stop" }] },
      { type: "done" }
    ];
    for (const event of events) applyStreamEvent(message, event);

    expect(message.content).toBe("Final answer.");
    expect(message.model).toBe("m1");
    expect(message.reasoning).toBe("");
    expect(message.citations.map((c) => [c.index, c.url])).toEqual([[1, "https://a"], [2, "https://b"], [3, "https://c"]]);
    expect(message.toolEvents.map((t) => [t.id, t.status, t.query])).toEqual([["t1", "done", "klui"], ["t2", "done", ""]]);
    expect(message.finishReason).toBe("stop");
    expect(message.activityEndedAt).toBeGreaterThan(0);
  });

  it("keeps reasoning only when asked and records server errors", () => {
    const message = createLiveAssistant("a");
    applyStreamEvent(message, { choices: [{ delta: { reasoning_content: "why" } }] }, { keepReasoning: true });
    applyStreamEvent(message, { type: "error", error: "Out of credits." });
    expect(message.reasoning).toBe("why");
    expect(message.error).toBe("Out of credits.");
    expect(message.finishReason).toBe("error");
  });
});
