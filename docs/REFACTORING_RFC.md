# RFC: Phased Structural Refactoring of Klui Chat

- **Status**: Phases 0–6 implemented (working tree)
- **Baseline**: HEAD = `dc8b5d6 Add ARCHITECTURE and docs files` (274 commits;
  the architecture pack was written against its parent `c55223a`)
- **Test baseline**: `npm test` → 329/329 passing, 20 files, ~3.4 s
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
the only cycle is the deliberate dynamic import `websearch/tool/loop.js` →
`saas/messages.js`), the client module graph is acyclic with `app.js` as the
sole composition root, workers are decoupled through DB claim RPCs, and 329
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
9. **No web bundler**: the browser loads `public/js/*` raw; Vite is used only
   for the mobile `dist-mobile/` build. Some imports carry `?v=` query
   strings as a historical convention, but they are **not required for
   correctness**: `server/static.js:55-57` serves HTML, JS, and CSS with
   `Cache-Control: no-cache`, so browsers revalidate on every load. New
   modules do not need `?v=`. What every client split must actually verify
   is both delivery paths: the raw module graph loads in a browser, and
   `npm run mobile:build` succeeds.
10. **`handleApiRequest` has no injectable context.** Its signature is
   `(req, res, url, config)`; the DB and R2 clients are constructed inside
   each handler via `bearerContext(config)` (`server/routes.js:147-152`),
   and auth calls `fetch` directly (`server/auth/supabase.js:27`). A stubbed
   context **cannot** currently be passed in. Deterministic route tests
   therefore require a minimal dependency seam first (see Phase 0 § 6.3).

None of these change the refactoring priorities; items 1–2 change what
Phase 0 must contain (docs fix + real dispatch tests), item 9 constrains
how the client split ships, and item 10 adds a small, behavior-preserving
seam to Phase 0's scope.

## 3. Non-goals

- No framework adoption (no React/Vue/etc.), no TypeScript migration, no
  bundler for the web client.
- No schema changes, no RPC changes, no new tables.
- No behavior changes: SSE event envelope, `/api/*` shapes, R2 key formats,
  localStorage keys (`klui.chat.controls.v1`, pinned chats), tool-loop
  invariants (provisional-prose reset, artifact-handoff guard, empty-answer
  retry, graceful tool degradation) all stay unchanged (verified via the
  canonical semantic transcripts of § 4).
- No CSS rewrite. CSS is deliberately last and optional (Phase 6).
- No changes to the Python worker or Android project in any phase.

## 4. Frozen contracts (the behavioral-safety spec)

These are the surfaces that characterization tests pin before any file
moves. A phase may not ship if any of these change:

1. **HTTP contract** — the 29-entry route inventory in `handleApiRequest`
   (`server/routes.js:3036-3200`), including method enforcement inside
   handlers, the 410 on `/api/chat`, and problem-JSON error shapes from
   `HttpError`.
2. **SSE envelope** — frozen as a **canonical semantic transcript**, not a
   byte-level snapshot: the ordered sequence of event types and their
   required fields for single chat (sanitized provider chunks, `tool:*`
   events, `usage`, `error`), compare (`start`/`delta`/`done`/`error` per
   index), council (`council:start`, panel events,
   `council:peer:start|ballot|done|skipped|error`,
   `council:chairman:start|delta|done|skipped|error`), and temporary chat
   (`usage`, `done { temporary: true }`). Generated IDs, timestamps, costs,
   and JSON key ordering are normalized before comparison; event order,
   event types, required fields, error surfacing, persistence writes, and
   billing calls are frozen exactly.
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

All phases are implemented **sequentially** in the order above. Phases 1, 2,
and 4 touch mostly disjoint production files, but their tests, import paths,
and architecture-doc updates overlap, so they are not run concurrently.

---

## 6. Phase 0 — Safety net (additive only, no production code moves)

**Goal**: make every later phase verifiable. Nothing in this phase changes
runtime behavior. The only production-code change is the minimal dependency
seam in item 3, which ships as its own commit with tests proving equivalence.

1. **CI**: add a GitHub Actions workflow running `npm ci`, `npm test`,
   syntax checks, and `npm run mobile:build` on every push/PR. (There is
   currently no CI at all.) Syntax checking uses a repository script
   (`scripts/check-syntax.mjs` or equivalent `find … | xargs node --check`)
   that enumerates files explicitly — **not** a `**` shell glob, whose
   expansion is shell-dependent and silently incomplete.
2. **Doc corrections** (from § 2): fix README's web-search section
   (SearXNG-primary), fix `ARCHITECTURE.md` § 8/§ 9 overstatements, fix
   `FUNCTION_INDEX.md` § D (`claimDocumentJob`) and § N (`apiFetch` not
   exported), and mark `CURRENT_SYSTEM.md` as historical at the top of the
   file.
