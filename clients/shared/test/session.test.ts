import { afterEach, describe, expect, it, vi } from "vitest";
import { AUTH_STORAGE_KEY, HostedSession, SessionManager, parseAuthCallback, sessionSnapshot, type KeyValueStorage, type SessionSnapshot } from "../src/session";

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

describe("the session inside an embedded page", () => {
  const snapshot = (access_token: string, expires_at: number, generation = 1) => ({
    generation,
    session: { access_token, expires_at, token_type: "bearer" } as SessionSnapshot
  });
  const inHour = () => Math.floor(Date.now() / 1000) + 3600;

  it("refreshes only through the app, holds no refresh token, and clearing it stays local", async () => {
    const host = {
      snapshot: vi.fn(async () => snapshot("a1", Math.floor(Date.now() / 1000) + 30)),
      refresh: vi.fn(async () => snapshot("a2", inHour())),
      signOut: vi.fn(async () => {})
    };
    const session = new HostedSession(host);
    await session.load();
    expect((await session.ensureFresh())?.access_token).toBe("a2");
    await session.ensureFresh();
    expect(host.refresh).toHaveBeenCalledTimes(1);
    expect(session.current()?.refresh_token).toBeNull();
    await expect(session.save({ access_token: "x", refresh_token: "y", expires_at: 1, token_type: "bearer" })).rejects.toThrow();

    const heard: unknown[] = [];
    session.subscribe((next) => heard.push(next));
    await session.save(null);
    expect(heard).toEqual([null]);
    expect(host.signOut).not.toHaveBeenCalled();
    await session.signOut();
    expect(host.signOut).toHaveBeenCalledTimes(1);
  });

  it("a reply overtaken by a newer event from the app loses", async () => {
    let answer: (state: ReturnType<typeof snapshot>) => void = () => {};
    const host = {
      snapshot: async () => snapshot("a1", Math.floor(Date.now() / 1000) + 30, 1),
      refresh: () => new Promise<ReturnType<typeof snapshot>>((resolve) => { answer = resolve; }),
      signOut: async () => {}
    };
    const session = new HostedSession(host);
    await session.load();
    const refreshing = session.ensureFresh();
    session.update({ generation: 3, session: null });
    answer(snapshot("stale", inHour(), 2));
    await refreshing;
    expect(session.current()).toBeNull();
  });

  it("what the app hands a page never carries the refresh token", () => {
    expect(sessionSnapshot({ access_token: "a", refresh_token: "secret", expires_at: 5, token_type: "bearer" })).toEqual({ access_token: "a", expires_at: 5, token_type: "bearer" });
    expect(sessionSnapshot(null)).toBeNull();
  });
});

describe("the sign-in callback", () => {
  const callback = "tech.klui.app://auth/callback";

  it("takes the code or error only from this app's exact address", () => {
    expect(parseAuthCallback(`${callback}?code=abc`, callback)).toEqual({ code: "abc", error: "" });
    expect(parseAuthCallback(`${callback}#error=x&error_description=Nope+now`, callback)).toEqual({ code: "", error: "Nope now" });
    for (const other of ["tech.klui.app://evil/callback?code=abc", "https://auth/callback?code=abc", `${callback}/more?code=abc`, `other://x?u=${callback}&code=abc`]) {
      expect(parseAuthCallback(other, callback)).toBeNull();
    }
  });
});
