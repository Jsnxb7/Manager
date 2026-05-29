# Entertainment Manager

A local Flask app for managing anime, manga, and custom media sections from one browser-based dashboard. It stores library data in JSON files, serves local video files, and keeps thumbnails, links, tags, watch states, bookmarks, and queue data close to the app.

## Features

### Content Hub

- Create custom sections such as Movies, TV Shows, Netflix, or any other list you want to track.
- Each custom section gets its own grid page, add form, search, filters, status controls, bookmarks, and editable links.
- Shared layout, animated backgrounds, and a persistent watch queue panel.

### Anime Library

- Responsive anime grid with local cover thumbnails.
- Live search across titles, seasons, status, and anime metadata headers.
- Filter accordion for status, sort controls, and metadata header filters.
- Floating add button on the anime index page.
- Add-anime form with thumbnail upload, safe filename validation, duplicate checks, and metadata selection.
- Anime metadata headers are stored in `data/unique_anime_tags.json`; each anime must include at least one value from every required header group.
- Anime detail page shows the thumbnail, metadata tags, editable download link, watched state, and episode list.
- Add or delete episodes from the anime detail page and persist those changes to JSON.
- Mark individual episodes or full anime entries as watched.
- Bookmark anime and cycle anime status values.

### Video Player

- Video.js based player for local episode playback.
- Keyboard shortcuts for playback, seeking, volume, fullscreen, and mute.
- Watch queue integration with auto-advance support.
- Previous and next episode side preview panels.
- Episode file lookup first checks the stored file path, then falls back to matching local video filenames such as `1.mp4`, `EP.01.mkv`, `episode-01.webm`, or `Show_-_01.mp4`.
- Episode matching uses the full episode number so `12.mp4` is not treated as episode `1`.

### Manga Library

- Manga grid with thumbnails, read state, bookmarks, status toggles, sorting, filtering, and live search.
- Editable manga links after creation.
- Thumbnail upload with preview on the add form.
- Small header/tag hover UI is ready for future manga metadata fields.

### Custom Sections

- Add custom items with title, status, link, and thumbnail.
- Upload thumbnails through the form instead of manually placing every image.
- Edit item links after creation.
- Track read state, bookmarks, and status per item.

## Project Structure

```text
entertainment-manager/
|-- app.py
|-- config.json
|-- main.js
|-- data/
|   |-- sections.json
|   |-- anime_data.json
|   |-- unique_anime_tags.json
|   |-- manga_data.json
|   |-- queue.json
|   `-- <section>_data.json
|-- static/
|   |-- anime_images/
|   |-- manga_images/
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
    |-- add_anime.html
    |-- manga_index.html
    |-- add_manga.html
    |-- section_index.html
    `-- add_section_item.html
```

Generated build folders, personal media, local database backups, and private JSON data should stay out of public commits unless you intentionally want to publish them.

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

### `data/unique_anime_tags.json`

```json
{
  "genres": ["Action", "Comedy"],
  "themes": ["School", "Supernatural"],
  "demographics": ["Shounen", "Seinen"],
  "tags": ["Dubbed", "Subbed"]
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

- The app is designed as a local personal manager, so JSON files can contain private paths, links, and watch history.
- Do not claim a license in the README unless a matching license file is added to the repository.
- Do not document external integrations unless they are actually implemented in `app.py` or the frontend.
- Keep generated build output and large media files out of GitHub unless they are required sample assets.
