# RFC: Phased Structural Refactoring of Klui Chat

- **Status**: Proposed (no code changed by this RFC)
- **Baseline**: HEAD = `dc8b5d6 Add ARCHITECTURE and docs files` (274 commits;
  the architecture pack was written against its parent `c55223a`)
- **Test baseline**: `npm test` → 278/278 passing, 16 files, ~3.3 s
- **Hard constraints**: preserve all user-visible behavior and API contracts;
  no ground-up rewrite; one vertical subsystem at a time; characterization
  tests land before each extraction; every phase is independently deployable.

---

## 1. Why (verified problem statement)

Every quantitative claim below was independently re-measured against the
working tree before this RFC was written (see § 2 for corrections to the
architecture pack).

| Hotspot | Measured | Problem |
|---|---|---|
| `public/js/app.js` | 6,704 lines, ~357 function declarations, 150 commits of churn | Single flat ES module owning all client state (`state` referenced ~116×, `els` DOM cache ~113×), every renderer, every reducer, every poller, and bootstrap. No test imports it; 3 test files grep its source as strings. |
| `server/routes.js` | 3,204 lines, 28 `handleXxx` functions, 61 commits | Dispatch if-ladder **plus** the entire chat/compare/council/temporary/research orchestration. `handleApiRequest` and `handleConversationMessage` have zero test coverage. |
| `public/styles.css` | 15,078 lines, 98 `!important`, 132 commits | Single stylesheet for every theme and surface. |
| `server/db/supabaseRest.js` | 835 lines, 58 public methods | One class mirroring the whole schema; grows linearly with every table. |
| `server/websearch/tool.js` | 712 lines | Tool run-loop + provider degradation + visual-PDF pipeline + artifact guard in one file. |
| `server/saas/messages.js` | 481 lines | Storage shape, stream reducer, and SSE encoding mixed. |
| Process gaps | — | **No CI**, no linter, no formatter. `npm test` runs only on developer machines. |

The foundations are genuinely good: dependency direction on the server is
strictly inward (verified — nothing imports `routes.js` except `index.js`;
the only cycle is the deliberate dynamic import `websearch/tool.js` →
`saas/messages.js`), the client module graph is acyclic with `app.js` as the
sole orchestrator, workers are decoupled through DB claim RPCs, and 278
tests pass. This is feature accretion, not rot. The refactor is therefore
**extraction along existing seams**, never redesign.

## 2. Verification findings (corrections to the architecture pack)

Everything in `ARCHITECTURE.md`, `docs/FUNCTION_INDEX.md`, and
`docs/ARCHITECTURE_HISTORY.md` was independently checked. Confirmed unless
listed here:

1. **`README.md` is stale on web search, contrary to `ARCHITECTURE.md` § 9.**
   `ARCHITECTURE.md` says README "is authoritative and matches the code";
   in fact README (line 16) still describes Jina-primary/Brave-fallback,
   while the code defaults to SearXNG-primary (`server/config.js:40-42`,
   `server/websearch/index.js:76-83`, `docker-compose.yml`). Both README and
   `CURRENT_SYSTEM.md` are stale on this point.
2. **`ARCHITECTURE.md` § 8 overstates route-test coverage.** It says
   `test/routes.test.js` covers "route dispatch for health, config, plans,
   payments, research, uploads, conversations". In reality it imports six
   exported helpers (`runSharedPreSearch`, `withResearchReportContext`,
   `installStableRequestSignal`, `buildDirectPdfVisualContext`,
   `normalizeAgentMode`, `shouldSuppressWebSearchForDocumentTurn`) and never
   invokes `handleApiRequest` or any `handleXxx` with a request/response
   pair. Route dispatch is **untested**.
3. **`docs/FUNCTION_INDEX.md` § D lists `klui_claim_document_job` among the
   `SupabaseRest` RPC methods.** No `claimDocumentJob` method exists in the
   Node client; that RPC is called only by the Python worker
   (`worker/worker.py` `Supabase.claim_job`).
