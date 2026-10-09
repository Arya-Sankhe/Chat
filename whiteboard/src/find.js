import { createElement as h, useEffect, useRef, useState } from "react";
import { nativeGetMatchedLines } from "@excalidraw/excalidraw";
import { findMatches } from "./find-matches.js";

export const searchIcon = h("svg", { viewBox: "0 0 24 24", width: 20, height: 20, fill: "none", stroke: "currentColor", strokeWidth: 1.8, "aria-hidden": true },
  h("circle", { cx: 10.5, cy: 10.5, r: 6.5 }), h("path", { d: "m16 16 5 5" }));

export function Find({ api, open, onOpen, onClose }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [, refresh] = useState(0);
  const panel = useRef(null);
  const input = useRef(null);
  useEffect(() => {
    if (!open) { setQuery(""); return; }
    input.current?.focus();
    const outside = (event) => { if (!panel.current?.contains(event.target)) onClose(); };
    document.addEventListener("pointerdown", outside, true);
    const unsubscribe = api?.onChange(() => refresh((value) => value + 1));
    return () => { document.removeEventListener("pointerdown", outside, true); unsubscribe?.(); };
  }, [open, api, onClose]);
  const needle = query.trim().toLocaleLowerCase();
  const matches = open && api ? findMatches(api.getSceneElements(), query, nativeGetMatchedLines) : [];
  const results = matches.map((match) => match.element);
  const searchMatches = matches.map(({ id, focus, matchedLines }) => ({ id, focus, matchedLines }));
  const matchKey = JSON.stringify(searchMatches);
  useEffect(() => {
    api?.updateScene({ appState: { searchMatches: JSON.parse(matchKey) } });
  }, [api, matchKey]);
  useEffect(() => () => { api?.updateScene({ appState: { searchMatches: [] } }); }, [api]);
  function choose(element) {
    api.scrollToContent(element, { animate: false });
    input.current.focus();
  }
  function onKeyDown(event) {
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); onClose(); }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = results.length ? (active + (event.key === "ArrowDown" ? 1 : -1) + results.length) % results.length : 0;
      setActive(next);
      panel.current.querySelector(`[data-find-index="${next}"]`)?.scrollIntoView({ block: "nearest" });
      if (results[next]) choose(results[next]);
    }
    if (event.key === "Enter" && event.target.tagName === "INPUT" && results[active]) { event.preventDefault(); choose(results[active]); }
  }
  return h("div", { ref: panel, className: `wb-find${open ? " is-open" : ""}`, onKeyDown },
    h("div", { className: "wb-find-control" }, searchIcon,
      open ? h("input", { ref: input, value: query, placeholder: "Search for text on this board…", "aria-label": "Search for text on this board", onChange: (event) => { setQuery(event.target.value); setActive(0); } })
        : h("button", { type: "button", onClick: onOpen, title: "Find on board (Ctrl/⌘ F)", "aria-label": "Find on board" }, "Find"),
      open && h("button", { type: "button", className: "wb-find-close", onClick: onClose, "aria-label": "Close search" }, "×")),
    open && needle && h("div", { className: "wb-find-results" },
      h("p", { className: "wb-find-status", role: "status" }, `${results.length} ${results.length === 1 ? "match" : "matches"}`),
      results.map((element, index) => {
        const text = element.originalText ?? element.text;
        const start = text.toLocaleLowerCase().indexOf(needle);
        return h("button", { key: element.id, type: "button", "data-find-index": index, className: index === active ? "is-active" : "", onClick: () => { setActive(index); choose(element); } },
          text.slice(0, start), h("mark", null, text.slice(start, start + needle.length)), text.slice(start + needle.length));
      }))
  );
}
