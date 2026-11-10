# Milestone 2: 1:1 parity with the current app

Goal: the rebuilt web and native clients look and behave exactly like the
current site (`public/`) and the Capacitor app, feature for feature. The
backend and database do not change.

## How "exactly 1:1" is met and checked

**Web: same DOM, same CSS.** The React components render the same element
structure, ids, class names and data attributes as `public/index.html` and the
DOM that `public/js/*` builds, and the web client loads the existing
stylesheets (`public/styles.css` and its imports) unchanged. Visual parity then
holds by construction; behavior is ported module by module.

**Caveat.** Same DOM + CSS only holds if the whole rendered state matches:
stylesheet order, root ancestry, body classes and data attributes set by JS
(`chat-empty`, `temporary-chat`, `data-mode`, wallpaper variables), elements
kept mounted but hidden (`:has()` rules depend on them), portal placement and
inline styles. React must own each subtree outright; no extra wrappers.
Screenshots prove parity only for the states exercised, so each slice also
asserts behavior (cancel, navigation, persistence).

**Reference backend: the real server, locally.** `clients/devtools/local-backend/`
runs the real server against throwaway local services: a Supabase CLI stack
(Postgres + REST + Auth) loaded with `supabase/schema.sql`, SeaweedFS for R2,
and `fake-openrouter.mjs` for models. Nothing touches a real database or paid
API. Both clients run against it, so ported behavior is checked against the
server code, not a hand-written mock.

**Proof: a visual-diff harness.** `clients/devtools/parity/`:

- the old site (`public/`, served unchanged) and the new web client each sign in
  as their own user, seeded with identical fixtures (fixed ids and timestamps);
  state is reset between runs and the scenarios run in separate contexts;
- determinism: pinned Chromium, viewport, DPR, locale, timezone, color scheme
  and fonts; a frozen clock; motion off (CSS animations/transitions, the
  mascot's random motion); fonts and images awaited; streams driven to named
  checkpoints by the fake model rather than sleeps; caret, focus, hover and
  scroll controlled; requests to anything but the local backend blocked;
- named scenarios at 1440x900 and 412x915, light and dark; per-pixel tolerance
  plus a changed-pixel limit; reference, actual and diff images per failure.

**Native reference: the legacy Capacitor app itself**, built from `android/` and
captured on the same emulator as the new app (`html.native-app` rules differ
from the phone-width site). Style values come from the legacy app's computed
styles per state; native text needs a stated visual tolerance plus keyboard,
accessibility and lifecycle checks. Complex editors/visualizations may use an
isolated WebView where a native recreation can't be faithful.

## Slices, in order

Each slice ships web first (diffed to the reference), then native, and is
reviewed before the next starts.

1. Harness: local backend, fixtures, scenario runner, diff report.
2. Shell and home: launch screen, auth and guest transitions, sidebar (pinned,
   list, profile menu), top bar, home modes, wallpaper, composer chrome,
   toasts, confirm/rename/search dialogs, deep links, back behavior.
3. Message rendering (`render.js`): markdown, math, code highlighting, tables,
   citations, reasoning, activity, artifacts, images and lightbox, weather
   cards, illustrations, sandboxed visualizations and their repair, message
   actions (copy, retry, edit, branch, report). On native this is the riskiest
   piece, so it is proven early.
4. Settings and account: appearance, wallpaper, colors, voice, storage, memory,
   reasoning, system prompt, export, account deletion.
5. Billing: paywall, plans, coupons, payment returns, subscription cancel.
6. Composer features: model picker and spectrum, writing style, attachments and
   uploads, camera sheet, pasted text, skill commands, follow-up queue,
   clarifications, temporary chat, prompt navigator.
7. Compare and council.
8. Research mode and the report view.
9. Documents: viewer, editor, selection actions, deck presets and progress,
   side chat, email.
10. Projects (behind the existing feature gate).
11. Study hub: courses, sources, tutor, whiteboard, tests/quizzes, cards and
    progress, notes, mind maps, podcasts, audio, recorder, lecture video, dojo.
12. Voice mode.
13. Admin panel, beta welcome, app update, moved notice.

## Rules

- No database or server changes. Server-side behavior is matched, not altered.
- Behavior is ported from the old module, not reinvented; where the old code
  has a quirk users rely on, it is kept.
- Every slice keeps the shared tests and typechecks green and adds tests for
  ported logic that has branches worth pinning.