4. **Two RPCs exist only in `schema.sql`, not in any migration**:
   `klui_claim_document_job` and `klui_search_document_chunks`. Migrations
   are not a complete replay path; `schema.sql` is the authority.
5. **Minor UI naming**: there is no separate admin drawer; `openAdminDrawer`
   opens `#adminSection` nested inside `#accountDrawer`
   (`public/index.html:449-462`).
6. **RLS is not uniformly "authenticated SELECT scoped to user_id"**:
   `app_settings`, `usage_api_events`, `model_cache`, `search_cache` have no
   authenticated grant at all (service-role-only), and `profiles` scopes on
   `id` not `user_id`.
7. **Counting drift (cosmetic)**: 28 `handleXxx` including the dispatcher
   (doc says 27 plus dispatch); ~357 functions in `app.js` vs claimed 353;
   several files off by one line; commit count is now 274 because the docs
   commit landed on top of `c55223a`.
8. **`apiFetch` and `readSseStream` are private** to `public/js/api.js`, not
   exported as `FUNCTION_INDEX.md` § N implies. The public surface is the
   ~33 per-route wrappers plus `configureApiAuth`.
9. **No web bundler**: the browser loads `public/js/*` raw with manual `?v=`
   cache-busting query strings; Vite is used only for the mobile
   `dist-mobile/` build. Any file split must update the `?v=` import
   specifiers and keeps working under both raw serving and Vite.

None of these change the refactoring priorities; items 1–2 change what
Phase 0 must contain (docs fix + real dispatch tests), and item 9 constrains
how the client split ships.

## 3. Non-goals

- No framework adoption (no React/Vue/etc.), no TypeScript migration, no
  bundler for the web client.
- No schema changes, no RPC changes, no new tables.
- No behavior changes: SSE event envelope, `/api/*` shapes, R2 key formats,
  localStorage keys (`klui.chat.controls.v1`, pinned chats), tool-loop
  invariants (provisional-prose reset, artifact-handoff guard, empty-answer
  retry, graceful tool degradation) all stay byte-identical.
- No CSS rewrite. CSS is deliberately last and optional (Phase 6).
- No changes to the Python worker or Android project in any phase.

## 4. Frozen contracts (the behavioral-safety spec)

These are the surfaces that characterization tests pin before any file
moves. A phase may not ship if any of these change:

1. **HTTP contract** — the 29-entry route inventory in `handleApiRequest`
   (`server/routes.js:3036-3200`), including method enforcement inside
   handlers, the 410 on `/api/chat`, and problem-JSON error shapes from
   `HttpError`.
2. **SSE envelope** — event types and payload shapes for single chat
   (`delta`, tool events, `done`), compare, and council
   (`council:start`, `council:peer:ballot`, `council:chairman:start`, …),
   including `sanitizeProviderEvent` filtering and usage capture from the
   trailing chunk.
3. **Persistence shapes** — `messages.content` (string or parts array),
   `messages.metadata` (council/websearch/documents/research),
   attachment/document/research row lifecycles.
4. **Worker claim protocol** — `klui_claim_research_run` /
   `klui_claim_document_job` semantics, lease heartbeats, `cancel_requested`.
5. **Client-visible module URLs** — `/js/app.js` stays the entry point
   loaded by `index.html`; new modules are additive imports beneath it.
6. **Billing gate** — every paid model call goes through
   `createCrofaiUsageMeter` (budget check before, cost record after).

## 5. Phasing overview

Each phase is a vertical extraction with its own characterization tests,
lands as one reviewable unit, keeps `npm test` green, and is deployable on
its own. Later phases do not depend on earlier ones except where noted, so
the plan degrades gracefully if interrupted.

