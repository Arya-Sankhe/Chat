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
(the top of `chat.js`). `chatHooks` in `state/app.ts` is how React asks the core
for something (pending attachments, filling the prompt, a Settings tab's data);
where React needs the core's internals the other way round, a hooks object is
filled when the core mounts (`sideChatHooks` in `state/sideChat.ts`).

## What React owns

The shell and its surfaces are React components in `src/shell` that render from
zustand stores in `src/state`:

- the sidebar, search, the composer chrome, the home mode pills and slide theme
  gallery (`state/homeModes.ts`), and the phone sheets;
- Settings (general, voice, memory, storage, account; `state/account.ts`), the
  account drawer and admin settings;
- the pricing screen: plans, coupons and checkout (`state/billing.ts`);
- the Deep Research report view (`state/researchReport.ts`);
- the side chat (`state/sideChat.ts`);
- the image lightbox and the pasted text viewer (`state/viewers.ts`);
- the in-app camera sheet (`state/camera.ts`);
- the voice picker, in Settings and as the modal chooser (`state/voicePicker.ts`);
- the dialogs (confirm, rename, auth, project/course/study creation), the
  toasts and the app update prompts.

The Dojo's page is React too (`src/dojo`); `studyHub.js` stays its engine.

## What stays here, and why

- **The conversation core** (`chat.js`, `render.js`, `streaming.js`,
  `reasoning.js`, `activityFeed.js`, `pendingTurns.js`, and the message
  renderers `compare.js`, `council.js`, `research.js`): sending, streaming,
  attachments, skills, follow-ups, and the `#messages` list. The core also owns
  the prompt and the send, stop and voice buttons; React renders them once with
  their markup classes. Moving the message list to React is one large step, not
  a slice: the renderers patch streaming messages in place.
- **The document viewer** (`documentViewer.js`, `documentEditor.js`): PDF.js
  pages, zoom, the Office/sheet views and the editor are imperative renderers.
- **Voice mode's live session** (`voiceMode.js`) and the AI tutor call
  (`studyTutor.js`): audio engines whose overlay follows the mic level at frame
  rate.
- **The Dojo engine** (`studyHub.js` and its `study*.js` modules, loaded on
  demand). It feeds the React Dojo and moves the composer, `#messages` and the
  document viewer into its own panels. React renders those nodes among static
  siblings only, so it never has to re-insert them.
- **Canvas and motion** (`klui.js`, `klui-motion.js`, `composerKlui.js`,
  `betaWelcome.js`, `voiceSatellites.js`, `whiteboard/`): drawn frame by frame.
- **`api.js`** and **`platform/`**: the HTTP client and the web platform layer,
  not views.

Island changes are noted in a header comment where a file differs from its
original.