3. **Minimal injectable seam — `createApiHandler(dependencies)`**: because
   `handleApiRequest(req, res, url, config)` constructs its own
   `SupabaseRest`/`R2Client` and calls the Supabase auth endpoint via
   global `fetch` (§ 2 item 10), deterministic route tests need one seam.
   `server/routes.js` gains a factory:

   - `createApiHandler(config, overrides = {})` returns an
     `async (req, res, url)` handler. `overrides` may supply
     `createDb(config)`, `createR2(config)`, and `verifyUser(req, config)`;
     when omitted, the defaults are exactly today's `new SupabaseRest(config)`,
     `new R2Client(config)`, and `requireUser(req, config)`.
   - The existing export `handleApiRequest(req, res, url, config)` remains
     and delegates to `createApiHandler(config)` with no overrides, so
     `server/index.js` is unchanged (or changes only trivially).
   - **No handler signature changes.** Handlers keep `(req, res, config, …)`;
     the seam is threaded through the two internal context builders
     (`bearerContext`, `authContext`) only.
   - Ships as its own commit, before any tests that use it, with a test
     asserting the default path constructs the same dependencies as before.
4. **Route-dispatch characterization tests** (`test/routes-dispatch.test.js`):
   drive the handler produced by `createApiHandler` with stubbed `req`/`res`
   and stubbed `createDb`/`verifyUser`. Table-driven over the full route
   inventory: status codes, method enforcement, auth boundary (401 without
   a token, 503 when Supabase is unconfigured), 404 for unknown paths, 405
   where handlers enforce methods, the `/api/chat` 410, and the
   problem-JSON shape `{ error, details? }`. Phase 1 diffs against this
   frozen table.
5. **Canonical SSE characterization tests** (`test/chat-sse.test.js`): with
   a fake provider stream and fake DB, capture the event sequence for
   (a) single chat including a web-search tool call, (b) two-model compare,
   (c) council through chairman synthesis, (d) temporary chat, and
   (e) error/abort surfacing plus the `usage` event. Assert **canonical
   semantic transcripts** (§ 4 item 2): parse the SSE `data:` lines,
   normalize generated IDs, timestamps, costs, and key order, then compare
   the ordered list of event types and required fields. Also assert the
   persistence writes (message insert/update payloads) and billing calls
   (`checkApiBudget` before, `recordApiUsageCost` after) observed by the
   fake DB.
6. **Client reducer fixtures** (`test/fixtures/`): record input→state
   fixtures for `applyStreamEvent` / `applyCompareStreamEvent` /
   `applyCouncilStreamEvent` now. The reducers cannot be imported today
   (`app.js` has DOM side effects at top level), so until Phase 3 the
   fixtures are validated only structurally; source-grep assertions are
   **not** counted as behavioral coverage. Real replay tests arrive when
   Phase 3 extracts the reducers.

**Exit criteria**: CI green; seam commit proves behavioral equivalence;
dispatch + SSE tests passing against unmodified handlers; docs no longer
contradict source.

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
- **Pure moves change nothing but the file a function lives in.** Handlers
  keep their exact current names and signatures `(req, res, config, …)`.
  Any dependency-injection change or signature change (for example,
  threading the Phase-0 seam deeper) is a **separate commit**, never mixed
  into a move commit. No DI framework.
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

**Exit criteria**: `routes.js` contains only dispatch, CORS, signal, and
error conversion; route inventory unchanged against the Phase-0 dispatch
table; canonical SSE transcripts unchanged; full suite green.

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
singletons. Rather than threading parameters everywhere (huge diff), a
store framework (rewrite-shaped), or a shared context module that every
subsystem imports (a global service locator by another name), each
extracted subsystem is a **narrow feature factory** that receives exactly
the capabilities it needs, explicitly, at construction:

```js
// app.js remains the composition root and owns state/els as today.
const streamReducer = createStreamReducer({ isAdmin, mergeArtifacts });
const documentViewer = createDocumentViewer({ elements, api, notify });
const research = createResearchController({ state, api, render });
```

- Each factory lists its dependencies in its signature; nothing reaches
  back into `app.js` internals, and no module exports a grab-bag of shared
  mutable state.
- `app.js` stays the single composition root: it constructs the factories
  at boot and wires them to DOM events.
- Where a subsystem genuinely needs a slice of shared state, it receives
  that slice (or accessor functions), not the whole `state` object, unless
  the slice **is** effectively the whole state (research controller).

Extraction order (leaf-most first, one step = one deploy):

