# 🎬 Entertainment Manager

A local, self-hosted entertainment tracker and media player built with **Flask** and a glassmorphism UI. Track and manage your anime, manga, movies, TV shows, Netflix watchlists, and any other content category you want — all from a sleek hub running on your own machine.

---

## ✨ Features

### 🏠 Content Hub
- Dynamic hub page showing all your custom sections (Anime, Manga, Movies, TV Shows, Netflix, etc.)
- Add new content sections on the fly with a single click — no code changes needed
- Animated starfield video background with a premium glassmorphism card design

### 🎌 Anime
- Browse your anime library in a responsive grid with cover thumbnails
- Per-anime detail pages showing all episodes with video preview on hover
- Built-in **video player** powered by [Video.js](https://videojs.com/) with:
  - Keyboard shortcuts (Space, arrows, F, M)
  - Playback speed controls (0.5×, 1×, 1.5×, 2×)
  - Auto-advance to next episode on completion
- Mark individual episodes or entire series as watched
- Cycle anime status: **Ongoing → Not Aired → Completed**
- Automatic thumbnail fetching via the [Jikan API](https://jikan.moe/) if no local image is found
- **Watch Queue** — add anime to a persistent queue and play them sequentially
- Add new anime with auto-generated episode file paths based on your local directory structure
- Delete anime with automatic cleanup of files and directories

### 📚 Manga
- Grid view with cover images
- Mark manga as read / unread
- Bookmark favourites (⭐)
- Toggle status between Ongoing, Completed, and Hiatus
- Sort by bookmarked first, filter by unread or ongoing, and live search
- Direct links to read online

### 🗂️ Custom Sections (Netflix, Movies, TV Shows, etc.)
- Any section you create through the hub gets its own full-featured index page
- Supports read/unread tracking, bookmarks, status toggling, and deletion
- Add items with a title, status, and a link (streaming URL, page, etc.)
- Live search and filter controls (Unread, Ongoing, Bookmarked First)

---

## 📁 Project Structure

```
entertainment-manager/
├── app.py                    # Flask backend
├── data/
│   ├── sections.json         # List of all hub sections
│   ├── anime_data.json       # Anime library data
│   ├── manga_data.json       # Manga library data
│   ├── queue.json            # Watch queue
│   └── <section>_data.json   # Auto-created for each custom section
├── static/
│   ├── images/
│   │   ├── stars.mp4         # Background video (anime pages)
│   │   └── stars1.mp4        # Background video (hub)
│   ├── home.webp             # Home button icon
│   ├── placeholder.jpg       # Default cover image
│   ├── anime_images/         # Anime cover images (<Title>.jpg/png)
│   ├── manga_images/         # Manga cover images
│   ├── <section>_images/     # Auto-created per custom section
│   ├── css/
│   │   └── uni_style.css     # Shared grid/card styles
│   └── js/
│       └── scripts.js
└── templates/
    ├── base.html             # Shared layout, nav, queue panel
    ├── hub.html              # Section hub
    ├── index.html            # Anime index
    ├── anime_detail.html     # Anime detail + episode grid
    ├── player.html           # Video player
    ├── add_anime.html        # Add anime form
    ├── manga_index.html      # Manga index
    ├── add_manga.html        # Add manga form
    ├── section_index.html    # Generic section index (reused for all custom sections)
    └── add_section_item.html # Generic add item form
```

---

## 🚀 Getting Started

### Prerequisites

- Python 3.8+
- pip

### Installation

```bash
git clone https://github.com/your-username/entertainment-manager.git
cd entertainment-manager
pip install flask werkzeug
```

### Running the App

```bash
python app.py
```

Then open your browser at **http://localhost:5000**.

Optionally, pass a custom base path (used by Electron wrappers):

```bash
python app.py "C:/Users/you/Documents/EntertainmentManager"
```

---

## 🗃️ Data Format

### `data/sections.json`
```json
{
  "sections": ["Anime", "Manga", "Movies", "TV Shows", "Netflix"]
}
```

### `data/anime_data.json`
```json
[
  {
    "id": 1,
    "title": "Attack on Titan",
    "season": "Season 1",
    "status": "Completed",
    "download_link": "https://...",
    "directory": "C:/Users/you/Anime/Attack on Titan/Season 1",
    "watched": false,
    "bookmarked": false,
    "episodes": [
      {
        "number": 1,
        "title": "Episode 1",
        "watched": false,
        "file_path": "C:/Users/you/Anime/Attack on Titan/Season 1/1.mp4"
      }
    ]
  }
]
```

### `data/manga_data.json` / `data/<section>_data.json`
```json
[
  {
    "id": 1,
    "title": "One Piece",
    "status": "Ongoing",
    "link": "https://...",
    "read": false,
    "bookmarked": false
  }
]
```

---

## 🖼️ Adding Cover Images

Place image files in the matching `static/<section>_images/` folder with the filename matching the title exactly:

```
static/anime_images/Attack on Titan.jpg
static/manga_images/One Piece.png
static/movies_images/Inception.jpg
```

Supported formats: `.jpg`, `.jpeg`, `.png`, `.avif`

For anime, if no local image is found, the app will automatically fetch one from the [Jikan API](https://jikan.moe/).

---

## ⌨️ Player Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `Space` | Play / Pause |
| `←` | Rewind 10 seconds |
| `→` | Skip forward 10 seconds |
| `↑` | Volume up |
| `↓` | Volume down |
| `F` | Toggle fullscreen |
| `M` | Toggle mute |

---

## 🛠️ API Endpoints

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/` | Hub page |
| POST | `/add-section` | Create a new section |
| GET | `/anime` | Anime index |
| GET | `/api/anime` | Anime data as JSON |
| GET | `/anime/<id>` | Anime detail page |
| POST | `/add_anime` | Add a new anime |
| DELETE | `/delete_anime/<id>` | Delete an anime |
| POST | `/mark_watched/<id>/<ep>` | Toggle episode watched |
| POST | `/mark_anime_watched/<id>` | Toggle anime watched |
| POST | `/update_anime_status/<id>` | Update anime status |
| POST | `/bookmark/<id>` | Toggle anime bookmark |
| GET | `/player/<anime_id>/<episode>` | Play an episode |
| GET | `/manga` | Manga index |
| GET | `/api/manga` | Manga data as JSON |
| POST | `/add_manga` | Add new manga |
| POST | `/mark_manga_read/<id>` | Toggle manga read |
| POST | `/manga_bookmark/<id>` | Toggle manga bookmark |
| POST | `/toggle_manga_status/<id>` | Toggle manga status |
| DELETE | `/delete_manga/<id>` | Delete manga |
| GET | `/<section>` | Generic section index |
| GET | `/api/<section>` | Generic section data as JSON |
| POST | `/<section>/add` | Add item to section |
| POST | `/mark_read/<section>/<id>` | Toggle read for section item |
| POST | `/bookmark/<section>/<id>` | Toggle bookmark for section item |
| POST | `/toggle_status/<section>/<id>` | Toggle status for section item |
| DELETE | `/delete/<section>/<id>` | Delete a section item |
| GET | `/queue` | Get watch queue |
| POST | `/add_video` | Add anime to queue |
| DELETE | `/delete_from_queue/<index>` | Remove item from queue |

---

## 🎨 Tech Stack

- **Backend:** Python / Flask
- **Frontend:** Vanilla HTML, CSS, JavaScript (Jinja2 templates)
- **Video Player:** [Video.js 7.15](https://videojs.com/)
- **Anime Metadata:** [Jikan REST API](https://jikan.moe/)
- **Design:** Glassmorphism, animated video backgrounds, CSS `backdrop-filter`

---

## 📝 License

MIT — feel free to fork and adapt for your own media library.