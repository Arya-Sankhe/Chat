# Klui website modernization

Scope update: the user subsequently expanded the target to a parallel frontend
rebuild for web, Android and iOS, retaining the backend. The current direction is
in [CROSS_PLATFORM_REBUILD_PLAN.md](./CROSS_PLATFORM_REBUILD_PLAN.md). The incremental
Capacitor-preserving strategy below records the earlier web-only discussion;
its migration sequence is superseded, while its behavioral findings still apply.

Status: agreed architecture after two review rounds between Codex and Claude
Opus 5.5 through the Claude Code provider. Final integration choices below are
Codex's responses to Opus's remaining questions.
Scope: architecture and implementation plan; no application migration in this change.
Repository inspected: `e7dad32` on 2026-10-19.
Planning branch: `codex/website-modernization-plan` (same application commit).

## Decision

Modernize the interactive app with React, TypeScript and Vite. Add React Router
in library mode when React takes ownership of the application shell and history,
rather than introducing a second navigation system during the first feature.
Keep the existing Node API, storage, authentication contracts, workers, hosting,
Capacitor integration and visual design. Migrate bounded features, rather than
rebuilding the entire application before users can benefit.

The goals are easier feature development, explicit state ownership, safer
refactoring and measurable UI responsiveness. React alone does not guarantee
faster rendering, better design, faster model responses or store approval.

## Discussion outcome

Opus independently recommended React/TypeScript/Vite and identified the missing
web build step, source-text test coupling and navigation/run lifecycle as key
costs. Codex accepted delaying Router until shell ownership and adding behavior
coverage before moving controls. Opus accepted Codex's objections to a whole-state
proxy, mandatory streaming rewrite, billing pilot and unsupported speed budgets.

The final build choice adopts Opus's manifest-loaded React entry: the existing
web graph stays unchanged during the pilot. The pilot is General settings
Appearance/Wallpaper/Accent; complex editors and the composer keep imperative
APIs where appropriate. There are no unresolved stack disagreements. Phase 0
is one bounded safety-net change, not a prerequisite rewrite of the whole test
suite. There is no measured effort estimate yet; a calendar deadline is not an
acceptance gate.

## Evidence from this repository

- `public/js/app.js` is about 12,119 lines. It holds shared state, element
  references, routes, rendering, stream orchestration and platform behavior.
- `public/js/streaming.js` already separates stream reducers from the page.
  `test/app-reducers.test.js` replays fixtures for ordinary chat, tool work,
  comparison and council messages. Preserve this behavior before changing UI.
- `public/js/app.js:5919` renders message lists. The streaming surface path at
  approximately line 6457 updates individual messages, batches with animation
  frames and preserves table scroll, editable emails, reasoning and live frames.
  A rewrite must not replace these guarantees with whole-app token updates.
- `public/js/render.js` contains tested Markdown, math, code, citations, email
  and visualization rendering. Its HTML sanitization and iframe policies are
  security boundaries, not incidental template code.
- `server/appShell.js` walks the browser module graph and creates hashed asset
  URLs, import maps and preloads. `server/static.js` handles compression, caching,
  app fallback routes, marketing hosts, downloads and OAuth exceptions.
- `Dockerfile` currently installs production dependencies and copies static
  sources; it has no frontend build stage. `vite.mobile.config.js` builds the
  shared public UI for Capacitor. Both delivery paths need explicit integration.
- `whiteboard/src/island.js` already mounts React through an imperative
  `mountBoard` boundary. It is built separately with `vite.whiteboard.config.js`.
- `public/js/platform/index.js` owns native-aware URLs, storage and integrations.
  Preserve that boundary; do not scatter Capacitor checks through new components.
- Several existing tests inspect source text and DOM IDs. They protect current
  wiring but need behavioral replacements as ownership deliberately moves.

## Alternatives

### Continue modular vanilla JavaScript

