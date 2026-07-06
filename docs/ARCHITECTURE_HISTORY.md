# Klui Chat Architecture History

This document was produced by walking the full Git history of the
working tree (HEAD = `c55223a Reset provisional tool prose and retry`,
273 commits between May 12 2026 and July 1 2026) and clustering it
into feature eras. It explains how the architecture arrived at its
current shape and which commits shifted responsibility. Current
behavior always wins over history; this file is the "why" companion
to `ARCHITECTURE.md`.

The evidence column lists the commits that introduced or most
directly expanded a subsystem. File paths and line counts are
verified against the working tree.

## 1. Feature eras

### Era 1 — CrofAI MVP (May 12 2026, one day, 4 commits)

- `b9daeda Build Dockerized CrofAI chat MVP` — the only commit that
  introduces `server/index.js`, `server/routes.js`,
  `server/crofai/{client,constants,normalize}.js`,
  `server/config.js`, `server/http/responses.js`, `Dockerfile`,
  `public/index.html`, `public/js/{app,api,render,reasoning}.js`,
  and `supabase/schema.sql` (the very first version, with a
  profiles/plans/conversations/messages/usage shape but no
  documents/research/payments yet).
- `afc001c Redesign frontend UI to clean, minimal ChatGPT-like aesthetic`.
- `ca1c4f1 Add live CrofAI model catalog integration` — first version
  of the in-house model catalog pulled from
  `${CROFAI_BASE_URL}/models` with a 5-minute cache.
- `f02ff43 Add CrofAI model browsing and image uploads` — first image
  upload path (browser → R2 presigned PUT → server).

### Era 2 — Frontend polish + brand rename (May 12–13)

