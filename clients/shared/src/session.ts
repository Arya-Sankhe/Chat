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

/* Owns the signed-in session: persistence, refresh and sign-out. A refresh in
   flight is shared, because Supabase rotates refresh tokens and two parallel
   refreshes would invalidate each other. */
export class SessionManager {
  private session: Session | null = null;
  private refreshing: Promise<Session | null> | null = null;
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
    this.session = session?.access_token ? session : null;
    if (this.session) await this.storage.set(AUTH_STORAGE_KEY, JSON.stringify(this.session));
    else await this.storage.remove(AUTH_STORAGE_KEY);
    for (const listener of this.listeners) listener(this.session);
  }

  /** Returns a usable session, refreshing when it expires within two minutes or when forced. */
  async ensureFresh({ force = false } = {}): Promise<Session | null> {
    const session = this.session;
    if (!session?.refresh_token) return session;
    if (!force && session.expires_at - nowSeconds() > 120) return session;
    this.refreshing ??= this.refresh(session).finally(() => { this.refreshing = null; });
    return this.refreshing;
  }

  private async refresh(session: Session): Promise<Session | null> {
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
      return session;
    }
    if (!response.ok) {
      // A 4xx means the refresh token is dead; a 5xx is Supabase having a moment.
      if (response.status >= 500) return session;
      await this.save(null);
      return null;
    }
    const next = sessionFromTokenPayload(await response.json(), session);
    await this.save(next);
    return next;
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
