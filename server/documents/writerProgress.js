// Live progress for the document writers, shown in the chat's status feed: each section heading
// (docs) or slide title (decks) as the writer streams it, and the pages it looks up.
const GAP_MS = 1200;
const HEADING = /^#{1,3}[ \t]+(.+)\n|"title"\s*:\s*"((?:[^"\\\n]|\\.){3,90})"/gm;

function label(raw) {
  const text = String(raw || "")
    .replace(/\|\|.*$/, "")
    .replace(/\\"/g, "\"")
    .replace(/[*_`]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (text.length < 3) return "";
  return text.length > 70 ? `${text.slice(0, 67).trim()}…` : text;
}

function host(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

export function createWriterProgress(onProgress, { verb = "Writing", now = Date.now } = {}) {
  if (typeof onProgress !== "function") return { onEvent() {}, onToolEvent() {} };
  let text = "";
  let sentAt = -Infinity;
  let pending = "";
  const send = (line, force = false) => {
    pending = line || pending;
    if (!pending || (!force && now() - sentAt < GAP_MS)) return;
    onProgress(pending);
    pending = "";
    sentAt = now();
  };
  return {
    onEvent(event) {
      const delta = event?.choices?.[0]?.delta?.content;
      if (typeof delta !== "string" || !delta) return;
      text += delta;
      let consumed = 0;
      let found = "";
      HEADING.lastIndex = 0;
      for (let match = HEADING.exec(text); match; match = HEADING.exec(text)) {
        consumed = match.index + match[0].length;
        found = label(match[1] || match[2]) || found;
      }
      // Keep the unfinished tail; a heading may still be streaming in.
      text = consumed ? text.slice(consumed) : text.slice(-400);
      send(found ? `${verb} “${found}”` : "");
    },
    onToolEvent(event) {
      if (event?.type !== "tool:start") return;
      let args = {};
      try { args = JSON.parse(event.arguments || "{}"); } catch {}
      if (event.name === "web_search" && args.query) send(`Looking up “${label(args.query)}”`, true);
      else if (event.name === "read_url" && host(args.url)) send(`Reading ${host(args.url)}`, true);
    }
  };
}
