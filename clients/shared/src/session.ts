import type { KluiConfig, Session } from "./types";

/* Same storage key and JSON shape as the current clients, so a session saved
   by one generation of the app is readable by the next. */
export const AUTH_STORAGE_KEY = "klui.auth.v1";

export interface KeyValueStorage {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

const cleanUrl = (value: string) => String(value || "").replace(/\/+$/, "");
const nowSeconds = () => Math.floor(Date.now() / 1000);

export function sessionFromTokenPayload(payload: Record<string, any>, previous: Session | null = null): Session {
  return {
    access_token: String(payload.access_token),
    refresh_token: payload.refresh_token || previous?.refresh_token || null,
    expires_at: Number(payload.expires_at) || nowSeconds() + Number(payload.expires_in || 3600),
    token_type: payload.token_type || "bearer"
  };
}

async function authError(response: Response, fallback: string): Promise<Error> {
  const payload = await response.json().catch(() => ({})) as Record<string, string>;
  return new Error(payload.error_description || payload.msg || payload.message || fallback);
}

export type SessionListener = (session: Session | null) => void;

/** What the API client and the page need from whoever owns the session. */
export interface SessionSource {
  current(): Session | null;
  ensureFresh(options?: { force?: boolean }): Promise<Session | null>;
}

/* Owns the signed-in session: persistence, refresh and sign-out. A refresh in
   flight is shared, because Supabase rotates refresh tokens and two parallel
   refreshes would invalidate each other. */
export class SessionManager implements SessionSource {
  private session: Session | null = null;
  private refreshing: Promise<Session | null> | null = null;
  /* Bumped on every save. A refresh that finishes after the session changed
     (sign-out, another account) must not write its result back. */
  private generation = 0;
  /* Storage writes run one at a time in call order, so a sign-out queued
     after a refresh's write always lands last. */
  private writes: Promise<void> = Promise.resolve();
  private listeners = new Set<SessionListener>();
  private config: KluiConfig | null = null;

  private fetchImpl: typeof fetch;

  constructor(private storage: KeyValueStorage, fetchImpl?: typeof fetch) {
    // Never store the global fetch as a method: browsers reject it when called with another `this`.
    this.fetchImpl = fetchImpl ?? ((input, init) => fetch(input, init));
  }

  setConfig(config: KluiConfig) {
    this.config = config;
  }

  current(): Session | null {
    return this.session;
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async load(): Promise<Session | null> {
    try {
      const parsed = JSON.parse((await this.storage.get(AUTH_STORAGE_KEY)) || "null") as Session | null;
      this.session = parsed?.access_token ? parsed : null;
    } catch {
      this.session = null;
    }
    return this.session;
  }

  async save(session: Session | null): Promise<void> {
    this.generation += 1;
    this.refreshing = null;
    const next = session?.access_token ? session : null;
    this.session = next;
    const write = this.writes.then(() => (next
      ? this.storage.set(AUTH_STORAGE_KEY, JSON.stringify(next))
      : this.storage.remove(AUTH_STORAGE_KEY)));
    this.writes = write.catch(() => {});
    for (const listener of this.listeners) listener(next);
    await write;
  }

  /** Returns a usable session, refreshing when it expires within two minutes or when forced. */
  async ensureFresh({ force = false } = {}): Promise<Session | null> {
    const session = this.session;
    if (!session?.refresh_token) return session;
    if (!force && session.expires_at - nowSeconds() > 120) return session;
    if (!this.refreshing) {
      const pending = this.refresh(session, this.generation).finally(() => {
        if (this.refreshing === pending) this.refreshing = null;
      });
      this.refreshing = pending;
    }
    return this.refreshing;
  }

  private async refresh(session: Session, generation: number): Promise<Session | null> {
    const config = this.requireConfig();
    let response: Response;
    try {
      response = await this.fetchImpl(`${cleanUrl(config.supabaseUrl)}/auth/v1/token?grant_type=refresh_token`, {
        method: "POST",
        headers: { apikey: config.supabaseAnonKey, "content-type": "application/json" },
        body: JSON.stringify({ refresh_token: session.refresh_token })
      });
    } catch {
      // Offline: keep the session; the request that needed it will fail on its own.
      return generation === this.generation ? session : this.session;
    }
    if (generation !== this.generation) return this.session;
    if (!response.ok) {
      // A 4xx means the refresh token is dead; a 5xx is Supabase having a moment.
      if (response.status >= 500) return session;
      await this.save(null);
      return null;
    }
    const next = sessionFromTokenPayload(await response.json(), session);
    if (generation !== this.generation) return this.session;
    const saving = this.save(next);
    const saved = this.generation;
    await saving;
    // Signed out (or switched accounts) while the new tokens were being written.
    return saved === this.generation ? next : this.session;
  }

  /** Native sign-in: exchanges the code a PKCE browser flow returned. */
  /** Null when the attempt stopped being wanted while the exchange ran. */
  async signInWithPkceCode(code: string, verifier: string, stillWanted: () => boolean = () => true): Promise<Session | null> {
    const config = this.requireConfig();
    const response = await this.fetchImpl(`${cleanUrl(config.supabaseUrl)}/auth/v1/token?grant_type=pkce`, {
      method: "POST",
      headers: { apikey: config.supabaseAnonKey, "content-type": "application/json" },
      body: JSON.stringify({ auth_code: code, code_verifier: verifier })
    });
    if (!response.ok) throw await authError(response, "Google sign-in failed.");
    const session = sessionFromTokenPayload(await response.json());
    if (!stillWanted()) return null;
    await this.save(session);
    return session;
  }

  /** Web sign-in: exchanges a Google Identity Services credential. */
  async signInWithGoogleIdToken(idToken: string): Promise<Session> {
    if (!idToken) throw new Error("Google did not return a sign-in token.");
    const config = this.requireConfig();
    const response = await this.fetchImpl(`${cleanUrl(config.supabaseUrl)}/auth/v1/token?grant_type=id_token`, {
      method: "POST",
      headers: { apikey: config.supabaseAnonKey, "content-type": "application/json" },
      body: JSON.stringify({ provider: "google", id_token: idToken })
    });
    if (!response.ok) throw await authError(response, "Google sign-in failed.");
    const session = sessionFromTokenPayload(await response.json());
    await this.save(session);
    return session;
  }

  async signOut(): Promise<void> {
    const session = this.session;
    const config = this.config;
    if (session?.access_token && config) {
      await this.fetchImpl(`${cleanUrl(config.supabaseUrl)}/auth/v1/logout`, {
        method: "POST",
        headers: { apikey: config.supabaseAnonKey, authorization: `Bearer ${session.access_token}` }
      }).catch(() => {});
    }
    await this.save(null);
  }

  private requireConfig(): KluiConfig {
    if (!this.config) throw new Error("Klui configuration is not loaded yet.");
    return this.config;
  }
}

/* The token a page embedded in the app may hold: never the refresh token. */
export type SessionSnapshot = Pick<Session, "access_token" | "expires_at" | "token_type">;

export function sessionSnapshot(session: Session | null): SessionSnapshot | null {
  return session?.access_token
    ? { access_token: session.access_token, expires_at: session.expires_at, token_type: session.token_type }
    : null;
}

/** The app's session as a page sees it. The generation goes up with every change. */
export interface HostedSessionState {
  generation: number;
  session: SessionSnapshot | null;
}

export interface SessionHost {
  snapshot(): Promise<HostedSessionState>;
  refresh(force: boolean): Promise<HostedSessionState>;
  signOut(): Promise<void>;
}

/* The session inside a page embedded in the app. The app owns the session and
   is the only one that refreshes it (Supabase rotates refresh tokens, so two
   owners would invalidate each other); this holds the latest access token. */
export class HostedSession implements SessionSource {
  private session: Session | null = null;
  private generation = -1;
  private listeners = new Set<SessionListener>();