Lowest immediate migration cost; a valid fallback if the pilot has poor returns.
Extracting controllers and reducing shared state would still help. It leaves the
team responsible for rendering, subscriptions, cleanup and navigation patterns.

### React and TypeScript with Vite

Preferred candidate. It fits the existing independent API and static mobile
bundle, and supports adopting components without changing all routes at once.
The team must choose routing, state boundaries and data ownership deliberately.

### React Router framework mode with client rendering

A credible alternative with route types and code splitting even without server
rendering. Defer it: those benefits do not currently justify changing the server
integration and adopting framework conventions during this migration. Library
mode is sufficient when the shell moves. Do not run two navigation owners.

### Next.js

A capable choice if public, dynamic, search-indexed pages or server rendering
become primary requirements. Those requirements are not established for the
authenticated workspace. Migrating the existing server and mobile packaging to
fit Next.js adds work without an identified user benefit today. Reassess for
public sharing requirements; do not adopt it merely because Claude uses it.

### Expo / React Native and other UI frameworks

An Expo migration is a separate native product decision. React web code can
share domain logic and types with future native apps, but DOM screens do not
automatically become native screens. Vue and Svelte are credible web options;
this repo already has React and an established React whiteboard integration.

## Implementation rules

1. Each subtree has one rendering owner. React owns its component tree; legacy
   code cannot replace, reparent or globally delegate competing handlers inside
   it. An imperative tool can own a child host if React treats it as opaque and
   calls its explicit mount/update/dispose API.
2. Each domain has one writable state owner. A temporary bridge passes selected
   data and explicit callbacks; it does not synchronize two independent stores.
   React subscriptions require cached, immutable snapshots or stable versioned
   projections, not the same mutable `state` object on every read. Do not first
   convert the entire shared state to a proxy/store: nested reducer mutations
   and direct legacy writes make that a large, unrelated migration. Introduce
   the seam for one feature, then extend it only as ownership moves.
3. Keep stream connections, background runs and resumable work outside route
   component lifetimes. Moving between chats must not silently abort valid work.
   Dispose subscriptions, timers and listeners when their owner actually ends.
4. Keep stream reducers and transport behavior initially. Publish updates only
   to affected message views and batch visual work. Avoid cloning and reparsing
   entire histories for each token. Add virtualization only if measurements
   justify it and selection, scrolling and interactive tools remain correct.
5. Preserve rich-content sanitization and sandboxing. React escaping does not
   sanitize HTML inserted through an adapter. Isolate legacy rich content in an
   explicit host; stabilize live iframe/editor identity and test cleanup.
6. New frontend code uses strict TypeScript. Existing JavaScript can coexist;
   convert API and event contracts as features move. Compile-time types do not
   replace validation of external responses or authorization on the server.
7. Retain CSS classes, variables and behavior first. Add component-scoped CSS
   where needed. A utility CSS or component-library migration is not required.
8. Keep package additions small and exactly pinned under the repository's
   `.npmrc` policy. Start with React type definitions and build integration;
   adopt Router when it becomes the navigation owner. No default Redux, Zustand,
   query library, AI SDK, monorepo framework or dependency upgrades unrelated to
   the migration. Add a tool only for a demonstrated need.

## Delivery and routes

- Preserve `/`, `/c/:id`, `/research/:id`, `/projects`, `/projects/:id`, `/study`
  and `/study/:id`, including refresh, browser history and existing query data.
- Keep `/api`, OAuth callbacks, download metadata, marketing host behavior and
  asset URLs out of generic application-route fallback handling.
- First build only the new React entry through a dedicated Vite web config and
  manifest. Existing `appShell.js` keeps serving the legacy graph and injects the
  manifest entry/CSS only when enabled. Keep its source-graph walker away from
  TSX and generated chunks. Mobile's existing Vite build includes the same feature
  source. Moving the entire web graph to Vite is a later cleanup decision.
