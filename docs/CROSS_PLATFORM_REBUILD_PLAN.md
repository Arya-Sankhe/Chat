# Klui web, Android and iOS rebuild

## Scope

The user clarified that the parallel rebuild includes modernization of both
mobile apps, rather than retaining Capacitor as the final mobile architecture.
The backend, database, billing rules, AI integrations and stream contracts stay
in place. This supersedes the web-only incremental migration sequence.

The earlier two-round Codex/Opus review covered web modernization with Capacitor
retained. It did not establish consensus on this expanded native architecture.
This document records the updated scope and proposed implementation direction;
no replacement frontend or native code has been implemented yet.

## Target architecture

- Web: React, strict TypeScript, Vite and React Router, owning a new frontend.
- Android and iOS: one Expo/React Native application with native navigation and
  platform-specific implementations where required. Choose compatible SDK/React
  versions from the Expo release matrix at setup; do not copy the web version
  pins into the mobile application blindly.
- Shared TypeScript modules: API contracts/client, stream events and reducers,
  conversation/run lifecycle, domain models and reusable validation. Shared
  modules cannot import browser globals or native-only modules.
- Shared design tokens: palette, spacing and typography intent; DOM and native
  components can implement platform-appropriate layouts and interaction.
- Separate adapters: auth/session persistence, files/uploads, audio/recording,
  permissions, sharing, deep links and app lifecycle. View unmounting does not
  own the lifetime of valid background conversations.
- Backend: existing Node services, storage and worker integrations. Any required
  auth/mobile capability changes must be compatible with existing clients.

Use the existing repository with simple npm workspaces for web, mobile and actual
shared modules. Do not add a task-orchestration framework merely to create three
directories. Initially leave the backend and old clients at their current paths.
Keep old and new development/build outputs independent.

Share business behavior deliberately, rather than assuming identical screen
implementations across DOM and native. Audit the current API client for browser
dependencies before extracting it. Existing HTML rendering utilities are directly
reusable on web; React Native needs native rendering or a deliberate isolated
WebView adapter. Rich editors/canvases may use that adapter without making the
entire mobile app a website wrapper.

## Native decision (2026-10-21)

The parity goal (every screen and behaviour 1:1 with the current apps) settled
the mobile architecture: the Expo app hosts the rebuilt web client
(`clients/web`) in one persistent WebView, as the Capacitor app hosted
`public/`. Native code is limited to adapters the page calls over a small
bridge (`clients/shared/src/nativeHost.ts`): secure storage and preferences,
the system browser for Google sign-in, deep links, Back, resume, the keyboard
and system-bar insets, text zoom, file sharing and downloads, the voice
foreground service and the mail composer. The page is served from the APK at
`https://localhost`, the origin the API's CORS already allows for the app. A
fully native React Native UI would be a second implementation of every screen
and could not be held to pixel parity; it stays an option per screen later.

## Native decision, revised (2026-11-04)

The app now mixes the two: React Native screens where that is the better
experience, and the web client in a persistent WebView for the rest. Native:
sign-in, chat list, chat thread with streaming, message box with attachments,
settings. Web: Compare, Council, Research, Skills, voice, Dojo, plans, memory and
storage, and replies with content the native renderer doesn't draw yet. The native
app owns the session and hands the page only what it needs
(`HostedSession` in `clients/shared/src/session.ts`), so the page never holds the
refresh token. Android is tested first; iOS is written alongside and has not been
compiled yet. This replaces the 2026-10-21 decision below where they differ.

## Execution sequence

1. **Isolation and inventory.** Create a dedicated rebuild worktree and development
   ports/configuration. Preserve uncommitted planning documents explicitly; Git
   worktrees start from commits and do not copy those files automatically. Inventory
   existing web/Android behavior and the iOS branch before discarding any native
   integrations. Confirm installed app identifiers, signing and release history.
2. **Shared contracts and build foundations.** Establish web/mobile apps, a narrow
   shared API/domain seam and repeatable stubbed stream fixtures. Keep secrets in
   existing server configuration; use test accounts/services for mutation tests.
   Add type checks, production builds and behavioral baselines.
3. **One vertical slice on all three platforms.** Sign in, list/open a conversation,
   send and stream a response, stop/retry, reload or relaunch and restore history.
   Verify navigation during background runs, session expiry, deep links, keyboard
   behavior and scrolling on web plus Android/iOS devices or simulators. Evaluate
   actual complexity and performance before rebuilding every feature.
4. **Feature parity.** Implement attachments, settings, research, compare/council,
   projects, study, documents and voice in reviewable slices. Shared reducers must
   retain behavior; rich renderers preserve sanitization, citations, math, code,
   tables, editable content and isolated visualization behavior. Scope explicit
   adapters for native permissions, secure persistence and audio lifecycles.
5. **Native release readiness.** Verify actual streaming/network behavior on both
   platforms, app backgrounding, sharing, OAuth, recording, accessibility and
   update compatibility. Resolve platform-specific sign-in, entitlements and
   purchase requirements according to the release model and current store rules.
   Reuse backend billing behavior without assuming identical checkout UI or
   receipt handling across web and native.
6. **Independent rollouts.** Validate each platform before enabling it for users;
   architecture work includes iOS from the beginning, but production releases
   need not happen simultaneously. Keep existing clients compatible until their
   replacements pass parity checks and rollout monitoring.

## Validation and recovery

Reuse the existing domain/server tests, add shared stream fixtures and web
behavior tests, and test native behavior using appropriate emulator/device
instrumentation. A mobile browser viewport is not native coverage. Compare cold
and warm startup, typing/scrolling, long-answer rendering, total transfer and
memory on named devices against measured baselines. React/Expo alone does not
guarantee better speed or store approval.

Keep old web delivery available through the rollout. Retain matching old/new
assets and compatible API/persistence formats. For native migrations preserve
app identifiers and signing when continuity is intended; test upgrade behavior
and authentication storage migration. An older native binary generally cannot
replace a newer installed build as an update: plan version-gated features and
corrective releases with increasing build numbers. Do not delete Capacitor or
existing iOS sources until their integrations are accounted for.

## References

- [Expo monorepo support](https://docs.expo.dev/guides/monorepos/)
- [Expo DOM components and native bridges](https://docs.expo.dev/guides/dom-components/)

The initial architecture priority is complete cross-platform chat behavior with
one shared domain layer. A visual redesign can be evaluated independently; it
is not required to preserve or modernize the existing product behavior.
