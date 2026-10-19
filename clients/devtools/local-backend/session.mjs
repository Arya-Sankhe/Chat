// Prints a session for the local test user (created on first run) from the
// local Supabase stack, in the shape both clients keep under "klui.auth.v1".
// Usage: node session.mjs [email=tester@klui.test]
const SUPABASE_URL = "http://127.0.0.1:55421";
// The Supabase CLI's public demo keys for local stacks.
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";

const email = process.argv[2] || "tester@klui.test";
const password = "local-parity-password";

await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
  method: "POST",
  headers: { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json" },
  body: JSON.stringify({ email, password, email_confirm: true, user_metadata: { full_name: "Test Student" } })
}); // 422 when the user already exists, which is fine.

const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: ANON, "content-type": "application/json" },
  body: JSON.stringify({ email, password })
});
const session = await response.json();
if (!response.ok) throw new Error(JSON.stringify(session));
console.log(JSON.stringify({
  access_token: session.access_token,
  refresh_token: session.refresh_token,
  expires_at: session.expires_at,
  token_type: session.token_type
}));