- Emit dedicated hashed assets. Serve matching build HTML/manifest and assets
  atomically; make HTML revalidate and hashed filenames immutable. Preserve
  missing-asset 404 behavior. For the pilot, catch lazy entry/chunk load failures
  before replacing the legacy controls and keep the working legacy feature.
  Never auto-reload a live stream or unsaved draft. For later shell/route chunks,
  use an error boundary that preserves the current route and offers a safe retry;
  before full shell cutover, have CI retain the previous two web asset manifests
  and their chunks as a release artifact and copy them alongside the current
  content-addressed assets into the runtime image. Test this across two builds.
- Add a Docker builder stage with dev dependencies, then copy compiled assets
  into the existing runtime stage. Include emitted files in the build ID.
- Use the same feature source for web and mobile builds, with target-specific
  configuration. Preserve static tool assets, API origin selection, OAuth,
  secure storage, keyboard, back navigation, sharing and voice behavior.
- Preserve synchronous theme/device boot and launch-screen timing. Preserve the
  lazy rich-text loader and its globals initially; a bundler must not pull every
  editor, highlighter and renderer into initial startup. Marketing, OAuth and
  download documents remain explicitly served assets. Shared source/config does
  not require web and mobile to have byte-identical outputs.
- Keep the separately built whiteboard behind its current API at first. Assess
  duplicate React payload before deciding whether to share a runtime; do not
  alter its private-library build adapters as part of unrelated migration work.

## Implementation phases

### 0. Establish behavior and performance baselines

Inventory user journeys and DOM/event ownership. Record desktop, mobile-browser
and Android behavior: login, guest continuation, chat navigation and streaming,
uploads, research, comparison/council, study, voice and rich content. Measure
cold/warm start, compressed initial JS, long-chat typing, scroll responsiveness,
main-thread work and memory after repeated navigation on representative devices.
Use repeatable stream fixtures to separate UI cost from provider latency.
Add a small Playwright browser harness with stubbed API/stream responses for
the critical journeys before removing source-text assertions. Cover the pilot
and boot/navigation first, then extend it immediately before each riskier slice;
do not require exhaustive automation of every feature before the build preflight.

Exit: reproducible baseline and agreed regression budgets. Do not invent speed
targets before measuring or infer speed from source-file length.

### 1a. Prove build plumbing without changing the UI

Add a Vite web config producing an empty React entry and manifest under a
dedicated asset namespace. Add the Docker builder stage, manifest-aware entry
injection, hashed-filename caching, CI type/build checks and inclusion in the
mobile build. Keep the existing public files, runtime module graph and inline
boot. With the flag off, manifest loading must not affect the legacy shell.
The no-op entry proves mounting and cleanup with the flag on. Verify chunk-load
failure leaves legacy UI usable and avoids reloading streams/drafts.

Exit: behavior tests, asset/deep-link/caching tests, production image and Android
bundle checks pass. No visible UI, routing or stream algorithm changes yet.

### 1b. Prove a bounded React feature

Add strict frontend TypeScript configuration and a lazy-loaded React entry.
The first feature is General settings appearance controls: Light/System/Dark,
home wallpaper selection and Accent. Exclude payment, account deletion and file
deletion. The three containers are `appearancePill`, `wallpaperPicker` and
`colorPresetRow` (`public/index.html:610`). `syncAppearanceControls` is their
writer and three delegated handlers update settings near the end of `app.js`.
Mobile setup changes the settings header/tabs rather than these controls.
Recheck these seams against current code when implementing. Reuse existing preference
commands, body/theme application and persisted formats. Pass selected settings
and explicit callbacks through one small seam; remove competing legacy writers
and handlers inside that root when the React version is enabled.

Use an opt-in rollout switch with a legacy fallback and verify mount/unmount,
system-theme changes, reload persistence, keyboard/accessibility behavior and
mobile settings navigation. Do not replace the entire settings drawer to prove
two controls. Keep legacy references valid or explicitly retire them.

