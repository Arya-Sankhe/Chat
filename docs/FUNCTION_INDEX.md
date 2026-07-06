# Klui Chat Function Index

This index lists every meaningful function and export grouped by
feature. Symbols with `← mixed` next to them carry responsibilities
from more than one feature; symbols without are owned by exactly one
feature. File paths are relative to the repo root.

For every entry:

- **Symbol** — the exported name (or the file's primary responsibility
  for entry-point modules that have no exports).
- **Path** — source file.
- **Responsibility** — what it actually does today.
- **Callers** — who calls it.
- **Major dependencies** — which other modules it talks to.

Trivial private helpers (one-line accessors, sort comparators, simple
regex substitutions) are deliberately not listed.

---

## A. HTTP entry and dispatch

### `handleApiRequest` ← mixed
- **Path**: `server/routes.js`
- **Responsibility**: The single dispatch entry point. Routes every
  `/api/*` path + method combination to its handler, runs CORS
  preflight, installs the stable request signal, and converts thrown
  `HttpError` instances into JSON problem responses.
- **Callers**: `server/index.js`.
- **Major dependencies**: every other module under `server/`.

### `serveStatic`
- **Path**: `server/static.js`
- **Responsibility**: Serves `public/` files; falls back to
  `index.html` for unknown paths (SPA); applies CORS to
  `/downloads/android/latest.json`; serves APK downloads.
- **Callers**: `server/index.js`.
- **Major dependencies**: `node:fs`, `node:path`, `server/http/cors.js`.

### `loadConfig`, `configuredServices`
- **Path**: `server/config.js`
- **Responsibility**: `loadConfig` reads `process.env` and produces
  a typed config object (with plan list, mobile origins, document
  limits, websearch limits, research limits, etc.). `configuredServices`
  is the canonical feature-detection helper.
- **Callers**: `server/index.js`, `server/routes.js`, every module
  that needs to gate behavior on configuration.
- **Major dependencies**: `server/crofai/constants.js`, `server/saas/plans.js`,
  `server/http/cors.js`.

---

## B. Auth, CORS, response helpers

### `extractBearerToken`, `requireSupabaseConfig`, `requireUser`
- **Path**: `server/auth/supabase.js`
- **Responsibility**: `extractBearerToken` parses the `Authorization`
  header. `requireSupabaseConfig` throws 503 when Supabase is not
  configured. `requireUser` calls `GET /auth/v1/user` to verify the
  token and returns `{id, email, raw}`.
- **Callers**: `server/routes.js` (every protected route).
- **Major dependencies**: `server/http/responses.js`.

### `normalizeAllowedOrigins`, `applyApiCors`, `handleApiPreflight`
- **Path**: `server/http/cors.js`
- **Responsibility**: CORS primitives for the mobile Capacitor
  WebView and the OTA update flow.
- **Callers**: `server/static.js`, `server/routes.js`, `server/config.js`.
- **Major dependencies**: none.

### `HttpError`, `sendJson`, `sendProblem`, `parseJsonBody`, `readRawBody`
- **Path**: `server/http/responses.js`
- **Responsibility**: The shared response/exception toolkit.
  `HttpError(status, message, details)` is the canonical error type
  the whole server throws.
- **Callers**: every module.
- **Major dependencies**: none.

---

## C. Models, providers, chat normalization

### `DEFAULT_PROVIDER_ID`, `OPENROUTER_*_MODEL`, `normalizeProviderId`, `providerLabel`, `defaultModelForProvider`, `resolveProvider`, `providerAvailability`, `resolveOpenRouterReasoningEffort`, `adaptChatRequestForProvider`
- **Path**: `server/providers.js`
- **Responsibility**: Provider registry. `resolveProvider` returns
  `{apiKey, baseUrl, id, label}` for a provider id. `adaptChatRequestForProvider`
  rewrites `reasoning_effort` → OpenRouter `reasoning.effort`, forces
  `usage.include: true`, pins `require_parameters: true` for tool
  calls, and routes DeepSeek models to the `deepseek` provider.
- **Callers**: `server/crofai/client.js`, `server/routes.js`.
- **Major dependencies**: `server/http/responses.js`.

### `listModels`, `streamChatCompletion`, `chatCompletion`
- **Path**: `server/crofai/client.js`
- **Responsibility**: The only place that calls the upstream
  OpenAI-compatible model API. Bounded retry/backoff for
  408/425/429/5xx; non-retry on 4xx; abort propagation. Streaming
  callers pipe the raw Response; non-streaming callers parse the
  JSON.
- **Callers**: `server/routes.js`, `server/saas/usageMeter.js`,
  `server/saas/council.js`, `server/saas/images.js`,
  `server/research/worker.js`.
- **Major dependencies**: `server/http/responses.js`, `server/providers.js`.

### `DEFAULT_CROFAI_BASE_URL`, `CROFAI_BASE_URLS`, `SUPPORTED_CHAT_PARAMS`, `normalizeBaseUrl`
- **Path**: `server/crofai/constants.js`
- **Responsibility**: Whitelist of allowed Klui base URLs;
  `normalizeBaseUrl` is the only allowed validator.
- **Callers**: `server/config.js`, `server/routes.js`.
- **Major dependencies**: `server/http/responses.js`.

### `normalizeChatRequest` ← mixed
- **Path**: `server/crofai/normalize.js`
- **Responsibility**: Validates an inbound chat request. Role
  whitelist, content-type whitelist (text/image_url), image
  data-URL validator, numeric range checks, stop/seed/tools
  validation.
- **Callers**: `server/routes.js` (every chat-issuing handler).
- **Major dependencies**: `server/http/responses.js`.

---

## D. Persistence (PostgREST client)

### `class SupabaseRest` ← mixed
- **Path**: `server/db/supabaseRest.js`
- **Responsibility**: PostgREST client for the `service_role` key.
  One method per table operation plus the `klui_*` RPCs and the
  `klui_cleanup_storage_and_cache` maintenance routine. Methods
  include:
  - **Profiles / app settings**: `upsertProfile`, `updateProfile`,
    `getProfile`, `getAppSetting`, `upsertAppSetting`.
  - **Subscriptions / payments**: `getLatestSubscription`,
    `upsertSubscription`, `createPaymentRequest`,
    `listPaymentRequests`, `listPendingPaymentRequests`,
    `getPaymentRequest`, `updatePaymentRequest`.
  - **Conversations / messages / attachments**:
    `listConversations`, `createConversation`, `getConversation`,
    `updateConversation`, `deleteConversation` (also deletes
    attachments and R2 keys), `listConversationAttachments`,
    `listMessages`, `insertMessage`, `updateMessage`,
    `deleteMessage`, `listMessageAttachments`, `createAttachment`,
    `completeAttachment`, `updateAttachment`, `getAttachment`,
    `deleteAttachment`.
  - **Documents**: `createDocumentFile`, `getDocumentFile`,
    `getDocumentFileByAttachment`, `getReadyPdfPreviewForDocument`,
    `getActivePdfPreviewJob`, `listReadyDocumentFiles`,
    `listDocumentFilesByAttachments`, `updateDocumentFile`,
    `updateDocumentFileByAttachment`, `createDocumentJob`,
    `getDocumentJob`, `listDocumentChunks`, `listDocumentPages`,
    `searchDocumentPages` (RPC), `searchDocumentChunks` (RPC).
  - **Research**: `createResearchRun`, `getResearchRun`,
    `listActiveResearchRuns`, `updateResearchRun`,
    `claimResearchRun` (RPC), `failExpiredResearchRuns`.
  - **Caches**: `getSearchCache`, `upsertSearchCache`,
    `getModelCache`, `upsertModelCache`.
  - **Billing**: `checkApiBudget`, `recordApiUsageCost`,
    `getApiWeeklyUsage`.
  - **Admin**: `adminSummary`.
