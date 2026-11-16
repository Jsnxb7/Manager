# Remaining work, in phases

Written 2026-11-05 from [REMAINING.md](REMAINING.md), [AUDIT.md](AUDIT.md) and a fresh source comparison against the old Flask/Electron app. Do the phases in order: each one makes the next easier to check. Tick items off here as they land.

## Phase A: Prove the PC build on real use: done 2026-11-05

Checked in a release build launched against the real library (by UI Automation and screen captures, not by hand).

- [x] Library data: no re-import needed. The native catalog already holds all 590 titles of the old app's latest data, plus one added since.
- [x] libmpv playback: embedded subtitles render; speed keys (`[` `]` Backspace) work; fullscreen fills the monitor and Esc returns. Audio and subtitle tracks are switched in mpv's controller or with `#` and `j`.
- [x] Resume (opened at the saved minute), 90%/end marks the episode watched, auto-next opens the next episode. **Fixed:** opening an episode without resume (Previous, auto-next) unmarked it as watched; a part-watched next episode restarted from zero.
- [x] Picture-in-picture: **added** a button under the video (Windows had only Alt+P, Android had no way in). The video pops into a small always-on-top window and back.
- [x] Adding an anime creates its `Title/Season` folder. Settings' bulk "Create missing folders" was not run (it would touch the real video folder).
- [x] Delete a throwaway title: confirmation names the folder; season folder and record removed. **Fixed:** the emptied title folder is now removed too.
- [x] Title editing works; renaming keeps the existing video folder link. **Fixed:** drag reordering never moved anything (rebuilt gesture handlers measured from zero); now verified in the queue. Relations and playlist use the same list.
- [x] Broken "AnimeManager" Start-menu dev package: already gone; only the installer's "Anime Manager" remains.
- [x] Lucky☆Star title, catalog folder reference and its (empty) media folder renamed; 21 missing covers added from MyAnimeList.

## Phase B: Fix known bugs: done 2026-11-05

- [x] Resize no longer loses page position: pages remember their scroll per history entry (also restored on Back); the Hub keeps its carousel position.
- [x] Player opens at its heading (held at the top while it opens).
- [x] Thin line under Continue watching covers: it was the row's scrollbar, which React Native Windows draws despite the prop; now clipped off. Covers also overdraw by 2% against rounding gaps.
- [x] Settings lists other catalogs by title count and date and offers to remove an empty one.
- [x] Toasts on the Player page are repeated in mpv's on-screen text (not runtime-checked: no toast could be triggered there).
- [~] Final progress save on hard close: accepted as is (user decision 2026-11-05).
- [x] Storage errors now name the rejected path.

Note for agents: a process started from the Claude/Codex desktop apps runs under MSIX file virtualization, so new files under `%LOCALAPPDATA%` land in the parent app's private copy and the app fails with "Operation outside app private storage". Launch the app with `Win32_Process.Create` (WMI) to test against the real data.

## Phase C: Keyboard and navigation polish (PC): done 2026-11-06

All checked in a release build on the real library (UI Automation, synthetic keys and screen captures).

