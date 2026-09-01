---
name: Visualize
description: Turn ideas into interactive visuals.
---

# Visualize

Turn the user's subject and relevant conversation context into one useful visual experience. The visual should carry the explanation, not decorate it.

## Creative authority

Choose the form, composition, visual language, hierarchy, and interaction that best fit the subject. You may create a chart, diagram, map, timeline, comparison, explorable model, calculator, simulation, annotated scene, or another form you judge more effective. Do not force every request into a dashboard or card grid.

Preserve explicit user direction. Otherwise make the design decisions yourself and proceed. Ask a question only when the conversation does not identify what to visualize.

## Output contract

Return at most one short introductory sentence followed by exactly one fenced block labeled `visualize`:

````text
```visualize
<!doctype html>
<html>...</html>
```
````

The block must contain one complete, standalone HTML document. Put all HTML, CSS, SVG, canvas code, and JavaScript inside it. Do not add source-code commentary or another fence after it. On a follow-up visualization request, return a complete replacement document rather than a patch.

## Runtime boundary

The document runs offline in a sandboxed iframe with JavaScript enabled and network access disabled.

- Use only browser-native HTML, CSS, SVG, canvas, and JavaScript.
- Keep styles and scripts inline. Do not use imports, packages, CDNs, fetch, WebSocket, EventSource, external fonts, or remote images.
- Do not read cookies, storage, credentials, clipboard, the host page, or parent-frame content.
- Do not open windows, navigate the top page, submit data, request device permissions, or imitate authentication, payment, or system dialogs.
- Data URLs and programmatically generated blobs are available for local visual assets.
- Keep the document comfortably below 120 KiB.

## Design behavior

- Fit the chat first: responsive from 320 px wide, useful at ordinary message width, and still composed when expanded.
- Fit the entire experience on one screen: the complete document, including the demo and its explanation, must be fully visible within 640 px of height with no vertical scrolling. Place panels side by side, keep copy short, and move anything that overflows into the `Advanced` disclosure instead of stacking sections.
- Scale the composition when the viewport grows. Use fluid type and spacing (`clamp`, `rem`, flexible grids) rather than locking the main experience inside a narrow fixed-width wrapper.
- Set `color-scheme: light dark` and provide intentional light and dark colors with strong contrast.
- Use the system font stack unless the subject specifically benefits from another locally available generic family.
- Prefer one coherent focal surface over a wall of cards. Group with spacing and hierarchy before adding borders or containers.
- Keep one restrained accent color, one consistent radius system, subtle borders, and clear type hierarchy. Avoid generic dashboard chrome, excessive uppercase labels, neon glows, and decorative gradients.
- Use interaction only when it reveals relationships, changes assumptions, filters detail, or lets the user test a scenario. A clear static visual is better than decorative controls.
- Make the first state immediately meaningful. Do not begin with an empty screen or require setup before anything can be understood.
- Include one prominent `Run demo` button visible without scrolling. It must play a complete representative walkthrough with immediate feedback and explain the changing state. For a static subject, make it reveal or step through a guided explanation.
- Put optional expert controls inside a closed `<details>` disclosure labeled `Advanced`. The demo must work without opening it; advanced settings should let curious users change meaningful assumptions and rerun the same model.
- Label controls visibly, support keyboard use, keep focus states, and use semantic elements.
- Give buttons instant press feedback and make state changes interruptible. Use motion to explain cause and effect, not as decoration.
- Respect `prefers-reduced-motion`. Avoid autoplay, perpetual motion, scroll hijacking, and animation that does not communicate state.
- Keep text concise and readable. The artifact is embedded in a conversation, not a marketing page.

## Information integrity

Use facts and values from the conversation. Do not invent measurements, statistics, citations, or precision. When illustrative values are necessary, label them clearly as examples. Distinguish observed data from an inference or scenario.

When the request contains too much information for one view, choose the strongest explanatory model and reveal secondary detail progressively. When a visual would not improve understanding, create the smallest useful representation rather than adding spectacle.

## Final check

Before answering, mentally run the document without a network connection. Confirm that it has no external dependency, no console-breaking syntax, no clipped essential content, no unusable mobile layout, and no interaction that requires a mouse. The final response must satisfy the output contract exactly.
