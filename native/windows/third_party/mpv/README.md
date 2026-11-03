# libmpv

The Windows player embeds libmpv. `libmpv-2.dll` is not committed (about 120 MB).

Get it from the `mpv-dev-x86_64-<date>-git-<hash>.7z` asset of
https://github.com/shinchiro/mpv-winbuild-cmake/releases (the build linked from mpv.io)
and place `libmpv-2.dll` in this folder. The build copies it next to `AnimeManager.exe`.

Current: release 20261102, `mpv-dev-x86_64-20261102-git-2137d21b2e.7z`,
SHA-256 `5ca801552661c18fa0b1edfd41dba6e5d9aa9d6d3d6c42dbe3fb91a45eb79f16`.

`windows/AnimeManager/mpv/client.h` comes from the same package (ISC licence).
The mpv core is GPLv2+ in this build.
