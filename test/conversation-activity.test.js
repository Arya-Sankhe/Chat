import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { readStylesheet } from "./helpers/styles.js";

const appJs = readFileSync(new URL("../public/js/app.js", import.meta.url), "utf8");

test("sidebar rows spin while a background reply runs, then show a done dot until that chat is opened", () => {
  assert.match(appJs, /const unreadDoneChats = new Set\(\)/);
  assert.match(appJs, /conversationRuns\.has\(conversation\.id\)/);
  assert.match(appJs, /conversation-activity is-running/);
  assert.match(appJs, /conversation-activity is-done/);
  assert.match(
    appJs,
    /completed && !run\.temporary && run\.conversationId && run\.conversationId !== state\.activeConversationId/
  );
  assert.match(appJs, /unreadDoneChats\.add\(run\.conversationId\)/);
  assert.match(appJs, /if \(state\.activeConversationId\) unreadDoneChats\.delete\(state\.activeConversationId\)/);
  assert.match(appJs, /endConversationRun\(runKey, \{ completed: !wasAborted && shouldReloadConversation \}\)/);
  assert.doesNotMatch(appJs, /endConversationRun\(runKey\);/);
});

test("sidebar activity styles keep a spinner and an accent done-dot", () => {
  const css = readStylesheet();
  assert.match(css, /\.conversation-activity\.is-running \{[\s\S]*?animation:\s*conversation-spin/);
  assert.match(css, /\.conversation-activity\.is-done \{[\s\S]*?background:\s*#3b82f6/);
});
