import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTH_STORAGE_KEY, SessionManager, type KeyValueStorage } from "../src/session";

function memoryStorage(initial: Record<string, string> = {}): KeyValueStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    async get(key) { return data[key] ?? null; },
    async set(key, value) { data[key] = value; },
    async remove(key) { delete data[key]; }
  };
}

const config = { supabaseUrl: "https://sb.test/", supabaseAnonKey: "anon" };
const expiringSoon = { access_token: "old", refresh_token: "r1", expires_at: Math.floor(Date.now() / 1000) + 30, token_type: "bearer" };

describe("session refresh", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("refreshes a session about to expire once, even when asked concurrently, using the global fetch", async () => {
    // A receiver check like the browser's: calling fetch with a foreign `this` throws.
    const fetchMock = vi.fn(function (this: unknown) {
      if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
      return Promise.resolve(new Response(JSON.stringify({ access_token: "new", refresh_token: "r2", expires_in: 3600 })));
    });
    vi.stubGlobal("fetch", fetchMock);
    const storage = memoryStorage({ [AUTH_STORAGE_KEY]: JSON.stringify(expiringSoon) });
    const session = new SessionManager(storage);
    session.setConfig(config);
    await session.load();

    const [a, b] = await Promise.all([session.ensureFresh(), session.ensureFresh()]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((fetchMock.mock.calls[0] as unknown[])[0]).toBe("https://sb.test/auth/v1/token?grant_type=refresh_token");
    expect(a?.access_token).toBe("new");
    expect(b).toBe(a);
    expect(JSON.parse(storage.data[AUTH_STORAGE_KEY]!).refresh_token).toBe("r2");
  });

  it("signs out on a rejected refresh token but keeps the session through a Supabase outage", async () => {
    const storage = memoryStorage({ [AUTH_STORAGE_KEY]: JSON.stringify(expiringSoon) });
    const responses = [new Response("{}", { status: 503 }), new Response("{}", { status: 400 })];
    const session = new SessionManager(storage, async () => responses.shift()!);
    session.setConfig(config);
    await session.load();

    expect((await session.ensureFresh())?.access_token).toBe("old");
    expect(await session.ensureFresh()).toBeNull();
    expect(storage.data[AUTH_STORAGE_KEY]).toBeUndefined();
  });
});

describe("session changes during a refresh", () => {
  it("a refresh that finishes after sign-out does not sign the old account back in", async () => {
    let respond!: (response: Response) => void;
    const storage = memoryStorage({ [AUTH_STORAGE_KEY]: JSON.stringify(expiringSoon) });
    const session = new SessionManager(storage, () => new Promise((resolve) => { respond = resolve; }));
    session.setConfig(config);
    await session.load();

    const refreshing = session.ensureFresh();
    await session.save(null);
    respond(new Response(JSON.stringify({ access_token: "new", refresh_token: "r2", expires_in: 3600 })));

    expect(await refreshing).toBeNull();
    expect(session.current()).toBeNull();
    expect(storage.data[AUTH_STORAGE_KEY]).toBeUndefined();
  });
});

describe("persistence order", () => {
  it("a sign-out issued while refreshed tokens are being written is what stays stored", async () => {
    let finishWrite!: () => void;
    const storage = memoryStorage({ [AUTH_STORAGE_KEY]: JSON.stringify(expiringSoon) });
    const slowSet = storage.set.bind(storage);
    storage.set = (key, value) => new Promise((resolve) => { finishWrite = () => void slowSet(key, value).then(resolve); });
    const session = new SessionManager(storage, async () => new Response(JSON.stringify({ access_token: "new", refresh_token: "r2", expires_in: 3600 })));
    session.setConfig(config);
    await session.load();

    const refreshing = session.ensureFresh();
    await vi.waitFor(() => expect(finishWrite).toBeTypeOf("function"));
    const signingOut = session.save(null);
    finishWrite();
    await Promise.all([refreshing, signingOut]);

    expect(await refreshing).toBeNull();
    expect(storage.data[AUTH_STORAGE_KEY]).toBeUndefined();
  });
});
