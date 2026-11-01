# React Native rebuild — phased execution plan

Status: phase 0 prepared; implementation awaits the user's go-ahead.
Prepared: 2026-11-01 (Asia/Calcutta).

## Approved direction and boundaries

- Fresh native UI and application logic in TypeScript + React Native. Windows PC/laptop EXE and Android phone/tablet APK are the initial distribution targets. Phone/tablet are adaptive layouts, not separate data models. Preserve iOS/iPadOS adapter boundaries; iOS delivery needs its own signing/toolchain and is not an EXE/APK deliverable.
- Local JSON remains authoritative. Transfer catalog, metadata, covers, progress, bookmarks, queue and relations. Do not include videos. Device media roots and permissions remain local; initial folder selection is acceptable.
- Preserve the source app's page structure and useful controls. Use the feature map, source inventory and original code continuously, rather than recreating screens from memory.
- Anime deletion intentionally deletes its linked local season media directory. Keep that functionality with a scope-specific confirmation and safe path/provider validation. Do not replace it with catalog-only deletion.
- Correct whole-title/episode watched consistency, episode deletion identity, queue start selection, Clear Watched, status spelling/enums and page-size persistence.
- Chrome, ash grey and graphite aesthetic, following the frontend-design skill. See DESIGN.md.
- WebP covers/thumbnails; WebM only for suitable app-owned optional motion assets when the selected native backend supports it. Never transcode, replace or transfer user videos automatically.
- Optimize list rendering, local IO and external requests. The local UI calls TypeScript services directly; no local HTTP backend, Python executable, Electron shell or Node runtime dependency in the shipped app.
- Bundled release assets must not depend on Metro or a development server. One distributable EXE installer for Windows and one signed APK for Android are the packaging targets. The installed Windows app may include required DLLs/assets; a literally single-file runnable Windows executable is not promised.
- Do not run native compilation, Gradle builds, MSBuild, APK/EXE packaging, emulator builds or packaging CI as part of this authorization. Write packaging configuration and instructions only.
- Stop at phase 0 until the user says go. No package installation or generated platform projects in phase 0.

## Source and workspace strategy

Original reference branch: `mob_use` at `387195109bed8e332ce0d6cda55ca42ffe6acaed`.
Original live reference workspace: `C:/Users/shour/Documents/Anime/Manager`.
Implementation branch: `codex/react-native-rebuild`.
Implementation worktree: `C:/Users/shour/Documents/Anime/Manager/.worktrees/react-native-rebuild`.

The original workspace contains uncommitted templates, player assets, tests and personal library changes. The new worktree starts at the committed base, so the live original source is the reference for those newer files. `source-reference.json` records source hashes at preparation time without copying private catalog contents. Recheck reference hashes at each phase; inspect intentional changes rather than silently absorbing moving requirements.

Keep the legacy root as reference during the rewrite. New application code lives under `native/`; do not patch Python as part of native bug fixes. Do not bundle legacy data/, instance/, config, static personal covers, logs, .venv, or node_modules. Use synthetic data for development and tests; real user data enters through explicit local import. No commits, stashes or cleanup of original user modifications.

One implementation worktree is sufficient initially. Do not create extra branches/worktrees or agents without a concrete need. Future task branches must start from the approved native baseline and be integrated serially; avoid conflicting repository state.

## Planned native structure

```text
native/
  src/
    app/                  navigation, startup, composition
    domain/               types, validation, state transitions, resolvers
    repositories/         JSON persistence, revisions, migrations
    services/             library, tracking, queue, relations, transfer
    screens/              mapped pages
    components/           reusable native controls and collections
    design/               tokens, typography, spacing, motion
    platform/             typed contracts and target implementations
      android/
      windows/
      ios/                reserved extension point
    integrations/         optional Jikan search/metadata client
  assets/                 bundled app-owned fonts/icons/placeholders
  fixtures/               synthetic catalogs and reference fixtures
  tests/                  invariant, migration, service and UI logic tests
  android/                generated after dependency selection
  windows/                generated after dependency selection
  packaging/              release configuration/instructions
```