1. `public/js/streaming.js` — `createStreamReducer(...)` wrapping
   `applyStreamEvent`, `applyToolEvent`, `applyCompareStreamEvent`,
   `applyCouncilStreamEvent`, `ensureToolState`. These mutate stream state
   but touch no DOM directly → easiest extraction and immediately
   unit-testable (replay the Phase-0 fixtures as real tests).
2. `public/js/documentViewer.js` — `createDocumentViewer({ elements, api, notify })`:
   PDF.js loading, page rendering, viewer open/close, preview-job polling,
   pending-artifact polling (`pendingArtifactPolls`, `documentViewerPoll`,
   `pdfJsPromise`, `pdfRenderToken` become factory-local state — they are
   already viewer-owned).
3. `public/js/research.js` — `createResearchController({ state, api, render })`:
   research card/report rendering, polling (`researchPollTimer` moves in),
   start/cancel/resume.
4. `public/js/council.js` + `public/js/compare.js` — the mode renderers
   and mode activation/model-picker seeding, same factory pattern.
5. `public/js/adminPanel.js` — admin dashboard load/render/save (small,
   isolated, admin-only blast radius).

**Constraints (verified against how the client ships)**:
- No bundler for web: new files are plain ES modules imported from
  `app.js`, and `index.html` continues to load only `/js/app.js`. `?v=`
  query strings are **not required** — `server/static.js` serves JS/CSS/HTML
  with `Cache-Control: no-cache`, so browsers revalidate every load. Each
  extraction verifies both delivery paths: load the raw module graph in a
  browser (or an import-resolution smoke test) and run
  `npm run mobile:build`; the Vite mobile build follows the import graph
  automatically and runs in CI from Phase 0 on.
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

## 10. Phase 4 — server-internal splits (after Phases 1–3)

Small, mechanical, low-risk splits — but **only where responsibility,
dependency, or churn evidence justifies them**. Line count alone is not a
reason to split; coherent modules stay whole.

1. `server/saas/messages.js` (481) → `server/saas/messages/content.js`
   (build/hydrate/filter/normalize/`stripLeakedToolMarkup`) +
   `server/saas/messages/stream.js` (`applyStreamEvent`,
   `pipeProviderStreamAndAccumulate`, `streamProviderAndAccumulate`,
   `sanitizeProviderEvent`, `writeProviderEvent`). Justified: two genuinely
   different responsibilities (storage shape vs. stream encoding) with
   different change drivers. `messages.js` becomes a re-export barrel so
   the dynamic import in `websearch/tool.js:494` and all static importers
   keep working unchanged.
2. `server/websearch/tool.js` (712) → `tool/loop.js` (run loop),
   `tool/visual.js` (`prepareVisualPagesForModel`, `visualDocumentMessage`,
   `visualImageInputLimit`), `tool/unsupported.js`
   (`isToolsUnsupportedError`, fallback-level logic). Justified: the visual
   PDF pipeline and the tools-unsupported degradation change independently
   of the run loop. `tool.js` re-exports. The tool-loop invariants
   (provisional-prose reset, dedupe of inline image fetches) already have
   tests; the SSE transcripts from Phase 0 guard the rest.
3. `server/documents/index.js` (696) → extract `inferFormat.js` and
   `resolveContent.js` (pure helpers); `DocumentService` stays.

**Explicitly not split** (removed from earlier drafts of this RFC):
`server/saas/usageMeter.js` (174 lines — a single coherent metering
responsibility; splitting out a cost resolver fragments a frozen billing
invariant for no evidence-based gain) and `server/research/engine.js`
(336 lines — one research loop with its own private helpers; no churn or
dependency pressure). Either may be revisited if future churn data says
otherwise.

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
- Feature factories' dependency lists shrink as capabilities consolidate;
  any factory that ended up taking the whole `state` object narrows to the
  slice it actually uses.

This phase is deliberately open-ended and cheap to stop at any point; every
step is behavior-preserving and individually shippable.

## 12. Phase 6 (optional) — `public/styles.css`

Deferred and explicitly optional. 15,078 lines and 98 `!important`s are a
maintenance cost but not a correctness risk, and CSS splits carry visual
regression risk with weak tooling here. If undertaken:

- Split by surface into `public/styles/{base,composer,sidebar,messages,viewer,research,council,settings,themes-*.css}`
  loaded via `@import` from a root `styles.css` (no HTML changes). Note:
  a `?v=` query on the root stylesheet does **not** version the child
  `@import` URLs — child files are fetched by their own URLs. Freshness
  relies on the `Cache-Control: no-cache` header the static server already
  sends for CSS, which applies to every imported file individually.
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
  dispatch table, the canonical SSE transcripts, syntax checks via the
  repository check script (explicit file enumeration, not `**` globs), and
  `npm run mobile:build`.
