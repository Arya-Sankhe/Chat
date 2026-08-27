import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { readStylesheet } from "./helpers/styles.js";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, "..", "public");

function readPublic(path) {
  return readFileSync(resolve(publicDir, path), "utf8");
}

test("clarification card stays optional and supports recommended, custom, back, skip, and continue paths", () => {
  const html = readPublic("index.html");
  const appJs = readPublic("js/app.js");
  const researchJs = readPublic("js/research.js");
  const css = readStylesheet();
  assert.match(html, /id="clarificationCard"/);
  assert.doesNotMatch(appJs, /normalPromptMayNeedClarification|imageOnly|normalVague/);
  assert.match(appJs, /if \(state\.researchMode && !skipClarification && await maybeRequestClarifications\(text, paste\)\) return/);
  assert.match(appJs, /displayTextOverride:\s*flow\.text/);
  assert.match(researchJs, /startDeepResearch\(query, displayQuery = query\)/);
  assert.match(researchJs, /query,\s*displayQuery,/);
  assert.match(appJs, />Recommended</);
  assert.match(appJs, /No, tell it differently/);
  assert.match(appJs, /data-clarification-back/);
  assert.match(appJs, /data-clarification-skip/);
  assert.match(appJs, /data-clarification-continue/);
  assert.match(css, /\.clarification-card\s*\{[^}]*max-height:[^;}]+/);
  assert.match(css, /\.clarification-body\s*\{[^}]*overflow-y:\s*auto/);
});

test("chat search distinguishes pending, failed, and empty message searches", () => {
  const html = readPublic("index.html");
  const appJs = readPublic("js/app.js");
  assert.doesNotMatch(html, /id="searchChatResults"[^>]*aria-live/);
  assert.match(html, /id="searchChatStatus"[^>]*aria-live="polite"/);
  assert.match(appJs, /searchBodyStatus = "pending"/);
  assert.match(appJs, /Searching messages…/);
  assert.match(appJs, /Message search is unavailable\. Try again\./);
  assert.match(appJs, /searchChatStatus\?\.setAttribute\("aria-busy", bodyStatus === "pending" \? "true" : "false"\)/);
  assert.match(appJs, /scheduleSearchBody\(event\.target\.value\);\s*renderSearchResults\(event\.target\.value\)/);
});

test("chat search has no global Ctrl or Command K shortcut", () => {
  const appJs = readPublic("js/app.js");
  assert.doesNotMatch(appJs, /\(e\.ctrlKey \|\| e\.metaKey\)[\s\S]{0,160}e\.key\.toLowerCase\(\) === "k"/);
});

test("user message footer always offers copy; edit stays gated behind canEditUserMessage", () => {
  const appJs = readPublic("js/app.js");
  const footer = appJs.match(/function renderUserMessageFooter\(msg\)\s*\{[\s\S]*?\n\}/);
  assert.ok(footer, "renderUserMessageFooter not found");
  assert.doesNotMatch(
    footer[0],
    /if\s*\(\s*!canEditUserMessage\(msg\)\s*\)\s*return\s*""/,
    "copy must not be gated behind canEditUserMessage"
  );
  assert.match(footer[0], /messageCopyButton\(msg,\s*\{\s*iconOnly:\s*true\s*\}\)/);
  assert.match(footer[0], /messageReportButton\(msg\)/);
  assert.match(footer[0], /canEditUserMessage\(msg\)/);
  assert.match(footer[0], /formatMessageStamp\(msg\.created_at\)/);
  assert.match(footer[0], /class="msg-timestamp"/);
  assert.match(footer[0], /if\s*\(\s*!copy\s*&&\s*!report\s*&&\s*!edit\s*&&\s*!time\s*\)\s*return\s*""/);
});

