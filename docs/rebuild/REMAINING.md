# What remains

Checked on 2026-11-02 against the old Flask/Electron app on `mob_use` (every route in `app.py` and `blueprints/`, every template script, `static/js/*`, and `main.js`) and against [AUDIT.md](AUDIT.md). "Built" means the code exists and passes type checks and the 86 tests. "Used" means it has actually been run in the real app with the real library.

## Readiness

| | PC (Windows) | Android phone and tablet |
| --- | --- | --- |
| Build | Release EXE folder and installer built | Signed release APK built (arm64-v8a, x86_64) |
| Runs | Release EXE opens with the full library | **Never installed or opened** |
| Video playback | libmpv embedded in the page, with mpv's on-screen controller. Played on the real library 2026-11-05: subtitles, speed, fullscreen, picture-in-picture, resume, auto-next | Media3 through `react-native-video`, with Media3's full controller (settings for speed, audio, subtitles); never played |
| Built-in subtitles | Built through libmpv/libass (styled ASS, embedded tracks, auto-loaded sidecar files) | Built (Media3 tracks); never tried |
| Picking the video folder | Used | Built with the Android folder picker; never tried |
| Creating title folders | Built; not used | Built; not used |
| Layout | Used from 430 to 1500 px wide | Same layouts; never seen on a device |
| Overall | **Ready for daily use, with the gaps below** | **Not ready: expect problems on first run** |

Before relying on Android: install the APK, import a catalog export, pick the video folder, play an episode, try picture-in-picture, resume, subtitles, folder creation, and rotate the screen.

## Old app features: how each maps

### Pages

| Old page | New | Notes |
| --- | --- | --- |
| Hub `/` | Hub | Sections, covers, add section. Now a scrolling row |
| Anime `/anime`, Manga `/manga`, custom `/<section>` | Library | Shared page. Grid and list replace the compact/comfort toggle |
| Add anime / manga / section item | Add form | Jikan and MAL search, metadata, cover, live checks |
| Anime details `/anime/<id>` | Details | Summary, tabs, episodes, relations, links, editing |
| Manga and custom item pages | Open the source link | The old routes pointed at missing templates; same behaviour as before |
| Player `/player/...` | Player | Native player instead of Video.js |
| Queue page and queue drawer | Queue page and drawer | Same queue in both |
| Custom player | Custom player | Plays files in place; old version copied uploads |
| Electron title bar and options menu | Top bar and Settings | See Electron below |

### Actions and data

| Old behaviour | Status |
| --- | --- |
| Add, edit, delete titles (anime, manga, custom) | Built. Editing is new |
| Mark episode or whole title watched; mark read | Built |
| Bookmark, release status, source link | Built |
| Add and delete episode records | Built; numbering of other episodes now stays fixed |
| Create title/season folder when adding anime | Built; not used |
| Create folders for existing titles (`setup_anime_folders.py`) | Built in Settings, with preview; not used |
| Set the anime video folder | Built and used on PC |
| Relink a title folder or one episode file | Built |
| Open the title folder in Explorer | Built, PC only |
| Check which episode files exist | Built; runs on Details, Queue and before playback |
| Delete the title's season folder with its videos | Built, scoped to the approved video folder; not used |
| Rewrite saved paths after moving folders (`rename_anime_paths.py`) | Not needed: paths are now relative to the video folder |
| Search, metadata AND/OR filters, quick filters, pagination, per-page | Built |
| Remember filters per section | Built; also saved on leaving |
| Continue watching: continue, start over, discard | Built |
| Progress saving and 90% completion | Built; saves every 5 s and on pause |
| Auto-next episode, then related season, then queue | Built; not used |
| Relations: view, add, merge warning, remove, reorder, reset, check | Built. Drag reorder is new |
| Queue: add, play, clear, clear watched, top, reorder | Built, with drag reorder |
| Jikan search with MAL fallback, rate limits | Built |
| New metadata value confirmation | Built |
| Import the old app's data and covers | Done once, used |
| Export and import catalog | Built; plus PC ↔ phone sync over ngrok, and in-app updates via `npm run release` (2026-11-06, see NEXT-PHASES.md) |