- **Callers**: `server/routes.js`, `server/research/worker.js`,
  `server/websearch/index.js` (via the orchestrator's `persistentCache`).
- **Major dependencies**: `server/http/responses.js`.

---

## E. R2 (Cloudflare R2 signed URLs)

### `isSupportedImageType`, `documentKindFromFileName`, `isSupportedDocumentType`, `uploadCategoryFromType`, `safeFileName`, `assertImageUpload`, `assertDocumentUpload`, `assertUpload`
- **Path**: `server/storage/r2.js`
- **Responsibility**: Static MIME-type and filename helpers.
- **Callers**: `server/routes.js`, `server/db/supabaseRest.js`.
- **Major dependencies**: `server/http/responses.js`.

### `class R2Client`
- **Path**: `server/storage/r2.js`
- **Responsibility**: `configured`, `requireConfigured`, `objectKey`,
  `uploadHeaders`, `presign`, `uploadUrl`, `putObject`, `readUrl`,
  `deleteUrl`, `headUrl`, `headObject`, `deleteObject`,
  `deleteObjects`. Pure-JS AWS Sig-V4 signing.
- **Callers**: `server/routes.js` (presign upload, upload relay,
  complete upload, attachment download/view/delete,
  conversation delete cascade).
- **Major dependencies**: `node:crypto`, `server/http/responses.js`.

---

## F. Plans, entitlements, billing, usage meter

### `loadPlans`, `publicPlan`, `findPlanById`
- **Path**: `server/saas/plans.js`
- **Responsibility**: Hard-coded three-tier plan catalog (lite/essential/pro)
  with env overrides. `publicPlan` is the projection returned by
  `GET /api/plans`.
- **Callers**: `server/config.js`, `server/routes.js`.
- **Major dependencies**: none.

### `getCurrentEntitlement`, `requireActiveEntitlement`
- **Path**: `server/saas/entitlements.js`
- **Responsibility**: Resolve the current active subscription +
  plan for a user, or short-circuit to the testing plan in
  `ACCESS_MODE=testing`.
- **Callers**: `server/routes.js`, `server/research/worker.js`.
- **Major dependencies**: `server/http/responses.js`, `server/saas/plans.js`.

### `billingPeriodForSubscription`, `apiUsageWindow`, `usageCostCredits`, `estimateOpenRouterCostCredits`, `fetchOpenRouterGenerationCost`, `assertApiBudgetAvailable` ← mixed
- **Path**: `server/saas/billing.js`
- **Responsibility**: `apiUsageWindow` splits the subscription
  billing month into 4 dynamic weeks. `usageCostCredits` extracts
  `usage.cost` from a provider usage object.
  `fetchOpenRouterGenerationCost` calls the OpenRouter generation
  endpoint for cost reconciliation. `assertApiBudgetAvailable`
  calls `klui_check_api_budget` and throws 429 when denied.
- **Callers**: `server/saas/usageMeter.js`, `server/routes.js`.
- **Major dependencies**: `server/http/responses.js`.

### `createCrofaiUsageMeter` ← mixed
- **Path**: `server/saas/usageMeter.js`
- **Responsibility**: Returns `{checkBudget, chatCompletion,
  streamChatCompletion}`. Wraps the raw `crofai/client.js`
  functions to enforce the weekly budget before each call and
  record the actual cost afterwards. Parses the streaming SSE for
  `usage` and `id` so the meter can attribute the cost to the
  generation.
- **Callers**: `server/routes.js`, `server/research/worker.js`.
- **Major dependencies**: `server/crofai/client.js`, `server/saas/billing.js`.

### `SYSTEM_PROMPT_SETTING_KEY`, `DEFAULT_GLOBAL_SYSTEM_PROMPT`, `normalizeGlobalSystemPrompt`, `systemPromptSettingValue`, `loadGlobalSystemPrompt`
- **Path**: `server/saas/systemPrompt.js`
- **Responsibility**: The default and admin-overridable global
  system prompt (stored in `app_settings`).
- **Callers**: `server/routes.js`.
- **Major dependencies**: none.

### `modelSupportsVision`, `resolveVisionDescribeModel`
- **Path**: `server/saas/models.js`
- **Responsibility**: Vision detection from OpenRouter model
  descriptors (`input_modalities` plus a name regex), and resolution
  of the vision describe model (config override → kimi/moonshot
  scan → `kimi-k2.6`).
- **Callers**: `server/saas/images.js`, `server/routes.js`.
- **Major dependencies**: none.

### `extractReasoningDelta`
- **Path**: `server/saas/reasoning.js`
- **Responsibility**: Normalizes reasoning/thinking deltas from
  `delta.reasoning_content` (Klui/DeepSeek) and `delta.reasoning` /
  `delta.reasoning_details[]` (OpenRouter).
- **Callers**: `server/saas/messages.js`.
- **Major dependencies**: none.

---

## G. Image description (vision fallback for text-only models)

### `messagesHaveImages`, `collectImageAttachmentIds`, `collectImageDescriptions`, `collectUndescribedImageAttachmentIds`, `applyImageDescriptionsToContent`, `substituteImagesWithDescriptions`, `describeConversationImages` ← mixed
- **Path**: `server/saas/images.js`
- **Responsibility**: `describeConversationImages` calls a single
  vision model to describe every attached image and returns
  `{descriptions, model}`. The other helpers collect ids, cache
  descriptions, and substitute images with text descriptions for
  text-only models.
- **Callers**: `server/routes.js`.
- **Major dependencies**: `server/crofai/client.js`, `server/saas/messages.js`,
  `server/saas/models.js`, `server/http/responses.js`.

---

## H. Messages, streaming, content shape

### `titleFromText`, `normalizeMessageSettings`, `buildStoredUserContent`, `normalizePastedTextRange`, `imageCountFromContent`, `contentText`, `hydrateMessagesForClient`, `filterCouncilHistory`, `buildProviderMessages`, `resolveReasoningDurationMs`, `reasoningDurationMetadata`, `normalizeUsage`, `stripLeakedToolMarkup`, `applyStreamEvent`, `sanitizeProviderEvent`, `writeProviderEvent`, `pipeProviderStreamAndAccumulate`, `streamProviderAndAccumulate` ← mixed
- **Path**: `server/saas/messages.js`
- **Responsibility**: Content shape, history filtering, the SSE
  stream reducer, tool-call delta accumulation, and the two
  long-running stream readers (`pipeProviderStreamAndAccumulate`
  for 1:1 relay, `streamProviderAndAccumulate` for the tool loop).
  `applyStreamEvent` is the central reducer; it captures usage
  from the trailing chunk and strips leaked DSML tool markup.
- **Callers**: `server/routes.js`, `server/saas/council.js` (dynamic
  import from the tool loop), `server/saas/images.js`.
- **Major dependencies**: `server/saas/reasoning.js`,
  `server/http/responses.js`.

---

## I. Council three-stage orchestration

### `COUNCIL_STAGE1_SYSTEM_PROMPT`, `withCouncilSystemPrompt`, `generateNonce`, `buildReviewerAssignments`, `buildPeerReviewPrompt`, `parseRanking`, `aggregateBordaCount`, `selectChairman`, `runPeerReview`, `bordaSummary`, `buildChairmanPrompt`, `runChairmanSynthesis` ← mixed
- **Path**: `server/saas/council.js`
- **Responsibility**: The full council flow. `buildReviewerAssignments`
  wraps each panelist response in a unique nonce tag and shuffles
  the letter labels A/B/C/… per reviewer. `parseRanking` extracts
  the order from the reviewer's output. `aggregateBordaCount`
  computes the average Borda score. `selectChairman` picks the
  override → Borda winner → user-selected → first panelist.
  `runPeerReview` runs Stage 2 with up to 3 attempts per reviewer.
  `runChairmanSynthesis` streams Stage 3.
- **Callers**: `server/routes.js` (`handleCouncilConversationMessage`).
- **Major dependencies**: `node:crypto`, `server/crofai/client.js`,
  `server/saas/messages.js`, `server/http/responses.js`.

---

## J. Documents: skills, tools, orchestrator

### `documentSkillText`, `isKnownDocumentSkill`
- **Path**: `server/documents/skillRegistry.js`
- **Responsibility**: The long prompt strings ("skills") for the
  model: BASE_SKILLS (`artifact-planner`, `document-read`,
  `pdf-read`, `document-edit`, `document-export`) and
  SPECIALIZED_SKILLS (`pdf-create`, `word-create`, `excel-create`,
  `presentation-create`).
- **Callers**: `server/documents/skills.js`.
- **Major dependencies**: none.

### `selectDocumentSkills`, `buildDocumentSystemHint`
- **Path**: `server/documents/skills.js`
- **Responsibility**: Heuristic-based tool/skill selection from the
  user prompt. Returns `{enabled, skills, toolNames, ready}`.
  Always attaches visual read tools and the `pdf-read` skill when
  a ready PDF is in the chat.
- **Callers**: `server/routes.js`.
- **Major dependencies**: `server/documents/skillRegistry.js`.

### `buildDocumentTools`, `isDocumentToolName`, `executeDocumentToolCall` ← mixed
- **Path**: `server/documents/tool.js`
- **Responsibility**: The six OpenAI-style tool schemas
  (`search_document`, `read_document`, `extract_tables`,
  `create_document`, `edit_document`, `export_document`) and the
  `executeDocumentToolCall` executor. Emits "pending artifact card"
  output so the UI can show a "Generating…" card while the worker
  is still processing.
- **Callers**: `server/websearch/tool.js` (when the model calls a
  document tool).
- **Major dependencies**: `server/documents/index.js` (the
  DocumentService) via the orchestrator.

### `class DocumentService` ← mixed, `buildUntrustedDocumentContext`
- **Path**: `server/documents/index.js`
- **Responsibility**: The orchestrator. Methods:
  `consume`, `readyDocuments`, `hasReadyDocuments`, `pageLimit`,
  `embedQuery` (Jina embedding), `signedPageUrl`,
  `pageResultsForDocs`, `resolveDocuments`,
  `requireDocumentByAttachment`, `requireDocumentById`, `search`,
  `read`, `extractTables`, `enqueueAndWait`,
  `latestAssistantText`, `resolveCreateContent`,
  `createDocument`, `editDocument`, `exportDocument`.
  `buildUntrustedDocumentContext` is a pure helper for the
  Council/Compare shared pre-document-search path.
- **Callers**: `server/routes.js` (single chat), `server/routes.js`
  (shared pre-document-search for Compare/Council),
  `server/websearch/tool.js` (tool loop).
- **Major dependencies**: `server/db/supabaseRest.js`, `server/http/responses.js`.

---

## K. Web search: orchestrator, providers, tool loop

### `class WebSearchOrchestrator`, `formatResultsForModel`, `citationsFromResults` ← mixed
- **Path**: `server/websearch/index.js`
- **Responsibility**: The provider chain (SearXNG → Jina → Brave)
  with per-provider circuit breaker, two-tier LRU+Supabase cache
  via `SearchCache`, and `readUrl` for direct page reads. Exposes
  a normalized `{ok, results, citations, cached}` shape regardless
  of provider.
- **Callers**: `server/routes.js` (single chat), `server/routes.js`
  (shared pre-search for Compare/Council).
- **Major dependencies**: `server/websearch/brave.js`,
  `server/websearch/cache.js`, `server/websearch/jina.js`,
  `server/websearch/searxng.js`.

### `class WebSearchError`, `jinaSearch`, `jinaRead`
- **Path**: `server/websearch/jina.js`
- **Responsibility**: `jinaSearch` calls `https://s.jina.ai/search`
  (returns search results + extracted markdown in one call, requires
  `JINA_API_KEY`). `jinaRead` calls `https://r.jina.ai/<url>` for a
  single URL (works anonymously).
- **Callers**: `server/websearch/index.js`.
- **Major dependencies**: `server/http/responses.js`.

### `braveSearch`
- **Path**: `server/websearch/brave.js`
- **Responsibility**: Brave LLM Context API
  (`https://api.search.brave.com/res/v1/llm/context`) fallback.
- **Callers**: `server/websearch/index.js`.
- **Major dependencies**: `server/websearch/jina.js` (for
  `WebSearchError`).

### `searxngSearch`
- **Path**: `server/websearch/searxng.js`
- **Responsibility**: SearXNG `/search?format=json` caller with a
  chat-tuned relevance re-ranker (tokenization, stopword filter,
  host quality bonus, noise blacklist, GitHub-generic filter,
  "restaurants"-term filter). Supports `raw: true` for deep
  research.
- **Callers**: `server/websearch/index.js`, `server/research/search.js`.
- **Major dependencies**: `server/websearch/jina.js` (for
  `WebSearchError`).

### `hashKey`, `class SearchCache`
- **Path**: `server/websearch/cache.js`
- **Responsibility**: Two-tier cache: in-process LRU Map +
  persistent Supabase `search_cache` table. `hashKey(parts)` is a
  deterministic sha256 JSON digest.
- **Callers**: `server/websearch/index.js`.
- **Major dependencies**: `node:crypto`.

### `extractUrls`, `detectSearchNeed`, `buildSearchSystemHint`
- **Path**: `server/websearch/detect.js`
- **Responsibility**: Cheap heuristic detector that decides whether
  to nudge the model toward `web_search` or `read_url`. The model
  still makes the final decision via tool-calling.
- **Callers**: `server/routes.js` (`runSharedPreSearch`).
- **Major dependencies**: none.

### `isToolsUnsupportedError`, `buildWebSearchTools`, `runChatWithToolLoop`, `executeToolCall`, `prepareVisualPagesForModel`, `visualDocumentMessage`, `visualImageInputLimit` ← mixed
- **Path**: `server/websearch/tool.js`
- **Responsibility**: The tool-calling run loop.
  `runChatWithToolLoop` is the core engine: it streams the model,
  intercepts `tool_calls`, executes them (web_search / read_url /
  document_*), reinjects the results as `role: "tool"` messages,
  then re-invokes the model. Handles provider graceful degradation
  (drop `tool_choice`, then `tools`), the artifact-handoff guard
  (when the model claims it created a document but no tool call
  returned a real artifact card), the empty-answer retry, and the
  per-turn iteration cap. Also handles visual PDF page inline
  images for vision models (`prepareVisualPagesForModel`,
  `visualDocumentMessage`).
- **Callers**: `server/routes.js` (single chat), `server/routes.js`
  (temporary chat).
- **Major dependencies**: `server/websearch/index.js`,
  `server/documents/tool.js`, `server/saas/messages.js` (dynamic
  import).

---

## L. Research worker (separate process)

### (entry point) `processRun`, `failExpiredRuns`, `loop`
- **Path**: `server/research/worker.js`
- **Responsibility**: Long-running Node process. Polls
  `klui_claim_research_run` RPC, runs `runDeepResearch`, writes
  progress every ~2s via `updateResearchRun`, finalizes the run +
  the linked assistant message on success/cancel/failure. Heartbeats
  every `leaseSeconds/2` to keep the lease alive and honour
  `cancel_requested`. `failExpiredRuns` flips expired leased runs
  to `failed`.
- **Callers**: `npm run research:worker`.
- **Major dependencies**: `server/config.js`, `server/db/supabaseRest.js`,
  `server/saas/entitlements.js`, `server/saas/usageMeter.js`,
  `server/providers.js`, `server/research/engine.js`.

### `partialReport`, `runDeepResearch` ← mixed
- **Path**: `server/research/engine.js`
- **Responsibility**: The actual research loop. Plan → category
  classify → for each round: generate queries (cheap model) →
  SearXNG search → fetch + extract pages (pinned DNS, SSRF guard)
  → relevance filter → synthesize evolving report → stop-decision
  (model says YES/NO). Final stage writes the report with the
  user's selected model. `validateReportLinks` strips/redirects
  any link not in the allowed sources list. `partialReport` is
  rendered on cancel.
- **Callers**: `server/research/worker.js`.
- **Major dependencies**: `server/research/fetcher.js`,
  `server/research/extract.js`, `server/research/search.js`,
  `server/research/prompts.js`.

### `searchResearchQueries`
- **Path**: `server/research/search.js`
- **Responsibility**: Calls `searxngSearch` once per query (with
  `raw: true`), normalizes URLs (strip utm, trailing slash),
  dedupes across queries, caps each domain at 2 results.
- **Callers**: `server/research/engine.js`.
- **Major dependencies**: `server/websearch/searxng.js`.

### `resolvePublicUrl`, `fetchPublicPage` ← mixed
- **Path**: `server/research/fetcher.js`
- **Responsibility**: SSRF-safe HTTP fetcher for research. Resolves
  DNS, rejects private/loopback addresses, blocks `.local`/`.internal`/metadata
  hosts, throttles per-host to 350 ms, follows up to 5 redirects,
  retries 429/503, enforces `maxBytes`. Pure node `http`/`https`,
  pinned to the resolved address.
- **Callers**: `server/research/engine.js`.
- **Major dependencies**: `node:dns/promises`, `node:http`,
  `node:https`, `ipaddr.js`.

### `extractPageText`, `untrustedSourceBlock`
- **Path**: `server/research/extract.js`
- **Responsibility**: Cheerio-based HTML → text extraction. Tries
  main selectors first, falls back to body.
- **Callers**: `server/research/engine.js`.
- **Major dependencies**: `cheerio`.

### `RESEARCH_SYSTEM`, `currentDateContext`, `planPrompt`, `RESEARCH_CATEGORIES`, `categoryPrompt`, `queryPrompt`, `extractPrompt`, `synthesizePrompt`, `stopPrompt`, `finalReportPrompt`
- **Path**: `server/research/prompts.js`
- **Responsibility**: All research prompts with category-specific
  guidance (`product` / `comparison` / `howto` / `factcheck`).
- **Callers**: `server/research/engine.js`.
- **Major dependencies**: none.

---

## M. Routes — chat/compare/council/temporary/research/admin

### `withResearchReportContext`, `installStableRequestSignal`, `applyEditedUserText` ← mixed
- **Path**: `server/routes.js`
- **Responsibility**: `withResearchReportContext` hydrates past
  research reports into the conversation messages array so
  follow-up turns have them in context. `installStableRequestSignal`
  shadows `req.signal` so the SSE stream can be aborted. `applyEditedUserText`
  rewrites the text of a stored user message while keeping its
  attachments.
- **Callers**: `handleApiRequest` (top-level), other handlers.
- **Major dependencies**: `server/db/supabaseRest.js`,
  `server/http/responses.js`.

### `handleCreateZiinaPaymentRequest`, `handleListPaymentRequests`
- **Path**: `server/routes.js`
- **Responsibility**: `POST /api/payments/ziina` creates a pending
  payment request with a Klui reference code. `GET /api/payments/ziina`
  lists the current user's recent payment requests.
- **Callers**: `handleApiRequest`.
- **Major dependencies**: `server/db/supabaseRest.js`, `server/saas/plans.js`.

### `handleMe`
- **Path**: `server/routes.js`
- **Responsibility**: `GET /api/me` returns the public user, profile,
  subscription, plan, weekly API usage, and the global system prompt
  (admin only).
- **Callers**: `handleApiRequest`.
- **Major dependencies**: `server/db/supabaseRest.js`, `server/saas/entitlements.js`,
  `server/saas/billing.js`, `server/saas/systemPrompt.js`, `server/config.js`.

### `handleAdminSettings`, `handleAdminSummary`, `handleAdminPaymentRequests`, `handleAdminUpdatePaymentRequest` ← mixed
- **Path**: `server/routes.js`
- **Responsibility**: `GET/PATCH /api/admin/settings` reads/updates
  the global system prompt in `app_settings`. `GET /api/admin/summary`
  returns the dashboard (with a 60s in-process cache). `GET /api/admin/payments`
  lists pending Ziina requests. `POST /api/admin/payments/:id/{approve,reject}`
  approves a payment (creating an active subscription) or rejects it.
- **Callers**: `handleApiRequest`.
- **Major dependencies**: `server/db/supabaseRest.js`, `server/saas/systemPrompt.js`,
  `server/config.js`.

### `handleCreateResearch`, `handleResearchStatus`, `handleCancelResearch`, `handleResearchReport` ← mixed
- **Path**: `server/routes.js`
- **Responsibility**: `POST /api/research` enqueues a deep research
  run. `GET /api/research/:runId/status` polls progress.
  `POST /api/research/:runId/cancel` cancels a queued/running run.
  `GET /api/research/:runId/report` returns the cached final report
  with ETag-conditional caching.
- **Callers**: `handleApiRequest`.
- **Major dependencies**: `server/db/supabaseRest.js`, `server/saas/usageMeter.js`,
  `server/providers.js`, `node:crypto`.

### `handleModels`
- **Path**: `server/routes.js`
- **Responsibility**: `GET /api/models` returns the model list for
  the requested base URL, with a 5-minute L1 in-memory cache +
  5-minute L2 Supabase cache.
- **Callers**: `handleApiRequest`.
- **Major dependencies**: `server/crofai/client.js`, `server/db/supabaseRest.js`.

### `handlePresignUpload`, `handleUploadContent`, `handleCompleteUpload` ← mixed
- **Path**: `server/routes.js`
- **Responsibility**: The three-step upload pipeline. `presign` returns
  a presigned PUT URL and creates an `attachments` row in `pending`
  status. `uploadContent` is the same-origin relay for browsers that
  can't PUT directly to R2. `complete` HEADs the R2 object, marks the
  attachment `uploaded`, and queues a `document.extract.*` job for
  document uploads.
- **Callers**: `handleApiRequest`.
- **Major dependencies**: `server/storage/r2.js`, `server/db/supabaseRest.js`,
  `server/config.js`.

### `handleAttachmentDownload`, `handleAttachmentView`, `handleAttachmentDelete` ← mixed
- **Path**: `server/routes.js`
- **Responsibility**: `GET /api/attachments/:id/download` 302s to a
  presigned R2 GET URL (or returns a JSON `{url, fileName, contentType}`
  for the mobile app). `GET /api/attachments/:id/view` returns an
  inline PDF preview, kicking off a DOCX/XLSX/PPTX→PDF export job
  if needed. `DELETE /api/attachments/:id` deletes an unattached
  attachment.
- **Callers**: `handleApiRequest`.
- **Major dependencies**: `server/storage/r2.js`, `server/db/supabaseRest.js`,
  `server/config.js`.

### `handleDocumentStatus`, `handleDocumentJobStatus`
- **Path**: `server/routes.js`
- **Responsibility**: `GET /api/documents/:attachmentId/status` polls
  the per-upload document processing status. `GET /api/documents/jobs/:jobId/status`
  polls a single document job and returns the artifact (if ready).
- **Callers**: `handleApiRequest`.
- **Major dependencies**: `server/db/supabaseRest.js`.

### `handleConversations`, `handleConversationById` ← mixed
- **Path**: `server/routes.js`
- **Responsibility**: `GET/POST /api/conversations` lists/creates
  conversations. `GET/PATCH/DELETE /api/conversations/:id` reads
  (with messages and admin-only reasoning), renames, or hard-deletes
  (purging attachments, document files, and R2 keys).
- **Callers**: `handleApiRequest`.
- **Major dependencies**: `server/db/supabaseRest.js`, `server/storage/r2.js`,
  `server/config.js`, `server/saas/messages.js`.

### `handleMessageById`
- **Path**: `server/routes.js`
- **Responsibility**: `DELETE /api/messages/:messageId` deletes a
  message and purges its attachments (R2 + DB).
- **Callers**: `handleApiRequest`.
- **Major dependencies**: `server/db/supabaseRest.js`, `server/storage/r2.js`,
  `server/config.js`.

### `handleCouncilConversationMessage`, `handleCompareConversationMessage`, `streamSingleChat`, `handleTemporaryChat` ← mixed
- **Path**: `server/routes.js`
- **Responsibility**: `handleCouncilConversationMessage` runs the
  full three-stage Council flow. `handleCompareConversationMessage`
  runs N parallel `streamChatCompletion` requests. `streamSingleChat`
  is the legacy fast path (no tools). `handleTemporaryChat` is the
  ephemeral, no-persistence chat.
- **Callers**: `handleApiRequest`.
- **Major dependencies**: every other module.

### `runSharedPreSearch`, `runSharedPreDocumentSearch`, `buildMeteredWebsearch`, `resolveWebSearchMode`, `withAvailableTools`, `normalizeAgentMode`, `shouldSuppressWebSearchForDocumentTurn`, `buildDirectPdfVisualContext`, `describeVisualPdfContextForTextModel`, `injectDocumentVisualContextForCompare`, `injectImageEvidenceForVisionCompare`, `persistImageDescriptions`, `injectWebContextMessage`, `buildUntrustedWebContext`, `sharedWebsearchMetadata`, `sharedDocumentMetadata`, `handleConversationMessage` (the dispatcher) ← mixed
- **Path**: `server/routes.js`
- **Responsibility**: The chat pipeline. `runSharedPreSearch` runs
  a single search/read up front and shares the result with all
  Council/Compare models as untrusted user-context. `runSharedPreDocumentSearch`
  does the same for document excerpts. `withAvailableTools` injects
  web search and document tool schemas + system-prompt hints.
  `buildDirectPdfVisualContext` builds the `image_url` content
  for PDF page images. `describeVisualPdfContextForTextModel` runs
  a single vision-describe call for text-only models in Compare
  mode. `handleConversationMessage` is the chat dispatcher (single
  vs Compare vs Council, with retry and edit modes).
- **Callers**: `handleApiRequest`.
- **Major dependencies**: every other module.

---

## N. Browser — public/js/

### `configureApiAuth`, `resolveSession`, `apiFetch`, `readSseStream` (private), `readProblem` (private)
- **Path**: `public/js/api.js`
- **Responsibility**: The `apiFetch` wrapper with auto-refresh on
  401. The auth runtime is configured via `configureApiAuth({getSession,
  refresh, onSession, onExpired})` from `app.js`. `readSseStream` is
  the shared SSE parser.
- **Callers**: every other browser module.
- **Major dependencies**: `public/js/platform/index.js`.

### `fetchConfig`, `fetchPlans`, `createZiinaPaymentRequest`, `fetchZiinaPaymentRequests`, `approveAdminPayment`, `rejectAdminPayment`, `fetchMe`, `fetchModels`, `listConversations`, `createConversation`, `fetchConversation`, `deleteConversation`, `updateConversation`, `createResearch`, `fetchResearchStatus`, `cancelResearch`, `fetchResearchReport`, `presignUpload`, `completeUpload`, `putUploadContent`, `uploadImage`, `uploadFile`, `fetchDocumentStatus`, `deleteAttachment`, `fetchDocumentJobStatus`, `fetchAttachmentView`, `downloadAttachment`, `streamConversationMessage`, `streamCompareConversationMessage`, `streamTemporaryChat`, `fetchAdminSummary`, `updateAdminSettings`
- **Path**: `public/js/api.js`
- **Responsibility**: One-to-one mapping to the server's `/api/*`
  routes. `uploadImage` / `uploadFile` are the only browser-side
  workflows that compose multiple endpoints (presign → PUT → complete).
- **Callers**: `public/js/app.js`.
- **Major dependencies**: `public/js/platform/index.js` (`apiUrl`,
  `platformDownload`).

### `loadSession`, `saveSession`, `clearSession`, `parseSessionFromUrl`, `parseAuthErrorFromUrl`, `refreshSession`, `signInWithGoogleIdToken`, `renderGoogleSignInButton`, `signOut`, `listenForNativeAuth`
- **Path**: `public/js/auth.js`
- **Responsibility**: Session load/save/clear, Google Identity
  Services loader with iOS-PWA redirect fallback, native auth
  callback bridge. `refreshSession` calls Supabase's
  `token?grant_type=refresh_token` endpoint directly.
- **Callers**: `public/js/app.js`.
- **Major dependencies**: `public/js/platform/index.js` (native
  Google, secure storage).

### `isNative`, `apiOrigin`, `apiUrl`, `storage`, `preferences`, `signInWithGoogle`, `parseAuthCallbackUrl`, `listenForAuthCallback`, `listenForDeepLinks`, `openExternal`, `download`, `copyText`, `appVersion`, `onResume`, `configureNativeChrome`, `setTextZoom`, `registerBackButton`, `exitApp`
- **Path**: `public/js/platform/index.js`
- **Responsibility**: The Capacitor-aware platform abstraction.
  Storage delegates to `@aparajita/capacitor-secure-storage` (for
  the auth session) and `@capacitor/preferences` (for everything
  else) on native, and to `localStorage` on the web. `setTextZoom`
  calls the custom `TextZoom` plugin.
- **Callers**: every other browser module.
- **Major dependencies**: `@capacitor/*` plugins (lazy).

### `checkForAppUpdate`, `openAppUpdate`, `compareVersionCodes`
- **Path**: `public/js/platform/updates.js`
- **Responsibility**: OTA update check. Throttled (6h) `fetch` to
  `/downloads/android/latest.json`; versionCode comparison.
- **Callers**: `public/js/app.js`.
- **Major dependencies**: `public/js/platform/index.js` (`appVersion`,
  `openExternal`, `storage`).

### `escapeHtml`, `renderPlainText`, `renderContent`, `getCodeSource`, `resetCodeSourceStore`, `compactModelDisplayName`, `modelBrandLogoUrl`, `normalizeModelList`, `resolveDefaultCompareModels`, `modelSupportsVision`, `inferModelBadges`, `renderModelOption`, `renderModelDetails`, `formatModelMeta`
- **Path**: `public/js/render.js`
- **Responsibility**: The renderer pipeline. `renderContent` walks
  content parts (text/image_url/file) and produces HTML. Internal
  helpers (`protectCodeSpans`, `extractMath`, `restoreCodeSpans`,
  `highlightCodeBlocks`, `sanitizeRenderedHtml`, `renderRichText`,
  `renderFallback`) are not exported but are the public renderer's
  only call sites.
- **Callers**: `public/js/app.js`.
- **Major dependencies**: `marked`, `katex`, `hljs`, `DOMPurify`
  (global CDN libraries).

### `extractReasoningDelta`
- **Path**: `public/js/reasoning.js`
- **Responsibility**: Client mirror of `server/saas/reasoning.js`.
  Identical signature.
- **Callers**: `public/js/app.js`.
- **Major dependencies**: none.

### `bootstrap`, `loadChatApp`, `bindEvents`, and the rest of `app.js`
- **Path**: `public/js/app.js`
- **Responsibility**: The 6,704-line UI controller. High-level
  responsibilities are documented in `ARCHITECTURE.md` § 3 ("Browser")
  and § 5 ("Feature map"). The file's noteworthy exports are:
  - State + helpers: `state`, `loadSettings`, `saveSettings`,
    `updateSetting`, `defaultSettings`, `defaultSettings` constants.
  - Auth/lifecycle: `bootstrap`, `loadChatApp`, `handleAuthenticatedSession`,
    `signOutAndReset`, `loadMe`, `loadModels`, `loadConversations`,
    `loadActiveConversation`.
  - Composer / follow-ups: `addFollowUpFromInput`,
    `editFollowUp`, `saveFollowUp`, `deleteFollowUp`,
    `clearFollowUps`, `drainFollowUps`, `followUpBatchText`,
    `followUpBatchImages`, `resolveRoutedModel`,
    `sendPrompt`, `executeSend`.
  - Single chat reducer: `applyStreamEvent`, `applyToolEvent`,
    `applyCompareStreamEvent`, `applyCouncilStreamEvent`,
    `ensureToolState`.
  - Compare / council: `activateCompareMode`, `activateCouncilMode`,
    `startCompareFreshChat`, `cancelCompareMode`, `renderCompareMessage`,
    `renderCouncilMessage`, `renderCouncilProgress`,
    `renderCouncilPanelist`, `renderCouncilSynthesis`,
    `renderCompareControls`, `seedCompareModelsForDropdown`.
  - Web search: `webSearchAvailable`, `renderWebSearchToggle`,
    `toggleWebSearchMode`, `shouldSuppressWebSearchForDocumentTurn`.
  - Research: `startDeepResearch`, `pollResearch`, `resumeResearchPolling`,
    `openResearchReport`, `closeResearchReport`, `renderResearchCard`,
    `renderResearchReport`, `setResearchMode`, `setResearchMode`,
    `researchMeta`, `updateResearchMessage`, `withResearchReportContext`.
  - Document viewer: `loadDocumentViewerUrl`, `openDocumentViewer`,
    `closeDocumentViewer`, `loadPdfJs`, `renderPdfPages`,
    `pollDocumentPreviewJob`, `findPendingArtifacts`,
    `pollPendingArtifact`, `applyJobStatusToPendingArtifact`,
    `syncPendingArtifactPolls`.
  - Images: `addImages`, `openLightbox`, `closeLightbox`.
  - Sidebar: `renderConversations`, `sortedConversations`,
    `loadPinnedChatIds`, `savePinnedChatIds`, `togglePinChat`,
    `openSearchDialog`, `closeSearchDialog`,
    `openConfirmDialog`, `closeConfirmDialog`,
    `openRenameDialog`, `closeRenameDialog`, `saveRenameDialog`.
  - Settings / theme: `openSettings`, `closeSettings`, `openAccount`,
    `closeAccount`, `applyChatTheme`, `applyAppearance`, `applyTextScale`,
    `applyCodeHighlightTheme`, `syncSettingsInputs`.
  - Admin: `openAdminDrawer`, `renderAdminDashboard`,
    `loadAdminDashboard`, `saveGlobalSystemPrompt`,
    `updateAdminPayment`.
  - Message rendering: `renderMessages`, `queueRenderMessages`,
    `renderUserContent`, `renderAssistantContent`,
    `renderReasoning`, `renderAssistantActivity`,
    `renderToolStatuses`, `renderCitations`, `renderArtifacts`,
    `renderPastedTextCard`, `renderUserMessageFooter`,
    `renderMessageFooter`, `renderMessageRetry`,
    `renderResearchCard`, `renderStandardMessage`.
  - Navigation: `openNewChat`, `openConversation`, `addConversation`,
    `removeConversation`, `editUserMessage`, `beginEditMessage`,
    `cancelEditMessage`, `retryFailedAssistant`,
    `waitForDocumentReady`, `startDocumentUpload`,
    `pollUploadedDocument`, `addImages`.
  - Native bridge: `setupNativeLifecycle`, `configureNativeChrome`,
    `checkAndShowAppUpdate`, `closeAppUpdate`, `hydrateNativeSettings`,
    `focusPromptInput`, `focusPromptInputSoon`,
    `showNativeKeyboard`, `hideNativeKeyboard`, `exitApp`.
  - Misc: `showToast`, `withTimeout`, `getGreeting`, `profileInitials`,
    `profileDisplayName`, `renderProfileMenu`, `closeAllDrawers`,
    `setRunning`, `updateSendButton`, `applyComposerHeight`,
    `composerPlaceholder`, `updateComposerPlaceholder`,
    `pinMessagesToBottom`, `distanceFromBottom`, `isNearBottom`,
    `composerHasPendingContent`, `composerHasFocus`,
    `blurEmptyComposerForHistoryScroll`, `setAutoScroll`.
- **Callers**: HTML (event handlers in `bindEvents`).
- **Major dependencies**: `public/js/api.js`, `public/js/auth.js`,
  `public/js/platform/index.js`, `public/js/platform/updates.js`,
  `public/js/render.js`, `public/js/reasoning.js`.

---

## O. Mobile (Capacitor + Android)

### `MainActivity` (Java)
- **Path**: `android/app/src/main/java/tech/klui/app/MainActivity.java`
- **Responsibility**: Sets edge-to-edge with a transparent
  status/nav bar and disables the Android contrast scrim, so the
  WebView's page background shows through.
- **Callers**: Android.
- **Major dependencies**: `com.getcapacitor.BridgeActivity`,
  `WindowCompat`.

### `TextZoomPlugin` (Java)
- **Path**: `android/app/src/main/java/tech/klui/app/TextZoomPlugin.java`
- **Responsibility**: Wraps `WebSettings.setTextZoom(int percent)`,
  clamped 85–130. Registered as a Capacitor plugin named `TextZoom`.
- **Callers**: `public/js/platform/index.js` `setTextZoom`.
- **Major dependencies**: `com.getcapacitor.Plugin`.

### `copy-static.mjs`, `gradle.mjs`, `publish-release.mjs`, `write-asset-links.mjs`
- **Path**: `scripts/mobile/`
- **Responsibility**: Mobile build pipeline helpers (see `ARCHITECTURE.md`
  § 3 — "Mobile").
- **Callers**: `package.json` scripts.
- **Major dependencies**: `node:fs`, `node:child_process`, `node:crypto`.

---

## P. Document worker (Python)

The document worker is a separate Docker container that polls
`document_jobs` and runs `extract.*` / `create.*` / `edit.*` /
`export.*` jobs. The Node server and the Python worker share the
same Supabase tables and R2 bucket; they communicate exclusively
through the database.

### `if __name__ == "__main__": main()` (entry)
- **Path**: `worker/worker.py`
- **Responsibility**: `python -m worker.worker` boots a single
  `Processor` and calls `Processor.run` in a forever loop.
- **Callers**: `Dockerfile` `CMD`.
- **Major dependencies**: `Processor`.

### `class Processor` ← mixed
- **Path**: `worker/worker.py`
- **Responsibility**: The work loop and dispatch. Methods:
  - `__init__` — builds `db` (`Supabase`), `r2` (`R2`), `embeddings`
    (`JinaEmbeddings`); reads `DOCUMENT_JOB_TIMEOUT_MS` (divided by
    1000 to set `lease_seconds`), `DOCUMENT_WORKER_POLL_SECONDS`,
    `DOCUMENT_WORKER_MAX_BACKOFF_SECONDS`, `DOCUMENT_MAX_EXTRACTED_CHARS`,
    `DOCUMENT_VISUAL_PAGE_DPI`, plus the per-kind `DOCUMENT_MAX_*`
    limits.
  - `object_key(user_id, file_name)` — `users/{user_id}/{uuid}/{safe_name}`.
  - `run` — claims jobs in a forever loop. On
    `requests.exceptions.RequestException` it backs off with
    exponential delay up to `max_backoff_seconds` (the
    `claim_failures` counter resets on success).
  - `handle_job(job)` — creates a temp dir, dispatches, then
    updates the job to `succeeded` (with `output`) or `failed` (with
    `error`) and updates the document file to `failed` on
    exception. Cleans up the temp dir in `finally`.
  - `dispatch(job, tmp)` — routes by `job.job_type` prefix to
    `extract_job` / `create_job` / `edit_job` / `export_job`.
  - `extract_job(job, tmp)` — top-level extraction. For PDFs,
    `extract_pdf_visual_job`; for everything else, `extract` plus
    chunk/page persistence. Writes the final manifest into the
    job's `output` and sets `document_files.processing_status =
    "ready"` (with `page_count`, `word_count`, etc.).
  - `extract_pdf_visual_job(job, tmp, doc, attachment, source, limits)`
    — the PDF path. Decrypts via `pypdf`, renders each page with
    `pdfplumber` + a renderer to JPEG at `visual_page_dpi`, uploads
    each page image to R2, embeds via `JinaEmbeddings` (when
    enabled), and writes a `document_pages` row per page. Updates
    `document_files.metadata.progress` every 5 pages.
  - `limit(limits, key, fallback)` / `cap_chunks(chunks, limits)` —
    apply the per-job limits object (set from
    `job.input.limits` plus `default_limits`).
  - `extract(path, kind, user_id, document_file_id, limits)` /
    `extract_pdf`, `extract_docx`, `extract_xlsx`, `extract_pptx`,
    `extract_csv` — kind-specific extraction. Returns `(chunks,
    meta)` where chunks are per-document record rows and `meta`
    is the document manifest.
  - `extract_pdf_page_text`, `render_pdf_pages` — page-text via
    `pdfplumber`, page images via `pdf2image` / `poppler`.
  - `estimated_page_pixels(page)` — derives `width_px` /
    `height_px` for the page image.
  - `chunk(user_id, document_file_id, index, source_type, label, text, metadata)` —
    builds a `document_chunks` row with `char_count` and
    `token_estimate`.
  - `create_job(job, tmp)` — invokes `create_js_artifact` (which
    shells out to `node artifact_generator.mjs`); uploads the
    generated file to R2; calls `store_generated` to write the
    `attachments` + `document_files` rows and link them.
  - `create_js_artifact(tmp, title, input_data, fmt)` /
    `create_docx`, `create_xlsx`, `create_pptx`, `create_pdf` —
    per-format creator. DOCX/XLSX/PPTX shell out to Node when
    `DOCUMENT_USE_JS_ARTIFACT_GENERATOR=1` (the default); PDF
    uses `reportlab` directly.
  - `edit_job(job, tmp)` / `edit_docx`, `edit_xlsx` — produce a
    new version of an existing document. Always bumps
    `version_no`; never overwrites the source.
  - `export_job(job, tmp)` / `libreoffice_convert` — converts
    DOCX/XLSX/PPTX to PDF via `soffice` (LibreOffice headless).
  - `store_generated(job, tmp, path, kind, content_type, source, parent_doc)`
    — uploads to R2, creates an `attachments` row + a new
    `document_files` row with `source = "generated"` /
    `"edited"` / `"exported"` and `parent_document_id` set to the
    version chain.
- **Callers**: `if __name__ == "__main__":` entry.
- **Major dependencies**: `boto3`, `pdfplumber`, `pypdf`, `python-docx`,
  `openpyxl`, `python-pptx`, `reportlab`, `requests`,
  `charset_normalizer`, `poppler-utils` (via `pdftoppm` /
  `pdfinfo`).

### `class Supabase`
- **Path**: `worker/worker.py`
- **Responsibility**: Service-role PostgREST client for the worker.
  Methods: `request`, `rpc`, `claim_job` (calls
  `klui_claim_document_job`), `get_attachment`, `get_document_file`,
  `update_document_file`, `create_attachment`, `create_document_file`,
  `delete_chunks`, `delete_pages`, `insert_chunks`, `insert_pages`,
  `update_job`.
- **Callers**: `Processor`.
- **Major dependencies**: `requests`.

### `class JinaEmbeddings`
- **Path**: `worker/worker.py`
- **Responsibility**: Embeds PDF page images via
  `https://api.jina.ai/v1/embeddings` (model
  `jina-embeddings-v5-omni-nano`, 768 dimensions, normalised,
  `embedding_type: "float"`). `enabled` is false when
  `JINA_API_KEY` is not set, in which case the worker still
  produces the page rows but with `embedding = NULL`.
