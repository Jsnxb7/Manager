# Rebuild status

Current status: phases 1–9 source implementation complete. Final non-compiling tests passed; native device/visual/installer verification remains pending.

Phase 0 below is historical preparation evidence.

Created branch `codex/react-native-rebuild` and isolated worktree from `mob_use` commit `387195109bed8e332ce0d6cda55ca42ffe6acaed`. Original uncommitted changes remain in the original workspace. Only planning documents and workspace boundaries were added here; no app dependencies installed, no native hosts generated, no feature code implemented and no compilation attempted.

Artifacts: PLAN.md, DESIGN.md, feature-map.md, current-source-inventory.md, source-reference.json, native/README.md and root AGENTS.md.

Verification policy: static checks after each phase; full verification after all features; no EXE/APK compilation tests. Native runtime/installer validation remains pending unless compatible prebuilt hosts become available or compilation is separately authorized.

Phase 0 checks passed: original/implementation branch and base revision verified; 11 phase headings; 15 screen/component sections; balanced Markdown fences; confirmed scope corrections; source-reference manifest generated for 45 code files. No native build or runtime checks executed. This is a planning checkpoint, not a completed application.


## Phase 1 — complete

Official RN 0.85.3 Android/iOS and RNW 0.85.0 C++ Fabric host sources generated. React 19.2.3 and all direct JS dependencies pinned with package-lock.json. Typed platform/navigation contracts, synthetic fixture boundary and capability ledger added. No native app launch/compile.

Passed: `npm run static` (strict tsc, ESLint, Prettier, source/config checks), `npm ls --depth=0`. Generator source initialization only; .NET first-run initialization occurred, no compilation. Native storage/video bindings are scheduled in phases 3/7, not claimed implemented in phase 1.

Phase 2 in progress.

## Phase 2 — complete

Versioned Zod schemas, stable legacy episode references, normalized statuses/page sizes, referential integrity validation, serialized JSON repository, staged writes/backups and explicit recovery added. Legacy importer retains unknown non-location metadata and reports watched-state reconciliation.

Passed: `npm run static` with zero lint warnings. Persistence/migration behavior tests authored, not executed per final-verification policy. Phase 3 in progress.

## Phase 3 — source implementation complete

Provider-aware Android storage module and Windows C++ storage module registered with generated hosts; typed bridge, batch media resolution, checksummed ZIP export/import and legacy-folder inspection implemented. Transfer allowlist rejects videos and unsafe paths; root deletion requires a locally approved root. Windows cover import explicitly preserves original image bytes when no WebP encoder is available.

Passed: `npm run static`, native project/manifest XML parse, original source hash check. Native module compilation, provider dialogs and filesystem behavior are unverified under no-compilation policy. Transfer tests authored for phase 10. Phase 4 in progress.

## Phase 4 — complete

Chrome/ash/graphite tokens, accessible buttons/forms/sheets/progress, width-driven shell/rail/mobile navigation, Hub/section creation, startup/error recovery UI and serialized device settings added. Android host applies system-bar/cutout insets. Placeholder routes are explicitly marked until their assigned phases.

Passed: `npm run static` (types, zero-warning lint, formatting and source checks). UI launch/screenshot critique deferred to final verification. Phase 5 in progress.

## Phase 5 — complete

Virtualized Anime/Manga/custom grids, deferred local search, AND/OR metadata filters, saved/debounced filter state, density/pagination, covers, add forms, metadata entry, link/status/read/bookmark actions, continuation strip and opt-in Jikan search/autofill added. Jikan requests are serialized, cached, deduplicated and cancellable with timeout/rate-limit feedback.

Passed: `npm run static`; domain filter/duplicate fixtures authored for final suite. Local browsing issues no HTTP requests. Native UI/codec verification remains deferred. Phase 6 in progress.

## Phase 6 — complete