Exit: the feature works on web and Android without duplicate events, broken
styles, auth changes or meaningful baseline regressions. Review the actual
reduction in coupling and implementation complexity before expanding. If the
seam requires a broad rewrite, shrink it or stop at the build improvement.

### 2. Expand components, then take over shell and navigation

Move the remaining settings and other bounded leaf surfaces, then sidebar and
conversation list UI. Start with Voice/Memory; account/storage/billing move only
with their specific behavior coverage. Introduce state seams per feature and
remove replaced event bindings in the same change. Then let React own the shell
and install React Router library mode as the sole history owner. Remove replaced
pushState/popstate handlers, preserve URL formats and native back/turn guards.
The chat surface remains an explicit legacy host; run/session owners live above
route views. Do not make the entire Study hub the second pilot because it is large.

Exit: each feature's browser/device journeys pass, resource cleanup works and
no competing DOM writers remain. Running turns survive navigation as before.
Direct links, refresh, browser history, session expiry and pending drafts pass.
No duplicate session refresh or API effects. Keep marketing/server/OAuth routes
outside client navigation.

### 3. Move the message list

Migrate attachments and message list ownership in reviewable slices. Keep
reducers and APIs, then introduce narrow message subscriptions and
stable message keys. Initially wrap the existing rich renderer behind an opaque
adapter; later split typed message blocks only when parity is established.
Cover cancellation, retry, edit, regeneration, pagination and reconnect/resume.

Exit: deterministic stream fixtures match; long conversations stay responsive;
scroll anchors, selection, copy, math, code, tables, citations, editable email,
reasoning, visualizations, compare and council all retain expected behavior.
Live tools do not reset as unrelated text arrives.

### 4. Move feature workspaces

Migrate remaining projects, research, study, document, voice and admin surfaces
one at a time. Keep existing APIs for canvases and editors until replacing them
has a benefit. Verify voice, permissions and OAuth on devices. The contenteditable
composer can remain an imperative host indefinitely; preserve skill marks, IME,
mobile keyboard behavior and transitions rather than rewriting it for consistency.

### 5. Roll out and remove obsolete paths

Enable for internal users, then expand the cohort after functional and measured
performance gates pass. Keep routing/auth contracts compatible through rollback.
Remove legacy renderers, source-specific assertions and old shell processing
only after all their users are migrated and the rollback window closes. Retire
the rollout flag and temporary bridges rather than keeping permanent dual UIs.

Exit: one frontend ownership model, passing release checks, documented recovery,
and no unused migration scaffolding. Consider a visual redesign or Expo only as
separate follow-on decisions with their own evidence and scope.

## Streaming optimization is a separate measured change

Profile the existing renderer before changing its algorithm. If it is a material
bottleneck, propose a separate optimization with deterministic render-equivalence
fixtures. Blank lines and closing fences are not sufficient proof that earlier
Markdown is immutable: reference links, tables, lists, Setext headings, open HTML
and custom artifacts can change interpretation. Reset/replacement events can
invalidate earlier content. Do not promise linear rendering or freeze blocks
without parser-aware invalidation and demonstrated output equivalence.

Keep the current sanitization and live-node preservation as the initial adapter.
Optimize rich parsing and per-message subscriptions independently of switching
the shell to React. Preserve incomplete content behavior and final reconciliation.

## Adjacent improvements with separate scope

Self-hosting Markdown, math and highlighting dependencies can reduce external
runtime dependencies. It should preserve lazy loading, language/font assets,
globals during transition, versions and licenses. It is not necessary to move
the appearance controls to React.

The main app currently lacks the CSP headers set on certain OAuth/tool pages.
A main-app CSP requires an inventory of Google sign-in, API connections, media,
blob URLs, workers, frames, inline boot and style requirements. Propose it
separately, start report-only and enforce only after representative workflows
and reports validate the actual policy. Do not copy a restrictive example header
into production as part of the framework migration.

