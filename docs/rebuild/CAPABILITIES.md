# Native platform capability ledger

Final source implementation ledger, not runtime validation. No native compilation performed. See VERIFICATION.md for passed tests and deferred platform checks.

| Capability | Android | Windows | State |
| --- | --- | --- | --- |
| UI host | RN 0.85.3 Fabric | RNW 0.85.0 Fabric | Official source scaffolds; pinned peers |
| Navigation | Typed JS stack and BackHandler | Typed JS stack | No native navigation dependency |
| JSON/files | Kotlin module registered with host | C++ attributed module registered with host | Source implemented; shared repository tests pass |
| Folder access | Document tree picker, persisted grants, provider-aware traversal | Win32 picker, approved roots and reparse-point rejection | Source implemented; device operations unverified |
| Covers | Bounded bitmap decode/resize to WebP | Explicit original-format fallback; guaranteed WebP encoder not bundled | Source implemented; never mislabel original bytes |
| Video | Inline react-native-video 6.19.3, Android-only native link | App-owned MFPlay native window, no Paper view | Source implemented; native codec/rendering unverified |
| Audio/captions | Native track selectors, imported SRT/VTT | Audio streams and external SRT/VTT; embedded caption support not promised | Source implemented; real media tests deferred |
| WebM/PiP | Decoder-dependent; PiP exposed on supported Android versions | Decoder-dependent; PiP not advertised | No decorative motion assets shipped |
| Transfer | fflate ZIP, SHA-256 JSON/artwork manifest | Same | Cross-device service round trip passes; no videos |
| Release | Embedded JS/assets and release signing configuration | Self-contained SDK setting and Inno EXE installer recipe | Configuration only; no binaries or signing keys |

The Android video dependency is explicitly excluded from Windows native autolinking. Windows uses its own media module. These decisions are source-reviewed and not a substitute for a native compiler/device check. iOS host scaffolding is retained as an extension point, with no completed iOS storage/player bindings.