Details/episode UI, async availability badges, source editing, local relinking/file overrides, watched transitions and stable episode deletion implemented. Existing anime deletion intent preserved with native local-root scope validation; record/reference cleanup follows successful media deletion.

Passed: `npm run static`. Watched/episode identity fixtures authored, execution deferred. Actual filesystem deletion was not exercised. Phase 7 in progress.

## Phase 7 — source implementation complete

Android inline Media3 playback via pinned react-native-video (Windows Paper autolink excluded), Windows app-owned Media Foundation window, typed transport bridge, progress cadence/lifecycle saves, explicit resume and once-only actual-end guard added. Captions import and audio controls included; Windows exposes external SRT/VTT, not an assurance of embedded subtitle support.

Passed: `npm run static`; progress/subtitle/end fixtures authored, not run yet. Windows native source and Android rendering are not compiled/device-verified. Platform implementation adjustment: Windows uses app-owned native window rather than unproven Fabric/XAML video embedding. Phase 8 in progress.

## Phase 8 — complete

Relations inference/manual merge/removal/blocked pairs/draft ordering and queue drawer/full page added. Shared stable-ID playback resolver now drives direct queue play, next/previous relations and queue continuation; Clear Watched uses whole-title completion. Accessible move buttons are the initial reorder interface.

Passed: `npm run static`. Priority, resume, blocked-pair and clear-watched fixtures authored for final suite. Phase 9 in progress.

## Phase 9 — source implementation complete

Temporary Custom Player, storage/root settings, checksummed import review, separate catalog registry/switching, backup recovery, open-with integration, Windows controls and release configuration implemented. APK signing uses environment secrets; release shrinking/bundled JS configured. Windows release uses self-contained SDK and bundled JS with an Inno Setup EXE installer recipe. Runtime license metadata recorded.

Android/Windows XML parse passed. Initial phase 9 static gate caught hook placement in open-with integration; corrected before the final suite. Initial Jest discovery also required a Windows-path configuration correction. No native builds, package compilation, signing keys or binaries created. Windows WebP conversion uses explicit original-format fallback; embedded captions and codec coverage remain native backend limitations. Phase 10 final non-compiling verification starts now.


## Phase 10 — non-compiling verification complete; native verification pending

Final behavior suite: 9 suites, 28 tests passed. Covers JSON/recovery, migration, watched/episode identity, relation/queue ordering, transfer round trips, checksums, local root preservation, API behavior and mocked Hub navigation. Selected service/repository line coverage: 71.52%. Static checks pass with zero lint warnings. Native CLI dependency configuration detects both hosts and excludes the Windows Paper video view. See VERIFICATION.md for exact evidence, source parity and unresolved platform/visual checks.

No native compilation, APK/EXE packaging, native app launch or real media deletion was performed. No personal library data copied into fixtures/assets. Windows playback uses a separate app-owned native window; Windows covers retain original format when WebP encoding is unavailable; initial reorder/import uses move buttons/file pickers rather than drag/drop. iOS remains an extension point.

Final source audit: Android/Windows host configuration inspected; XML and JS configuration syntax valid; 45 original reference hashes unchanged. Archived pre-import snapshots remain after later saves and can be reviewed/restored. Final suite rerun: 28/28 tests, 9/9 suites passed. Native compilation/device/visual checks remain deferred.

Startup follow-up: added a project-local community CLI launcher with a fixed native workspace and existing .NET path fallback. Verified npm run cli -- run-windows --help, JavaScript syntax and source checks; no native build executed. npm start now uses the same launcher.

Startup correction: the first launcher check inherited Codex's PowerShell 7 and missed the ordinary terminal's missing pwsh.exe. Reproduced the Windows plugin failure with a restricted PATH, then verified run-windows --help succeeds under the same PATH after adding existing PowerShell 7 discovery (standard installation or existing Codex runtime fallback). Added explicit plugin preflight so dependency failures are visible before community CLI suppresses them. Three environment regression checks and source/configuration checks passed. No native compilation or app launch.