---
name: Visualize
description: Turn ideas into interactive visuals.
---

# Visualize

Turn the user's subject and the relevant conversation into one visual that explains it. The visual carries the explanation; it is not decoration.

Pick the form that fits: a chart, diagram, timeline, map, comparison, step-through, small simulation, calculator, or annotated scene. Not everything is a dashboard. Follow any direction the user gave; otherwise decide and proceed. Ask a question only when nothing in the conversation says what to visualize.

## Output

At most one short sentence, then exactly one fenced block labeled `visualize` holding one complete HTML document:

````text
```visualize
<!doctype html>
<html>
<head><meta charset="utf-8"><style>…</style></head>
<body>
  …markup…
  <script>…</script>
</body>
</html>
```
````

Nothing after the fence. A follow-up request gets a complete replacement document, not a patch.

## Sandbox

The document runs offline in a sandboxed iframe: inline HTML, CSS, SVG, canvas, and JavaScript only. No imports, modules, CDNs, `fetch`, sockets, external fonts or images, storage, cookies, clipboard, popups, navigation, forms that submit, or permission prompts. Data URLs are fine. Stay well under 120 KiB; most good visuals are under 15 KiB.

## Built-in styles

The host already styles plain elements, so write only the CSS your layout needs:

- System font, readable sizes, light and dark colors that follow the app.
- `button` is a quiet pill; `button.primary` is the accent button. Inputs, selects, ranges, tables, `details`, and focus rings are styled.
- Color variables: `--k-fg`, `--k-muted`, `--k-line`, `--k-surface`, `--k-bg`, `--k-accent`, `--k-good`, `--k-warn`, `--k-bad`, `--k-radius`, `--k-mono`. Use them instead of hard-coded colors so dark mode works.
- Helpers: `.k-row` (wrapping flex row), `.k-stack` (vertical grid), `.k-muted`, `.k-num` (tabular numbers).
- SVG `<text>` inherits the text color.

## Code that runs the first time

Most failures are small JavaScript mistakes. Write plain, boring code:

- One classic `<script>` as the last element in `<body>`, so every element exists when it runs.
- Every `getElementById` / `querySelector` target must exist in the markup with exactly that id or class. Do not look up elements you never wrote.
- Declare a variable or function before code that runs immediately uses it. No top-level `await`, no `import`/`export`.
- Size canvases from their element (`canvas.clientWidth`) and redraw on `resize`. Never assume a fixed viewport.
- Guard every state change so pressing a button twice or mid-animation cannot break it.

## Playback

When the subject has a process, sequence, or change over time, add one `Play` button (`button.primary`) visible without scrolling. Build playback as a list of steps that each set the full state and a one-line caption, advanced by one `setTimeout` chain that `Play` restarts and `Pause`/`Reset` clears. Each step must render on its own, so the visual never depends on an earlier animation finishing.

With `prefers-reduced-motion: reduce`, still step through every state; just skip the tweening. Never skip the playback itself.

A static subject (a comparison, a structure, a single chart) does not need a Play button. Show the full picture immediately, and use hover/tap or a small control only where it reveals something.

## Look

- Fit the chat: works from 320 px wide, aims to fit in about 640 px of height. Use `clamp()` and flexible grids so it also scales up when expanded.
- One focal surface. Group with spacing before adding borders or cards. One accent color; status colors only for status.
- Sentence-case labels, short captions, real numbers with units. No emoji, gradients, glows, glassmorphism, drop-shadow stacks, or title banners. The chat already shows the title, so start with the content.
- Optional expert settings go in a closed `<details>` labeled `Advanced`.
- Label controls, keep them keyboard-usable, and make the first state meaningful, never an empty canvas.

## Information integrity

Use facts and values from the conversation. Do not invent measurements, statistics, or citations. When illustrative values are necessary, label them as examples. Keep observed data visibly separate from scenarios.

## Before answering

Read the script once as the browser would: top to bottom, with every lookup resolving and every function defined before it is called. Then return the fence and nothing after it.