### Quality-of-life details

| Old behaviour | Status |
| --- | --- |
| Toast messages, including the cover-download warning | Built as toasts |
| Loading skeleton cards while the list loads | Built 2026-11-16: a pulsing card grid while the library opens, and a pulsing placeholder in each cover until its image loads |
| Smooth scroll to the list top on page change | Built (2026-11-06) |
| Compact/comfort density remembered | Replaced by grid/list, remembered per section |
| Esc closes dialogs | Built (2026-11-06); Android back button works |
| Enter adds a custom metadata value | Built (2026-11-06) |
| Arrow keys move through Jikan search results | Built (2026-11-06) |
| Cover preview before saving in the add form | Built 2026-11-16: the MyAnimeList cover shows as soon as a search result is picked (downloaded on save), a chosen image replaces it, and either can be removed |
| Video preview on hover: continue-watching cards, episode rows, previous/next in the player | Built on PC (2026-11-06): muted clip beside the item |
| Details tab in the address (`#relations`) | Replaced by remembering the tab per title |
| Player keys: Space, arrows, F, M, volume | Built on PC; page buttons hand focus back to the video |
| Ctrl+R reload, F11 fullscreen, Ctrl+M minimise | Built (2026-11-06) |
| Always on top | Built in Settings window tools |
| Drag files into the custom player | Built on PC (2026-11-06); also a cover image onto the Add form |
| Drag reorder in queue, relations, playlist | Built |
| Double-tap left/right to skip 10 s (Android) | Built 2026-11-15 in the patched `ExoPlayerView` (inline and fullscreen; repeated taps add up, shown as a badge); compiles, not tried on a device |
| Hold for 2× speed; swipe left half for brightness, right half for volume (Android) | Built 2026-11-16 in the same patched view; brightness applies only while the player is shown; compiles, not tried on a device |
| Turning the phone sideways opens fullscreen, upright closes it (Android) | Built 2026-11-16 (phones only, after the video loads); not tried on a device |
| Subtitle file loading | Built (SRT, VTT) |
| Playback speed list | Built |
| Picture-in-picture | Built on PC and Android; not used |
| Progress saved when the page closes | Partial: saved every 5 s, on pause and on leaving; the final seconds can be lost on a hard close |

### Electron and server features

| Old behaviour | Status |
| --- | --- |
| Choose Flask EXE, Flask data folder, backend status, PID, idle shutdown | Not needed: no server |
| Open config folder, open data folder | Built as Open app data (PC) |
| Open logs | Built: Settings → View error log |
| DevTools | Not available in release builds |
| Reset all paths | Built: Settings → Reset all folder links |
| Restart and reload app | Built in Settings window tools |

## Must do

1. **Run Android on a real device** and fix what breaks. Nothing there has run.
2. **Built-in subtitles and wider format support on PC**: done with libmpv (shinchiro build 20261102, GPLv2+). The licence matters if the app is ever shared publicly.
3. ~~Use the untested PC features once each~~: done 2026-11-05, except Settings' bulk folder creation and auto-next into a related season or the queue.

## Should do / Nice to have

Done on 2026-11-06 (see [NEXT-PHASES.md](NEXT-PHASES.md)):
- Esc, Enter and arrow keys in forms and search.
- Player keys whatever has focus.
- Scroll to the list top on page change.
- Hover previews, file drops, Custom Player positions.
- Alternate titles and year in search results.
- Whole-library relations check, log viewer, reset all folder links.
- Ctrl+R, F11 and Ctrl+M.

Done on 2026-11-15/16: loading skeletons; Android double-tap seek, hold for 2×, brightness/volume swipes, rotate to fullscreen.

Still open:
- A separate tablet layout (skipped by choice).
- See the QoL backlog below.

## Known bugs

Fixed on 2026-11-05 (see [NEXT-PHASES.md](NEXT-PHASES.md)): resize losing page position, Player opening past its heading, the line under Continue watching covers, internal catalog IDs in Settings, toasts hidden by the video, drag reordering not moving items, episodes unmarked as watched when opened without resume.

