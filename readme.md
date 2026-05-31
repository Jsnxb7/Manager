# Entertainment Manager

A local Flask-based media manager for organizing anime, manga, and custom entertainment sections from one browser dashboard. The app stores library data in JSON files, serves local episode files, tracks watch progress, manages a queue-based player, and includes a customizable Theme Studio for changing the UI without editing CSS manually.

This project is designed for personal/local use. Keep private JSON data, local media paths, backups, uploaded backgrounds, and large media files out of public GitHub commits.

## Features

### Content Hub

- Central dashboard for Anime, Manga, and custom media sections.
- Create custom sections such as Movies, TV Shows, Netflix, Drama, or any other list.
- Each custom section gets its own listing page, add form, search, filters, status controls, bookmarks, editable links, and thumbnails.
- Shared dark/glass UI with animated or custom backgrounds.
- Persistent queue panel available across the app.

### Anime Library

- Responsive anime grid with local cover thumbnails.
- Live search across title, season, status, and metadata.
- Filter accordion for status, sort controls, and metadata header filters.
- Floating add button on the anime index page.
- Add-anime form with thumbnail upload, safe filename validation, duplicate checks, and metadata selection.
- Anime metadata headers are stored in `data/unique_anime_tags.json`.
- Anime detail page shows:
  - thumbnail
  - metadata tags
  - editable download/source link
  - watch status
  - progress summary
  - episode list
  - per-episode resume state
- Add or delete episodes from the anime detail page.
- Mark individual episodes or entire anime entries as watched.
- Bookmark anime entries.
- Track anime watch statuses such as:
  - Not Started
  - Plan to Watch
  - Watching
  - On Hold
  - Dropped
  - Rewatching
  - Completed

### Continue Watching

- Tracks unfinished episodes in `data/anime_tracking.json`.
- Home/anime page can show Continue Watching cards.
- Cards include:
  - anime title
  - thumbnail
  - current episode
  - progress percentage
  - resume timestamp
  - Continue action
  - Start Over action
  - Discard action
- Hover preview UI shows current episode context and resume controls.

### Episode Progress Tracking

- Saves episode playback time and total duration.
- Episode cards can show:
  - watched percentage
  - current timestamp
  - total duration
  - Resume / Continue button
  - Start Over button
  - Rewatch button for completed episodes
- Anime-level progress is calculated from episode watch state and saved progress.
- Completed episodes are removed from the active Continue Watching list.

### Video Player

- Video.js based local episode player.
- Saves playback progress to JSON.
- Supports resume and start-over behavior.
- Keyboard shortcuts for playback, seeking, volume, fullscreen, and mute.
- Previous and next episode side preview panels.
- Queue-aware player support.
- Episode file lookup first checks the stored file path, then falls back to matching local video filenames such as `1.mp4`, `EP.01.mkv`, `episode-01.webm`, or `Show_-_01.mp4`.
- Episode matching uses the full episode number so `12.mp4` is not treated as episode `1`.

### Queue System

- Persistent queue stored in `data/queue.json`.
- Dedicated queue page.
- Queue player page with expandable/retractable sidebar.
- Queue progress indicator showing current position and remaining episodes.
- Queue cards include:
  - anime thumbnail
  - anime title
  - episode number
  - episode title
  - duration where available
  - now-playing state
- Queue actions include:
  - remove item
  - move item to top
  - clear queue
  - clear watched items
  - drag-and-drop reorder
- Queue-aware next/previous previews can move across different anime, not just episodes from the same anime.

### Manga Library

- Manga grid with thumbnails, read state, bookmarks, status toggles, sorting, filtering, and live search.
- Editable manga links after creation.
- Thumbnail upload with preview on the add form.
- Metadata support for genres, themes, demographics, and tags.

### Custom Sections

- Add custom items with title, status, link, and thumbnail.
- Upload thumbnails through the form.
- Edit item links after creation.
- Track read state, bookmarks, and status per item.
- Each custom section stores data in its own JSON file.

