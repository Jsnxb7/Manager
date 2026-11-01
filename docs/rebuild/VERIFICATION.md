# Final verification — source and non-native behavior

Date: 2026-11-01. Branch: `codex/react-native-rebuild`. Implementation: `native/` in the isolated worktree. Original app source is a read-only reference.

## Passed evidence

- Static gates were run at the end of phases 1–9: strict TypeScript (`tsc --noEmit`), zero-warning ESLint, Prettier and source/configuration assertions. Introduced failures were corrected before progressing.
- Final `npm test -- --coverage`: **9 suites passed, 28 tests passed**. Tests use synthetic records and an in-memory filesystem; no personal catalog or media files were loaded, migrated or deleted.
- Tested behavior: serialized JSON mutations, interrupted-write recovery, corrupt-data refusal, archived pre-import snapshot preservation/restoration, legacy identity mapping, watched reconciliation, episode deletion identity, duplicate validation, AND/OR filtering, relation removal blocks/order, episode/relation/queue priority, shared queue resume, Clear Watched, 90% completion versus actual-end advancement, SRT conversion, transfer entry rejection, checksum tampering, complete data/artwork export/import, retained device media roots, separate catalogs, directory-scan sharing, deletion root requirement, metadata cache/deduplication/cancellation/rate-limit feedback, and mocked Hub navigation/section creation.
- Service/repository coverage for the selected collection: 72.2% statements, 71.52% lines. This is not a whole-application/native coverage claim.
- React Native CLI configuration detects both native projects, links react-native-video on Android and excludes its legacy Windows renderer.
- Native host registration, Android manifest and Windows project configuration inspected; project XML parses. This is not a compiler/type check of Kotlin or C++.
- Direct JavaScript dependency versions pinned; package lock present; runtime package license metadata recorded in `native/packaging/THIRD_PARTY.json`.

## Platform/UI limitations and deferred evidence

- **No native host was compiled or launched. No APK, EXE, installer or signing key was generated.** Device and installer checks remain pending under the user's explicit constraint.
- UI aesthetics/accessibility were reviewed in source only. No screenshot, rendered visual comparison, screen-reader/device interaction, orientation/resize journey or touch behavior is verified.
- Native filesystem picker grants, document-provider behavior, real deletion boundaries, Kotlin/C++ bindings and native lifecycle correctness require device verification. The tests establish shared service behavior, not native integration safety.
- Android uses an inline Media3-backed video view through react-native-video. Windows uses an app-owned native Media Foundation window; transport controls are exposed by TypeScript and keyboard/native buttons. Windows playback is not embedded inside a Fabric view.
- Windows embedded subtitle enumeration is not promised; external SRT/VTT import is implemented. Audio/video codec coverage depends on the target system, including optional Windows media components. Real codec, caption, fullscreen, audio and PiP checks are deferred.
- Android cover conversion resizes to WebP in native source. Windows explicitly falls back to the original recognized image format because a guaranteed bundled WebP encoder is not included. No bytes are mislabeled as WebP.
- No decorative motion video is shipped. Optional user WebM playback is decoder-dependent; no automatic user-media transcoding occurs.
- Reordering uses accessible move buttons; desktop/touch drag-and-drop reordering and file-drop import are not implemented. File pickers and native open-with integration are the initial import controls.
- Native open-with and Windows window controls are source implementations, not runtime-verified integrations. Signing, offline installed startup, resource completeness, publisher identity and redistribution requirements need release validation.
- iOS/iPadOS native storage/playback bindings are not implemented; generated iOS host source is an extension point. Initial target is Windows and Android phone/tablet.

## Screen parity index

| Mapped feature | Source implementation | Verification |
| --- | --- | --- |
| Shared shell | `src/app/Root.tsx`, `components/controls.tsx` | Static; mocked controls; native visual pending |
| Hub/add section | `screens/Hub.tsx` | Mocked interaction test |
| Anime/Manga/custom libraries | `screens/Library.tsx` | Static + filter/domain tests |
| Continue Watching | Library header + progress service | Shared state tests; UI runtime pending |
| Add Anime/Manga/custom item | `screens/EntryForm.tsx` | Static + validation/Jikan tests |
| Anime details/episodes | `screens/Details.tsx`, `services/mutations.ts` | Watched/identity tests; native file checks pending |
| Relations | `components/Relations.tsx`, `services/relations.ts` | Group/order/removal tests |
| Library player | `screens/Player.tsx`, platform players | Progress/resolver tests; native playback pending |
| Persistent queue/drawer | `screens/Queue.tsx` | Queue/resolver tests |
| Custom Player | `screens/CustomPlayer.tsx` | Static; native/session journey pending |
| Storage/data settings | `screens/Settings.tsx`, repositories/transfer | Recovery/transfer round-trip tests |
| EXE/APK delivery | `packaging/`, Gradle/C++ release settings | Configuration only; no build artifacts |

The source implementation and non-compiling checks are complete for this pass. It is not a production-ready, device-verified release. The pending platform/visual checks above must remain visible in the handoff.

Startup follow-up: Windows plugin import fails with Unable to find pwsh.exe under a PATH containing Windows system tools and .NET but no PowerShell 7. The repaired launcher succeeds with run-windows --help under that same PATH by discovering an existing developer runtime. Three focused Node environment tests pass (standard installations, existing fallback, PATH preservation/casing); source/configuration and syntax checks pass. This checks command discovery only, not native compilation or app startup. Upstream context: https://github.com/microsoft/react-native-windows/issues/16273.