Space on a focused page button pressing it and also pausing the video: fixed 2026-11-06 (page buttons hand focus back to the video; see NEXT-PHASES.md Phase C). No open bugs are recorded.

## QoL backlog

Built on 2026-11-16 (typecheck, lint and tests pass; not yet used in the app):
- Long-press (touch) or right-click (PC) on a library card, list row or episode row opens a menu of its actions. Phone list rows had no actions menu before.
- Resizing the window no longer loses open edit/delete/metadata dialogs, typed text, expanded filter groups, the add-section dialog, or Details' file checks. The Details tab was already kept.
- Live cover preview in the add form.

Built on 2026-11-16 (second batch; typecheck, lint, format, 159 tests and the Windows Release build pass):
- Library sort (title, recently watched, recently added, progress, your rating), next to the count. Checked in the app.
- Multi-select: the select button or a card's menu, then a floating bar to mark watched/unwatched (read), queue, bookmark or delete the chosen titles. Esc leaves it. Checked in the app.
- Search everything: the search button outside a library, or Ctrl+K anywhere on PC; Search on the phone's bottom bar. Checked in the app.
- Personal rating (1-10 scale in Details, star badge on cards and search results, sort and "Your rating" filter) and notes (Details only, saved as you type). Rating checked in the app; notes typing not tried on the real library.
- Episode matching: extras (NCOP/NCED/PV/preview/trailer/sample/recap) are left out; OVA/SP only count for OVA titles; duplicates are ranked by Locate link, then newer version, then the release group and resolution most of the folder uses, and a true tie names the files; later seasons numbered 13, 14... map to 1, 2...; years and CRC checksums are ignored. Details has "Review matches". Unit-tested; the sheet was opened in the app.
- New episode files: every app open and the library refresh button scan the folders (cached in `catalogs/new-episodes.json`); cards show "+N new", the filters have "New episodes", and Details offers "Add them" / "Not now". The real library had no new files, so the banner and badge were not seen with real data.
- Up next: when an episode ends, a 4-second countdown under the video (and in mpv's on-screen text on PC) with Play now and Cancel; seeking back cancels it. Not played through on the real library yet.
- Audio and subtitle choice remembered per title (by language, else track number; subtitles off is kept). Not played yet.
- Android: pull down on a library or Details to re-check episode files. Not run on a device.

Mapped on 2026-11-16 from this file, NEXT-PHASES.md and AUDIT.md, each checked against the current code. AUDIT.md predates most fixes; its scroll memory, filter-save-on-leave, tooltips, action menus, cover replacement, cover clean-up on delete and queue file checks are all built now.

| Item | Platform | Where it comes from |
| --- | --- | --- |
| Picture-in-picture automatically when leaving the app with the Home button during playback | Android | New; PiP exists only as a button. `react-native-video` has `enterPictureInPictureOnLeave` |
| Fullscreen turns the phone to landscape even with auto-rotate off | Android | New; react-native-video ignores `fullscreenOrientation` on Android, so fullscreen with rotation locked stays portrait |
| Skip-opening button (+85 s), shown in the first minutes of an episode | Both | New |
| Same seek step on both: arrow keys skip 5 s on PC, Android skips 10 s | PC | New |
| Final seconds of progress kept on a hard close or crash | Both | REMAINING "Progress saved when the page closes" (Partial); Android already saves when the app goes to the background |
| Hardware keyboard shortcuts on Android (Space, arrows, Esc) for tablets with keyboards | Android | AUDIT §keyboard |
| Separate tablet layout | Android | Skipped by choice 2026-11-06 |

Not QoL but still open in NEXT-PHASES.md Phase F: back up the signing key, final re-import if the old app was used, retire the old app, update STATUS.md.

## Library data

- Only 140 video files are on this PC; most episodes show as missing until their files are added or relinked.
- All titles have covers and the Lucky☆Star title is fixed (2026-11-05).

## Builds

See [packaging/README.md](../../native/packaging/README.md) and the commands in the session notes. Signing key: `%USERPROFILE%\.anime-manager-signing\`; back it up, every APK update needs it.
