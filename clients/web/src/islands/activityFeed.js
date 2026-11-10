// The live status feed under the Klui bar: short lines saying what Klui is doing right now
// (searches, pages read, sources found, document steps, glimpses of its thinking).
const MAX_ENTRIES = 30;

function clip(text, max = 64) {
  const value = String(text || "").replace(/\s+/g, " ").trim();
  return value.length > max ? `${value.slice(0, max - 1).trim()}…` : value;
}

export function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function toolStart(name, args) {
  const query = clip(args.query);
  if (name === "web_search") return { kind: "search", text: query ? `Searching “${query}”` : "Searching the web" };
  if (name === "read_url") return { kind: "read", text: hostOf(args.url) ? `Reading ${hostOf(args.url)}` : "Reading a page" };
  if (name === "get_weather") return { kind: "search", text: args.location ? `Checking the weather in ${clip(args.location, 40)}` : "Checking the forecast" };
  if (name === "search_document") return { kind: "search", text: query ? `Searching your files for “${query}”` : "Searching your files" };
  if (name === "read_document") return { kind: "read", text: "Reading your document" };
  if (name === "extract_tables") return { kind: "read", text: "Pulling tables out of your document" };
  if (name === "query_spreadsheet") return { kind: "step", text: "Crunching numbers in your spreadsheet" };
  if (name === "create_document") return { kind: "step", text: args.title ? `Starting “${clip(args.title, 48)}”` : "Starting your document" };
  if (name === "edit_document") return { kind: "step", text: "Editing your document" };
  if (name === "export_document") return { kind: "step", text: "Exporting the file" };
  if (name === "load_tools") return { kind: "step", text: "Getting the right tools out" };
  return { kind: "step", text: "Working on it" };
}

function settle(message) {
  for (const entry of message.activity) entry.live = false;
}

function push(message, entry) {
  settle(message);
  message.activity.push({ live: true, ...entry });
  if (message.activity.length > MAX_ENTRIES) message.activity.splice(0, message.activity.length - MAX_ENTRIES);
}

// Folds one stream event (tool:* or status:*) into message.activity.
export function applyActivityEvent(message, event, args = {}) {
  if (!message.activity) message.activity = [];
  const type = event?.type;
  if (type === "tool:start") {
    push(message, { key: event.toolCallId, ...toolStart(event.name, args) });
  } else if (type === "tool:result") {
    const entry = message.activity.find((row) => row.key === event.toolCallId);
    if (entry) entry.live = false;
    const hosts = [...new Set((event.citations || []).map((citation) => hostOf(citation.url)).filter(Boolean))];
    if (event.name === "web_search" && hosts.length) {
      const count = (event.citations || []).length;
      push(message, { key: `${event.toolCallId}:found`, kind: "sources", hosts: hosts.slice(0, 3), text: `Found ${count} source${count === 1 ? "" : "s"} · ${hosts.slice(0, 2).join(", ")}`, live: false });
    }
  } else if (type === "tool:error") {
    const entry = message.activity.find((row) => row.key === event.toolCallId);
    if (entry) Object.assign(entry, { kind: "error", live: false, text: event.name === "read_url" ? `${entry.text.replace(/^Reading/, "Couldn't open")}, moving on` : "One step hit a snag, moving on" });
  } else if (type === "tool:limit") {
    push(message, { key: `limit:${message.activity.length}`, kind: "step", text: "Wrapping up with what I found" });
  } else if (type === "status:step" && event.text) {
    push(message, { key: `step:${message.activity.length}:${event.text}`, kind: "step", text: clip(event.text, 80) });
  } else if (type === "status:thought" && event.text) {
    // Thoughts rotate through one line instead of piling up.
    const last = message.activity.at(-1);
    if (last?.kind === "thought") message.activity.pop();
    push(message, { key: `thought:${message.activity.length}:${event.text}`, kind: "thought", text: clip(event.text, 110) });
  }
}