| Phase | Subsystem | Risk | Depends on |
|---|---|---|---|
| 0 | Safety net: CI, dispatch/SSE characterization tests, doc corrections | none (additive) | — |
| 1 | `server/routes.js` → per-resource route modules + `server/chat/` orchestrators | low–medium | 0 |
| 2 | `server/db/supabaseRest.js` → domain-grouped modules behind the same class | low | 0 |
| 3 | `public/js/app.js` → extracted feature modules over an explicit context | medium | 0 |
| 4 | Server-internal splits: `saas/messages.js`, `websearch/tool.js`, `saas/usageMeter.js`, `documents/index.js`, `research/engine.js` helpers | low | 0 |
| 5 | State-ownership hardening on the client (store boundary for pollers/queues) | medium | 3 |
| 6 (optional) | `public/styles.css` decomposition | medium (visual) | 3 |

Phases 1, 2, and 4 touch disjoint files and could be parallelized; 3 → 5 → 6
are sequential on the client.

---

## 6. Phase 0 — Safety net (additive only, no production code moves)

**Goal**: make every later phase verifiable. Nothing in this phase changes
runtime behavior.

1. **CI**: add a GitHub Actions workflow running `npm ci`, `npm test`, and
   `node --check` over `server/**/*.js` and `public/js/**/*.js` on every
   push/PR. (There is currently no CI at all.)
2. **Route-dispatch characterization tests** (`test/routes-dispatch.test.js`):
   drive `handleApiRequest` directly with stubbed `req`/`res` and a stubbed
   context (`db`, `r2`, auth fetch). Pin per route: status codes, method
   enforcement, auth-required behavior (401/503 paths), problem-JSON shape,
   and the `/api/chat` 410. This is table-driven off the § 4 route
   inventory so Phase 1 diffs against a frozen table.
3. **SSE golden transcripts** (`test/chat-sse.test.js`): with a fake
   provider stream, capture the full event sequence for (a) single chat
   with a tool call, (b) compare with 2 models, (c) council through
   chairman synthesis, (d) temporary chat. Assert the serialized SSE lines
   byte-for-byte. These transcripts are the contract Phases 1 and 4 must
   not disturb.
4. **Client reducer characterization** (`test/app-reducers.test.js`): the
   `applyStreamEvent` / `applyCompareStreamEvent` / `applyCouncilStreamEvent`
   reducers in `app.js` cannot be imported today (the module has DOM side
   effects at top level). Pin their behavior the way existing tests already
   do — source-level assertions — plus record input→state fixtures now, to
   be replayed as real unit tests the moment Phase 3 makes them importable.
5. **Doc corrections** (from § 2): fix README's web-search section
   (SearXNG-primary), fix `ARCHITECTURE.md` § 8/§ 9 overstatements, fix
   `FUNCTION_INDEX.md` § D (`claimDocumentJob`) and § N (`apiFetch` not
   exported), and mark `CURRENT_SYSTEM.md` as historical at the top of the
   file.

**Exit criteria**: CI green on main; dispatch + SSE tests passing against
unmodified code; docs no longer contradict source.

## 7. Phase 1 — `server/routes.js` decomposition

**Goal**: `routes.js` becomes a thin dispatcher (~300–500 lines); handlers
move to per-resource modules. This is the highest-leverage server change
because every chat feature currently lands in this one file (61 commits).

**Mechanics** — pure moves, in this order (each step is shippable):

1. `server/routes/payments.js` — Ziina create/list + admin
   approve/reject. Smallest and most isolated; proves the pattern.
2. `server/routes/admin.js` — summary (keep the 60 s in-process cache as a
   module-local singleton, same semantics), settings.
3. `server/routes/uploads.js` — presign / relay / complete +
   attachment download/view/delete + document status polling.
4. `server/routes/research.js` — create/status/cancel/report (worker side
   untouched).
5. `server/routes/conversations.js` — list/create/get/rename/delete +
   message delete (the R2 purge stays in the handler, where it lives today —
   verified that `SupabaseRest.deleteConversation` does not touch R2).