## Validation and rollback

Keep `node:test` for existing domain/server tests. Add `tsc --noEmit` and web
production builds to CI; extend DOM/component and browser coverage where a
migrated interaction warrants it. Test user behavior, not just source strings.
Required checks include missing assets, deep links, auth return paths, release
caching, build ID, sanitizer regressions, deterministic streams and mobile build.
Run meaningful browser/device journeys before rollout, not only unit tests.
A mobile browser viewport is not Android WebView validation: use the repository's
Android workflow and available emulator/device instrumentation separately, and
state any missing prerequisites. Record cold/warm total transferred bytes,
including lazy/CDN assets, rather than counting only the Vite entry bundle.

Roll back a feature using its release flag and retained legacy implementation.
Flags must be sticky for the current session; never swap a live React tree and
legacy tree mid-stream. Roll back deployment as a complete matching asset set.
Keep API, persisted preferences and local draft formats compatible throughout;
there are no planned database/schema changes. A native binary needs its own
release rollback strategy: a web flag cannot replace bundled native code. Use
per-binary compatible flags and API contracts; a corrective update normally
needs a higher versionCode/build number. Do not assume a store or installer will
accept an older APK as an update. Validate direct-download updater behavior and
store rollout behavior independently.

Baseline verification performed during planning: 156 tests passed across
`test/app-reducers.test.js`, `test/render.test.js`, `test/app-shell.test.js`,
`test/host-routing.test.js` and `test/mobile.test.js`. This does not establish
browser/device parity, full-suite status or performance improvements.
These ran against application commit `e7dad32`; the planning branch adds only
this document.

## First three implementation changes

1. **Safety net and baseline.** Add exactly pinned `@playwright/test`, a browser
   config, test fixtures and scripts. Use local stub services/test fixtures for
   provider/auth responses; do not introduce a production auth bypass. Cover
   guest/signed-in boot, streamed send/stop, deep-link refresh and back while a
   turn runs, settings appearance persistence, and mobile-browser layout. Capture
   the replay performance baseline and note native device prerequisites. Existing
   tests stay in place; no application refactor or global assertion replacement.
2. **Build plumbing with a no-op entry.** Add `vite.web.config`, strict frontend
   `tsconfig`, a small `src/web` entry, manifest reading/injection, dedicated asset
   serving and Docker/CI/mobile build integration. Type declarations and a React
   build plugin may be added if needed. Prove flag-off legacy delivery, flag-on
   mount/cleanup and failed-chunk fallback in the production image.
3. **Appearance pilot.** Add one appearance component and a narrow subscription
   source. It reads cached projections of the existing settings owner, and clicks
   call the existing `updateSetting`/accent commands, preserving `colorChosen`.
   Hook notifications into `syncAppearanceControls`; skip its DOM writes and
   the three competing handlers only while the React owner is active. Preserve
   the legacy controls until module loading succeeds. Verify all three controls,
   reload/system-theme behavior, native preference persistence and mobile back.

The appearance source is a read projection, not a second writable settings store.
Do not move the early persisted-theme boot read or `applyAppearance` side effects
into React during the pilot. Do not introduce the router, rewrite the streaming
parser, upgrade Excalidraw or change billing in these three changes.

Delivery is a sequence of small feature branches/PRs merged behind flags. The
planning branch is not a long-lived rewrite branch. Estimate later phases after
the pilot demonstrates actual build/test effort and ownership improvements.

## Official references

- [React: incremental adoption](https://react.dev/learn/add-react-to-an-existing-project)
- [React: external-store subscriptions](https://react.dev/reference/react/useSyncExternalStore)
- [Vite: backend integration and build manifests](https://vite.dev/guide/backend-integration)
- [React Router: modes and tradeoffs](https://reactrouter.com/start/modes)

Use documentation matching the installed, pinned tool versions when implementing;
current online examples can refer to newer versions than this repository uses.