- **Rollback**: every step is a small revertable commit; barrels/re-exports
  mean a revert never breaks importers.
- **Docs**: `ARCHITECTURE.md` § 3 module tables and `docs/FUNCTION_INDEX.md`
  entries are updated in the same PR as each move so the pack never goes
  stale again; CI greps that moved files mentioned in the pack exist.

## 14. Risks

| Risk | Mitigation |
|---|---|
| SSE stream shape drifts during chat-pipeline move (Phase 1.7) | Canonical semantic transcripts from Phase 0 (event order, types, required fields, persistence, billing frozen; volatile IDs/timestamps/costs normalized); chat pipeline moves last, after six lower-risk resources prove the pattern. |
| `app.js` closure untangling introduces subtle state bugs | Feature factories receive explicit capabilities; extractions are leaf-most-first; streaming reducers gain real unit tests immediately. |
| Raw-served client module graph breaks on split | Static server sends `Cache-Control: no-cache` for JS, so no cache-busting is needed for correctness; each extraction verifies the raw module graph loads and `npm run mobile:build` passes in CI. |
| Source-grep tests silently pass against moved code | Each move updates the grep target in the same commit; Phase 0 records reducer fixtures so grep assertions convert to real imports in Phase 3. |
| Admin summary cache semantics change when moving to `routes/admin.js` | Cache stays a module-local singleton with identical TTL; a test pins the 60 s caching behavior before the move. |
| Server phases interfere (1, 2, 4) | Implemented strictly sequentially; each phase's tests and doc updates land before the next begins. |
| The Phase-0 seam itself changes behavior | Seam ships as its own commit; defaults are byte-identical constructor/auth calls; a dedicated test asserts default wiring equals pre-seam behavior; full suite green before and after. |

## 16. Implementation notes (Phases 1–6, working tree)

Recorded deviations from the plan above when the refactor landed:

1. **Phase 1 — `server/chat/single.js` is minimal (~15 lines).** It exports
   only `streamSingleChat` (legacy no-tools fast path). The main single-chat
   agent flow remains in `server/chat/pipeline.js` `handleConversationMessage`
   via `runChatWithToolLoop`; `streamSingleChat` is called from `pipeline.js`
   when tools are disabled.
2. **Phase 4 — `usageMeter.js` and `research/engine.js` untouched** per § 10
   (no evidence-based churn pressure).
3. **Phase 5 — poller lifecycle + one reach-in fix.** Research and
   document-viewer factories own their timers and expose
   `stop*()` / `is*Active()`; `app.js` calls `stopExtractedModulePollers()`
   on sign-out/navigation. External callers now use
   `applyResearchRunUpdate` instead of reaching into
   `updateResearchMessage`.
4. **Phase 6 — CSS split with approved checksum baseline.** `public/styles.css` is 13
   `@import` lines over `public/styles/*.css`; verified by
   `npm run check:css-split` / `scripts/verify-css-split.mjs` against
   `scripts/css-split-baseline.json` (approved concatenated snapshot; refresh
   explicitly on intentional CSS edits). Tests concatenate via
   `test/helpers/styles.js` `readStylesheet()`.
5. **Post-refactor sizes (verified):** `server/routes.js` 233 lines;
   `server/db/supabaseRest.js` 297 lines; `public/js/app.js` 5,331 lines;
   `server/chat/pipeline.js` 1,186 lines (largest remaining server
   orchestrator).
6. **Tests added:** `test/supabase-rest.test.js` (one stubbed-`fetch` case per
   `server/db/rest/*` domain); retry and edit-mode cases in
   `test/chat-sse.test.js`; `test/app-reducers.test.js` replays fixtures
   through `createStreamReducer` from `public/js/streaming.js`.

## 15. What success looks like

Success is measured by ownership, dependency direction, testability, and
change isolation — **not** by file size. (An earlier draft's "no file over
1,500 lines" criterion is removed: size is a symptom, not the disease, and
optimizing for it invites fragmentation.)

- Every subsystem has one owning module with an explicit public surface;
  no handler or renderer lives in a file whose other contents it never
  touches.
- Dependency direction stays strictly inward on the server and acyclic on
  the client; new cross-module reach-ins fail review.
- `routes.js` is a dispatcher; chat orchestration lives in `server/chat/`.
- The streaming reducers, document viewer, research view, and council/
  compare renderers are importable, unit-tested modules.
- CI exists and gates every merge on the full suite plus the frozen
  contracts.
- The architecture pack (`ARCHITECTURE.md`, `docs/FUNCTION_INDEX.md`)
  stays accurate because updating it is part of each move's definition of
  done.