6. `server/routes/meta.js` — health, config, plans, me, models.
7. **The chat pipeline last**, as its own package because it is
   orchestration, not routing:
   - `server/chat/pipeline.js` — `handleConversationMessage` dispatch
     (single/compare/council, retry and edit modes), `withAvailableTools`,
     `normalizeAgentMode`, `runSharedPreSearch`, `runSharedPreDocumentSearch`,
     `buildDirectPdfVisualContext`, `withResearchReportContext`,
     `injectWebContextMessage`, image-evidence/description helpers.
   - `server/chat/single.js`, `server/chat/compare.js`,
     `server/chat/council.js`, `server/chat/temporary.js` — the four mode
     orchestrators.
   - `routes.js` keeps only `handleApiRequest`, CORS preflight,
     `installStableRequestSignal`, and the error-to-problem-JSON conversion.

**Rules**:
- Handlers keep their exact names and signatures `(context, req, res, url, …)`;
  modules receive the same `context` object — no new DI framework.
- Existing exports used by tests (`runSharedPreSearch`,
  `withResearchReportContext`, `buildDirectPdfVisualContext`,
  `installStableRequestSignal`, `normalizeAgentMode`,
  `shouldSuppressWebSearchForDocumentTurn`, `applyEditedUserText`) are
  re-exported from `routes.js` so `test/routes.test.js` and
  `test/saas.test.js` pass unmodified; tests migrate to the new import
  paths in a follow-up commit within the phase.
- Each step: move, re-export, run Phase-0 dispatch + SSE suites, deploy.

**Characterization first**: the Phase-0 dispatch table and SSE transcripts
are the safety net; step 7 additionally pins retry-mode and edit-mode
request handling (currently untested) before the chat pipeline moves.

**Exit criteria**: `routes.js` ≤ ~500 lines; route inventory byte-identical;
SSE transcripts byte-identical; 278 + new tests green.

## 8. Phase 2 — `server/db/supabaseRest.js` split by domain

**Goal**: keep the public surface (`class SupabaseRest`, all 58 methods,
constructor signature) exactly as is; move implementations into domain
modules so the file stops growing linearly with the schema.

**Mechanics**: `SupabaseRest` retains `configured`, `request()`, `rpc()`.
Method groups move to `server/db/rest/{profiles,subscriptions,payments,chat,attachments,documents,research,billing,caches,admin}.js`
as functions taking the client (`listMessages(client, …)`), mixed onto the
class prototype (or delegated) so **every existing call site and test is
untouched**. No behavioral change of any kind; response parsing and error
mapping move verbatim.

**Characterization first**: `test/saas.test.js` already covers several REST
methods; add thin request-shape tests (URL, headers, method, body) for one
representative method per domain group using a stubbed `fetch`, pinned
before the move.

**Exit criteria**: `supabaseRest.js` ≤ ~150 lines; all callers unmodified;
tests green.

## 9. Phase 3 — `public/js/app.js` extraction

**Goal**: shrink `app.js` from 6,704 lines to a bootstrap/orchestrator
(~2,500 lines initially) by extracting the most self-contained subsystems.
This is the highest-churn file (150 commits) and the main merge-conflict
generator.

**The state problem, solved minimally**: functions in `app.js` close over
`state` (~116 refs), `els` (~113 refs), and ~15 module-level mutable
singletons. Rather than threading parameters everywhere (huge diff) or a
store framework (rewrite-shaped), extract the shared mutable core into one
leaf module:

- `public/js/appContext.js` — exports the `state` object, the `els` DOM
  cache (initialized by `app.js` at boot exactly as today), and the small
  shared helpers the subsystems need (`showToast`, `queueRenderMessages`
  handle, settings accessors). It is a leaf: imports nothing project-side.

Then extract, in dependency order (leaf-most first, one step = one deploy):

1. `public/js/streaming.js` — `applyStreamEvent`, `applyToolEvent`,
   `applyCompareStreamEvent`, `applyCouncilStreamEvent`, `ensureToolState`.
   These mutate `state` but touch no DOM directly → easiest extraction and
   immediately unit-testable (replay the Phase-0 fixtures as real tests).