Use bare React Native + React Native Windows so Windows is a first-class target. Choose and pin a mutually supported React/RN/RNW/CLI/TypeScript combination in phase 1; do not independently install each latest version. React Native Windows's current architecture requirements must be part of the compatibility matrix. Native storage/player libraries need real Windows and Android support; isolate thin Kotlin/C++/platform bindings if a shared package lacks a required capability. Most product code is TypeScript; native host/bindings cannot all be TypeScript.

## Verification policy at every phase

Run static checks after each phase, fix all introduced failures, and record exact commands, results and outstanding limitations in STATUS.md. Static means strict TypeScript checking, lint, formatting/whitespace, dependency/config/schema checks and source-only contract checks. No application launch or end-to-end suite during intermediate phases. Tests may be authored alongside each behavior, but execute the complete non-compiling automated suite only after the full implementation is complete.

Phase 0 has no TypeScript project yet: verify Git isolation, document links, mapped scope and workspace paths instead. Later phase gates expand only as real tooling exists. A static check passing is never evidence that native playback or packaging works.

Full verification occurs once all feature phases are implemented, in phase 10. Full non-build verification is possible under the current constraint; native device/installer verification remains explicitly pending unless compatible prebuilt artifacts exist or the user later authorizes compilation. Do not call delivery fully device-verified without that evidence.

## Phase 0 — plan and isolated workspace (this turn)

Deliver: branch/worktree, reviewed feature map/inventory, source reference manifest, phased plan, design brief, workspace guardrails and status. Prepare the native workspace boundary without generating app code or installing dependencies.

Gate: correct branch/base/path; original source unchanged by setup; plans include all accepted corrections; no compile or feature implementation attempted. Stop for user go-ahead.

## Phase 1 — dependency and platform foundation

Deliver: compatible pinned dependencies/lockfile; strict TS/lint configuration; RN Android and RNW host scaffolds; navigation foundation; typed platform contracts; synthetic fixture support. No legacy Android project reuse without explicit audit. App entry point must load bundled release assets.

Resolve storage picker/provider support, native video backend, WebP decoding, captions/audio tracks and RNW architecture compatibility through documentation/source inspection. Maintain a capability matrix with supported/needs-binding/unverified states. No empty stub may masquerade as working functionality.

Static gate: configuration and dependency graph inspection, `tsc --noEmit`, lint and whitespace checks. No host compile or launch.

## Phase 2 — JSON data layer and migration

Deliver: versioned catalog schema, stable title/episode IDs, legacy import normalization, atomic/recoverable JSON writes, snapshot revision management, backup recovery and device-local settings. Preserve unknown legacy fields in migration output/backup.

Map integer legacy IDs consistently across records, progress, queue and relations. Normalize `Haitus` to `Hiatus`, release status aliases and one page-size set: 10/15/20/25/50, default 15. Keep compact density and pagination preferences device-local by default. Keep filters independently keyed by library/section.

Write fixture tests for malformed/truncated JSON, migration ID/reference integrity, save interruption and recovery; defer executing the full suite to phase 10.

Static gate: strict types, schema/static fixture validity, migration mapping completeness, lint.

## Phase 3 — device filesystem and catalog transfer

Deliver: Android document-provider and Windows folder/file adapters, root picker and persisted local grants/settings, per-title overrides, file availability states, safe media resolution and data/artwork-only export/import.

Use provider-aware Android access, not concatenated content URIs. Resolve transferable relative references against locally selected roots; accept local absolute overrides. Same relative layout means one root selection; different layouts need relinking. Import never restores another device's path or permission token. Browsing stays usable with no videos present.

Snapshot export includes manifest, schema/catalog ID/revision/checksums, JSON and covers. Stage/validate imports; back up before explicit snapshot replacement; preserve local settings. Different catalogs remain separate. Divergent device edits keep both snapshots and require explicit selection; no silent merging. Verify paths/archives cannot escape selected scopes.

