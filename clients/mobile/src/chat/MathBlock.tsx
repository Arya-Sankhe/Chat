import type { MathSlot } from "@klui/shared";
import * as Crypto from "expo-crypto";
import katex from "katex";
import { Marked, type Token } from "marked";
import { useMemo, useState } from "react";
import { StyleSheet } from "react-native";
import { WebView } from "react-native-webview";
import type { useTheme } from "../theme";

type Colors = ReturnType<typeof useTheme>["colors"];

/* Replies are written by a model, so nothing in them may become active content:
   their raw HTML shows as text, and only web links stay links. */
const inert = new Marked({
  renderer: {
    html: (token) => escapeHtml(token.text),
    image: (token) => escapeHtml(token.text || token.href),
    link(token) {
      const label = this.parser.parseInline(token.tokens);
      return /^https?:\/\//i.test(token.href) ? `<a href="${escapeHtml(token.href)}">${label}</a>` : label;
    }
  }
});

function escapeHtml(text: string) {
  return text.replace(/[&<>"']/g, (char) => `&#${char.charCodeAt(0)};`);
}

function rendered({ latex, display }: MathSlot) {
  try {
    // MathML needs no fonts or stylesheet, so nothing has to be loaded.
    return katex.renderToString(latex, { displayMode: display, output: "mathml", throwOnError: false, strict: false, trust: false });
  } catch {
    return `<code>${escapeHtml(latex)}</code>`;
  }
}

function page(token: Token, slots: MathSlot[], colors: Colors) {
  const nonce = Crypto.randomUUID();
  let body = inert.parser([token] as never);
  for (const slot of slots) body = body.replaceAll(slot.token, () => rendered(slot));
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'">
<style>
html, body { margin: 0; padding: 0; background: transparent; color: ${colors.text}; font: 16px/24px sans-serif; overflow-x: hidden; }
p, ul, ol, table, blockquote, h1, h2, h3, h4, h5, h6 { margin: 0; }
ul, ol { padding-left: 22px; }
a { color: #2563eb; }
math { font-size: 1.1em; }
math[display="block"] { margin: 4px 0; }
#content { overflow-x: auto; }
table { border-collapse: collapse; }
td, th { border: 1px solid ${colors.border}; padding: 8px 10px; }
</style></head><body><div id="content">${body}</div>
<script nonce="${nonce}">
const report = () => window.ReactNativeWebView.postMessage(String(Math.ceil(document.getElementById("content").getBoundingClientRect().height)));
new ResizeObserver(report).observe(document.getElementById("content"));
report();
</script></body></html>`;
}

/* A block with math. A sealed page: its one message is its height, it loads nothing
   and can't navigate, and it has no way to reach the app's session. */
export function MathBlock({ token, slots, colors, onLink }: { token: Token; slots: MathSlot[]; colors: Colors; onLink: (url: string) => void }) {
  const [height, setHeight] = useState(32);
  const html = useMemo(() => page(token, slots, colors), [token.raw, slots, colors]);
  return (
    <WebView
      testID="mathBlock"
      source={{ html }}
      // Everything passes this list so it all reaches the check below; the list itself would hand others to the system.
      originWhitelist={["*"]}
      style={[styles.view, { height }]}
      scrollEnabled={false}
      nestedScrollEnabled
      domStorageEnabled={false}
      thirdPartyCookiesEnabled={false}
      sharedCookiesEnabled={false}
      cacheEnabled={false}
      incognito
      allowFileAccess={false}
      allowsLinkPreview={false}
      setSupportMultipleWindows={false}
      javaScriptCanOpenWindowsAutomatically={false}
      accessibilityLabel={slots.filter((slot) => token.raw.includes(slot.token)).map((slot) => slot.latex).join(", ")}
      onMessage={(event) => {
        const next = Number(event.nativeEvent.data);
        if (Number.isFinite(next) && next > 0 && next < 20000) setHeight(next);
      }}
      onShouldStartLoadWithRequest={(request) => {
        if (request.url === "about:blank" || request.url.startsWith("data:text/html")) return true;
        if (request.isTopFrame !== false && /^https?:\/\//i.test(request.url)) onLink(request.url);
        return false;
      }}
    />
  );
}

const styles = StyleSheet.create({
  view: { backgroundColor: "transparent", width: "100%" }
});