2. `public/js/documentViewer.js` — PDF.js loading, page rendering, viewer
   open/close, preview-job polling, pending-artifact polling
   (`pendingArtifactPolls`, `documentViewerPoll`, `pdfJsPromise`,
   `pdfRenderToken` move in as module-local state — they are already
   viewer-owned).
3. `public/js/research.js` — research card/report rendering, polling
   (`researchPollTimer` moves in), start/cancel/resume.
4. `public/js/council.js` + `public/js/compare.js` — the mode renderers
   and mode activation/model-picker seeding.
5. `public/js/adminPanel.js` — admin dashboard load/render/save (small,
   isolated, admin-only blast radius).

**Constraints (verified against how the client ships)**:
- No bundler for web: every new file is imported from `app.js` with an
  explicit `?v=` version query (matching the existing convention), and
  `index.html` continues to load only `/js/app.js`. The Vite mobile build
  follows the import graph automatically; run `npm run mobile:build` in CI
  from this phase on.
- `test/mobile.test.js`, `test/native-topbar.test.js`,
  `test/reasoning.test.js`, and `test/research.test.js` grep `app.js`
  source for specific strings; each extraction step updates those tests to
  point at the new file **in the same commit**, keeping assertions
  otherwise identical.
- Functions keep their names and call signatures; only their home moves.

**Characterization first**: Phase-0 reducer fixtures; plus a DOM-level smoke
test per extracted subsystem where feasible (render a message list fixture
into jsdom-free string HTML via the existing render helpers and snapshot
it — the codebase already tests `render.js` this way).

**Exit criteria**: `app.js` no longer contains streaming reducers, document
viewer, research view, council/compare renderers, or admin panel; web app
and `npm run mobile:build` both work; all source-grep tests updated; new
unit tests exist for the streaming reducers.

## 10. Phase 4 — server-internal splits (independent of Phases 1–3)

Small, mechanical, low-risk splits along boundaries the architecture pack
already identified and verification confirmed:

1. `server/saas/messages.js` (481) → `server/saas/messages/content.js`
   (build/hydrate/filter/normalize/`stripLeakedToolMarkup`) +
   `server/saas/messages/stream.js` (`applyStreamEvent`,
   `pipeProviderStreamAndAccumulate`, `streamProviderAndAccumulate`,
   `sanitizeProviderEvent`, `writeProviderEvent`). `messages.js` becomes a
   re-export barrel so the dynamic import in `websearch/tool.js:494` and all
   static importers keep working unchanged.
2. `server/websearch/tool.js` (712) → `tool/loop.js` (run loop),
   `tool/visual.js` (`prepareVisualPagesForModel`, `visualDocumentMessage`,
   `visualImageInputLimit`), `tool/unsupported.js`
   (`isToolsUnsupportedError`, fallback-level logic). `tool.js` re-exports.
   The tool-loop invariants (provisional-prose reset, dedupe of inline
   image fetches) already have tests; the SSE transcripts from Phase 0
   guard the rest.
3. `server/saas/usageMeter.js` (174) → extract `costResolver.js`
   (usage.cost → generation endpoint → estimate chain) and keep the meter
   as the wrapper. `test/saas.test.js` meter tests pass unchanged.
4. `server/documents/index.js` (696) → extract `inferFormat.js` and
   `resolveContent.js` (pure helpers); `DocumentService` stays.
5. `server/research/engine.js` (336) → move `parseJsonArray`/
   `parseJsonObject`, `mapLimit`, `validateReportLinks` to
   `research/util.js`; `runDeepResearch` stays a single function.

Each item is a separate commit/deploy. Rule: barrels preserve every current
import path for at least one release; importers migrate opportunistically.

## 11. Phase 5 — client state-ownership hardening

