import { describe, expect, it } from "vitest";
import { NetworkError, createApiClient } from "../src/api";
import { SessionManager } from "../src/session";
import type { StreamEvent } from "../src/types";

const noStorage = { get: async () => null, set: async () => {}, remove: async () => {} };

function clientWith(streamFetch: typeof fetch) {
  return createApiClient({ baseUrl: "https://klui.test", session: new SessionManager(noStorage), streamFetch });
}

/* A body that delivers one event, then fails the way expo/fetch's native layer does. */
function droppingBody() {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode('data: {"choices":[{"delta":{"content":"Hi"}}]}\n\n'));
      setTimeout(() => controller.error(new Error("unexpected end of stream on http://10.0.2.2:5199/...")), 0);
    }
  });
}

describe("api client transport errors", () => {
  it("reports native connect failures and mid-stream drops as NetworkError, aborts as AbortError, and callback bugs as themselves", async () => {
    // expo/fetch: a refused connection is a plain Error, not a TypeError.
    const refused = clientWith(async () => { throw new Error("fetch failed: java.net.ConnectException: Failed to connect"); });
    const connectError = await refused.streamMessage("c1", {}, { onEvent: () => {} }).catch((error) => error);
    expect(connectError).toBeInstanceOf(NetworkError);
    expect(connectError.message).not.toMatch(/java/);

    const events: StreamEvent[] = [];
    const dropping = clientWith(async () => new Response(droppingBody(), { headers: { "x-klui-turn-run-id": "r1" } }));
    const dropError = await dropping.streamMessage("c1", {}, { onEvent: (event) => events.push(event) }).catch((error) => error);
    expect(dropError).toBeInstanceOf(NetworkError);
    expect(events.map((event) => event.type ?? "delta")).toEqual(["turn:submitted", "delta"]);

    // expo/fetch rejects an aborted request with a plain Error too.
    const controller = new AbortController();
    const aborting = clientWith(async () => { controller.abort(); throw new Error("fetch failed: The operation was aborted."); });
    const abortError = await aborting.streamMessage("c1", {}, { signal: controller.signal, onEvent: () => {} }).catch((error) => error);
    expect(abortError.name).toBe("AbortError");

    const bug = new RangeError("reducer bug");
    const healthy = clientWith(async () => new Response(droppingBody()));
    const callbackError = await healthy.streamMessage("c1", {}, { onEvent: (event) => { if (event.choices) throw bug; } }).catch((error) => error);
    expect(callbackError).toBe(bug);

    // A malformed payload is a protocol error, not a connectivity one.
    const garbled = clientWith(async () => new Response("data: {not json\n\n"));
    const parseError = await garbled.streamMessage("c1", {}, { onEvent: () => {} }).catch((error) => error);
    expect(parseError).toBeInstanceOf(SyntaxError);
  });
});

describe("boot prefetch", () => {
  it("uses each prefetched response once and refetches when the prefetch failed", async () => {
    const boot: Record<string, Promise<Response | null> | undefined> = {
      config: Promise.resolve(new Response('{"from":"prefetch"}')),
      plans: Promise.resolve(new Response("down", { status: 503 }))
    };
    const fetched: string[] = [];
    const client = createApiClient({
      baseUrl: "",
      session: new SessionManager(noStorage),
      fetch: async (input) => { fetched.push(String(input)); return new Response('{"from":"network"}'); },
      takeBootResponse: (name) => { const pending = boot[name] ?? null; delete boot[name]; return pending; }
    });
    expect(await client.fetchConfig()).toEqual({ from: "prefetch" });
    expect(await client.fetchConfig()).toEqual({ from: "network" });
    expect(await client.fetchPlans()).toEqual({ from: "network" });
    expect(fetched).toEqual(["/api/config", "/api/plans"]);
  });
});

describe("web build id", () => {
  it("sends the page's build id with every request and asks for a build check when the server turns one away", async () => {
    const sent: (string | null)[] = [];
    let checks = 0;
    let buildId = "";
    const client = createApiClient({
      baseUrl: "",
      session: new SessionManager(noStorage),
      fetch: async (_input, init) => {
        sent.push(new Headers(init?.headers).get("x-klui-build-id"));
        return new Response('{"error":"This tab is out of date. Reload to continue."}', { status: 426 });
      },
      buildId: () => buildId,
      onStaleBuild: () => { checks += 1; }
    });
    // Before /api/config answers there is no build id to send.
    await client.renameConversation("c1", "Atoms").catch(() => {});
    buildId = "build-7";
    await client.renameConversation("c1", "Atoms").catch(() => {});
    expect(sent).toEqual([null, "build-7"]);
    expect(checks).toBe(2);
  });
});
