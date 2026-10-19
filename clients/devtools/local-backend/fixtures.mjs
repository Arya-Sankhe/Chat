// Resets the two parity users to identical fixture data: the old site signs in
// as "old", the new client as "new", so neither sees the other's writes.
// Ids and timestamps are fixed so screenshots are repeatable.
// Usage: node fixtures.mjs            (reset both users)
//        node fixtures.mjs session old (print a session for one user)
import { execFileSync } from "node:child_process";

const SUPABASE_URL = "http://127.0.0.1:55421";
// The Supabase CLI's public demo keys for local stacks.
const ANON = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0";
const SERVICE = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU";
const PASSWORD = "local-parity-password";

export const USERS = {
  old: { id: "00000000-0000-4000-8000-0000000000a1", email: "student@klui.test", tag: "a" },
  new: { id: "00000000-0000-4000-8000-0000000000b1", email: "student.new@klui.test", tag: "b" }
};

/** The clock both browsers are frozen at; fixture times are relative to it. */
export const NOW = "2026-10-19T12:00:00.000Z";

const id = (user, kind, n) => `00000000-0000-4000-${kind}-${user.tag}${String(n).padStart(11, "0")}`;
const sql = (text) => execFileSync("docker", ["exec", "-i", "supabase_db_klui-parity", "psql", "-U", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], { input: text });
const lit = (value) => (value == null ? "null" : `'${String(value).replace(/'/g, "''")}'`);
const json = (value) => `${lit(JSON.stringify(value))}::jsonb`;

const RICH_REPLY = [
  "Photosynthesis turns light into chemical energy in two stages.",
  "",
  "## Light-dependent reactions",
  "",
  "1. Chlorophyll absorbs light in the **thylakoid membranes**.",
  "2. Water is split, releasing *oxygen*.",
  "3. The energy is stored as `ATP` and `NADPH`.",
  "",
  "## The Calvin cycle",
  "",
  "| Input | Output |",
  "| --- | --- |",
  "| CO2 | Glucose |",
  "| ATP, NADPH | ADP, NADP+ |",
  "",
  "```python",
  "def glucose_from(co2_molecules):",
  "    return co2_molecules // 6",
  "```",
  "",
  "> In short: light in, sugar out."
].join("\n");

function fixtureSql(user) {
  const conversations = [
    { n: 1, title: "Photosynthesis basics", at: "2026-10-19T10:30:00Z" },
    { n: 2, title: "Essay outline on climate policy", at: "2026-10-18T16:00:00Z" },
    { n: 3, title: "Calculus limits practice", at: "2026-10-02T09:00:00Z" }
  ];
  const rows = [];
  for (const c of conversations) {
    rows.push(`insert into public.conversations (id, user_id, title, model, created_at, updated_at) values (${lit(id(user, "8000", c.n))}, ${lit(user.id)}, ${lit(c.title)}, 'think', ${lit(c.at)}, ${lit(c.at)});`);
  }
  const conversationId = id(user, "8000", 1);
  rows.push(`insert into public.messages (id, user_id, conversation_id, role, content, model, finish_reason, created_at, turn_run_id) values
    (${lit(id(user, "a000", 1))}, ${lit(user.id)}, ${lit(conversationId)}, 'user', ${json("Explain photosynthesis simply")}, null, null, '2026-10-19T10:30:00Z', null),
    (${lit(id(user, "a000", 2))}, ${lit(user.id)}, ${lit(conversationId)}, 'assistant', ${json(RICH_REPLY)}, 'think', 'stop', '2026-10-19T10:30:05Z', null);`);
  return rows.join("\n");
}

async function ensureUser(user) {
  const headers = { apikey: SERVICE, authorization: `Bearer ${SERVICE}`, "content-type": "application/json" };
  const body = { email: user.email, password: PASSWORD, email_confirm: true, user_metadata: { full_name: "Test Student", beta_welcome_seen: true } };
  const created = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, { method: "POST", headers, body: JSON.stringify({ id: user.id, ...body }) });
  if (!created.ok) {
    // Already there: put its metadata back to the fixture state.
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${user.id}`, { method: "PUT", headers, body: JSON.stringify(body) });
  }
}

export async function session(name) {
  const user = USERS[name];
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: ANON, "content-type": "application/json" },
    body: JSON.stringify({ email: user.email, password: PASSWORD })
  });
  const value = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(value));
  return { access_token: value.access_token, refresh_token: value.refresh_token, expires_at: value.expires_at, token_type: value.token_type };
}

export async function reset() {
  for (const user of Object.values(USERS)) {
    await ensureUser(user);
    // Everything a user owns hangs off profiles/auth.users with cascades; clearing
    // conversations and projects covers what the fixtures and scenarios create.
    sql(`insert into public.profiles (id, email, created_at, updated_at) values (${lit(user.id)}, ${lit(user.email)}, '2026-09-01T00:00:00Z', '2026-09-01T00:00:00Z') on conflict (id) do nothing;
         delete from public.conversations where user_id = ${lit(user.id)};
         delete from public.projects where user_id = ${lit(user.id)};
         ${fixtureSql(user)}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv[2] === "session") console.log(JSON.stringify(await session(process.argv[3] || "old")));
  else {
    await reset();
    console.log("Fixtures reset for", Object.keys(USERS).join(", "));
  }
}