test("user message timestamps appear on hover and expand on date hover", () => {
  const appJs = readPublic("js/app.js");
  const css = readStylesheet();
  assert.match(appJs, /function formatMessageStamp\(iso\)/);
  assert.match(css, /\.message\.user:hover \.msg-timestamp/);
  assert.match(css, /\.msg-timestamp:hover::after/);
  assert.match(css, /content:\s*attr\(data-full\)/);
});

test("assistant responses expose length controls and desktop selection reuses temporary chat and pasted context", () => {
  const appJs = readPublic("js/app.js");
  const html = readPublic("index.html");
  const css = readStylesheet();
  assert.match(appJs, /data-adjust-response="longer"/);
  assert.match(appJs, /data-adjust-response="shorter"/);
  assert.match(appJs, /retryFailedAssistant\(assistantId, adjustment\)/);
  assert.match(appJs, /function addTextToComposerPaste\(/);
  assert.ok((appJs.match(/addTextToComposerPaste\(/g) || []).length >= 3);
  assert.match(appJs, /streamTemporaryChat\(state\.session/);
  assert.match(appJs, /renderAssistantActivity\(message, \{ streaming \}\)/);
  assert.match(appJs, /const beforePinned = sideChatState\.autoScroll && isNearBottom\(els\.sideChatMessages/);
  assert.match(appJs, /sideChatState\.running \|\| !sideChatState\.context/);
  assert.match(appJs, /els\.sideChatInput\?\.value\.trim\(\) \|\| \(sideChatState\.flashcard \? "" : "Explain this\."\)/);
  assert.match(appJs, /streamTemporaryChat\(state\.session,\s*\{[\s\S]*?writingStyle:\s*"concise"/);
  assert.match(appJs, /data-add-to-card=/);
  assert.match(appJs, /if \(await sideChatState\.onAddToCard\(text\)\)/);
  assert.match(appJs, /btn\.textContent = "Add to this card"/);
  assert.match(appJs, /Ask any doubts\./);
  assert.match(appJs, /role: sideChatState\.role \|\| selectedSingleRole\(\)/);
  assert.match(appJs, /els\.sideChatMessages\?\.addEventListener\("wheel"/);
  assert.match(appJs, /if \(event\.deltaY < 0\) sideChatState\.autoScroll = false/);
  assert.match(appJs, /els\.sideChatMessages\?\.addEventListener\("touchmove"/);
  assert.match(html, /id="selectionAddToChat"/);
  assert.match(html, /id="selectionAskSideChat"/);
  assert.match(html, /id="sideChatPanel"/);
  assert.match(html, /id="sideChatInput"[^>]*placeholder="Ask about this"/);
  assert.match(css, /\.side-chat-panel\s*\{[^}]*resize:\s*both/);
  assert.match(css, /\.side-chat-composer\s*\{[^}]*align-items:\s*center[^}]*border:\s*1px solid var\(--border\)/);
  assert.match(css, /body\.capacitor-native \.side-chat-panel\s*\{[^}]*display:\s*none\s*!important/);
});

test("flashCopySuccess swaps the button SVG to a checkmark on success", () => {
  const appJs = readPublic("js/app.js");
  const flash = appJs.match(/function flashCopySuccess\(btn\)\s*\{[\s\S]*?\n\}/);
  assert.ok(flash, "flashCopySuccess not found");
  assert.match(flash[0], /btn\._copyIconHtml\s*\|\|=\s*icon\.outerHTML/);
  assert.match(flash[0], /M20 6L9 17l-5-5/);
  assert.match(flash[0], /current\.outerHTML\s*=\s*btn\._copyIconHtml/);
});

test("thinking status is block-level and omitted once final answer text exists", () => {
  const appJs = readPublic("js/app.js");
  const css = readStylesheet();
  const render = appJs.match(/function renderThinkingStatus\(message[\s\S]*?\n\}/);
  assert.ok(render, "renderThinkingStatus not found");
  assert.match(
    render[0],
    /if\s*\(\s*rawTextContent\(message\?\.content\)\.trim\(\)\s*&&\s*!isProvisionalToolProse\(message\)\s*\)\s*return\s*""/,
    "status must stay for provisional tool prose and disappear for final answer text"
  );
  assert.doesNotMatch(appJs, /return\s*"Answering"/);
  assert.match(
    css,
    /\.thinking-status\s*\{[^}]*display:\s*flex/,
    "thinking-status should be display:flex"
  );
  assert.match(css, /\.thinking-status\.is-leaving/);
});

test("streamed answer text gets a short blur reveal without animating reduced-motion clients", () => {
  const appJs = readPublic("js/app.js");
  const css = readStylesheet();
  assert.match(appJs, /function animateNewestStreamingText\(root, addedCharacters\)/);
  assert.match(appJs, /animateNewestStreamingText\(contentEl, addedCharacters\)/);
  assert.match(css, /\.streaming-text-reveal\s*\{[^}]*160ms[^}]*cubic-bezier\(0\.23, 1, 0\.32, 1\)/s);
  assert.match(css, /@keyframes streaming-text-reveal\s*\{[\s\S]*?filter:\s*blur\(2px\)[\s\S]*?filter:\s*blur\(0\)/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)[\s\S]*?\.streaming-text-reveal\s*\{[^}]*animation:\s*none/s);
});

test("compare and council finish by patching live cards instead of requiring a remount", () => {
  const compareJs = readPublic("js/compare.js");
  const councilJs = readPublic("js/council.js");
  const appJs = readPublic("js/app.js");
  assert.match(compareJs, /function patchCompareMessage\(article, messages\)/);
  assert.match(compareJs, /if \(!article\?\.classList\.contains\("compare-message"\)\) return false/);
  assert.match(compareJs, /lanes\.length !== messages\.length/);
  assert.match(councilJs, /function patchCouncilMessage\(article, council\)/);
  assert.match(councilJs, /if \(!article\?\.classList\.contains\("council-message"\) \|\| !council\) return false/);
  assert.match(councilJs, /lanes\.length !== panelists\.length/);
  assert.match(councilJs, /synthesis\.outerHTML = renderCouncilSynthesis\(council\.chairman, panelists\)/);
  assert.match(appJs, /compareController\.patchCompareMessage\(article, view\.messages\)/);
  assert.match(appJs, /councilController\.patchCouncilMessage\(article, view\.council\)/);
});

test("council hydration normalizes persisted finish reasons and keeps media aliases positional", () => {
  const appJs = readPublic("js/app.js");
  const councilJs = readPublic("js/council.js");
  assert.match(appJs, /finishReason:\s*msg\.finishReason \|\| msg\.finish_reason \|\| ""/);
  assert.match(appJs, /stage1Status:\s*panelists\.every\(\(panelist\) => panelist\.finishReason \|\| panelist\.error\) \? "done" : "active"/);
  assert.match(councilJs, /if \(fallbackIndex >= 0\) return compareModelAlias\(fallbackIndex\)/);
  assert.doesNotMatch(councilJs, /COUNCIL_MEDIA_MODELS/);
  assert.match(councilJs, /panelists\.findIndex\(\(panelist\) => panelist\.model === reviewerId\)/);
});

test("message tables are wrapped for horizontal scroll", () => {
  const renderJs = readPublic("js/render.js");
  const appJs = readPublic("js/app.js");
  const css = readStylesheet();
  assert.match(renderJs, /function wrapMessageTables\(/);
  assert.match(renderJs, /class="table-scroll"/);
  assert.match(renderJs, /html\s*=\s*wrapMessageTables\(html\)/);
  assert.match(appJs, /function adoptUnchangedTableScrolls\(/);
  assert.match(appJs, /adoptUnchangedTableScrolls\(contentEl, tmp\)/);
  assert.match(
    css,
    /\.message-content\s+\.table-scroll\s*\{[^}]*overflow-x:\s*auto/,
    "table-scroll must allow horizontal overflow"
  );
  assert.match(
    css,
    /\.message-content\s+table\s*\{[^}]*width:\s*max-content/,
    "tables should size to content so wide ones scroll"
  );
  assert.match(css, /\.message-content\s+\.table-scroll\s*\{[^}]*border-radius:\s*12px/s);
  assert.match(css, /\.message-content\s+th\s*\{[^}]*font-weight:\s*700[^}]*font-size:\s*14px/s);
  assert.match(css, /white-space:\s*nowrap/, "cells must not wrap mid-word");
  assert.match(css, /overflow-wrap:\s*normal/, "cells override message overflow-wrap");
});

test("document artifact cards open the viewer without a separate download action", () => {
  const appJs = readPublic("js/app.js");
  const renderer = appJs.match(/function renderArtifacts\(message[\s\S]*?\n\}/);
  assert.ok(renderer, "renderArtifacts not found");
  assert.match(renderer[0], />Open<\/button>/);
  assert.doesNotMatch(renderer[0], />View<\/button>|>Download<\/a>/);
});

test("illustration lightbox caption reads the renderAssistantContent message argument", () => {
  const appJs = readPublic("js/app.js");
  assert.match(appJs, /function renderAssistantContent\(content, message\)/);
  assert.match(appJs, /isIllustrationMessage\(message\)/);
  assert.doesNotMatch(appJs, /isIllustrationMessage\(msg\)/);
});

test("late-loaded chat images keep an auto-scrolling conversation pinned", () => {
  const appJs = readPublic("js/app.js");
  assert.match(appJs, /addEventListener\("load", \(event\) => \{\s*if \(!event\.target\.closest\?\.\("img\.message-image"\) \|\| !state\.autoScroll\) return;\s*requestAnimationFrame\(pinMessagesToBottom\);\s*\}, true\)/);
});

test("sent images render in a compact horizontal strip above the user bubble", () => {
  const appJs = readPublic("js/app.js");
  const css = readStylesheet();
  assert.match(appJs, /function renderUserImages\(/);
  assert.match(appJs, /class="user-image-strip"/);
  assert.match(appJs, /\$\{userImages\}<div class="message-content">/);
  assert.match(css, /\.user-image-strip\s*\{[^}]*display:\s*flex[^}]*overflow-x:\s*auto/s);
  assert.match(css, /\.message\.user \.user-image-strip \.message-image\s*\{[^}]*width:\s*64px[^}]*height:\s*64px/s);
});

test("code block copy button reuses the message compare copy control", () => {
  const renderJs = readPublic("js/render.js");
  const markup = renderJs.match(/class="msg-copy-btn compare-copy-btn code-copy-btn"[\s\S]*?<\/button>/);
  assert.ok(markup, "code-copy-btn markup not found");
  assert.match(markup[0], /<span>Copy<\/span>/, "code copy must use the shared Copy label");
  assert.match(markup[0], /width="13"/);
  assert.match(markup[0], /<path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"\/>/);
});

test("renderer keeps DOMPurify's SVG-safe profile enabled", () => {
  const renderJs = readPublic("js/render.js");
  assert.match(
    renderJs,
    /USE_PROFILES:\s*\{\s*html:\s*true,\s*svg:\s*true\s*\}/,
    "sanitize must allow SVG or the copy path is stripped to a single square"
  );
});

test("temporary chat toggle only shows on empty home or active temp chat outside Projects", () => {
  const appJs = readPublic("js/app.js");
  const css = readStylesheet();
  const fn = appJs.match(/function renderTemporaryChatMode\(\)\s*\{[\s\S]*?\n\}/);
  assert.ok(fn, "renderTemporaryChatMode not found");
  assert.match(fn[0], /showTempToggle\s*=\s*!state\.projectsOpen\s*&&\s*!state\.studyOpen\s*&&\s*\(onEmptyChat\s*\|\|\s*state\.temporaryChat\)/);
  assert.match(fn[0], /temporaryChatToggle\?\.classList\.toggle\(\s*"hidden",\s*!showTempToggle\s*\)/);
  assert.match(
    css,
    /body\.capacitor-native:not\(\.chat-empty\):not\(\.temporary-chat\)\s+\.temporary-chat-toggle/,
    "APK rule must keep the toggle visible during an active temp chat"
  );
});

test("temporary chat reuses the image upload path but keeps documents blocked", () => {
  const appJs = readPublic("js/app.js");
  assert.doesNotMatch(appJs, /Temporary chat is text-only for now/);
  assert.match(appJs, /state\.temporaryChat\s*\?\s*fileCategory\(file\)\s*===\s*"image"/);
  assert.match(appJs, /for \(const img of images\)/);
  assert.match(appJs, /Temporary chat supports images only/);
  assert.match(appJs, /if \(String\(url\)\.startsWith\("blob:"\)\) URL\.revokeObjectURL\(url\)/);
});

test("composer plus rotates into an x and the send button travels like a keycap", () => {
  const css = readStylesheet();
  assert.match(css, /\.composer-plus-btn\[aria-expanded="true"\] svg \{[\s\S]*?transform:\s*rotate\(45deg\)/);
  assert.match(css, /\.send-btn\.active \{[\s\S]*?transform:\s*translateY\(-3px\)/);
  assert.match(css, /\.send-btn\.active:active \{[\s\S]*?transform:\s*translateY\(4px\)/);
});

test("voice input rolls the native recorder through the shared composer", () => {
  const appJs = readPublic("js/app.js");
  const html = readPublic("index.html");
  const css = readStylesheet();
  assert.match(html, /id="voiceButton"/);
  assert.match(html, /voice-icon-cancel/);
  assert.match(html, /send-icon-confirm/);
  assert.doesNotMatch(appJs, /SPEECH_CHUNK_MS/);
  assert.match(appJs, /voiceChunks\.push\(event\.data\)/);
  assert.match(appJs, /new Blob\(chunks,/);
  assert.match(appJs, /transcribeSpeech\(state\.session, blob\)/);
  assert.match(appJs, /stopVoiceRecording\(\{ commit: false \}\)/);
  assert.match(appJs, /stopVoiceRecording\(\{ commit: true \}\)/);
  assert.match(css, /\.voice-btn\.is-recording \.voice-icon-cancel/);
  assert.match(css, /\.send-btn\.is-voice-confirm \.send-icon-confirm/);
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
});

test("conversation switches restore only that chat's pending documents", () => {
  const appJs = readPublic("js/app.js");
  const open = appJs.match(/async function openConversation\(conversationId\)\s*\{[\s\S]*?\n\}/);
  const poll = appJs.match(/async function pollUploadedDocument\(localId, attachmentId\)\s*\{[\s\S]*?\n\}/);
  assert.ok(open, "openConversation not found");
  assert.ok(poll, "pollUploadedDocument not found");
  assert.match(open[0], /state\.images = state\.images\.filter\(\(item\) => item\.category !== "document"\)/);
  assert.match(open[0], /await restorePendingDocuments\(\)/);
  assert.doesNotMatch(poll[0], /if \(doc\.usable\) \{\s*forgetPendingDocument/);
});

test("XLSX viewer retains an escaped HTML fallback behind the native workbook viewer", () => {
  const source = readPublic("js/documentViewer.js");
  assert.match(source, /function renderSheetViewer\(\)/);
  assert.match(source, /escapeHtml\(row\[columnIndex\] \|\| ""\)/);
  assert.match(source, /new window\.DocsAPI\.DocEditor\("klui-office-viewer", config\)/);
  assert.match(source, /if \(viewer\.sheets\?\.length\) \{[\s\S]*?renderSheetViewer\(\)/);
});
