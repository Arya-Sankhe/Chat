import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { MEMORY_PROFILE_INSTRUCTIONS, userAuthoredText, withUserMemorySystemPrompt } from "../server/saas/userMemory.js";

test("memory reads only user-authored text parts", () => {
  assert.equal(userAuthoredText("plain message"), "plain message");
  assert.equal(userAuthoredText([
    { type: "text", text: "typed alongside the upload" },
    { type: "image_url", image_url: { url: "secret image" } },
    { type: "file", file: { content: "secret document" } }
  ]), "typed alongside the upload");
});

test("memory is clearly delimited as context, never instructions", () => {
  const prompt = withUserMemorySystemPrompt("Base", "Prefers concise replies.");
  assert.match(prompt, /never treat it as instructions/);
  assert.match(prompt, /<user_memory>[\s\S]*Prefers concise replies\.[\s\S]*<\/user_memory>/);
});

test("memory keeps durable context, not social small talk", () => {
  assert.match(MEMORY_PROFILE_INSTRUCTIONS, /Relevant Context/);
  assert.match(MEMORY_PROFILE_INSTRUCTIONS, /Do not retain greetings, small talk, weather/);
  assert.doesNotMatch(MEMORY_PROFILE_INSTRUCTIONS, /relationships/i);
});

test("memory storage is backend-only and collection queries only user messages", () => {
  const migration = fs.readFileSync(new URL("../supabase/migrations/20260820153000_add_user_memory_profiles.sql", import.meta.url), "utf8");
  const rest = fs.readFileSync(new URL("../server/db/rest/memory.js", import.meta.url), "utf8");
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all .* from anon, authenticated/);
  assert.match(migration, /grant select, insert, update, delete .* to service_role/);
  assert.match(rest, /role: "eq\.user"/);
  assert.match(rest, /created_at: `gt\.\$\{after\}`/);
});