- **Callers**: `Processor.extract_pdf_visual_job`.
- **Major dependencies**: `requests`.

### `class R2`
- **Path**: `worker/worker.py`
- **Responsibility**: Thin `boto3` client wrapper. Methods:
  `__init__` (creates the boto3 S3 client with the Cloudflare R2
  endpoint), `download(key, path)`, `upload(key, path, content_type)`.
- **Callers**: `Processor`.
- **Major dependencies**: `boto3`.

### Module-level helpers (`worker/worker.py`)
- `env(name, default="")` — `os.environ` accessor.
- `now_iso()` — current UTC time as ISO 8601.
- `safe_name(value, fallback="document")` — filesystem-safe
  filename. Strips path separators, replaces unsafe characters
  with `-`, truncates to 120 chars.
- `truncate(text, limit)` — adds a `...[truncated]` suffix when
  the text exceeds `limit`.
- `normalize_math_symbols(text)` — replaces superscript/subscript
  Unicode with ASCII.
- `clean_markdown(text)` — strips a few chat-only phrases from
  the model-supplied markdown body.
- `artifact_content(input_data)` — picks the best body text
  (`content` > `body` > `text`).
- `comparable_heading(text)`, `strip_duplicate_title_heading(text, title)`,
  `split_markdown_table_row`, `is_markdown_table_separator`,
  `normalize_table_row_width`, `collect_markdown_table` — markdown
  normalisation helpers used by the JS artifact generator's
  Python counterparts.
