# What remains

Checked on 2026-11-02 against the old Flask/Electron app on `mob_use` (every route in `app.py` and `blueprints/`, every template script, `static/js/*`, and `main.js`) and against [AUDIT.md](AUDIT.md). "Built" means the code exists and passes type checks and the 86 tests. "Used" means it has actually been run in the real app with the real library.

## Readiness

| | PC (Windows) | Android phone and tablet |
| --- | --- | --- |
| Build | Release EXE folder and installer built | Signed release APK built (arm64-v8a, x86_64) |
| Runs | Release EXE opens with the full library | **Never installed or opened** |
| Video playback | libmpv embedded in the page (2026-11-03), with mpv's on-screen controller; replaces the Media Foundation player. Built; not yet played on the user's library | Media3 through `react-native-video`, with Media3's full controller (settings for speed, audio, subtitles); never played |
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
| Export and import catalog | Built |

### Quality-of-life details

| Old behaviour | Status |
| --- | --- |
| Toast messages, including the cover-download warning | Built as toasts |
| Loading skeleton cards while the list loads | **Missing**: a spinner shows instead |
| Smooth scroll to the list top on page change | Partial: a top button exists; changing page does not scroll |
| Compact/comfort density remembered | Replaced by grid/list, remembered per section |
| Esc closes dialogs | **Missing on PC**; Android back button works |
| Enter adds a custom metadata value | **Missing**: needs the Add value button |
| Arrow keys move through Jikan search results | **Missing** |
| Cover preview before saving in the add form | Partial: shows after choosing, not as a live preview |
| Video preview on hover: continue-watching cards, episode rows, previous/next in the player | **Missing** |
| Details tab in the address (`#relations`) | Replaced by remembering the tab per title |
| Player keys: Space, arrows, F, M, volume | Built on PC when the video has focus; not when page controls have focus |
| Ctrl+R reload, F11 fullscreen, Ctrl+M minimise | **Missing as shortcuts**; window buttons and the player's fullscreen exist |
| Always on top | Built in Settings window tools |
| Drag files into the custom player | **Missing**; use Choose videos |
| Drag reorder in queue, relations, playlist | Built |
| Subtitle file loading | Built (SRT, VTT) |
| Playback speed list | Built |
| Picture-in-picture | Built on PC and Android; not used |
| Progress saved when the page closes | Partial: saved every 5 s, on pause and on leaving; the final seconds can be lost on a hard close |

### Electron and server features

| Old behaviour | Status |
| --- | --- |
| Choose Flask EXE, Flask data folder, backend status, PID, idle shutdown | Not needed: no server |
| Open config folder, open data folder | Built as Open app data (PC) |
| Open logs | Partial: errors go to `app-log.txt` in the app data folder; no log viewer |
| DevTools | Not available in release builds |
| Reset all paths | Partial: clear video folder and clear relinked files exist separately |
| Restart and reload app | Built in Settings window tools |

## Must do

1. **Run Android on a real device** and fix what breaks. Nothing there has run.
2. **Built-in subtitles and wider format support on PC**: done with libmpv (shinchiro build 20261102, GPLv2+). The licence matters if the app is ever shared publicly.
3. **Use the untested PC features once each**: folder creation, delete on a throwaway title, title editing, drag, in-video controls, picture-in-picture, auto-next, resume.

## Should do

4. Esc closes dialogs; Enter adds metadata values; arrow keys in search results.
5. Player keys work whatever has focus on the Player page.
6. Scroll to the list top when changing page.
7. Make the final save on close reliable.
8. Loading skeletons instead of a spinner.
9. Settings should show catalog names, not internal IDs, and offer to remove the old empty catalog.

## Nice to have

10. Hover video previews (continue watching, episodes, previous/next).
11. Drag files into the custom player and the add form.
12. App shortcuts: Ctrl+R, F11, Ctrl+M.
13. Custom player remembering positions between sessions.
14. Alternate titles and year in search results.
15. A whole-library relations check.
16. A separate tablet layout.

## Known bugs

- Resizing the window resets the Hub, Details and Queue pages; Library returns to its scroll position.
- The Player can open scrolled past its heading.
- A thin line may show under the Continue watching cover in narrow windows.
- Settings shows internal IDs for saved catalogs.
- The Start menu "AnimeManager" entry is the old development package and crashes. Use the installer. Removing it with Windows deletes that package's copy of the library, which is now also at `%LOCALAPPDATA%\AnimeManager\catalogs`.
- Toasts cannot draw over the video on PC.

## Library data

- Only 140 video files are on this PC; most episodes show as missing until their files are added or relinked.
- 21 titles have no cover: they had no image in the old app either.
- "Lucky☆Star" is garbled in the old data and needs its title corrected.

## Builds

See [packaging/README.md](../../native/packaging/README.md) and the commands in the session notes. Signing key: `%USERPROFILE%\.anime-manager-signing\`; back it up, every APK update needs it.
