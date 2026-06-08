import assert from "node:assert/strict";
import test from "node:test";

import { configureApiAuth, fetchMe } from "../public/js/api.js";

const realFetch = globalThis.fetch;

test("API client refreshes an expiring session before authenticated requests", async () => {
  const calls = [];
  const refreshed = {
    access_token: "fresh-token",
    refresh_token: "fresh-refresh",
    expires_at: Math.floor(Date.now() / 1000) + 3600
  };
  let session = {
    access_token: "old-token",
    refresh_token: "old-refresh",
    expires_at: Math.floor(Date.now() / 1000) + 30
  };

  configureApiAuth({
    getSession: () => session,
    refresh: async () => refreshed,
    onSession: (next) => {
      session = next;
    }
  });

  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), authorization: options.headers?.authorization });
    return new Response(JSON.stringify({ user: { id: "user_1" } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const payload = await fetchMe(session);
    assert.equal(payload.user.id, "user_1");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].authorization, "Bearer fresh-token");
    assert.equal(session.access_token, "fresh-token");
  } finally {
    globalThis.fetch = realFetch;
    configureApiAuth({});
  }
});

test("API client force-refreshes and retries once on 401", async () => {
  const calls = [];
  let session = {
    access_token: "stale-token",
    refresh_token: "refresh-token",
    expires_at: Math.floor(Date.now() / 1000) + 3600
  };

  configureApiAuth({
    getSession: () => session,
    refresh: async (_session, options = {}) => {
      if (!options.force) return session;
      return {
        access_token: "retried-token",
        refresh_token: "retried-refresh",
        expires_at: Math.floor(Date.now() / 1000) + 3600
      };
    },
    onSession: (next) => {
      session = next;
    }
  });

  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), authorization: options.headers?.authorization });
    if (calls.length === 1) {
      return new Response(JSON.stringify({ error: "expired" }), {
        status: 401,
        headers: { "content-type": "application/json" }
      });
    }
    return new Response(JSON.stringify({ user: { id: "user_1" } }), {
      status: 200,
      headers: { "content-type": "application/json" }
    });
  };

  try {
    const payload = await fetchMe(session);
    assert.equal(payload.user.id, "user_1");
    assert.equal(calls.length, 2);
    assert.equal(calls[0].authorization, "Bearer stale-token");
    assert.equal(calls[1].authorization, "Bearer retried-token");
  } finally {
    globalThis.fetch = realFetch;
    configureApiAuth({});
  }
});
