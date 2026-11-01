# Anime Manager Native

TypeScript + React Native Windows/Android rebuild. See ../docs/rebuild/PLAN.md and STATUS.md for phase evidence and limitations.

- npm ci --ignore-scripts: install pinned JS dependencies without lifecycle builds.
- npm run static: strict types, lint, formatting and source/config checks.
- npm test: full non-native behavior suite; reserved for final verification.

No native compilation or release artifacts have been verified. See packaging/README.md for future EXE installer and signed APK preparation. User data imports locally; no personal catalog is bundled. Original media deletion remains intentional, scoped to locally selected roots.
