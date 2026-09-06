import assert from "node:assert/strict";
import test from "node:test";
import { EMAIL_FACT_RULES, needsEmailPrompt, withEmailComposerPrompt, withModelSystemPrompt } from "../server/saas/systemPrompt.js";

test("Luna receives its conversation style in the same system prompt", () => {
  const prompt = withModelSystemPrompt("Base prompt", "openai/gpt-5.6-luna");

  assert.match(prompt, /^Base prompt\n\nConversation style for this model:/);
  assert.match(prompt, /prefer 2–5 natural sentences/);
  assert.equal(withModelSystemPrompt("Base prompt", "another-model"), "Base prompt");
});

test("email composer shares factual limits and keeps unknown recipients empty", () => {
  const prompt = withEmailComposerPrompt("Base", { emailMode: true });
  assert.match(prompt, /^Base\n\nWhen the user asks for an email/);
  assert.match(prompt, /\[Name\]/);
  assert.ok(prompt.includes(EMAIL_FACT_RULES));
  assert.match(prompt, /leave To: empty/);
  assert.match(prompt, /only exact email addresses explicitly supplied/);
  assert.match(prompt, /preserve existing factual details and unrelated placeholders/);
  assert.match(prompt, /invent only that reason in the body/);
  assert.match(prompt, /must keep \[Recipient Name\], \[Assignment Name\], and \[Your Name\] unresolved/);
  assert.match(prompt, /Never use <email> HTML tags; always use the triple-backtick fence/);
  assert.equal(withEmailComposerPrompt("").includes(EMAIL_FACT_RULES), false);
});

test("email rules are enabled by intent, common typos, camel case, and email follow-ups", () => {
  for (const text of [
    "EMAIL my teacher", "send mail", "emailDraft", "eMail my boss", "emial support", "eamil them",
    "draft a note", "compose a response", "reply to Jane", "write to my professor", "respond to the client"
  ]) assert.equal(needsEmailPrompt(text), true, text);

  assert.equal(needsEmailPrompt("Make it shorter", [{ role: "assistant", content: "```email\nTo:\nSubject: Hi\n\nHello\n```" }]), true);
  assert.equal(needsEmailPrompt("Explain photosynthesis", [{ role: "assistant", content: "Unrelated answer" }]), false);
});
