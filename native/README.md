# Anime Manager Native

TypeScript + React Native Windows/Android rebuild. See ../docs/rebuild/PLAN.md and STATUS.md for phase evidence and limitations.

- npm ci --ignore-scripts: install pinned JS dependencies without lifecycle builds.
- npm run static: strict types, lint, formatting and source/config checks.
- npm test: full non-native behavior suite; reserved for final verification.

No native compilation or release artifacts have been verified. See packaging/README.md for future EXE installer and signed APK preparation. User data imports locally; no personal catalog is bundled. Original media deletion remains intentional, scoped to locally selected roots.

## Development startup

Use `npm run cli -- run-windows --help` to verify local Windows command discovery without building. The launcher pins the working directory and installed community CLI. It makes existing default .NET and PowerShell 7 installations visible to its child process without changing saved environment settings. PowerShell 7 (`pwsh.exe`) is required for Windows plugin discovery; Windows PowerShell 5.1 is insufficient. A missing runtime can misleadingly appear as `unknown command 'run-windows'` because the community CLI suppresses plugin-loading errors ([upstream report](https://github.com/microsoft/react-native-windows/issues/16273)). The launcher checks the Windows plugin explicitly to expose its real error.

If PowerShell 7 is absent from PATH and its standard installation folder, the launcher can use an existing Codex developer runtime under the current user's `.cache/codex-runtimes` folder. This is only a development-tool fallback, not a dependency of the packaged app. Other development machines should install PowerShell 7 and place `pwsh.exe` on PATH. No runtime is downloaded or installed automatically.

For a user-authorized development build, keep `npm start` running in one terminal and run `npm run cli -- run-windows --arch x64` in another. Android uses `npm run cli -- run-android`. These launch commands DO compile native code; they were not executed during source verification.