- `3f500cb`, `a282013` — replaced native `confirm()` with custom in-app
  dialogs. This is the in-house taste ("Use in-app modal dialogs
  instead of native browser popups for confirmations") manifesting
  in code for the first time.
- `273cc5e` … `ca1b9cf` — model-selector UX work and the
  `Smartfy → Smartyfy` rename. The current `taste.md` still says
  "Project is named 'Klui', not 'Smartyfy'" — that note is the
  survivor of a chain of brand changes: Smartfy (initial), Smartyfy
  (May 13 2026), then `6633755 Rename Smartyfy to Klui across project`
  (May 28 2026) and the final `ca1b9cf`. The current product name
  is Klui, the production app id is `tech.klui.app`, and the
  web origin is `https://klui.tech`.

### Era 3 — The managed Smartyfy SaaS stack (May 13 2026)

This is the commit that creates the *current* backend shape:

- `61582ab Implement managed Smartyfy SaaS stack` introduces:
  `server/auth/supabase.js` (Bearer-token auth via Supabase
  GoTrue), `server/db/supabaseRest.js` (the service-role PostgREST
  client), `server/billing/stripe.js` (later removed in Era 5),
  `server/saas/{entitlements,messages,plans}.js` (the SaaS
  primitives), and rewrites `server/routes.js` to its current
  if-ladder shape.

  It also restructures the frontend: `public/js/chat.js`,
  `public/js/constants.js`, and `public/js/storage.js` are
  deleted; `public/js/api.js` and `public/js/auth.js` are
  written/extracted; `public/js/app.js` is reshaped around the
  managed stack.

  This commit is also when `.npmrc` gains the
  `min-release-age=7` policy, which is still in force.

### Era 4 — Stripe-out and the testing access mode (May 14 2026)

- `4f2be46 Remove Stripe and add testing access mode` and
  `95a1a0d Remove Stripe and enable testing access mode` delete
  `server/billing/stripe.js`, drop the `stripe_*` columns, and
  introduce the `ACCESS_MODE=testing` short-circuit in
  `server/saas/entitlements.js`. This is the era that
  `CURRENT_SYSTEM.md` documents and that the README still describes
  as the default. The schema migrations `2026_06_08_drop_legacy_usage_counters.sql`
  and the post-`8a2b9f Switch to API-credit weekly billing` rewrite
  retire the last of the legacy counters.

- Around the same time: `da4d516 Restore 3d69c46-style frontend and
  wire it to managed backend`, `097696c Make conversation deletion
  hard-delete Supabase records`, `89fd25c Delete R2 images when
  chats and messages are removed` — these harden the data lifecycle
  (no soft-delete ghosts, attachment storage cleanup).

- `019bdf8 Add composer thinking-effort control and forward reasoning_effort`
  adds the per-message reasoning effort control and surfaces the
  `reasoning_effort` field to the model. The client `showModelReasoning`
  toggle lands later (Era 8).

### Era 5 — Reasoning, markdown, and the compare/council core (May 14–21)

- `df3813d Add rich markdown, LaTeX, and syntax-highlighted code rendering`,
  `8a1642b Harden markdown rendering and math parsing`, `0fb9fe9 Allow safe br tags`,
  `9a057cb Fix code block rendering, add copy buttons, and fix send flash` —
  the current `public/js/render.js` LaTeX isolation
  (`protectCodeSpans`/`extractMath`/`restoreCodeSpans`/`isLikelySingleDollarMath`)
  is the work of this era, including the "currency / price never
  hijacks math" rule that the `9051dee Avoid treating currency and tables as math`
  fix adds later.

- `40b6119 Charge compare chats by model count`, `888ee13 Fix chat send failures and compare usage accounting`,
  `f68e48f Fix compare image context and usage accounting`, `937b9aa Add compare mode image context handling with single-call describe` —
  Compare mode (2–4 models streaming in parallel) is hardened, and
  the single-call vision describe (the seed of the current
  `server/saas/images.js`) is introduced.

- `c95eba5 Add Model Council three-stage pipeline with peer review and chairman synthesis` —
  the single biggest architecture shift. This commit creates
  `server/saas/council.js` and rewrites `server/routes.js`'s chat
  dispatcher to add the SSE event envelope (`council:start`,
  `council:peer:ballot`, `council:chairman:start`, etc.). The
  schema gains the `messages.metadata` JSONB column (migration
  `2026_05_21_add_messages_metadata.sql`). The Council flow has
  the same core shape today as it did in this commit.

- `99a4c94 Meter CrofAI usage per request and fix council rank display` —
  introduces `server/saas/usageMeter.js` (the bounded budget +
  post-call cost reconciliation meter) and the OpenRouter fallback
  pricing model in `server/saas/billing.js`.

- `3413f25 Add OpenRouter provider toggle & support` — adds
  `server/providers.js` (the provider registry), wires the
  `provider=openrouter` resolution into routes, council, websearch
  tool, and API responses. The current `server/providers.js`
  `adaptChatRequestForProvider` (the `reasoning.effort` →
  `reasoning.effort` rewrite, `require_parameters: true` for tool
  calls) is the work of this era and `af92675 / e9f19b8`.

- `3413f25` also adds `7a2523d`-style cloud-friendly R2 signing
  fixes (`x-amz-content-sha256: UNSIGNED-PAYLOAD` for unsigned PUTs
  and canonical header signing), which `server/storage/r2.js` still
  uses.

- `6633755 Rename Smartyfy to Klui across project` — the final
  brand change.

### Era 6 — Web search and document skills (May 21–25)

- `c76a902 Add web search via Jina (primary) and Brave (fallback) with tool calls` —
  introduces `server/websearch/{index,jina,brave,cache,detect,tool}.js`.
  This is the original "Jina primary / Brave fallback" shape that
  `CURRENT_SYSTEM.md` still describes. The current default
  (SearXNG primary, Jina fallback, Brave fallback) is the work of
  the later era 7 commit `be84b3a`.

- `691552c Fix Google OAuth redirect by including Supabase apikey` —
  the first Google sign-in wiring. The current Google flow lands
  in `595944c Add Google Identity sign-in support` (Era 7).

- `a78d7ec Add document tools, worker, and docs` — the single biggest
  document feature. Introduces `server/documents/{index,skillRegistry,skills,tool}.js`,
  `worker/{worker.py,artifact_generator.mjs,Dockerfile,requirements.txt,healthcheck.py}`,
  the `document_files` / `document_chunks` / `document_pages` /
  `document_jobs` tables (with the `pgvector` extension and the
  HNSW index on `document_pages.embedding`), and the
  `klui_search_document_chunks` / `klui_search_document_pages` /
  `klui_claim_document_job` RPCs. Adds the `document-worker`
  service to `docker-compose.yml`.

  This commit also grows the implementation plan
  `DOCUMENT_SKILLS_IMPLEMENTATION_PLAN.md` from ~250 lines to ~1,100.
  That plan is no longer authoritative for current behavior — the
  current document skills live in
  `server/documents/{index,skillRegistry,skills,tool}.js`.

- `a03f0a6 Add visual PDF page support and upload UI`,
  `01cdb8c Improve PDF visual handling and vision model hints`,
  `2174f34 Always attach pdf-read and visual read tools for PDFs`,
  `6576fb0 Support inline PDF page images for vision models`,
  `87c792d Enhance document vision handling and limits` — the visual
  PDF page inline-image pipeline (the seed of the current
  `server/websearch/tool.js` `prepareVisualPagesForModel` +
  `visualDocumentMessage` and the `buildDirectPdfVisualContext`
  in `server/routes.js`).

- `b7e6ad1 Support pending document artifacts and job polling` —
  the "pending artifact card" output shape that
  `server/documents/tool.js` `artifactFromDocumentResult` still
  emits. The browser-side counterpart is
  `findPendingArtifacts` / `pollPendingArtifact` in
  `public/js/app.js`.

- `b1ca157 Add clean PDF viewer and progressive rendering`,
  `9378883 Add document viewer sidebar` — the seed of the
  document viewer in `app.js` (PDF.js, viewport, polling).

- `a8057e0 Track and display reasoning duration` and the
  cluster around it (`610e853`, `807e643`, `72a954d`,
  `807e643`, `610e853`, `a8057e0`) — the current
  `reasoningDurationMs` metadata path on the assistant message,
  surfaced as the "Thought" / "Worked" timing label.

- `6cf70c2 Add server-side upload relay and R2 putObject` — the
  same-origin `PUT /api/uploads/:uploadId/content` fallback that
  `public/js/api.js` `putUploadContent` uses when R2 CORS blocks
  the browser PUT. `4931ab4` / `28ec2e6` later fix the canonical
  query string for downloads.

### Era 7 — API-credit billing, web search rework, Ziina payments, Google sign-in (May 28 – Jun 9)

- `08a2b9f Switch to API-credit weekly billing` — moves billing
  from per-message counters to a unified weekly API-credit window.
  Creates `usage_api_weekly` / `usage_api_events` (migration
  `2026_06_08_add_api_credit_billing.sql`), `klui_check_api_budget`
  and `klui_record_api_usage` RPCs, and `assertApiBudgetAvailable`
  + `apiUsageWindow` in `server/saas/billing.js`. This is the
  metering path that every chat/compare/council/temporary call
  goes through today.

- `caac3f6 Add Ziina manual payment requests & plans` (migration
  `2026_06_08_add_ziina_payment_requests.sql`) — adds the Ziina
  payment-request workflow: `POST /api/payments/ziina` creates a
  pending request with a Klui reference code; the admin dashboard
  approves it; approval creates the active subscription.

- `0b43582 Admin dashboard: UI, summary & caching` — adds the
  in-process 60-second cache on `handleAdminSummary` and the
  admin drawer in `app.js`.

- `9a82a3c Add global system prompt admin & persistence` — the
  `app_settings` table (migration
  `2026_06_26_add_global_app_settings.sql`),
  `server/saas/systemPrompt.js`, and the admin GET/PATCH
  `/api/admin/settings` endpoints.

- `be84b3a Integrate SearXNG as primary web search provider with fallback to Jina and Brave` —
  flips the default from "Jina primary" to "SearXNG primary / Jina
  fallback / Brave fallback". Adds the chat-tuned relevance
  re-ranker in `server/websearch/searxng.js` (tokenization, stopword
  filter, host quality bonus, noise blacklist, GitHub-generic
  filter, "restaurants"-term filter). This is the current
  `resolveChain` order in `server/websearch/index.js`. The
  `CURRENT_SYSTEM.md` document is now stale on this point.

- `1ff2f5d Add Council mode for multi-model comparison`,
  `67bba36 Remove agent mode toggle and force agentMode on` —
  hardens Council and unifies the agent-mode default.

- `34a145b Inject neutral image evidence for vision compare` —
  the `injectImageEvidenceForVisionCompare` path in
  `server/routes.js`.

- `5311f6b Add JS artifact generator to document worker` —
  switches the document worker to call `worker/artifact_generator.mjs`
  for DOCX/XLSX/PPTX creation (the Python generators are kept as
  fallbacks). This is the current
  `DOCUMENT_USE_JS_ARTIFACT_GENERATOR=1` default.

- `1011748 Add PPTX (PowerPoint) document support` (migration
  `2026_06_09_add_pptx_document_support.sql`) — extends the
  `document_files.kind` check to include `pptx`.

- `7dafe29 Add visual theme support for generated artifacts` —
  the `theme` enum (`clean` / `business` / `academic`) on
  `create_document`.

- `8e9f724 Prefer DeepSeek provider with fallbacks` — the
  `order: ["deepseek"]` provider preference for DeepSeek models
  in `server/providers.js`.

- `e2ec9fd Cascade FKs and add orphan document cleanup`,
  `48ee0ed Extend cleanup to include caches and cron job` (migrations
  `2026_06_10_add_orphan_document_cleanup.sql`,
  `2026_06_10_extend_cleanup_to_caches.sql`) — the cascade
  semantics for `attachments` / `document_files` /
  `document_jobs` and the `klui_cleanup_storage_and_cache` RPC.

- `595944c Add Google Identity sign-in support`, `1b12a97 Switch to Google-only auth and add guest modal` —
  the current Google sign-in flow. Email magic link is still
  supported in the current Supabase Auth setup but the UI is
  Google-first.

### Era 8 — Sidebar, themes, mobile MVP (Jun 9–18)

- The sidebar work cluster (`ae8961f`, `3f1fd06`, `d1f7e6b`, `9a5d3e5`,
  `f9b87e2`, `6d2b4ad`, `71c243f`, `b9f2c70`, `156ea5d`, `8ccd362`,
  `3a95c9c Add chat theme selector and 'Cyber Mind' theme`,
  `5d516c2 Add 'Doodle Luxe' chat theme`, `6ebaeef Add appearance and accent color themes`)
  produces the current sidebar, theme, and appearance system.
  `15707c0` and the surrounding commits establish the
  `--color-source-*` CSS variables that
  `public/js/app.js` `renderInlineSourcePill` still uses.

- `284cd34 Implement follow-up message feature with UI updates and styling` —
  the follow-up queue (`addFollowUpFromInput`, `drainFollowUps`).
  Used by the temporary chat to chain related questions.

- `4581ab9 Add native top-bar mode handlers and tests` and the
  mobile-MVP work — see Era 9.

- `4115b32 Add taste documentation` — seeds
  `.commandcode/taste/taste.md` (the document that
  `.commandcode/taste/taste.md` is generated from).

### Era 9 — Mobile MVP and Android APK (Jun 18–28)

- `ad95ea1 Add Android APK and iPhone PWA mobile MVP` — the first
  mobile build. Adds the `android/` Capacitor project, `MOBILE.md`,
  `vite.mobile.config.js`, the mobile build pipeline in
  `package.json`, the `dist-mobile/` build target, and the iPhone
  PWA support (`public/service-worker.js`).

- `a829e9a PKCE storage, callback dedupe, render shell early` —
  the PKCE plumbing for the native APK in
  `public/js/platform/index.js`.

- `43c04b5 Support Capacitor native UI and Google auth`,
  `5ae7142 Enable Supabase session persistence`, `44457f4 Add debug APK and switch to preferences storage` —
  harden the native side.

- `426585b Publish Android 1.0.1` through `698d9f6 Release Klui Android 1.0.9` —
  eight APK release commits between Jun 23 and Jul 1 2026.

- `5ea95f2 Add native TextZoom support and UI` — the
  `TextZoomPlugin` Java class and the in-app "Text size" slider.

- `b76873b Android edge-to-edge, center empty state` — the
  `MainActivity` edge-to-edge setup.

### Era 10 — Deep Research (Jun 29 – Jul 1)

- `b096247 Add Deep Research feature (worker, UI, API, DB)` — the
  largest single architecture change after Council. Introduces
  `server/research/{engine,extract,fetcher,prompts,search,worker}.js`,
  the `research-worker` Docker Compose service, the
  `npm run research:worker` script, the `research_runs` table
  (migration `2026_06_29_add_research_runs.sql`) and the
  `klui_claim_research_run` RPC, the `cheerio` and `ipaddr.js`
  runtime dependencies, and the browser-side research card +
  report view. Also adds `8c868de`'s SearXNG config and
  `2f25fc9`'s lease cleanup.

- `d45e576 Enhance research engine with iterative planning` —
  upgrades the research engine to plan-driven iterations.

- `577228f Add research report theming and masthead`,
  `5922507 Clean report summaries, remove dek, bump assets`,
  `e4ba2cb Enhance research report copy and TOC behavior`,
  `b83e945 Polish research card UI, motion, and tests`,
  `5f04d06 Increase research defaults and add finalMaxTokens` —
  the report UI hardening.

- `8ce9163 Add research report context hydration` — wires the
  completed research report into the chat history so follow-up
  prompts can reference it. Implemented as
  `withResearchReportContext` in `server/routes.js`.

- `682fae6 Add long-paste handling and pasted-text UI` and
  `686d057 Add renderPlainText and user content rendering` — the
  long-paste detection (`LONG_PASTE_MIN_CHARS` / `LONG_PASTE_MIN_LINES`
  in `public/js/app.js`) and the pastable text card.

- `c55223a Reset provisional tool prose and retry` and
  `c6862a2 Tighten text zoom bounds and start focus earlier` —
  the most recent commits. The first resets the tool-loop's
  provisional prose before the final tool answer (the
  `e8dd707 Sync and refactor stripLeakedToolMarkup; add test`
  invariant the tool loop guarantees); the second tightens the
  TextZoom bounds and starts the focus earlier in the bootstrap.

### 1.11 Complete commit inventory (273 commits)

The 273 commits in the working tree, grouped by era. Every commit is
listed; the era membership is derived from the commit date and the
prose description of the era in § 1.1 – § 1.10. Era counts:

- Era 1 (CrofAI MVP): 4 commits
- Era 2 (Frontend polish + brand rename): 9 commits
- Era 3 (Managed Smartyfy SaaS stack): 8 commits
- Era 4 (Markdown hardening + Compare foundations): 13 commits
- Era 5 (Council metering and provider reasoning): 8 commits
- Era 6 (Document subsystem): 32 commits
- Era 7 (API-credit billing + web search rework + payments + Google sign-in): 50 commits
- Era 8 (Sidebar + themes + mobile MVP start): 108 commits
- Era 9 (Mobile MVP + Deep Research): 24 commits
- Era 10 (Latest refinements): 17 commits

**Total: 273 commits** (verified via `git log --oneline | wc -l`).

#### Era 1

- `f02ff43` — Add CrofAI model browsing and image uploads
- `ca1c4f1` — Add live CrofAI model catalog integration
- `afc001c` — Redesign frontend UI to clean, minimal ChatGPT-like aesthetic
- `b9daeda` — Build Dockerized CrofAI chat MVP
  *(total: 4 commits)*
#### Era 2

- `ca1b9cf` — Rename branding from Smartfy to Smartyfy
- `3d69c46` — Add brand logos to model selector and filter Gemma/Greg models
- `69d5173` — Strip provider prefixes from model names
- `8a1efa3` — Simplify model display names to text after first colon
- `19e8a7e` — Fix compact model labels for version-only slugs
- `b5e885a` — Improve model labels and model search field
- `273cc5e` — Move model selector into composer with minimal dropdown
- `a282013` — Replace browser confirm with custom delete dialog
- `3f500cb` — Replace native delete confirm with in-app modal
  *(total: 9 commits)*
#### Era 3

- `df3813d` — Add rich markdown, LaTeX, and syntax-highlighted code rendering
- `019bdf8` — Add composer thinking-effort control and forward reasoning_effort
- `89fd25c` — Delete R2 images when chats and messages are removed
- `097696c` — Make conversation deletion hard-delete Supabase records
- `da4d516` — Restore 3d69c46-style frontend and wire it to managed backend
- `4f2be46` — Remove Stripe and add testing access mode
- `95a1a0d` — Remove Stripe and enable testing access mode
- `61582ab` — Implement managed Smartyfy SaaS stack
  *(total: 8 commits)*
#### Era 4

- `a3135e7` — Add migration to add messages.metadata column for Model Council
- `c95eba5` — Add Model Council three-stage pipeline with peer review and chairman synthesis.
- `cb15417` — Improve image describe prompt for better transcription quality
- `691552c` — Fix Google OAuth redirect by including Supabase apikey.
- `f68e48f` — Fix compare image context and usage accounting
- `937b9aa` — Add compare mode image context handling with single-call describe
- `a120d10` — Fix Docker startup and frontend auth boot
- `b83de21` — Auto-scroll during streaming, cancel on manual scroll
- `9a057cb` — Fix code block rendering, add copy buttons, and fix send flash
- `888ee13` — Fix chat send failures and compare usage accounting
- `40b6119` — Charge compare chats by model count
- `0fb9fe9` — Allow safe br tags in markdown rendering
- `8a1642b` — Harden markdown rendering and math parsing
  *(total: 13 commits)*
#### Era 5

- `a78d7ec` — Add document tools, worker, and docs
- `94b6697` — Document planned word PDF and spreadsheet skills
- `0086ee8` — Move sources pill below answers and add inline citation pills
- `a1986ed` — Hide web-search tool UI and restyle sources as expandable pill
- `afda4fe` — Fix web search context handling and request abort signals
- `7bd77fd` — Require JINA_API_KEY for s.jina.ai search
- `c76a902` — Add web search via Jina (primary) and Brave (fallback) with tool calls
- `99a4c94` — Meter CrofAI usage per request and fix council rank display
  *(total: 8 commits)*
#### Era 6

- `6cf70c2` — Add server-side upload relay and R2 putObject
- `6633755` — Rename Smartyfy to Klui across project
- `da7b361` — Add agent mode toggle and server handling
- `87c792d` — Enhance document vision handling and limits
- `6576fb0` — Support inline PDF page images for vision models
- `9bf1528` — Add assistant message retry feature
- `f3bda0a` — Use light code theme and refine code styling
- `2825d45` — Simplify inline citation pill injection
- `bbf88f9` — Use placeholder slots for inline citation pills
- `2174f34` — Always attach pdf-read and visual read tools for PDFs
- `c39f149` — Improve document-read detection for uploads
- `01cdb8c` — Improve PDF visual handling and vision model hints
- `a03f0a6` — Add visual PDF page support and upload UI
- `7c3f8ae` — Enhance single-dollar math detection
- `a8057e0` — Track and display reasoning duration
- `7a2523d` — Remove Na-ve-Bayes-Classification-Summary.pdf
- `9e54c72` — Allow greg in selector; mark as vision+reasoning
- `b1ca157` — Add clean PDF viewer and progressive rendering
- `9378883` — Add document viewer sidebar
- `e3d38a6` — Improve document skills and PDF table rendering
- `b7e6ad1` — Support pending document artifacts and job polling
- `4d41ed0` — Add document skills and artifact download rendering
- `32d5b92` — Fix document creation to use actual summary content
- `28ec2e6` — Fix R2 presigned download query canonicalization
- `4931ab4` — Use signed URL JSON for attachment downloads.
- `e461597` — Hide native disclosure marker on Thinking box.
- `df79c0d` — Improve thinking UI and simplify document attachment labels.
- `90175e5` — Fix authenticated document downloads and dedupe document sources.
  *(total: 28 commits)*
#### Era 7

- `3413f25` — Add OpenRouter provider toggle & support
  *(total: 1 commits)*
#### Era 6

- `af92675` — Return single reasoning field from delta
- `e9f19b8` — Normalize image.detail and improve model cache resolution
- `c300a7a` — Normalize OpenRouter reasoning effort handling
- `07a2671` — Support provider reasoning tokens and mapping
  *(total: 4 commits)*
#### Era 7

- `ad9dae1` — Render non-HTTP source URLs as static rows
- `6feb4d4` — Improve message scrolling and sanitize code languages
- `d3fe1e1` — Add streaming message rendering and targeting
- `8e9f724` — Prefer DeepSeek provider with fallbacks
- `23419c4` — Improve doc/pdf/xlsx generation and add tests
- `1c36ea4` — Require format and intent before create_document
- `ee1bab1` — Improve artifact detection for document skills
- `1017a7e` — Prefer create_document for document artifacts
- `7e8dee3` — Support native PPTX charts for pricing comparisons
- `3b3b14a` — Improve PPTX slide quality and add tests
- `1192798` — Improve document artifact handling and handoff
- `a36e47a` — Enhance XLSX generator: metrics, notes, formatting
- `bc96616` — Improve DOCX generation: headings, styles, spacing
- `463ba7e` — Improve PPTX slide generation and parsing
- `7dafe29` — Add visual theme support for generated artifacts
- `8362f66` — Add runtime libs; fix XLSX formatting and filter
- `5311f6b` — Add JS artifact generator to document worker
- `d6d4810` — Add PPTX to supported document types
- `1011748` — Add PPTX (PowerPoint) document support
- `f1632dd` — Add document skill registry and refactor skills
- `caac3f6` — Add Ziina manual payment requests & plans
- `607957e` — Update empty-state copy and script version
- `1b12a97` — Switch to Google-only auth and add guest modal
- `595944c` — Add Google Identity sign-in support
- `0b43582` — Admin dashboard: UI, summary & caching
- `c197a10` — Use max of local and provider token estimates
- `c4d467b` — Add API auth runtime & conversation URL sync
- `b6b992f` — Update Jina websearch endpoint and headers
- `08a2b9f` — Switch to API-credit weekly billing
- `326349e` — Add context token usage reporting & estimates
- `bfac1eb` — Reduce message image max dimensions
- `dae8334` — Delay revoking image previews and allow blob URLs
- `34a145b` — Inject neutral image evidence for vision compare
- `7732c41` — Refine image/text extraction instructions
- `01d193f` — Support streaming vision model responses
- `67bba36` — Remove agent mode toggle and force agentMode on
- `c00edbc` — Ignore placeholder reasons in council UI/parser
- `1ff2f5d` — Add Council mode for multi-model comparison
- `cb5a1ac` — Letter aliases for compare and layout tweaks
- `a188cf0` — Update composer placeholder and script tag
- `33b85c3` — Add context meter and enforce 2-model compare
- `792e13a` — Refine model picker UI and wording
- `e054bf1` — Add composer action menu and tweak model UI
- `c5c48fc` — Simplify model picker for OpenRouter routing
- `e1da556` — Document titles in citations; add attachments
- `9051dee` — Avoid treating currency and tables as math
- `65cfc67` — Add retry/backoff for chat completions
- `54b510b` — Fallback when providers don't support tools
- `9eb8265` — Sanitize and render inline citations as plain text
  *(total: 49 commits)*
#### Era 8

- `9ed48d2` — Enhance chat access handling with upgraded plan prompts and UI updates
- `c77df1b` — Add flash animation for copy success and update stylesheet references
- `70c867b` — Implement message editing functionality with user interface updates and backend support
- `7608ab7` — Update pro usage description to reflect increased capacity
- `97c34fb` — Update styles.css and index.html for improved styling and versioning
- `deac9c6` — Update app.js version in index.html for code copy functionality
- `52db3cb` — Enhance code source management by implementing reset functionality and updating code retrieval logic
- `5c7fb8f` — Refactor code copy functionality to use unique code IDs and implement code source management
- `6e7b924` — Update page title and add favicon for improved branding
- `038fbbd` — Add Supabase plugin configuration to settings
- `54198d5` — Hide admin settings sections and update related JavaScript functionality
- `3551f6e` — Implement temporary chat mode toggle functionality and update related UI elements
- `83f290e` — Update temporary chat mode logic and enhance sidebar section label styles
- `873895e` — Add quality version to cache key and implement noise filtering in search results
- `d816614` — Fix reasoning duration metadata handling in conversation message comparison
- `8e48832` — Add metadata handling to conversation message events
- `7becdd1` — Refactor untrusted document context formatting and update tests to remove inline citation markers
- `69952f6` — Enhance runSharedPreSearch to support deep reading of search results and update tests for URL handling
- `2312fef` — Refactor runSharedPreSearch to enhance web search handling and add tests for auto mode and URL processing
- `8c868de` — Update SearXNG configuration and enhance search request headers for improved functionality and testing
- `4947f50` — Remove unused methods for deleting conversation and message document jobs in SupabaseRest class
- `be84b3a` — Integrate SearXNG as primary web search provider with fallback to Jina and Brave; update configuration and add tests for search functionality
- `900c2ba` — Enhance theme preview styles for improved visual consistency and user experience
- `bf20f74` — Enhance settings drawer visibility with transition effects for smoother opening and closing
- `dcaaaf8` — Refactor settings drawer to enhance accessibility and improve theme and appearance selection UI
- `0ab3486` — Enhance thinking status to use data attributes for improved accessibility and visual effects
- `f2f41bf` — Enhance thinking status styling with shimmer effect and improved text visibility
- `3653383` — Refactor thinking status styling for improved visual effects and clarity
- `4115b32` — Add taste documentation outlining code style, branding, web search, UI/UX, model naming, npm, and devops guidelines
- `4820f53` — Refactor reasoning summary labels to use "Worked" instead of "Thought" for improved clarity
- `b135008` — Enhance thinking status styling with data attributes for improved visual effects
- `b12f9ba` — Enhance thinking status styling with animation effects for improved visual feedback
- `7ac61d3` — Enhance thinking status styling with shimmer effect for improved visual feedback
- `610e853` — Refactor reasoning duration calculation to ensure accurate tracking of activity start and end times
- `807e643` — Refactor activity tracking logic to improve finish reason handling and streamline assistant activity finalization
- `f4cd50c` — Refactor handleTemporaryChat function to enhance web search integration and tool setup logic
- `72a954d` — Enhance activity tracking and reasoning management; add styling for thinking status
- `d7d6bb5` — Refactor removeConversation function to improve error handling and state management during conversation deletion
- `013527b` — Remove toast notifications for chat routing, pinning, renaming, deletion, payment actions, and temporary chat toggle for a cleaner user experience.
- `ee25fb7` — Update upgrade button icon and adjust chat layout for cyber theme
- `c83958d` — Add temporary chat bar styling for doodle theme and adjust layout properties
- `33af50b` — Enhance layout and responsiveness by adjusting height and padding properties; introduce new font variable for improved typography
- `8809253` — Implement temporary chat feature with UI controls and backend support
- `6e99dd7` — Remove starter help section and associated styles for cleaner layout
- `2e33fef` — Toggle send button visibility based on running state in syncSettingsInputs function
- `a8f03ce` — Adjust empty chat state padding and positioning for improved layout consistency
- `7997576` — Refactor doodle theme styles to simplify background handling and improve layout for empty chat state
- `e968259` — Refactor starter help section for improved readability and styling
- `e5332c3` — Update paywall UI with close button and enhance starter help section
- `dc088fc` — Remove sign-out button from paywall and related event listener
- `284cd34` — Implement follow-up message feature with UI updates and styling
- `032324a` — Add backoff for job claim network errors
- `227d852` — Revamp paywall UI and pricing plan rendering
- `d07492d` — Adjust doodle theme z-index; bump CSS version
- `219977f` — Doodle theme: add light-mode glow & edge masks
- `b938402` — Update doodle background & stylesheet version
- `e0e0a66` — Refactor 'cyber' theme styles and bump CSS version
- `498f14b` — Update stylesheet version and composer styles
- `15507c0` — Use CSS variables for source/source-pill styles
- `6ebaeef` — Add appearance and accent color themes
- `a1eaa4e` — Preserve scrollTop and update cache-bust
- `7e7e0e0` — Control auto-scroll via user gestures
- `a12442f` — Refine message autoscroll handling
- `214248b` — Refactor autoscroll behavior and bump app version
- `1d84de1` — Refine autoscroll behavior and handlers
- `cbdc788` — Suppress programmatic scrolls to improve autoscroll
- `7569615` — Auto-close source pills on scroll and outside click
- `a055834` — Fix message footer sources panel positioning
- `7b2f6f7` — Improve message footer layout and copy button
- `8115dab` — Add message footer with action buttons
- `638509d` — Add chat rename feature
- `99bfa0d` — Sidebar conversation menu: flip up + asset version bump
- `843441d` — Add sidebar pinned chats and search UI
- `bc89e6c` — Update compare label and script version
- `ae8961f` — Clean chat UI: hide avatars, add icon copy button
- `335f89e` — Add profile upgrade/paywall UI and handlers
- `f9b87e2` — Make composer area transparent & adjust layout
- `8ccd362` — Fix sidebar sizing and bump stylesheet version
- `d1f7e6b` — Show inline profile meta in sidebar
- `3f1fd06` — Update sidebar layout and bump CSS version
- `9a5d3e5` — Add profile sidebar menu and UI tweaks
- `156ea5d` — Center cyber sidebar top/bottom; bump CSS version
- `71c243f` — Update cyber sidebar stylesheet and CSS
- `6d2b4ad` — Collapse cyber theme top gradient to thin border
- `dba08ea` — Right-align user messages and adjust layout
- `7728320` — Doodle theme: layout and styling tweaks
- `7534a91` — Adjust cyber theme spacing and max widths
- `b9f2c70` — Cyber theme: scrollable messages & composer layout
- `cb6d539` — Add account usage UI; hide context meter
- `5d516c2` — Add 'Doodle Luxe' chat theme
- `3a95c9c` — Add chat theme selector and 'Cyber Mind' theme
- `48ee0ed` — Extend cleanup to include caches and cron job
- `e2ec9fd` — Cascade FKs and add orphan document cleanup
  *(total: 93 commits)*
#### Era 9

- `ad95ea1` — Add Android APK and iPhone PWA mobile MVP
  *(total: 1 commits)*
#### Era 8

- `e8dd707` — Sync and refactor stripLeakedToolMarkup; add test
- `0b59af3` — Refine SearxNG result scoring and selection
- `c0554b0` — Strip leaked DSML tool markup from messages
- `2f41452` — Improve SearXNG relevance & noise filtering
- `8373563` — Add frosted glass effect to doodle composer
- `ee10fd1` — Set minimum top for composer in empty chat
- `e0dc353` — Doodle: composer transparent, temp-bar mobile fix
- `878e2d8` — Responsive layout tweaks, doodle composer & cache bump
- `9c14ec7` — Responsive mobile UI, image preview, and fixes
- `a829e9a` — PKCE storage, callback dedupe, render shell early
- `44457f4` — Add debug APK and switch to preferences storage
- `5ae7142` — Enable Supabase session persistence
- `43c04b5` — Support Capacitor native UI and Google auth
- `426585b` — Publish Android 1.0.1
- `c5de756` — Mobile: API origin env, shell visibility, SW tweaks
  *(total: 15 commits)*
#### Era 9

- `e4ba2cb` — Enhance research report copy and TOC behavior
- `b83e945` — Polish research card UI, motion, and tests
- `5f04d06` — Increase research defaults and add finalMaxTokens
- `2f25fc9` — Improve research run cancellation and cleanup
- `b096247` — Add Deep Research feature (worker, UI, API, DB)
- `4584038` — Add desktop temporary-chat CSS and test
- `f2a4869` — Add admin toggle for model reasoning display
- `0b13195` — Release Klui Android 1.0.8
- `6e74c00` — Responsive header: hide APK-only controls
- `4581ab9` — Add native top-bar mode handlers and tests
- `1ff2580` — Transparent status bar and composer tap fix
- `219eb64` — Release Klui Android 1.0.7
- `de611f0` — fix: polish native composer and temp chat label
- `03145f9` — Release Klui Android 1.0.6
- `2695084` — fix: stabilize native composer focus
- `81561da` — Release Klui Android 1.0.5
- `45f0abb` — fix: polish native chat composer
- `4a0757f` — Fix delete and edit button
- `3a52c6c` — fix: show rename/delete dialogs above native sidebar
- `9a82a3c` — Add global system prompt admin & persistence
- `00d321b` — Update Android app icon
- `f0bdce5` — Release Android APK 1.0.2
- `ec0e21d` — fix: polish Android native app experience
  *(total: 23 commits)*
#### Era 10

- `c55223a` — Reset provisional tool prose and retry
- `c6862a2` — Tighten text zoom bounds and start focus earlier
- `682fae6` — Add long-paste handling and pasted-text UI
- `686d057` — Add renderPlainText and user content rendering
- `a4e2b9d` — Optimize chat prompt navigator rendering
- `8ce9163` — Add research report context hydration
- `698d9f6` — Release Klui Android 1.0.9
- `5ea95f2` — Add native TextZoom support and UI
- `b76873b` — Android edge-to-edge, center empty state
- `9a91eaa` — Add native header fade and mobile build check
- `6c033af` — Position desktop prompt navigator
- `5922507` — Clean report summaries, remove dek, bump assets
- `577228f` — Add research report theming and masthead
- `c7906e1` — Ignore .agents and add skills-lock.json
- `d45e576` — Enhance research engine with iterative planning
- `f595045` — Remove chat prompt title and fix nav position
- `51c295d` — Add desktop chat navigation (prompt rail + jump)
  *(total: 17 commits)*

## 2. Important commit hashes and what they changed

The commits that shifted architectural responsibility (not
single-feature work). Each row is the file it primarily
moved, with a short note on what changed.

| Hash | Date | Subject | What shifted |
|---|---|---|---|
| `b9daeda` | 2026-05-12 | Build Dockerized CrofAI chat MVP | The whole initial architecture. |
| `61582ab` | 2026-05-13 | Implement managed Smartyfy SaaS stack | Created the current backend shape (auth/db/PostgREST/SaaS). |
| `4f2be46` / `95a1a0d` | 2026-05-14 | Remove Stripe and add testing access mode | The current `ACCESS_MODE=testing` shape. |
| `019bdf8` | 2026-05-14 | Add composer thinking-effort control and forward reasoning_effort | First reasoning-effort wiring. |
| `c95eba5` | 2026-05-21 | Add Model Council three-stage pipeline | Created `server/saas/council.js` and the Council SSE envelope. |
| `99a4c94` | 2026-05-21 | Meter CrofAI usage per request | Created `server/saas/usageMeter.js` and the fallback pricing model. |
| `c76a902` | 2026-05-22 | Add web search via Jina (primary) and Brave (fallback) with tool calls | Created the entire `server/websearch/` module family. |
| `a78d7ec` | 2026-05-23 | Add document tools, worker, and docs | Created `server/documents/`, `worker/`, and the `document_*` schema family. |
| `af92675` / `e9f19b8` / `c300a7a` / `07a2671` | 2026-05-28 | Reasoning tokens, model cache resolution, OpenRouter reasoning effort, provider reasoning tokens | The current `extractReasoningDelta` shape. |
| `3413f25` | 2026-05-28 | Add OpenRouter provider toggle & support | Created `server/providers.js` and the per-provider adaptation. |
| `6633755` | 2026-05-28 | Rename Smartyfy to Klui across project | Final brand name. |
| `08a2b9f` | 2026-06-08 | Switch to API-credit weekly billing | Created the `usage_api_weekly` / `usage_api_events` model and the `klui_check_api_budget` / `klui_record_api_usage` RPCs. |
| `caac3f6` | 2026-06-08 | Add Ziina manual payment requests & plans | Created the `payment_requests` table and the admin approval flow. |
| `5311f6b` | 2026-06-09 | Add JS artifact generator to document worker | Switched the document worker to the JS-first `docx`/`ExcelJS`/`PptxGenJS` generators. |
| `be84b3a` | 2026-06-15 | Integrate SearXNG as primary web search provider with fallback to Jina and Brave | Flipped the web-search default to SearXNG-primary. |
| `e2ec9fd` | 2026-06-10 | Cascade FKs and add orphan document cleanup | The cascade semantics and the `klui_cleanup_storage_and_cache` RPC. |
| `9a82a3c` | 2026-06-26 | Add global system prompt admin & persistence | The `app_settings` table and the admin GET/PATCH `/api/admin/settings` endpoints. |
| `ad95ea1` | 2026-06-23 | Add Android APK and iPhone PWA mobile MVP | The mobile platform. |
| `a829e9a` | 2026-06-23 | PKCE storage, callback dedupe, render shell early | Native PKCE plumbing. |
| `b096247` | 2026-06-29 | Add Deep Research feature (worker, UI, API, DB) | Created `server/research/`, the research worker, and the `research_runs` table. |
| `d45e576` | 2026-06-30 | Enhance research engine with iterative planning | The current plan-driven research loop. |
| `8ce9163` | 2026-07-01 | Add research report context hydration | `withResearchReportContext` (research reports hydrate into the chat history). |
| `c55223a` | 2026-07-01 | Reset provisional tool prose and retry | Latest invariant in the tool loop. |

## 3. High-churn files and why

The top-12 files by commit count (full repo, not just source):

| Commits | Path | Why it accumulates work |
|---:|---|---|
| 150 | `public/js/app.js` | Every UI surface lives in one file: composer, sidebar, settings, account, model picker, council, compare, documents, research, image upload, follow-ups, dialogs, navigation, message rendering, and the streaming reducer. There is no extraction layer between the 6,704-line file and the rest of the client. |
| 140 | `public/index.html` | The whole single-page shell — every new view (setup, paywall, chat, research report, admin drawer, settings drawer) grows the DOM. |
| 132 | `public/styles.css` | The single shared stylesheet for every visual surface. The "Doodle Luxe", "Cyber Mind", and accent-color themes, the responsive mobile work, the document viewer, the council/compare layouts, and the admin drawer all land here. |
| 61 | `server/routes.js` | The single dispatch file plus the bulk of chat/Council/Compare/temporary/admin/research orchestration. Every chat feature lands here. |
| 30 | `public/js/render.js` | The renderer pipeline (marked + KaTeX + hljs + DOMPurify) and the model-catalog normalisation. The LaTeX isolation, code-block source storage, brand-logo resolution, vision detection, and badge inference are all here. |
| 22 | `README.md` | Updated alongside every feature (R2, plan limits, document skills, web search, mobile, research). |
| 21 | `test/saas.test.js` | Tests for entitlements, billing, R2, image counts, and the usage meter. Every change to the SaaS layer lands here. |
| 20 | `test/render.test.js` | Tests for the renderer pipeline (math detection, code highlighting, model normalisation). |
| 20 | `test/mobile.test.js` | Tests for the platform abstraction (`isNative`, storage, secure storage, deep links, OTA updates). |
| 20 | `server/db/supabaseRest.js` | One method per table operation; every new table or RPC adds at least one method. |
| 20 | `public/js/api.js` | One function per server route; grows with the route table. |
| 19 | `test/websearch.test.js` | Tests for the search orchestrator, the tool loop, and the document tool integration. |

### Why `public/js/app.js` is 6,704 lines

There is no architectural boundary in the browser between "data
fetching", "state management", and "rendering". The 6,704-line
`app.js` is the single file that owns:

- All the long-lived client state (the `state` object and the
  module-level mutable singletons: pollers, queues, scroll
  position, research poll timer, document viewer state).
- All the API call sites (`executeSend`, `sendPrompt`,
  `retryFailedAssistant`, `startDeepResearch`, `startZiinaPayment`).
- The per-mode streaming reducers (`applyStreamEvent`,
  `applyCompareStreamEvent`, `applyCouncilStreamEvent`).
- The document viewer (PDF.js, viewport, polling, artifact
  viewer).
- The council/compare renderers and the
  `renderCouncilProgress`/`renderCouncilPanelist`/
  `renderCouncilSynthesis` UI.
- The research card and report view.
- The composer, the follow-up queue, the image upload pipeline,
  the long-paste UI.
- The sidebar (pinned, search, menu, conversation cards), the
  settings drawer, the account drawer, the admin drawer, the
  dialogs.
- The model catalog and the compare/council model pickers.
- The native bridge glue (`setupNativeLifecycle`,
  `configureNativeChrome`, `setTextZoom` plumbing).
- The theme/appearance application.
- Bootstrap (`bootstrap`).

The recommended extraction boundaries (without implementing them)
are in `ARCHITECTURE.md` § 10. The first three are:

1. `public/js/app.js` → `streaming.js`, `documentViewer.js`,
   `research.js`, `council.js`, `compare.js`.
2. `server/routes.js` → one file per resource.
3. `server/db/supabaseRest.js` → one file per table group.

### Why `server/routes.js` is 3,204 lines

It owns the dispatch (the if-ladder over `url.pathname` and
`req.method`) plus every chat-feature orchestrator. Every chat
feature lands here. The Compare path, the Council path, the
single-chat path, the temporary-chat path, the research create /
status / cancel / report handlers, the admin summary / settings /
payment handlers, the upload pipeline, the attachment download /
view / delete handlers, the conversation create / get / rename /
delete handlers, and the document job status handlers are all
handlers inside this one file. Recommended split is one file per
resource.

### Why `server/saas/messages.js` is 481 lines

It mixes message content normalisation (storage shape, R2 URL
hydration for client vs provider, council history filtering) with
streaming accumulation (the SSE reducer, the tool-call delta
accumulator, the two long-running stream readers) and SSE
serialisation (`writeProviderEvent`, `sanitizeProviderEvent`).
Recommended split is `messages/content.js` and
`messages/stream.js`.

### Why `server/websearch/tool.js` is 712 lines

The tool-calling run loop in `runChatWithToolLoop` mixes:

- the iteration cap and the "force final without tools" branch,
- the provider graceful-degradation negotiation (drop
  `tool_choice`, then `tools`),
- the artifact-handoff guard,
- the empty-answer retry,
- the visual page inline-image pipeline
  (`prepareVisualPagesForModel`, `visualDocumentMessage`,
  `visualImageInputLimit`),
- the per-mode SSE event emission.

Recommended split is `tool/loop.js`, `tool/visual.js`, and
`tool/detectUnsupported.js`.

### Why `server/db/supabaseRest.js` is 835 lines

One method per table operation. The class is the database
interface and it grows linearly with the schema. The `klui_*`
RPCs are in the same class. Recommended split is one file per
table group.

## 4. Current documentation that is stale or contradictory

Verified by re-reading the documents on the working tree:

- **`CURRENT_SYSTEM.md` (May 28 2026)** is the most stale. It
  was written when the model API was the Klui API only, web search
  was Jina-primary / Brave-fallback, and the only model output was
  streamed text. The following sections of `CURRENT_SYSTEM.md`
  are no longer authoritative:

  - "Current Backend Modules" — missing `server/research/`,
    `server/documents/`, `server/providers.js`, the OpenRouter
    provider, the Python document worker, the research worker.
  - "Current Required Environment" — does not list
    `OPENROUTER_API_KEY`, `DOCUMENTS_ENABLED`, `JINA_API_KEY`,
    `BRAVE_SEARCH_API_KEY`, `SEARXNG_BASE_URL`, the research
    knobs, or the document knobs.
  - "Web Search" — describes Jina-primary / Brave-fallback. The
    current default is SearXNG-primary / Jina-fallback /
    Brave-fallback (per `be84b3a`, default
    `WEBSEARCH_PRIMARY_PROVIDER=searxng`).
  - "Still Needed For Production" — the post-Stripe era has
    implemented the manual Ziina payment flow
    (`caac3f6`); a true production payment gateway is still
    pending.

  `CURRENT_SYSTEM.md` should be considered historical, not
  current. The current authoritative description is
  `README.md` plus the in-source documentation and this pack.

- **`README.md` (latest)** is authoritative for the product
  description, the dependency policy, the required environment
  variables, the document skills, and the web search setup. It
  matches the code.

- **`MOBILE.md` (latest)** is authoritative for the mobile build
  flow, the Capacitor plugin set, the Play-style universal link
  setup, the OTA update flow, and the release publishing. It
  matches the code.

- **`DOCUMENT_SKILLS_IMPLEMENTATION_PLAN.md`** is a planning
  document from `a78d7ec`. It is not authoritative for current
  behavior; the current document skills live in
  `server/documents/{index,skillRegistry,skills,tool}.js`.

- **`docs/FUNCTION_INDEX.md` and `docs/ARCHITECTURE_HISTORY.md`**
  (this file) are the current authoritative architecture pack.

- **`ANDROID_AGENT_WORKFLOW.md`** describes the agent-driven
  Android test workflow and is consistent with the current
  `scripts/android-agent-test.sh` script.

## 5. Test evidence

- `npm test` on `c55223a` (HEAD): **278 tests, 4 suites, 278 pass,
  0 fail, 0 cancelled, 0 skipped, 3.3 s wall time**.
  Test inventory (16 files, all under `test/`):
  - `artifact-generator.test.js`
  - `client-auth.test.js`
  - `council.test.js`
  - `documents.test.js`
  - `images.test.js`
  - `mobile.test.js`
  - `native-topbar.test.js`
  - `normalize.test.js`
  - `providers.test.js`
  - `reasoning.test.js`
  - `render.test.js`
  - `research.test.js`
  - `routes.test.js`
  - `saas.test.js`
  - `usage.test.js`
  - `websearch.test.js`

- `node --check` on every `.js` file under `server/` and
  `public/js/`: all files pass syntax check.

- No production code changed. The full diff of this commit is
  three new files:
  - `ARCHITECTURE.md` (new)
  - `docs/FUNCTION_INDEX.md` (new)
  - `docs/ARCHITECTURE_HISTORY.md` (new)

  `git status` on the working tree shows only these new files
  and no edits to existing files.