- [x] Esc closes dialogs, sheets, the queue drawer, the error log, search results and the search bar. Esc comes from a native keyboard hook (`WindowControls.h`), so it works wherever focus is.
- [x] Enter adds a custom metadata value; the field keeps focus.
- [x] Up/Down move through search results and Enter picks the highlighted one. While the list is open and its field focused, the arrows go to the list instead of scrolling the page.
- [x] Changing page in a library scrolls to its first row.
- [x] Ctrl+R reloads, F11 toggles fullscreen and Ctrl+M minimises, both from the page and while the video has focus (mpv bindings). A reload during playback now closes the video window first (this also fixes Settings' "Reload UI").
- [x] Space on the Player page always controls the video: page buttons hand focus back to the video, and the page no longer forwards Space itself.

## Phase D: Android first run: checked by the user

## Phase E: Nice to have: done 2026-11-06, except as noted

- [x] Loading skeleton cards instead of a spinner: done 2026-11-16 (library opening grid and per-cover placeholder).
- [x] Hover video previews (PC): after 0.4 s a muted clip plays in a 16:9 popup beside the hovered item. Covers Continue watching (from the saved position), Details episode rows, and Previous/Next beside the player. It closes on hover-out and on scroll. Runtime-checked on Continue watching.
- [x] Drag files in (PC): videos dropped onto the Custom Player join the playlist; an image dropped onto the Add form becomes the cover. Both runtime-checked with a real OLE drag.
- [x] Custom Player remembers each file's position between sessions (`custom-player-positions.json`, newest 200 files, forgotten at 90%). Checked across a restart.
- [x] Custom Player playlist redesigned: file name only (no folder, no extension), "Now playing" / "Resumes at" status, and times shown as `6:02 / 23:37`.
- [x] Search results show the start year, plus English and Japanese titles when Jikan provides them. The MAL fallback gives the year only.
- [x] Settings → "Check relations for all anime" (with confirmation; pairs you separated stay apart).
- [~] Separate tablet layout: skipped (user decision 2026-11-06).
- [x] Settings → "View error log" (newest first, with Clear).
- [x] Settings → "Reset all folder links" (media folders and relinked titles/files; with confirmation). The dialog was checked, but the reset was not run on real data; it is covered by unit tests.

Also fixed while testing:
- The app could hang when a video or a preview closed. mpv was shut down on the UI thread while its render thread needed that thread; shutdown now runs on a worker thread.
- The Custom Player showed full Windows paths for files opened with "Open with".

## Sync between PC and phone over ngrok: built 2026-11-06

**How it works**
- The PC app shares; the phone syncs with it. There are no accounts: a sync key, created on the PC and typed into the phone once, signs every request.
- **Nothing polls:**
  - The PC learns from ngrok's own log when its tunnel goes up or down, and shows "ngrok is available".
  - The phone looks for the PC only when you press Sync (bottom bar, or Settings → Sync with PC). Before sync is set up, pressing Sync shows a toast that leads to Settings.
- **What syncs:** titles, episodes, watched marks, progress, queue, relations, bookmarks, metadata and covers. Covers are compared by content, so each device keeps its own file names.
- **What never syncs:** videos, folder links and filters.
- **How changes merge:** each side keeps the last synced copy. A change made on one side only merges by itself; watch progress takes the newest; only a title changed differently on both devices asks which version to keep. Both devices keep a snapshot of their library from before each sync.

**Setup**
1. **PC:** Settings → Sync with phone.
   - Domain: your free static ngrok domain (`<name>.ngrok-free.dev`, shown in the ngrok dashboard); ngrok and its authtoken are already installed.
   - Create key → Share with phone. Sharing then starts whenever the app opens.
2. **Phone:** Settings (More) → Sync with PC. Enter the same domain and the key shown on the PC, then Save.
3. Press **Sync** on the phone: it finds the PC, then asks before changing anything. On the PC the top-bar sync icon starts sharing if it's off.

**Checked**
- 118 unit tests: three-way merge cases, request signing (tampering, replays, clock skew), and a full PC↔phone round trip in memory, including covers, conflicts and a stale commit.
- **Live on the PC through the public ngrok URL:**
  - Unsigned, replayed and wrongly-signed requests are refused.
  - The catalog (922 titles) arrives with covers as hashes and no device paths: 12.5 s the first time, 0.5 s after that.
  - A cover downloads intact.
  - A stale commit is refused.
  - The "ngrok is available" toast appears when the tunnel comes up.
  - ngrok stops with the app and with Stop sharing.

**Not checked by me:** the phone side on a real device (the APK is built, but installing and syncing need your phone), and a real committed sync (the live test was read-only).

## Releases and in-app updates: built 2026-11-06

**Building a release:** run `npm run release` in `native/` (next patch version), or `npm run release -- 1.2.0` for a chosen one. It:
1. Raises the version and build number (`native/version.json`, mirrored in `src/app/version.ts` and the Android `versionCode`).
2. Runs the type checks and tests.
3. Builds the PC installer (`release/installers/AnimeManager-Setup-<v>.exe`) and the signed APK (`release/android/AnimeManager-<v>.apk`).
4. Writes `release/update.json` with their hashes, and copies all three to `%LOCALAPPDATA%\AnimeManager\updates`.

Options: `--skip-windows`, `--skip-android`, `--no-publish`, `--no-checks`. Run it from a normal terminal: a process started inside the Claude app has its new AppData files redirected (see the session notes), so publishing from there needs a copy run outside it.

**Every release is an update, not a fresh install:**
- The installer keeps the same app id, so it upgrades Program Files in place. It closes the running app first and reopens it after a silent update.
- The APK keeps the same signing key and a higher version code, so Android installs it over the old app.
- The library lives in app data on both devices, so updating never touches it.

**In-app updates:**
- **PC:** on start (or Settings → Check for updates) the app reads the updates folder. If there is a newer build, it shows "Version X is ready to install" with **Install**: the installer's hash is checked, Windows asks for permission, and the app closes, updates and reopens.
- **Phone:** when you press Sync, the PC also reports a newer APK. **Install** downloads it over the signed sync connection, checks its hash, and opens Android's installer. The first time, Android asks you to allow installs from Anime Manager.

**First time only:** installs from before 1.1.0 have no updater, so install 1.1.0 by hand once on each device.

## UI pass: 2026-11-16

- Choices (sort order, per page, release status, player options) open as a dropdown under the control instead of a full-screen sheet. Popovers draw over the whole window, so cards and scroll views never clip them.
- A card's ⋯ keeps the icon column dropping from the button (user's choice), restyled: a slim pill drawn above everything, icons dropping in one after another, delete below a rule. An episode's ⋯ (phones) and the queue's arrange menu are labelled menus anchored to the button.
- Add form is a wizard: Find → Details → Metadata → Artwork → Review, with a step tracker (done steps revisitable, later ones open once the details are valid), a running overview of the entry beside every step, and a review page whose rows jump back to their step. Metadata groups show chosen values first, a filter-or-add field, and the 18 most used values with "Show all".
- One motion for pages, steps and sheets: a 320 ms glide from the side you are heading (forward from the right, Back from the left) with a fade; the player and custom player only fade, because their video is a native window. On Windows these run on the JS driver: the native driver left transforms part-way, so pages sat shifted right or dropped (fixed before 1.1.6 shipped).
- Rating is a 10-segment bar with the score, MyAnimeList's verdict word, and a Clear button. The row aligns to its bottom edge, since Windows ignores baseline alignment.
- Details' Episodes header: watched count, a "Review matches" chip, and a rounded add-episode field (Enter adds).
- Player: season/episode overline above a smaller title with a round link chevron; the up-next card under the video is restyled, and on PC mpv draws a matching card over the video (`overlay` method, ASS `osd-overlay`) instead of plain OSD text.
- Jikan: while api.jikan.moe is unreachable the client goes straight to MyAnimeList for 5 minutes instead of waiting out an 8 s timeout on every search, the form says so, and the MAL detail page now supplies the English/Japanese titles too.

## Phase F: Switch over

- [ ] Final re-import from the old app if it was still used during phases A–E.
- [x] PC ↔ phone routine: sync over ngrok (see above); ZIP export/import still exists for backups.
- [ ] Back up the signing key in `%USERPROFILE%\.anime-manager-signing\`.
- [ ] Stop using the old Flask/Electron app; keep `mob_use` as read-only reference.
- [ ] Update REMAINING.md and STATUS.md to the final state.

## Deliberately not planned

Flask EXE/data-folder/PID/idle-shutdown controls, the `stars.mp4` background, manga/custom item detail pages (the old routes had no templates), and the path-rewrite script (paths are now relative to the video folder). DevTools in release builds.