Only after Phase 3 proves out. Goal: each extracted module owns its own
timers/queues with explicit `start/stop` lifecycle so `app.js` stops
reaching into module internals:

- Pollers (research, artifacts, document preview) expose
  `startX()/stopX()/isXActive()`; `app.js` calls lifecycle methods on
  navigation/sign-out instead of clearing shared timer variables.
- The follow-up queue and upload pipeline become owned by the composer
  section with an explicit interface.
- `appContext.js` shrinks toward `state` + `els` only.

This phase is deliberately open-ended and cheap to stop at any point; every
step is behavior-preserving and individually shippable.

## 12. Phase 6 (optional) — `public/styles.css`

Deferred and explicitly optional. 15,078 lines and 98 `!important`s are a
maintenance cost but not a correctness risk, and CSS splits carry visual
regression risk with weak tooling here. If undertaken:

- Split by surface into `public/styles/{base,composer,sidebar,messages,viewer,research,council,settings,themes-*.css}`
  loaded via `@import` from a root `styles.css` (no HTML changes; keeps the
  single `?v=` cache-bust point).
- Before/after screenshot comparison across the three themes × light/dark ×
  desktop/mobile widths, plus the existing Maestro flows for the APK.
- No selector or specificity changes in the split itself; `!important`
  reduction is a separate, per-rule follow-up if ever.

## 13. Testing & rollout strategy (applies to every phase)

- **Characterization before extraction**: no file moves until the behavior
  it carries is pinned by a test that fails on divergence.
- **Pure moves only**: extraction commits contain moves + import updates +
  re-exports. Any behavioral fix discovered along the way ships as its own
  commit before or after, never inside, a move.
- **Deploy gate per step**: `npm test` (grows from 278), the Phase-0
  dispatch table, the SSE golden transcripts, `node --check` over all JS,
  and (from Phase 3 on) `npm run mobile:build`.
- **Rollback**: every step is a small revertable commit; barrels/re-exports
  mean a revert never breaks importers.
- **Docs**: `ARCHITECTURE.md` § 3 module tables and `docs/FUNCTION_INDEX.md`
  entries are updated in the same PR as each move so the pack never goes
  stale again; CI greps that moved files mentioned in the pack exist.

## 14. Risks

| Risk | Mitigation |
|---|---|
| SSE stream shape drifts during chat-pipeline move (Phase 1.7) | Byte-level golden transcripts from Phase 0; chat pipeline moves last, after six lower-risk resources prove the pattern. |
| `app.js` closure untangling introduces subtle state bugs | `appContext.js` keeps the exact same shared-mutation semantics; extractions are leaf-most-first; streaming reducers gain real unit tests immediately. |
| Raw-served client + `?v=` cache-busting breaks on module split | Convention already exists (`render.js?v=…` import in `app.js`); CI adds a check that every `public/js` import carries a version query; mobile Vite build in CI catches graph breaks. |
| Source-grep tests silently pass against moved code | Each move updates the grep target in the same commit; Phase 0 converts the most important ones (reducers) to real imports as soon as possible. |
| Admin summary cache semantics change when moving to `routes/admin.js` | Cache stays a module-local singleton with identical TTL; a test pins the 60 s caching behavior before the move. |
| Parallel phases collide (1, 2, 4 touch server) | They touch disjoint files; if run concurrently, merge order is 2 → 4 → 1 (smallest blast radius first). |

## 15. What success looks like

- No file in the repo over ~1,500 lines except `styles.css` (until/unless
  Phase 6), `worker/worker.py` (out of scope), and `schema.sql`.
- `routes.js` is a dispatcher; chat orchestration lives in `server/chat/`.
- The streaming reducers, document viewer, research view, and council/
  compare renderers are importable, unit-tested modules.
- CI exists and gates every merge on the full suite plus the frozen
  contracts.
- The architecture pack (`ARCHITECTURE.md`, `docs/FUNCTION_INDEX.md`)
  stays accurate because updating it is part of each move's definition of
  done.
