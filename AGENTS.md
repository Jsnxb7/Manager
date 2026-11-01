# Native rebuild workspace rules

Work only on `codex/react-native-rebuild` in this worktree. Original `mob_use` workspace is a read-only reference; preserve its uncommitted changes. See docs/rebuild/source-reference.json.

Read docs/rebuild/PLAN.md, DESIGN.md and feature-map.md. User authorized execution on 2026-11-01. Phases 1–9 source implementation and phase 10 non-compiling checks are recorded in STATUS.md and VERIFICATION.md. User authorized native Windows builds on 2026-11-02.

After go-ahead implement phases in order. Perform and record static checks after each phase; full automated/runtime verification only after all feature phases. Windows development builds and launches are allowed for verification. Do not compile APKs or release packages, invoke Gradle, or trigger external build CI without separate authorization. Clearly report native runtime/release verification as pending when unavailable under that constraint.

Use TypeScript + native React Native controls. No WebView frontend, Python runtime, Electron or required local server. Local JSON is authoritative. Data/artwork transfer excludes videos and device roots/permissions. Imported device paths never authorize deletion outside the locally selected and validated media scope.

Anime media-folder deletion is intentional. Correct state/identity/queue/status/page-size defects as specified. Use the frontend-design skill for the chrome/ash-grey/graphite UI. Avoid unrequested features. App-owned assets use WebP and appropriate optional WebM with fallbacks; do not transcode user videos automatically.

Do not commit private catalogs, paths, covers, signing keys, logs, runtime state or generated outputs. Stage files explicitly; never `git add .` in this legacy repository. Do not run the legacy Flask app or its tests against real data. No subagents are required by these instructions.