- `find_existing_file(candidates)` — picks the first existing
  file from a list.
- `register_pdf_fonts()` — registers DejaVu/Liberation fonts in
  ReportLab for non-ASCII text.

### `worker.healthcheck` (`main`)
- **Path**: `worker/healthcheck.py`
- **Responsibility**: Docker healthcheck. Verifies `soffice`,
  `pdftotext`, `qpdf` are present.
- **Callers**: Docker Compose.
- **Major dependencies**: `shutil.which`.

### `artifact_generator.mjs` (Node CLI)
- **Path**: `worker/artifact_generator.mjs`
- **Responsibility**: Stand-alone Node CLI that takes a JSON input
  path and an output directory on argv, reads the input, dispatches
  on `input.format` (`docx` / `xlsx` / `pptx`), and writes the
  generated file to `output_dir/{safe_name(title)}.{format}`. The
  path of the generated file is emitted to stdout as JSON
  `{path, content_type}`. The Python worker spawns this CLI via
  `subprocess`. Internal functions (no exports; the file is a CLI):
  - `createDocx(input, outputPath)` — DOCX via `docx`. Builds
    paragraphs, code blocks, tables, and callouts from a
    markdown body, with `academic` / `business` / `clean` themes
    (`theme.colors`, `theme.fonts`).
  - `createXlsx(input, outputPath)` — XLSX via `exceljs`. Converts
    `data.sheets` / `data.rows` / `tables` into a workbook with
    styled headers, frozen panes, filters, and conditional
    formatting.
  - `createPptx(input, outputPath)` — PPTX via `pptxgenjs`. Builds
    slides from `data.slides` with title, subtitle, bullets,
    tables, KPIs, and a recommendation slide. Includes a
    `presentation_slides` / `normalize_slide_data` /
    `slides_from_markdown` pipeline that converts markdown into
    the slide structure.
  - `qualityDocumentMarkdown`, `qualityDocumentBlocks` — heuristic
    cleanup of model output (removes "Step", "Answer", "Solution"
    labels, etc.).
  - `MIME`, `THEMES`, `argb`, `safeName`, `safeSheetName`,
    `cleanText`, `artifactContent`, `resolveTheme` — pure
    constants and helpers.
- **Callers**: `Processor.create_js_artifact` (via
  `subprocess.run(["node", "artifact_generator.mjs", …])`).
- **Major dependencies**: `docx`, `exceljs`, `pptxgenjs`.