Static gate: adapter interface completeness, archive whitelist/path rules, export schema, types/lint. Author transfer/recovery fixtures.

## Phase 4 — design system, shell and Hub

Deliver: reviewed design tokens, responsive app shell, Hub, section creation, toasts/dialogs, navigation and queue drawer frame. Follow DESIGN.md and reference current `base.html`/`hub.html` for interaction parity.

Desktop navigation rail and keyboard focus; phone bottom navigation/action sheets; tablet rail/split layout when space permits. Width-driven layouts, safe areas and reduced motion. Use native components, not HTML/WebView wrappers. Artwork remains the main color in the monochrome chrome.

Static gate: token usage, accessibility labels/roles and touch action coverage, navigation route types, lint/typecheck. Keep visual review until full verification.

## Phase 5 — libraries, filters and add/edit forms

Deliver: Anime/Manga/custom-section grids; search, metadata/quick filters, active chips, density, pagination; card actions; add forms and link editing; optional Jikan autofill; covers and metadata catalogs. Preserve manual offline entry and duplicate rules.

Use virtualized collections, memoized summaries and bounded image sizes. Recompute filters before pagination and restore navigation state. Metadata OR within group / AND across groups. Cancel stale search work; avoid rewriting JSON on each keystroke.

Static gate: shared filter/schema consistency, form validation and route coverage, strict types/lint. Author validation/filter/mutation fixtures.

## Phase 6 — details, watched consistency and episode identity

Deliver: anime summary, metadata, release status/link editing, folder actions, file badges, episode list/add/delete, bookmark/watch actions.

Chosen corrected behavior:

- Whole-title Mark Watched sets all existing episodes watched and removes their continuation entries; Mark Unwatched clears all episode watched/resume states. Titles with no episodes can retain an explicit manual flag.
- Per-episode changes recompute whole-title completion for titles with episodes. Release status is independent. Do not infer completed release status from watch completion.
- Legacy import with title watched=true sets existing episode flags watched; otherwise derive title completion from episode flags. Document this reconciliation in the import summary.
- Episode deletion preserves surviving episode IDs, numbers, filenames and associated progress. Do not renumber surviving episodes. Addition uses next displayed number, with a new stable identity.
- Anime deletion confirms the exact locally linked season directory and removes those media files intentionally. Reject root/parent/out-of-scope deletion, resolve symlinks/reparse/provider semantics, and never derive the deletion target from an untrusted imported absolute path. Missing folder still allows record removal; failed/partial media deletion is surfaced before final catalog cleanup. Clean tracking/relations/queue/cover references consistently.

Static gate: watch-state invariants, deletion scope contracts and reference cleanup coverage; types/lint. Author behavior fixtures.

## Phase 7 — native player and progress

Deliver: library playback, resume/start-over, seek +/-10s, speed, volume/mute, fullscreen, supported PiP, audio/subtitle selection, SRT/VTT import, episode jump, native lifecycle saves, desktop shortcuts.

Save on an 8-second cadence, pause, background and exit with serialized coalesced writes. Clamp finite time values. Maintain the current >=90% watched threshold but only auto-advance on actual end, exactly once. Completion saves must not be lost when navigating. Protect shortcut behavior in forms and focused controls.

Static gate: player adapter/event types, lifecycle cleanup, resolver inputs and progress state transitions; lint/typecheck. Platform playback remains runtime-unverified until final verification.

## Phase 8 — relations and queue

Deliver: relation inference/groups, manual search/add/remove, blocked pairs, draft reorder/save/cancel/reset; full queue and synchronized drawer, persistent reorder, duplicate prevention, clear actions and now-playing state.

Queue unit remains title. Direct Play and auto-continuation share the same starting resolver: latest resumable unfinished episode -> first unwatched -> first episode. Next priority episode -> related title -> queue; previous priority reversed within those contexts. Track stable identity and queue context across relation chains/reorders.

