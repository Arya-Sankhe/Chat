import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = resolve(here, "..", "public");

function readPublic(path) {
  return readFileSync(resolve(publicDir, path), "utf8");
}

// Locate the most recent (last) definition of a CSS rule whose selector
// contains `selectorFragment` inside a body.capacitor-native block. We
// need the LAST match because the file is layered — earlier rules from
// previous rounds exist but are superseded by the authoritative block at
// the end.
function findLastNativeRule(css, selectorFragment) {
  // Greedy match: any number of body.capacitor-native rules. Find the
  // final one whose selector includes the fragment.
  const regex = /body\.capacitor-native[^{]*\{[^}]*\}/g;
  let match;
  let result = null;
  while ((match = regex.exec(css)) !== null) {
    if (match[0].includes(selectorFragment)) result = match[0];
  }
  return result;
}

test("the APK top bar exposes a Thinking/Pro/Compare/Council mode dropdown and no longer shows the Klui wordmark", () => {
  const html = readPublic("index.html");
  assert.match(html, /id="nativeMobileModeButton"/, "mode chip button missing");
  assert.match(html, /id="nativeMobileModeDropdown"/, "mode dropdown missing");
  assert.match(html, /data-mode="thinking"/, "Thinking option missing");
  assert.match(html, /data-mode="pro"/, "Pro option missing");
  assert.match(html, /data-mode="compare"/, "Compare option missing");
  assert.match(html, /data-mode="council"/, "Council option missing");
  assert.doesNotMatch(
    html,
    /<span class="native-mobile-brand">Klui<\/span>/,
    "Klui wordmark should be removed from the APK top bar"
  );
});

test("the top bar markup order: hamburger → mode chip → temp-chat label → temp-chat icon → new-chat", () => {
  const html = readPublic("index.html");
  const idxMenu = html.indexOf('id="nativeMobileMenu"');
  const idxMode = html.indexOf('id="nativeMobileModeButton"');
  const idxLabel = html.indexOf('id="temporaryChatLabel"');
  const idxTemp = html.indexOf('id="temporaryChatToggle"');
  const idxNew = html.indexOf('id="compactNewChatButton"');
  assert.ok(idxMenu > 0 && idxMode > 0 && idxLabel > 0 && idxTemp > 0 && idxNew > 0, "top bar controls must exist");
  assert.ok(idxMenu < idxMode, "hamburger should be left of mode chip");
  assert.ok(idxMode < idxLabel, "mode chip should be left of active temporary-chat label");
  assert.ok(idxLabel < idxTemp, "active temporary-chat label should sit before the temp-chat icon");
  assert.ok(idxTemp < idxNew, "temp-chat icon should be left of new-chat");
});

test("the APK temporary-chat label is in the top bar, not floated into the chat content", () => {
  const css = readPublic("styles.css");
  const blocks = [...css.matchAll(/body\.capacitor-native \.temporary-chat-label \{[^}]*\}/g)].map((m) => m[0]);
  const block = blocks.find((candidate) => candidate.includes("position: static"));
  assert.ok(block, "native temporary-chat label layout block not found");
  assert.match(block, /position:\s*static/, "temporary-chat label should participate in the top bar row");
  assert.doesNotMatch(block, /top:\s*calc/, "temporary-chat label must not be positioned below the bar");
  assert.doesNotMatch(block, /left:\s*50%/, "temporary-chat label must not be centered in chat content");
});

test("the document viewer Download control is a <button> (not an <a>) so the Android WebView does not open the share sheet", () => {
  const html = readPublic("index.html");
  assert.match(
    html,
    /<button[^>]+id="documentViewerDownload"[^>]*>Download<\/button>/,
    "Download should be a <button> element on the APK"
  );
});