### Theme Studio

- Interactive settings page for changing the app appearance.
- Prebuilt theme kits include:
  - Soft Pink Glass
  - Dark Neon
  - Purple Space
  - Minimal Dark
  - Cream Glass
  - Ocean Mist
  - Ember Noir
  - Forest Glass
  - Sakura Night
  - Arctic Blue
- Theme settings are stored in `data/theme_settings.json`.
- Supports:
  - global app theme
  - page-specific themes
  - global element color overrides
  - page-specific element color overrides
  - live color editing with color picker controls
  - real scaled page preview through iframe rendering
  - desktop/tablet/mobile preview sizes
  - custom uploaded video or image backgrounds
  - dark shade mode
- Theme variables are designed to be single-source so grouped elements such as buttons, pagination, cards, panels, inputs, and badges inherit from shared theme tokens.

## Project Structure

```text
entertainment-manager/
|-- app.py
|-- config.json
|-- main.js
|-- data/
|   |-- sections.json
|   |-- anime_data.json
|   |-- anime_tracking.json
|   |-- theme_settings.json
|   |-- unique_anime_tags.json
|   |-- manga_data.json
|   |-- unique_manga_headers.json
|   |-- queue.json
|   `-- <section>_data.json
|-- static/
|   |-- anime_images/
|   |-- manga_images/
|   |-- theme_uploads/
|   |-- <section>_images/
|   |-- css/
|   |   `-- uni_style.css
|   |-- js/
|   |   `-- scripts.js
|   |-- images/
|   `-- placeholder.jpeg
`-- templates/
    |-- base.html
    |-- hub.html
    |-- index.html
    |-- anime_detail.html
    |-- player.html
    |-- queue.html
    |-- queue_player.html
    |-- settings.html
    |-- settings_preview.html
    |-- add_anime.html
    |-- manga_index.html
    |-- manga_detail.html
    |-- add_manga.html
    |-- section_index.html
    |-- section_detail.html
    `-- add_section_item.html
```

Some files or folders may not exist until the app creates them.

## Getting Started

### Requirements

- Python 3.8+
- Flask
- Werkzeug

### Install

```bash
pip install flask werkzeug
```

### Run

```bash
python app.py
```

Open the app at:

```text
http://localhost:5000
```

You can also pass a custom base path when launching the app:

```bash
python app.py "C:/Path/To/EntertainmentManager"
```

## Data Files

The app uses JSON files for local persistence. The examples below are safe sample structures only.

### `data/sections.json`

```json
{
  "sections": ["Anime", "Manga", "Movies"]
}
```

### `data/anime_data.json`

```json
[
  {
    "id": 1,
    "title": "Example Anime",
    "season": "Season 1",
    "status": "Ongoing",
    "watch_status": "Watching",
    "download_link": "https://example.com",
    "directory": "C:/Media/Example Anime/Season 1",
    "watched": false,
    "bookmarked": false,
    "genres": ["Action"],
    "themes": ["School"],
    "demographics": ["Shounen"],
    "tags": ["Dubbed"],
    "episodes": [
      {
        "number": 1,
        "title": "Episode 1",
        "watched": false,
        "file_path": "C:/Media/Example Anime/Season 1/1.mp4"
      }
    ]
  }
]
```

### `data/anime_tracking.json`

```json
{
  "schema_version": 1,
  "updated_at": null,
  "last_use": {
    "anime_id": 1,
    "anime_title": "Example Anime",
    "episode_number": 1,
    "episode_title": "Episode 1",
    "current_time": 420,
    "total_duration": 1440,
    "progress_percentage": 29.17,
    "last_watched_at": "2026-01-01T12:00:00+00:00"
  },
  "queue": {
    "updated_at": null,
    "order": []
  },
  "anime": {
    "1": {
      "anime_id": 1,
      "anime_title": "Example Anime",
      "watch_status": "Watching",
      "last_watched_episode": 1,
      "completion_percentage": 0,
      "episodes": {
        "1": {
          "episode_number": 1,
          "episode_title": "Episode 1",
          "current_time": 420,
          "total_duration": 1440,
          "progress_percentage": 29.17,
          "completed": false,
          "active_continue": true
        }
      }
    }
  }
}
```