Clear Watched removes completed titles using the normalized title/episode invariant, not default episode 1. Queued missing titles are cleaned; titles with missing media are shown clearly and not silently deleted. Provide explicit Next for unavailable playback rather than an infinite skip loop.

Static gate: shared resolver usage, membership/order integrity, no array-index identity assumptions; types/lint. Author reference priority/ordering fixtures.

## Phase 9 — Custom Player, settings and release preparation

Deliver: multi-file temporary playback/import, native picker/open-with integration where supported, reorder/jump/clear/new-session; data/storage settings, backup/restore and diagnostics; EXE installer and signed APK configuration/documentation with embedded JS/assets and app-owned resources.

Temporary cleanup owns only app-created copies, never originals. Keep custom UUID identities as strings. Explicitly define temporary-session resume semantics; do not promise cross-session persistence from the old log-only endpoint.

No release keys/secrets committed. No automatic cloud/external CI build invocation. Windows deployment plan must account for native runtime/codec dependencies and include redistributables in installer where licensing permits. An EXE installer target does not prove a portable single-file binary. Release native scaffolds/config must be real, not placeholder packaging claims.

Static gate: resource inclusion/exclusion audit, signing configuration without secrets, absence of Python/localhost runtime dependencies, asset sizes and license inventory, types/lint. Do not compile.

## Phase 10 — full completion verification and handoff

Begin only when phases 1–9 are implemented. Run all static checks and the complete non-compiling test suite: domain/state rules, migration, persistence/recovery, transfer round trips, adapters with mocks, filtering/forms, queue/relations/player event contracts, accessibility and navigation logic. Ensure tests verify behavior rather than mirror function bodies.

Review every feature-map item against implemented source. Record passed/failed/deferred evidence. Where a compatible prebuilt host is already available, perform full visual/runtime journeys on desktop/phone/tablet; otherwise mark native runtime, codecs, permission dialogs, device deletion, rotation, PiP, startup performance and installer behavior as deferred due to the no-compilation constraint. Do not produce or claim EXE/APK artifacts in this phase without new authorization.

Handoff: source, lockfile, migration/transfer instructions, packaging instructions, completed parity checklist, static/test results and honest platform limitations. Future user-authorized release compilation is a separate action.

## Performance and asset budget

- Core offline interactions issue zero HTTP API calls. Jikan only on explicit search/selection; debounce search about 300ms, cancel stale work, deduplicate in-flight requests, bound cache size/TTL, respect Retry-After, cap retries, retain manual-entry fallback. No routine background polling.
- Parse catalog once per revision; immutable browse summaries; load episode detail on demand; batch filesystem checks with one directory listing per title/check; bound concurrency and invalidate caches on rescan/relink.
- Generate dimension-appropriate WebP thumbnails at import with bounded worker/native concurrency; preserve source artwork when required. Never re-encode covers repeatedly during scrolling. Disk/memory cache keys include artwork revision.
- Prefer still covers to auto-playing previews. Optional WebM motion must have a static fallback and reduced-motion/off switch; do not assume WebM is smaller/faster on every native decoder. User media plays in its existing supported format.
- Measure performance only at final runtime verification; do not claim FPS/startup/codec results from static checks. Set measured budgets after representative device evidence.

## Primary references

- `feature-map.md`: screen/control/flow/data requirements.
- `current-source-inventory.md`: original current-source route and function index.
- `source-reference.json`: reference commit, live source paths and hashes.
- `DESIGN.md`: palette, typography, layouts and design review.
- [React Native Windows setup](https://microsoft.github.io/react-native-windows/docs/getting-started/).
- [React Native Android release bundling](https://reactnative.dev/docs/signed-apk-android).
- [Windows distribution paths](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/choose-distribution-path).
- [Anthropic frontend-design skill](https://github.com/anthropics/skills/blob/main/skills/frontend-design/SKILL.md).
