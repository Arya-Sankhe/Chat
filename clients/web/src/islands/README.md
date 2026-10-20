# Islands

Imperative DOM controllers carried over from the current site (`public/js`),
mounted by React into an element it renders and never touches again. They keep
their timers and `Math.random` call order, so the mascot greeting and motion
play exactly as before. Edit them like any other source file; `slot-text/` is
the vendored text-roll library from `public/vendor/slot-text/dist`.

`chat.js` is the chat core: the old app's conversation code, copied from
`public/js/app.js` with `devtools/codegen/extract-legacy.mjs` and grown one slice
at a time. It reads the old `state` and `els` through `state/legacy.ts`: keys
the React store owns go through the store and are only ever replaced, never
mutated. Functions React already owns come in as bridges under their old names
(the top of `chat.js`), and pieces whose slice has not landed are listed there
too. `api.js`, `render.js` and the controllers (`compare.js`, `council.js`,
`research.js`, `documentViewer.js`) are the old modules; `platform/index.js` is
the old platform layer with only its web branches. Island changes are noted in
a header comment where a file differs from its original.