### `data/queue.json`

```json
{
  "queue": [
    {
      "id": 1,
      "title": "Example Anime",
      "episode": 1
    }
  ]
}
```

### `data/theme_settings.json`

```json
{
  "schema_version": 1,
  "theme": "soft_pink_glass",
  "dark_mode": false,
  "same_theme_everywhere": true,
  "section_themes": {
    "home": "soft_pink_glass",
    "anime": "soft_pink_glass",
    "manga": "soft_pink_glass",
    "queue": "soft_pink_glass",
    "player": "soft_pink_glass",
    "details": "soft_pink_glass",
    "add": "soft_pink_glass",
    "sections": "soft_pink_glass",
    "settings": "soft_pink_glass"
  },
  "background": {
    "mode": "default_video",
    "url": "/static/images/stars.mp4",
    "type": "video"
  },
  "global_overrides": {},
  "page_overrides": {}
}
```

### `data/unique_anime_tags.json`

```json
{
  "summary": {
    "unique_tags": 1,
    "unique_genres": 1,
    "unique_themes": 1,
    "unique_demographics": 1
  },
  "tags": [
    {
      "name": "Dubbed",
      "count": 1
    }
  ],
  "genres": [
    {
      "name": "Action",
      "count": 1
    }
  ],
  "themes": [
    {
      "name": "School",
      "count": 1
    }
  ],
  "demographics": [
    {
      "name": "Shounen",
      "count": 1
    }
  ]
}
```

### `data/manga_data.json` and `data/<section>_data.json`

```json
[
  {
    "id": 1,
    "title": "Example Item",
    "status": "Ongoing",
    "link": "https://example.com",
    "read": false,
    "bookmarked": false
  }
]
```

## Thumbnail Uploads

Anime, manga, and custom section add forms accept thumbnail uploads and show a preview before submitting. The server saves uploaded images into the matching static folder:

```text
static/anime_images/
static/manga_images/
static/<section>_images/
```

The saved filename is based on a secured version of the title so it can be loaded back as the card thumbnail. Legacy manually named images are still supported as fallbacks.

Supported image types include:

```text
.jpg, .jpeg, .png, .avif, .webp, .gif
```

## Theme Background Uploads

The Theme Studio can store uploaded background media in:

```text
static/theme_uploads/
```

Supported background types include:

```text
.mp4, .webm, .jpg, .jpeg, .png, .webp, .gif
```

Do not commit personal uploaded backgrounds to a public repository unless they are intended sample assets.

## Episode File Matching

The app normally uses the episode file paths stored in `data/anime_data.json`. If that exact file is not found, it scans the anime directory and tries to match the requested episode number against supported video files.

Supported fallback filename patterns include:

```text
1.mp4
001.mkv
Show EP.01.mp4
Show episode-01.webm
Show_-_01.m4v
```

Supported video types include:

```text
.mp4, .mkv, .avi, .mov, .webm, .m4v
```

## Player Shortcuts

| Key | Action |
| --- | --- |
| `Space` | Play or pause |
| `Left Arrow` | Rewind |
| `Right Arrow` | Skip forward |
| `Up Arrow` | Volume up |
| `Down Arrow` | Volume down |
| `F` | Toggle fullscreen |
| `M` | Toggle mute |
## Development Notes

- The app is designed as a local personal manager, so JSON files may contain private paths, links, watch history, queue history, and theme-upload paths.
- Keep generated build output and large media files out of GitHub unless they are required sample assets.
- Do not document external integrations unless they are actually implemented in `app.py` or the frontend.
- Do not claim a license in the README unless a matching license file is added to the repository.
- If the Theme Studio is expanded further, keep theme values routed through shared CSS variables so grouped UI elements update consistently.