test("the renderer wires the viewer's Download dataset to the same attachment id used by the Capacitor-aware download path", () => {
  const appJs = readPublic("js/app.js");
  assert.match(
    appJs,
    /documentViewerDownload\.dataset\.attachmentId\s*=\s*downloadAttachmentId/,
    "viewer download dataset.attachmentId assignment missing"
  );
  assert.match(
    appJs,
    /documentViewerDownload\?\.addEventListener\(\s*"click"/,
    "viewer download click handler missing"
  );
  assert.match(
    appJs,
    /await\s+downloadAttachment\(state\.session,\s*attachmentId,\s*fileName\)/,
    "viewer download click should call downloadAttachment"
  );
  assert.doesNotMatch(
    appJs,
    /documentViewerDownload\.href\s*=/,
    "viewer download must not set an href (it is now a <button>)"
  );
});

test("the temporary chat toggle clears the press highlight synchronously when toggled off", () => {
  const appJs = readPublic("js/app.js");
  assert.match(
    appJs,
    /temporaryChatToggle\?\.addEventListener\(\s*"click"/,
    "temporary chat toggle click handler missing"
  );
  const clickBlock = appJs.match(
    /temporaryChatToggle\?\.addEventListener\(\s*"click",\s*\(\)\s*=>\s*\{[\s\S]*?\}\s*\)/
  );
  assert.ok(clickBlock, "click handler block not found");
  assert.match(
    clickBlock[0],
    /temporaryChatToggle\??\.classList\.remove\(\s*"pressed"\s*\)/,
    "click handler should clear the .pressed class"
  );
});

test("the mode chip has a subtle translucent surface while the top bar remains transparent", () => {
  const css = readPublic("styles.css");
  assert.match(
    css,
    /body\.capacitor-native \.native-mobile-mode-btn[\s\S]*?background:\s*var\(--apk-chip-bg\)\s*!important/,
    "mode button should use the subtle APK chip surface"
  );
  // The chevron inside the chip must render at full opacity, not 0.7.
  const chipChildren = findLastNativeRule(css, " .native-mobile-mode-btn svg {");
  assert.ok(chipChildren, "chip children (svg) block not found");
  assert.match(
    chipChildren,
    /opacity:\s*1/,
    "chevron inside mode chip should be opacity:1"
  );
});

test("the status bar / notification panel visually blends into the top bar (no seam)", () => {
  const css = readPublic("styles.css");
  // The top bar itself has a solid background = --bg, not transparent.
  const bar = findLastNativeRule(css, ".native-mobile-bar {");
  assert.ok(bar, ".native-mobile-bar block not found");
  assert.match(
    bar,
    /background:\s*transparent\s*!important/,
    "top bar should be transparent; only the individual controls get translucent surfaces"
  );
  assert.doesNotMatch(bar, /backdrop-filter:\s*blur/, "top bar should not have a backdrop-filter");
  // The bar should have no visible bottom border (the seam the user
  // complained about). An explicit "border-bottom: 0" is fine — what
  // matters is that there is no 1px+ border creating a visual line.
  assert.doesNotMatch(bar, /border-bottom:\s*[1-9]/, "top bar must not have a visible border-bottom");
  // The configureNativeChrome call in app.js must read --bg.
  const appJs = readPublic("js/app.js");
  assert.match(
    appJs,
    /getComputedStyle\(document\.body\)\.getPropertyValue\(\s*"--bg"\s*\)/
  );
  // Messages start immediately under the bar — no +24px gap.
  // The selector fragment must NOT match the .chat-empty variant.
  const messages = findLastNativeRule(css, " .messages {");
  assert.ok(messages, ".messages block not found");
  // Skip the chat-empty variant and re-find if needed.
  const messages2 = messages.includes("chat-empty")
    ? findLastNativeRule(css, " .messages {\n")
    : messages;
  // Find the rule that contains padding-top and the new token.
  const candidates = [...css.matchAll(/body\.capacitor-native[^{]*\{[^}]*\}/g)]
    .map((m) => m[0])
    .filter((s) => s.includes("padding-top"))
    .filter((s) => /^\s*body\.capacitor-native\s+\.messages\s*\{/.test(s));
  const messagesFinal = candidates[candidates.length - 1];
  assert.ok(messagesFinal, "the plain .messages rule with padding-top was not found");
  assert.ok(
    messagesFinal.includes("padding-top: calc(var(--safe-area-inset-top, env(safe-area-inset-top)) + var(--native-bar-h) + 4px)"),
    "messages padding-top must end with + 4px (no 24px seam). Got:\n" + messagesFinal
  );
});

test("the compact pill while scrolling is small, centered, solid, and tappable", () => {
  const css = readPublic("styles.css");
  assert.match(
    css,
    /body\.capacitor-native \.composer \{[\s\S]*?background:\s*var\(--bg\)\s*!important/,
    "normal composer should use an opaque APK background"
  );

  const compact = findLastNativeRule(css, ".composer.compact {");
  assert.ok(compact, ".composer.compact block not found");
  assert.match(compact, /background:\s*color-mix\(in srgb, var\(--text-secondary\)/, "compact should use a solid text-secondary-based pill background");
  assert.match(compact, /opacity:\s*1/, "compact pill should not be transparent");
  assert.match(compact, /width:\s*56px/, "compact width should be 56px (small tappable pill)");
  assert.match(compact, /height:\s*14px/, "compact height should be 14px (small tappable pill)");
  assert.match(compact, /margin:\s*0 auto/, "compact pill should remain centered");

  const hiddenChildren = css.match(/body\.capacitor-native \.composer\.compact \.composer-previews,[\s\S]*?display:\s*none\s*!important/);
  assert.ok(hiddenChildren, "compact mode should hide textarea/actions so the pill has no text inside");

  // JS uses hysteresis to avoid flicker, keeps typed text/attachments full-size,
  // and tapping the compact pill expands + focuses the composer.
  const appJs = readPublic("js/app.js");
  assert.match(appJs, /bottomDistance\s*<=\s*2/, "compact state should only clear at the actual bottom");
  assert.match(appJs, /setTimeout\(\(\) => \{[\s\S]*?distanceFromBottom\(els\.messages\) <= 2[\s\S]*?\}, 120\)/, "compact state should wait for scroll to settle before auto-expanding at bottom");
  assert.match(appJs, /bottomDistance\s*>=\s*180/, "compact state should only start once clearly away from bottom");
  assert.match(appJs, /composerHasPendingContent\(\) \|\| composerHasFocus\(\)/, "pending text/attachments or focus should prevent compact mode");
  assert.match(appJs, /state\.images\?\.length\) els\.composer\?\.classList\.remove\("compact"\)/, "attachment previews should keep the composer full-size");
  assert.match(appJs, /blurEmptyComposerForHistoryScroll\(\)/, "scrolling history should blur an empty focused composer so it can compact");
  assert.match(appJs, /focusPromptInput\(\)/, "tapping the compact pill should expand and focus the composer");
  assert.match(appJs, /Keyboard\.show\(\)/, "native focus should request the Android keyboard");
});

test("the composer is hidden model/compare chips on the APK (Gemini-style clean pill)", () => {
  const css = readPublic("styles.css");
  assert.match(
    css,
    /body\.capacitor-native \.composer-bottom \.composer-actions > \.composer-model-wrap[\s\S]*?display:\s*none\s*!important/
  );
  assert.match(
    css,
    /body\.capacitor-native \.composer-bottom \.composer-actions > \.composer-compare-wrap[\s\S]*?display:\s*none\s*!important/
  );
});

test("the attachment preview remove (X) button is always visible on the APK (no hover-only opacity)", () => {
  const css = readPublic("styles.css");
  const block = findLastNativeRule(css, ".preview-remove {");
  assert.ok(block, "preview-remove block not found");
  assert.match(block, /opacity:\s*1/, "preview-remove should be opacity:1 on native");
  assert.match(block, /pointer-events:\s*auto/);
});

test("the document viewer overlays the whole screen on the APK (sidebar offset is the bug being fixed)", () => {
  const css = readPublic("styles.css");
  assert.match(
    css,
    /body\.capacitor-native\.document-viewer-open \.document-viewer\s*\{[\s\S]*?inset:\s*0/
  );
});