  constructor(private host: SessionHost) {}

  setConfig(_config: KluiConfig) {}

  current(): Session | null {
    return this.session;
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /* A reply can be overtaken by a newer event from the app; the older of the two loses. */
  private accept(state: HostedSessionState) {
    if (state.generation < this.generation) return false;
    this.generation = state.generation;
    this.session = state.session ? { ...state.session, refresh_token: null } : null;
    return true;
  }

  /** The app told the page its session changed. */
  update(state: HostedSessionState) {
    if (!this.accept(state)) return;
    for (const listener of this.listeners) listener(this.session);
  }

  async load(): Promise<Session | null> {
    this.accept(await this.host.snapshot());
    return this.session;
  }

  /** Clearing is local: only the app ends the session (signOut). */
  async save(session: Session | null): Promise<void> {
    if (session) throw new Error("The app owns the session.");
    this.session = null;
    for (const listener of this.listeners) listener(null);
  }

  async ensureFresh({ force = false } = {}): Promise<Session | null> {
    const session = this.session;
    if (!session) return null;
    if (!force && session.expires_at - nowSeconds() > 120) return session;
    this.accept(await this.host.refresh(force));
    return this.session;
  }

  async signInWithGoogleIdToken(_idToken: string): Promise<Session> {
    throw new Error("The app owns sign-in.");
  }

  async signOut(): Promise<void> {
    await this.host.signOut();
  }
}

/* Native Google sign-in (Supabase PKCE). */
export function googleAuthorizeUrl(options: { supabaseUrl: string; redirectTo: string; codeChallenge: string }): string {
  const query = [
    ["provider", "google"],
    ["redirect_to", options.redirectTo],
    ["code_challenge", options.codeChallenge],
    ["code_challenge_method", "s256"],
    ["prompt", "select_account"]
  ].map(([key, value]) => `${key}=${encodeURIComponent(value!)}`).join("&");
  return `${cleanUrl(options.supabaseUrl)}/auth/v1/authorize?${query}`;
}

export type AuthCallback = { code: string; error: string };

/** The code or error in an OAuth redirect, or null if the URL isn't exactly this app's callback. */
export function parseAuthCallback(url: string, callbackUrl: string): AuthCallback | null {
  const value = String(url || "");
  const [address = ""] = value.split(/[?#]/, 1);
  if (address.replace(/\/+$/, "") !== callbackUrl.replace(/\/+$/, "")) return null;
  const params: Record<string, string> = {};
  for (const part of value.slice(address.length + 1).split(/[?#&]/)) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    let text = part.slice(separator + 1).replace(/\+/g, " ");
    try { text = decodeURIComponent(text); } catch { /* keep it as sent */ }
    params[part.slice(0, separator)] ??= text;
  }
  return { code: params.code || "", error: params.error_description || params.error_code || params.error || "" };
}
