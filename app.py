from flask import Flask, send_file, render_template, jsonify, request, redirect, url_for
import json
import os
import sys
import re
from urllib.parse import quote
from werkzeug.utils import secure_filename
import logging
import shutil
from datetime import datetime, timezone
import tempfile

if len(sys.argv) > 1:
    BASE_PATH = sys.argv[1]
else:
    BASE_PATH = os.getcwd()
    print(f"No Flask data directory provided by Electron. Using current directory: {BASE_PATH}")

# Use the path received from Electron (default to current dir if not provided)
STATIC_FOLDER = os.path.join(BASE_PATH, 'static')
QUEUE_FILE = os.path.join(BASE_PATH, 'data','queue.json' )
TEMPLATES_FOLDER = os.path.join(BASE_PATH, 'templates')
DATA_FILE = os.path.join(BASE_PATH, 'data', 'anime_data.json')
TRACKING_FILE = os.path.join(BASE_PATH, 'data', 'anime_tracking.json')
THEME_SETTINGS_FILE = os.path.join(BASE_PATH, 'data', 'theme_settings.json')
THEME_UPLOAD_FOLDER = os.path.join(BASE_PATH, 'static', 'theme_uploads')
IMAGE_FOLDER = os.path.join(BASE_PATH, "static", "anime_images")
DEFAULT_IMAGE = "/static/placeholder.jpeg"
MANGA_DATA_FILE = os.path.join(BASE_PATH, 'data', 'manga_data.json')
MANGA_IMAGE_FOLDER = os.path.join(BASE_PATH, "static", "manga_images")
DEFAULT_MANGA_IMAGE = "/static/placeholder.jpeg"
DATA_FILE_SEC = os.path.join(BASE_PATH, 'data', 'sections.json')
DATA_FOLDER = os.path.join(BASE_PATH, 'data')
ANIME_TAGS_FILE = os.path.join(BASE_PATH, 'data', 'unique_anime_tags.json')
ANIME_FILTER_STATE_FILE = os.path.join(BASE_PATH, 'data', 'anime_filter_state.json')
MANGA_HEADERS_FILE = os.path.join(BASE_PATH, 'data', 'unique_manga_headers.json')
ALLOWED_IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "avif", "webp", "gif"}
IMAGE_EXTENSION_ORDER = ["jpg", "png", "jpeg", "avif", "webp", "gif"]
VIDEO_EXTENSIONS = {".mp4", ".mkv", ".avi", ".mov", ".webm", ".m4v"}
MANGA_DEMOGRAPHICS = {"Shounen", "Seinen", "Shoujo", "Josei", "Kids"}
MANGA_HEADER_GROUPS = ["tags", "genres", "themes", "demographics"]
WINDOWS_RESERVED_NAMES = {
    "con", "prn", "aux", "nul",
    "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
    "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9"
}

# Ensure folders exist
if not os.path.exists(STATIC_FOLDER) or not os.path.exists(TEMPLATES_FOLDER):
    print("Error: Flask data folder does not contain required directories.")
    sys.exit(1)

app = Flask(__name__, static_folder=STATIC_FOLDER, template_folder=TEMPLATES_FOLDER)


def allowed_image_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_IMAGE_EXTENSIONS


def normalize_compare(value):
    return (value or "").strip().casefold()


def secure_path_title(title):
    cleaned = "".join("-" if char in '<>:"/\\|?*\x00' else char for char in (title or "").strip())
    cleaned = " ".join(cleaned.split()).strip(" .")
    if not cleaned:
        return ""
    if cleaned.casefold() in WINDOWS_RESERVED_NAMES:
        cleaned = f"{cleaned}_"
    return cleaned


def title_security_info(title):
    safe_title = secure_path_title(title)
    original = (title or "").strip()
    return {
        "safe_title": safe_title,
        "is_safe": bool(safe_title) and safe_title == original,
        "has_title": bool(original),
        "message": "Title is safe for filenames." if safe_title and safe_title == original else "Title will be saved with a safe filename."
    }


def title_to_image_filename(title, extension):
    return f"{secure_path_title(title)}.{extension.lower()}"


def image_filename_candidates(title, extension):
    extension = extension.lower()
    candidates = [title_to_image_filename(title, extension)]
    legacy = f"{(title or '').strip()}.{extension}"
    if legacy not in candidates:
        candidates.append(legacy)
    return candidates


def save_uploaded_thumbnail(file_storage, title, image_folder):
    if not file_storage or not file_storage.filename:
        return None

    original_filename = secure_filename(file_storage.filename)
    if not allowed_image_file(original_filename):
        return None

    os.makedirs(image_folder, exist_ok=True)
    extension = original_filename.rsplit(".", 1)[1].lower()
    filename = title_to_image_filename(title, extension)
    if filename.startswith("."):
        return None
    file_storage.save(os.path.join(image_folder, filename))
    return filename

def normalize_metadata_values(values):
    if isinstance(values, str):
        values = [values]
    elif not isinstance(values, list):
        values = []

    seen = set()
    normalized = []

    for value in values:
        clean_value = " ".join(str(value or "").strip().split())
        key = clean_value.casefold()
        if clean_value and key not in seen:
            seen.add(key)
            normalized.append(clean_value)

    return normalized


def parse_metadata_form(groups):
    metadata = {}

    for group in groups:
        raw_value = request.form.get(group, "[]")
        try:
            parsed = json.loads(raw_value)
        except json.JSONDecodeError:
            parsed = []
        metadata[group] = normalize_metadata_values(parsed if isinstance(parsed, list) else [])

    return metadata


def missing_metadata_groups(metadata, labels):
    return [label for group, label in labels.items() if not metadata.get(group)]


def build_unique_metadata_payload(data, groups, extra_summary=None):
    grouped = {group: {} for group in groups}

    for item in data:
        for group in groups:
            for value in item.get(group, []) or []:
                clean_value = " ".join(str(value or "").strip().split())
                if clean_value:
                    grouped[group][clean_value] = grouped[group].get(clean_value, 0) + 1

    summary = {f"unique_{group}": len(values) for group, values in grouped.items()}
    if extra_summary:
        summary.update(extra_summary)

    payload = {"summary": summary}
    payload.update({
        group: [
            {"name": name, "count": count}
            for name, count in sorted(values.items(), key=lambda item: (-item[1], item[0].lower()))
        ]
        for group, values in grouped.items()
    })
    return payload


def find_duplicate(data, fields):
    for item in data:
        if all(normalize_compare(item.get(key)) == normalize_compare(value) for key, value in fields.items()):
            return item
    return None


def find_same_title(data, title):
    return [item for item in data if normalize_compare(item.get("title")) == normalize_compare(title)]


def build_validation_payload(data, fields):
    title = fields.get("title", "")
    exact_duplicate = find_duplicate(data, fields)
    same_title = find_same_title(data, title) if title else []
    security = title_security_info(title)

    return {
        **security,
        "exact_duplicate": exact_duplicate is not None,
        "same_title_count": len(same_title),
        "can_submit": security["has_title"] and bool(security["safe_title"]) and exact_duplicate is None,
        "duplicate_message": "This exact entry already exists." if exact_duplicate else (
            "This title exists, but the other fields are different." if same_title else "No matching title found."
        )
    }


@app.route("/api/validate-entry")
def validate_entry():
    entry_type = request.args.get("type", "")
    title = request.args.get("title", "")
    status = request.args.get("status", "")
    link = request.args.get("link", "")
    season = request.args.get("season", "")

    if entry_type == "anime":
        payload = build_validation_payload(load_anime_data(), {
            "title": title,
            "season": season,
            "status": status
        })
    elif entry_type == "manga":
        payload = build_validation_payload(load_manga_data(), {
            "title": title
        })
    elif entry_type == "section":
        section = normalize_section(request.args.get("section", ""))
        payload = build_validation_payload(load_section_data(section), {
            "title": title,
            "status": status,
            "link": link
        })
    else:
        return jsonify({"error": "Unknown entry type"}), 400

    return jsonify(payload)


def get_section_paths(section):
    section = section.lower()

    return {
        "DATA_FILE": os.path.join(DATA_FOLDER, f"{section}_data.json"),
        "IMAGE_FOLDER": os.path.join(STATIC_FOLDER, f"{section}_images"),
        "IMAGE_URL": f"/static/{section}_images",
        "INDEX_TEMPLATE": f"{section}_index.html",
        "DETAIL_TEMPLATE": f"{section}_detail.html"
    }

def load_section_data(section):
    paths = get_section_paths(section)
    data_file = paths["DATA_FILE"]

    if not os.path.exists(data_file):
        return []

    with open(data_file, "r", encoding="utf-8") as f:
        data = json.load(f)

    for item in data:
        item.setdefault("read", False)
        item.setdefault("bookmarked", False)

    data.sort(key=lambda x: x.get("title", "").lower())
    return data

def save_section_data(section, data):
    paths = get_section_paths(section)
    with open(paths["DATA_FILE"], "w", encoding="utf-8") as f:
        json.dump(data, f, indent=4)

def find_by_id(data, item_id):
    return next((item for item in data if item.get("id") == item_id), None)

def renumber_anime_episodes(anime):
    directory = anime.get("directory", "")
    episodes = sorted(anime.get("episodes", []), key=lambda episode: episode.get("number", 0))

    for index, episode in enumerate(episodes, start=1):
        episode["number"] = index
        episode["title"] = episode.get("title") or f"Episode {index}"
        if directory:
            episode["file_path"] = os.path.join(directory, f"{index}.mp4").replace("\\", "/")

    anime["episodes"] = episodes
    return episodes

def get_episode_number_from_filename(filename):
    stem, ext = os.path.splitext(os.path.basename(filename))
    if ext.lower() not in VIDEO_EXTENSIONS:
        return None

    if stem.isdigit():
        return int(stem)

    episode_pattern = re.compile(r'(?:EP\.|episode-|_-_)(\d{1,3})(?!\d)', re.IGNORECASE)
    match = episode_pattern.search(stem)

    if match:
        return int(match.group(1).lstrip("0") or "0")

    return None

def find_episode_video_file(directory, episode_number):
    if not directory or not os.path.isdir(directory):
        return None

    matches = []
    for filename in os.listdir(directory):
        filepath = os.path.join(directory, filename)
        if not os.path.isfile(filepath):
            continue
        if get_episode_number_from_filename(filename) == episode_number:
            matches.append(filepath)

    if not matches:
        return None

    def match_rank(filepath):
        filename = os.path.basename(filepath).lower()
        stem, ext = os.path.splitext(filename)
        exact_rank = 0 if stem == str(episode_number) else 1
        ext_rank = 0 if ext == ".mp4" else 1
        return (exact_rank, ext_rank, filename)

    return sorted(matches, key=match_rank)[0]

def resolve_episode_video_file(anime, filename):
    directory = anime.get("directory")
    if not directory:
        return None
    requested_path = os.path.join(directory, filename)

    if os.path.exists(requested_path):
        return requested_path

    episode_number = get_episode_number_from_filename(filename)
    if episode_number is None:
        return None

    return find_episode_video_file(directory, episode_number)

def get_episode_video_url(anime, episode):
    if not anime or not episode or not episode.get("file_path"):
        return None
    filename = os.path.basename(episode["file_path"].replace("\\", "/"))
    return f"/videos/{anime['id']}/{filename}" if filename else None

def prepare_anime_episodes_for_player(anime):
    episodes = sorted(anime.get("episodes", []), key=lambda item: item.get("number", 0))
    anime["episodes"] = episodes
    for episode in episodes:
        episode["video_url"] = get_episode_video_url(anime, episode)
    return episodes

def get_adjacent_episode_context(anime, episode):
    episodes = anime.get("episodes", [])
    current_index = next(
        (index for index, item in enumerate(episodes) if item.get("number") == episode.get("number")),
        None
    )
    previous_episode = episodes[current_index - 1] if current_index is not None and current_index > 0 else None
    next_episode = episodes[current_index + 1] if current_index is not None and current_index + 1 < len(episodes) else None
    return {
        "previous_episode": previous_episode,
        "next_episode": next_episode,
        "previous_episode_url": url_for("player", anime_id=anime["id"], episode_number=previous_episode["number"]) if previous_episode else None,
        "next_episode_url": url_for("player", anime_id=anime["id"], episode_number=next_episode["number"]) if next_episode else None,
        "previous_episode_video_url": previous_episode.get("video_url") if previous_episode else None,
        "next_episode_video_url": next_episode.get("video_url") if next_episode else None
    }

def get_section_image(section, title):
    paths = get_section_paths(section)

    for ext in IMAGE_EXTENSION_ORDER:
        for filename in image_filename_candidates(title, ext):
            filepath = os.path.join(paths["IMAGE_FOLDER"], filename)

            if os.path.exists(filepath):
                return f"{paths['IMAGE_URL']}/{filename}"

    return DEFAULT_IMAGE

@app.route("/api/<section>")
def api_section(section):
    if section == "anime-tags":
        return api_anime_tags()

    data = load_section_data(section)

    for item in data:
        item["thumbnail_url"] = get_section_image(section, item["title"])

    return jsonify(data)

@app.route("/<section>/<int:item_id>")
def section_detail(section, item_id):
    data = load_section_data(section)
    item = next((i for i in data if i["id"] == item_id), None)

    if not item:
        return "Not found", 404

    return render_template(f"{section}_detail.html", item=item)

@app.route("/update_link/<section>/<int:item_id>", methods=["POST"])
def update_section_link(section, item_id):
    data = load_section_data(section)
    item = find_by_id(data, item_id)

    if not item:
        return jsonify({"status": "error", "message": "Item not found"}), 404

    payload = request.get_json(silent=True) or {}
    link = payload.get("link", "").strip()

    if not link:
        return jsonify({"status": "error", "message": "Missing link"}), 400

    item["link"] = link
    save_section_data(section, data)

    return jsonify({"status": "success", "link": link})

@app.route("/<section>/add", methods=["GET", "POST"])
def add_section_item(section):
    section = normalize_section(section)

    if request.method == "POST":
        title = request.form.get("title", "").strip()
        status = request.form.get("status")
        link = request.form.get("link")

        if not title or not secure_path_title(title):
            return redirect(url_for("add_section_item", section=section))

        data = load_section_data(section)
        if find_duplicate(data, {"title": title, "status": status, "link": link}):
            return redirect(url_for("add_section_item", section=section, duplicate=1))

        existing_ids = {i["id"] for i in data}
        new_id = 1
        while new_id in existing_ids:
            new_id += 1

        data.append({
            "id": new_id,
            "title": title,
            "status": status,
            "link": link,
            "read": False,
            "bookmarked": False
        })

        save_uploaded_thumbnail(request.files.get("thumbnail"), title, get_section_paths(section)["IMAGE_FOLDER"])
        save_section_data(section, data)

        return redirect(url_for("section_index", section=section))

    return render_template(
        "add_section_item.html",
        section=section.capitalize(),
        section_slug=section
    )


@app.route("/mark_read/<section>/<int:item_id>", methods=["POST"])
def toggle_read(section, item_id):
    data = load_section_data(section)
    item = next((i for i in data if i["id"] == item_id), None)

    if not item:
        return jsonify({"error": "Not found"}), 404

    item["read"] = not item["read"]
    save_section_data(section, data)

    return jsonify({"read": item["read"]})

@app.route("/bookmark/<section>/<int:item_id>", methods=["POST"])
def toggle_bookmark_1(section, item_id):
    data = load_section_data(section)
    item = next((i for i in data if i["id"] == item_id), None)

    if not item:
        return jsonify({"error": "Not found"}), 404

    item["bookmarked"] = not item["bookmarked"]
    save_section_data(section, data)

    return jsonify({"bookmarked": item["bookmarked"]})

@app.route("/toggle_status/<section>/<int:item_id>", methods=["POST"])
def toggle_status_1(section, item_id):
    data = load_section_data(section)
    item = next((i for i in data if i["id"] == item_id), None)

    if not item:
        return jsonify({"error": "Not found"}), 404

    current = item.get("status", "Ongoing").lower()
    item["status"] = "Completed" if current == "ongoing" else "Ongoing"

    save_section_data(section, data)
    return jsonify({"status": item["status"]})

@app.route("/delete/<section>/<int:item_id>", methods=["DELETE"])
def delete_item_1(section, item_id):
    data = load_section_data(section)
    index = next((i for i, x in enumerate(data) if x["id"] == item_id), None)

    if index is None:
        return jsonify({"error": "Not found"}), 404

    title = data[index]["title"]
    paths = get_section_paths(section)

    for ext in IMAGE_EXTENSION_ORDER:
        for filename in image_filename_candidates(title, ext):
            path = os.path.join(paths["IMAGE_FOLDER"], filename)
            if os.path.exists(path):
                os.remove(path)
                break

    data.pop(index)
    save_section_data(section, data)

    return jsonify({"status": "success"})


@app.route("/<section>")
def section_index(section):
    return render_template(
        "section_index.html",
        section=section
    )

def load_sections():
    with open(DATA_FILE_SEC, "r") as f:
        return json.load(f)["sections"]

def save_section(sections):
    with open(DATA_FILE_SEC, "w") as f:
        json.dump({"sections": sections}, f, indent=2)

def normalize_section(name):
    return name.strip().lower().replace(" ", "_")

def create_section(section):
    paths = get_section_paths(section)

    os.makedirs(paths["IMAGE_FOLDER"], exist_ok=True)

    if not os.path.exists(paths["DATA_FILE"]):
        with open(paths["DATA_FILE"], "w") as f:
            json.dump([], f, indent=2)

@app.route("/add-section", methods=["POST"])
def add_section():
    name = request.form.get("name")

    if not name:
        return redirect(url_for("hub"))

    display_name = name.strip()
    slug = normalize_section(display_name)

    sections = load_sections()

    # avoid duplicates (case-insensitive)
    existing_slugs = {normalize_section(s) for s in sections}

    if slug not in existing_slugs:
        sections.append(display_name)      # 👈 STORE DISPLAY NAME
        save_section(sections)
        create_section(slug)               # 👈 USE SLUG FOR FILES

    return redirect(url_for("hub"))


def extract_manga_items(raw_data):
    if isinstance(raw_data, list):
        return raw_data

    if isinstance(raw_data, dict):
        for key in ["manga", "mangas", "items", "data", "results"]:
            value = raw_data.get(key)
            if isinstance(value, list):
                return value

    return []

def first_text_value(item, keys, fallback=""):
    for key in keys:
        value = item.get(key)
        if value is not None and str(value).strip():
            return str(value).strip()
    return fallback

def normalize_manga_item(item, fallback_id):
    if not isinstance(item, dict):
        return None

    manga = dict(item)
    manga["id"] = manga.get("id") or fallback_id
    manga["title"] = first_text_value(
        manga,
        ["title"],
        f"Untitled Manga {fallback_id}"
    )
    manga["status"] = first_text_value(manga, ["status"], "Unknown")
    manga["link"] = first_text_value(manga, ["link", "url", "source_url", "mal_url"], "")
    manga["read"] = bool(manga.get("read", False))
    manga["bookmarked"] = bool(manga.get("bookmarked", False))

    enrich_manga_headers(manga)
    return manga

def load_manga_data():
    if not os.path.exists(MANGA_DATA_FILE):
        return []
    with open(MANGA_DATA_FILE, 'r', encoding='utf-8') as file:
        raw_data = json.load(file)

    data = []
    for index, item in enumerate(extract_manga_items(raw_data), start=1):
        manga = normalize_manga_item(item, index)
        if manga:
            data.append(manga)

    data.sort(key=lambda m: str(m.get("title", "")).lower())
    return data

def save_manga_data(data):
    with open(MANGA_DATA_FILE, 'w', encoding='utf-8') as file:
        json.dump(data, file, indent=4, ensure_ascii=False)

def enrich_manga_headers(manga):
    genres = normalize_metadata_values(manga.get("genres", []) if isinstance(manga.get("genres"), list) else [])
    tags = normalize_metadata_values(manga.get("tags", []) if isinstance(manga.get("tags"), list) else [])
    explicit_themes = normalize_metadata_values(manga.get("themes", []) if isinstance(manga.get("themes"), list) else [])
    explicit_demographics = normalize_metadata_values(manga.get("demographics", []) if isinstance(manga.get("demographics"), list) else [])

    genre_keys = {value.casefold() for value in genres}
    demographic_keys = {value.casefold() for value in MANGA_DEMOGRAPHICS}

    derived_demographics = [
        value for value in tags
        if value.casefold() in demographic_keys and value not in explicit_demographics
    ]
    derived_themes = [
        value for value in tags
        if value.casefold() not in genre_keys
        and value.casefold() not in demographic_keys
        and value not in explicit_themes
    ]

    manga["genres"] = genres
    manga["tags"] = tags
    manga["themes"] = normalize_metadata_values([*explicit_themes, *derived_themes])
    manga["demographics"] = normalize_metadata_values([*explicit_demographics, *derived_demographics])
    return manga

def get_manga_image(manga):
    title = manga.get("title", "") if isinstance(manga, dict) else manga
    for ext in IMAGE_EXTENSION_ORDER:
        safe_filename = title_to_image_filename(title, ext)
        filepath = os.path.join(MANGA_IMAGE_FOLDER, safe_filename)
        if os.path.exists(filepath):
            return f"/static/manga_images/{quote(safe_filename)}"

        legacy_filename = f"{(title or '').strip()}.{ext}"
        legacy_path = os.path.join(MANGA_IMAGE_FOLDER, legacy_filename)
        if legacy_filename != safe_filename and os.path.exists(legacy_path):
            return f"/static/manga_images/{quote(legacy_filename)}"

    return DEFAULT_MANGA_IMAGE

def build_manga_api_item(manga):
    item = dict(manga)
    item["thumbnail_url"] = get_manga_image(item)
    item.setdefault("themes", [])
    item.setdefault("demographics", [])
    item.setdefault("genres", [])
    item.setdefault("tags", [])
    item.setdefault("link", "")
    return item

def parse_manga_metadata_form():
    return parse_metadata_form(MANGA_HEADER_GROUPS)

def missing_manga_metadata_groups(metadata):
    return missing_metadata_groups(metadata, {
        "genres": "Genres",
        "themes": "Themes",
        "demographics": "Demographics",
        "tags": "Tags"
    })

def rebuild_unique_manga_headers(manga_data):
    enriched_data = [enrich_manga_headers(dict(manga)) for manga in manga_data]
    statuses = {}
    source_lists = {}
    thumbnail_present = 0
    link_present = 0

    for manga in enriched_data:
        status = manga.get("status") or "Unknown"
        statuses[status] = statuses.get(status, 0) + 1

        source_list = manga.get("source_list_name")
        if source_list:
            source_lists[source_list] = source_lists.get(source_list, 0) + 1

        if get_manga_image(manga) != DEFAULT_MANGA_IMAGE:
            thumbnail_present += 1
        if manga.get("link"):
            link_present += 1

    payload = build_unique_metadata_payload(
        enriched_data,
        ["tags", "genres", "themes", "demographics"],
        {
            "total_manga": len(enriched_data),
            "unique_statuses": len(statuses),
            "unique_source_lists": len(source_lists),
            "thumbnail_present": thumbnail_present,
            "thumbnail_missing": max(0, len(enriched_data) - thumbnail_present),
            "link_present": link_present,
            "link_missing": max(0, len(enriched_data) - link_present)
        }
    )
    payload["statuses"] = [
        {"name": name, "count": count}
        for name, count in sorted(statuses.items(), key=lambda item: (-item[1], item[0].lower()))
    ]
    payload["source_lists"] = [
        {"name": name, "count": count}
        for name, count in sorted(source_lists.items(), key=lambda item: (-item[1], item[0].lower()))
    ]

    with open(MANGA_HEADERS_FILE, "w", encoding="utf-8") as file:
        json.dump(payload, file, indent=4, ensure_ascii=False)

    return payload

@app.route('/api/manga')
def api_manga():
    manga_data = load_manga_data()
    return jsonify([build_manga_api_item(manga) for manga in manga_data])

@app.route('/api/manga-headers')
def api_manga_headers():
    if os.path.exists(MANGA_HEADERS_FILE):
        with open(MANGA_HEADERS_FILE, 'r', encoding='utf-8') as file:
            payload = json.load(file)
        if all(isinstance(payload.get(group), list) for group in MANGA_HEADER_GROUPS):
            return jsonify(payload)

    return jsonify(rebuild_unique_manga_headers(load_manga_data()))

@app.route('/manga')
def manga_index():
    return render_template("manga_index.html")

@app.route('/manga/<int:manga_id>')
def manga_detail(manga_id):
    manga_data = load_manga_data()
    manga = next((m for m in manga_data if m["id"] == manga_id), None)

    if manga:
        return render_template("manga_detail.html", manga=build_manga_api_item(manga))

    return "Manga not found", 404

@app.route('/add_manga', methods=['GET', 'POST'])
def add_manga():
    if request.method == 'POST':
        title = request.form.get('title', '').strip()
        status = request.form.get('status')
        link = request.form.get("link")
        metadata = parse_manga_metadata_form()
        missing_metadata = missing_manga_metadata_groups(metadata)

        if not title or not secure_path_title(title):
            return redirect(url_for('add_manga'))

        if missing_metadata:
            return redirect(url_for('add_manga', missing_metadata=",".join(missing_metadata)))

        manga_data = load_manga_data()
        if find_duplicate(manga_data, {"title": title}):
            return redirect(url_for('add_manga', duplicate=1))
        existing_ids = {m["id"] for m in manga_data}
        new_id = 1
        while new_id in existing_ids:
            new_id += 1

        new_manga = {
            "id": new_id,
            "title": title,
            "status": status,
            "link": link,
            "read": False,
            "bookmarked": False,
            "tags": metadata["tags"],
            "genres": metadata["genres"],
            "themes": metadata["themes"],
            "demographics": metadata["demographics"],
            "tag_source": "manual",
            "tag_match_status": "manual"
        }

        manga_data.append(new_manga)
        save_uploaded_thumbnail(request.files.get("thumbnail"), title, MANGA_IMAGE_FOLDER)
        save_manga_data(manga_data)
        rebuild_unique_manga_headers(manga_data)

        return redirect(url_for('manga_index'))

    return render_template("add_manga.html")

@app.route('/mark_manga_read/<int:manga_id>', methods=['POST'])
def mark_manga_read(manga_id):
    manga_data = load_manga_data()
    manga = next((m for m in manga_data if m["id"] == manga_id), None)

    if manga:
        manga["read"] = not manga.get("read", False)
        save_manga_data(manga_data)
        return jsonify({"status": "success", "read": manga["read"]})

    return jsonify({"status": "error"}), 404

@app.route('/manga_bookmark/<int:manga_id>', methods=['POST'])
def manga_bookmark(manga_id):
    manga_data = load_manga_data()
    manga = next((m for m in manga_data if m["id"] == manga_id), None)

    if manga:
        manga["bookmarked"] = not manga.get("bookmarked", False)
        save_manga_data(manga_data)
        return jsonify({"status": "success", "bookmarked": manga["bookmarked"]})

    return jsonify({"status": "error"}), 404

@app.route('/update_manga_link/<int:manga_id>', methods=['POST'])
def update_manga_link(manga_id):
    manga_data = load_manga_data()
    manga = find_by_id(manga_data, manga_id)

    if not manga:
        return jsonify({"status": "error", "message": "Manga not found"}), 404

    payload = request.get_json(silent=True) or {}
    link = payload.get("link", "").strip()

    if not link:
        return jsonify({"status": "error", "message": "Missing link"}), 400

    manga["link"] = link
    save_manga_data(manga_data)

    return jsonify({"status": "success", "link": link})

@app.route('/toggle_manga_status/<int:manga_id>', methods=['POST'])
def toggle_manga_status(manga_id):
    manga_data = load_manga_data()   # same pattern as anime
    manga = next((m for m in manga_data if m['id'] == manga_id), None)

    if not manga:
        return jsonify({'error': 'Manga not found'}), 404

    # Toggle status
    current_status = manga.get('status', 'Ongoing').lower()
    manga['status'] = 'Completed' if current_status == 'ongoing' else 'Ongoing'

    save_manga_data(manga_data)

    return jsonify({
        'status': manga['status']
    })

@app.route('/delete_manga/<int:manga_id>', methods=['DELETE'])
def delete_manga(manga_id):
    manga_data = load_manga_data()
    index = next((i for i, m in enumerate(manga_data) if m["id"] == manga_id), None)

    if index is None:
        return jsonify({"status": "error"}), 404

    title = manga_data[index]["title"]

    for ext in IMAGE_EXTENSION_ORDER:
        for filename in image_filename_candidates(title, ext):
            path = os.path.join(MANGA_IMAGE_FOLDER, filename)
            if os.path.exists(path):
                os.remove(path)
                break

    manga_data.pop(index)
    save_manga_data(manga_data)

    return jsonify({"status": "success"})

def load_anime_data():
    data = read_json_file(DATA_FILE, fallback=os.path.join(BASE_PATH, 'data', 'anime_data.backup.json'))
    new_data = []
    for anime in data:
        if isinstance(anime, str):
            anime = {"title": anime, "bookmarked": False}
        elif "bookmarked" not in anime:
            anime["bookmarked"] = False
        new_data.append(anime)
    new_data.sort(key=lambda anime: anime.get("title", "").lower())
    return new_data

# Save anime data
def save_anime_data(data):
    write_json_file_atomic(DATA_FILE, data, indent=4)

def empty_anime_filter_state():
    return {
        "schema_version": 1,
        "updated_at": None,
        "search": "",
        "quick_filters": {
            "unwatched": False,
            "ongoing": False,
            "bookmarked": False
        },
        "tag_filters": {
            "tags": [],
            "genres": [],
            "themes": [],
            "demographics": []
        },
        "page": 1,
        "items_per_page": 12
    }


def normalize_anime_filter_state(raw_state):
    state = empty_anime_filter_state()
    if not isinstance(raw_state, dict):
        return state

    state["search"] = str(raw_state.get("search") or "")

    quick_filters = raw_state.get("quick_filters") if isinstance(raw_state.get("quick_filters"), dict) else {}
    for key in state["quick_filters"]:
        state["quick_filters"][key] = bool(quick_filters.get(key))

    tag_filters = raw_state.get("tag_filters") if isinstance(raw_state.get("tag_filters"), dict) else {}
    for key in state["tag_filters"]:
        values = tag_filters.get(key, [])
        if isinstance(values, list):
            state["tag_filters"][key] = [str(value) for value in values if str(value).strip()]

    try:
        state["page"] = max(1, int(raw_state.get("page", 1)))
    except (TypeError, ValueError):
        state["page"] = 1

    try:
        state["items_per_page"] = int(raw_state.get("items_per_page", 12))
    except (TypeError, ValueError):
        state["items_per_page"] = 12
    if state["items_per_page"] not in {8, 12, 16, 24}:
        state["items_per_page"] = 12

    return state


def load_anime_filter_state():
    if not os.path.exists(ANIME_FILTER_STATE_FILE):
        return empty_anime_filter_state()
    try:
        return normalize_anime_filter_state(read_json_file(ANIME_FILTER_STATE_FILE))
    except (json.JSONDecodeError, OSError):
        return empty_anime_filter_state()


def save_anime_filter_state(state):
    normalized = normalize_anime_filter_state(state)
    normalized["updated_at"] = utc_now_iso()
    write_json_file_atomic(ANIME_FILTER_STATE_FILE, normalized, indent=4)
    return normalized

def parse_anime_metadata_form():
    return parse_metadata_form(["tags", "genres", "themes", "demographics"])

def missing_anime_metadata_groups(metadata):
    return missing_metadata_groups(metadata, {
        "genres": "Genres",
        "themes": "Themes",
        "demographics": "Demographics",
        "tags": "Tags"
    })

def rebuild_unique_anime_tags(anime_data):
    payload = build_unique_metadata_payload(anime_data, ["tags", "genres", "themes", "demographics"])

    with open(ANIME_TAGS_FILE, "w", encoding="utf-8") as file:
        json.dump(payload, file, indent=4, ensure_ascii=False)

def read_json_file(path, fallback=None):
    try:
        with open(path, "r", encoding="utf-8") as file:
            return json.load(file)
    except (json.JSONDecodeError, OSError):
        if fallback and os.path.exists(fallback):
            with open(fallback, "r", encoding="utf-8") as file:
                return json.load(file)
        raise

def write_json_file_atomic(path, data, **dump_kwargs):
    folder = os.path.dirname(path)
    os.makedirs(folder, exist_ok=True)
    fd, temp_path = tempfile.mkstemp(prefix=f".{os.path.basename(path)}.", suffix=".tmp", dir=folder)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as file:
            json.dump(data, file, **dump_kwargs)
            file.flush()
            os.fsync(file.fileno())
        os.replace(temp_path, path)
    finally:
        if os.path.exists(temp_path):
            os.remove(temp_path)

def utc_now_iso():
    return datetime.now(timezone.utc).isoformat()

def empty_tracking_data():
    return {
        "schema_version": 1,
        "updated_at": None,
        "last_use": {
            "anime_id": None,
            "anime_title": None,
            "episode_number": None,
            "episode_title": None,
            "current_time": 0,
            "total_duration": 0,
            "progress_percentage": 0,
            "last_watched_at": None
        },
        "queue": {
            "updated_at": None,
            "order": []
        },
        "anime": {}
    }

def normalize_tracking_data(data):
    base = empty_tracking_data()
    if not isinstance(data, dict):
        return base

    base.update({key: data.get(key, base[key]) for key in ("schema_version", "updated_at")})
    if isinstance(data.get("last_use"), dict):
        base["last_use"].update(data["last_use"])
    if isinstance(data.get("queue"), dict):
        base["queue"].update(data["queue"])
    if isinstance(data.get("anime"), dict):
        base["anime"] = data["anime"]
    return base

def load_tracking_data():
    if not os.path.exists(TRACKING_FILE):
        return empty_tracking_data()
    try:
        return normalize_tracking_data(read_json_file(TRACKING_FILE))
    except (json.JSONDecodeError, OSError):
        return empty_tracking_data()

def save_tracking_data(data):
    data["updated_at"] = utc_now_iso()
    write_json_file_atomic(TRACKING_FILE, normalize_tracking_data(data), indent=4)

def get_tracking_anime_entry(tracking, anime, create=True):
    anime_key = str(anime["id"])
    if anime_key not in tracking["anime"]:
        if not create:
            return None
        tracking["anime"][anime_key] = {
            "anime_id": anime["id"],
            "anime_title": anime.get("title", "Untitled"),
            "anime_thumbnail": get_anime_image(anime.get("title", "")),
            "watch_status": "Watching",
            "last_watched_episode": None,
            "last_watched_at": None,
            "completion_percentage": 0,
            "episodes": {}
        }

    entry = tracking["anime"][anime_key]
    entry["anime_id"] = anime["id"]
    entry["anime_title"] = anime.get("title", "Untitled")
    entry["anime_thumbnail"] = get_anime_image(anime.get("title", ""))
    entry.setdefault("episodes", {})
    entry.setdefault("watch_status", "Watching")
    return entry

def get_anime_progress_summary(anime, tracking_entry):
    episodes = anime.get("episodes", [])
    total_episodes = len(episodes)
    watched_numbers = {
        episode.get("number")
        for episode in episodes
        if episode.get("watched") is True
    }
    progress_entries = tracking_entry.get("episodes", {}) if tracking_entry else {}
    partial_count = sum(
        1
        for episode in progress_entries.values()
        if not episode.get("completed") and float(episode.get("progress_percentage", 0) or 0) > 0
    )
    completed_count = len(watched_numbers)
    percent = round((completed_count / total_episodes) * 100, 2) if total_episodes else 0
    return {
        "total_episodes": total_episodes,
        "completed_episodes": completed_count,
        "partial_episodes": partial_count,
        "completion_percentage": percent
    }

def prune_tracking_entry(tracking, anime):
    anime_key = str(anime["id"])
    entry = tracking["anime"].get(anime_key)
    if not entry:
        return

    episodes = anime.get("episodes", [])
    valid_episode_numbers = {int(ep.get("number", 0)) for ep in episodes}
    watched_episode_numbers = {
        int(ep.get("number", 0))
        for ep in episodes
        if ep.get("watched") is True
    }

    for episode_key in list(entry.get("episodes", {}).keys()):
        try:
            episode_number = int(episode_key)
        except ValueError:
            entry["episodes"].pop(episode_key, None)
            continue
        progress = entry["episodes"].get(episode_key, {})
        is_complete_progress = progress.get("completed") or float(progress.get("progress_percentage", 0) or 0) >= 90
        if episode_number not in valid_episode_numbers or episode_number in watched_episode_numbers or is_complete_progress:
            entry["episodes"].pop(episode_key, None)

    if anime.get("watched") is True or (episodes and len(watched_episode_numbers) == len(episodes)) or not entry.get("episodes"):
        tracking["anime"].pop(anime_key, None)
        return

    summary = get_anime_progress_summary(anime, entry)
    last_episode = max(
        entry["episodes"].values(),
        key=lambda episode: episode.get("last_watched_at") or "",
        default=None
    )
    entry["completion_percentage"] = summary["completion_percentage"]
    if last_episode:
        entry["last_watched_episode"] = last_episode.get("episode_number")
        entry["last_watched_at"] = last_episode.get("last_watched_at")

def remove_tracking_anime(anime_id):
    tracking = load_tracking_data()
    tracking["anime"].pop(str(anime_id), None)
    if tracking.get("last_use", {}).get("anime_id") == anime_id:
        refresh_tracking_last_use(tracking)
    save_tracking_data(tracking)

def remove_tracking_episode(anime_id, episode_number):
    tracking = load_tracking_data()
    anime_data = load_anime_data()
    anime = next((item for item in anime_data if item.get("id") == anime_id), None)
    entry = tracking["anime"].get(str(anime_id))
    if entry:
        entry.get("episodes", {}).pop(str(episode_number), None)
        if anime:
            prune_tracking_entry(tracking, anime)
        elif not entry.get("episodes"):
            tracking["anime"].pop(str(anime_id), None)
    if (
        tracking.get("last_use", {}).get("anime_id") == anime_id
        and tracking.get("last_use", {}).get("episode_number") == episode_number
    ):
        refresh_tracking_last_use(tracking)
    save_tracking_data(tracking)

def refresh_tracking_last_use(tracking):
    latest = None
    latest_anime = None
    for anime_entry in tracking.get("anime", {}).values():
        for episode in anime_entry.get("episodes", {}).values():
            if latest is None or (episode.get("last_watched_at") or "") > (latest.get("last_watched_at") or ""):
                latest = episode
                latest_anime = anime_entry

    if not latest or not latest_anime:
        tracking["last_use"] = empty_tracking_data()["last_use"]
        return

    tracking["last_use"] = {
        "anime_id": latest_anime.get("anime_id"),
        "anime_title": latest_anime.get("anime_title"),
        "episode_number": latest.get("episode_number"),
        "episode_title": latest.get("episode_title"),
        "current_time": latest.get("current_time", 0),
        "total_duration": latest.get("total_duration", 0),
        "progress_percentage": latest.get("progress_percentage", 0),
        "last_watched_at": latest.get("last_watched_at")
    }

def sync_tracking_queue():
    tracking = load_tracking_data()
    queue = load_queue().get("queue", [])
    tracking["queue"] = {
        "updated_at": utc_now_iso(),
        "order": [
            {
                "position": index + 1,
                "anime_id": item.get("id"),
                "anime_title": item.get("title"),
                "episode_number": item.get("episode", 1)
            }
            for index, item in enumerate(queue)
        ]
    }
    save_tracking_data(tracking)
    return tracking["queue"]

def get_episode_duration_from_tracking(anime_id, episode_number):
    tracking = load_tracking_data()
    episode = (
        tracking.get("anime", {})
        .get(str(anime_id), {})
        .get("episodes", {})
        .get(str(episode_number), {})
    )
    return episode.get("total_duration") if isinstance(episode, dict) else None

def format_duration_label(seconds):
    try:
        total = int(float(seconds or 0))
    except (TypeError, ValueError):
        total = 0
    if total <= 0:
        return "Unknown"
    hours = total // 3600
    minutes = (total % 3600) // 60
    secs = total % 60
    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes}:{secs:02d}"

def build_enriched_queue():
    queue = load_queue().get("queue", [])
    anime_data = load_anime_data()
    tracking = load_tracking_data()
    last_use = tracking.get("last_use", {})
    enriched = []

    for index, item in enumerate(queue):
        anime_id = item.get("id")
        episode_number = int(item.get("episode", 1) or 1)
        anime = next((entry for entry in anime_data if entry.get("id") == anime_id), None)
        episode = None

        if anime:
            episodes = prepare_anime_episodes_for_player(anime)
            episode = next((entry for entry in episodes if entry.get("number") == episode_number), None)

        duration = (
            (episode or {}).get("duration")
            or item.get("duration")
            or get_episode_duration_from_tracking(anime_id, episode_number)
        )

        enriched.append({
            "index": index,
            "position": index + 1,
            "id": anime_id,
            "anime_id": anime_id,
            "title": (anime or {}).get("title") or item.get("title", "Unknown Anime"),
            "anime_title": (anime or {}).get("title") or item.get("title", "Unknown Anime"),
            "season": (anime or {}).get("season", "N/A"),
            "thumbnail_url": get_anime_image((anime or {}).get("title") or item.get("title", "")),
            "episode": episode_number,
            "episode_number": episode_number,
            "episode_title": (episode or {}).get("title") or f"Episode {episode_number}",
            "duration": duration,
            "duration_label": format_duration_label(duration),
            "video_url": (episode or {}).get("video_url"),
            "player_url": url_for("queue_player", index=index),
            "legacy_player_url": url_for("player", index=index) + "?from_queue=true",
            "is_now_playing": (
                last_use.get("anime_id") == anime_id
                and last_use.get("episode_number") == episode_number
            )
        })

    return enriched

def build_continue_watching_items():
    tracking = load_tracking_data()
    anime_data = load_anime_data()
    anime_lookup = {anime.get("id"): anime for anime in anime_data}
    items = []
    for anime_entry in tracking.get("anime", {}).values():
        anime_id = anime_entry.get("anime_id")
        anime = anime_lookup.get(anime_id)
        if not anime:
            continue
        episodes_from_data = prepare_anime_episodes_for_player(anime)
        episodes = [
            episode
            for episode in anime_entry.get("episodes", {}).values()
            if not episode.get("completed")
        ]
        if not episodes:
            continue
        latest_episode = max(episodes, key=lambda episode: episode.get("last_watched_at") or "")
        episode_number = latest_episode.get("episode_number")
        source_episode = next((episode for episode in episodes_from_data if episode.get("number") == episode_number), None)
        adjacent = get_adjacent_episode_context(anime, source_episode) if source_episode else {}
        items.append({
            "anime_id": anime_id,
            "anime_title": anime.get("title") or anime_entry.get("anime_title"),
            "anime_thumbnail": get_anime_image(anime.get("title", "")),
            "watch_status": anime_entry.get("watch_status", "Watching"),
            "episode_number": episode_number,
            "episode_title": (source_episode or {}).get("title") or latest_episode.get("episode_title"),
            "episode_video_url": (source_episode or {}).get("video_url"),
            "previous_episode_number": (adjacent.get("previous_episode") or {}).get("number"),
            "previous_episode_title": (adjacent.get("previous_episode") or {}).get("title"),
            "previous_episode_video_url": adjacent.get("previous_episode_video_url"),
            "next_episode_number": (adjacent.get("next_episode") or {}).get("number"),
            "next_episode_title": (adjacent.get("next_episode") or {}).get("title"),
            "next_episode_video_url": adjacent.get("next_episode_video_url"),
            "current_time": latest_episode.get("current_time", 0),
            "total_duration": latest_episode.get("total_duration", 0),
            "progress_percentage": latest_episode.get("progress_percentage", 0),
            "last_watched_at": latest_episode.get("last_watched_at"),
            "continue_url": url_for(
                "player",
                anime_id=anime_id,
                episode_number=episode_number
            ) + "?resume=1",
            "start_over_url": url_for(
                "player",
                anime_id=anime_id,
                episode_number=episode_number
            ) + "?start_over=1"
        })
    return sorted(items, key=lambda item: item.get("last_watched_at") or "", reverse=True)

def get_episode_tracking_progress(anime_id, episode_number):
    tracking = load_tracking_data()
    episode = (
        tracking.get("anime", {})
        .get(str(anime_id), {})
        .get("episodes", {})
        .get(str(episode_number), {})
    )
    return episode if isinstance(episode, dict) else {}

def get_queue_player_context(index):
    queue_items = build_enriched_queue()
    if not (0 <= index < len(queue_items)):
        return None

    current_item = queue_items[index]
    anime_data = load_anime_data()
    anime = next((item for item in anime_data if item.get("id") == current_item.get("anime_id")), None)
    if not anime:
        return None

    episodes = prepare_anime_episodes_for_player(anime)
    episode = next((item for item in episodes if item.get("number") == current_item.get("episode_number")), None)
    if not episode:
        return None

    previous_item = queue_items[index - 1] if index > 0 else None
    next_item = queue_items[index + 1] if index + 1 < len(queue_items) else None

    return {
        "queue_items": queue_items,
        "queue_index": index,
        "queue_position": index + 1,
        "queue_total": len(queue_items),
        "remaining_count": max(0, len(queue_items) - index - 1),
        "current_item": current_item,
        "previous_item": previous_item,
        "next_item": next_item,
        "anime": anime,
        "episode": episode,
        "saved_progress": {} if request.args.get("start_over") == "1" else get_episode_tracking_progress(anime["id"], episode["number"])
    }


THEME_PRESETS = {
    "soft_pink_glass": "Soft Pink Glass",
    "dark_neon": "Dark Neon",
    "purple_space": "Purple Space",
    "minimal_dark": "Minimal Dark",
    "cream_glass": "Cream Glass",
    "ocean_mist": "Ocean Mist",
    "ember_noir": "Ember Noir",
    "forest_glass": "Forest Glass",
    "sakura_night": "Sakura Night",
    "arctic_blue": "Arctic Blue"
}

THEME_TEXT_COLORS = {"heading_text": "#ffffff", "body_text": "#f8f2f8", "text_color": "#fff8fb", "muted_text": "#d8c5d0", "subtle_text": "#bda7b5", "meta_text": "#bda7b5", "link_text": "#ffe7f1", "nav_text": "#fff8fb", "button_text": "#151018", "accent_button_text": "#151018", "secondary_button_text": "#f8f2f8", "danger_button_text": "#ffffff", "input_text": "#fff8fb", "placeholder_text": "#bda7b5", "card_text": "#f8f2f8", "overlay_text": "#ffffff", "badge_text": "#151018", "chip_text": "#fff8fb", "success_text": "#c9ffd8", "danger_text": "#ffd0dc", "warning_text": "#fff1b8"}

THEME_STYLE_PROFILES = {
    "soft_pink_glass": {
        "panel_style": "Blush glass panels",
        "card_style": "Soft rounded anime cards",
        "button_style": "Cream gradient actions",
        "badge_style": "Pink glow status chips",
        "progress_style": "Rose to cream progress",
        "surface_style": "Light translucent overlays",
        "heading_text": "#ffffff",
        "body_text": "#f8edf4",
        "text_color": "#fff8fb",
        "muted_text": "#e7ccd9",
        "subtle_text": "#cfaebf",
        "meta_text": "#cfaebf",
        "link_text": "#fff1c7",
        "nav_text": "#fff8fb",
        "button_text": "#181016",
        "accent_button_text": "#181016",
        "secondary_button_text": "#f8edf4",
        "danger_button_text": "#ffffff",
        "input_text": "#fff8fb",
        "placeholder_text": "#cfb7c4",
        "card_text": "#f8edf4",
        "overlay_text": "#ffffff",
        "badge_text": "#181016",
        "chip_text": "#fff7fb",
        "success_text": "#c9ffd8",
        "danger_text": "#ffd0dc",
        "warning_text": "#fff1b8"
    },
    "dark_neon": {
        "panel_style": "Deep neon glass panels",
        "card_style": "High contrast media cards",
        "button_style": "Cyan magenta actions",
        "badge_style": "Electric outline chips",
        "progress_style": "Cyan to pink progress",
        "surface_style": "Dark saturated overlays",
        "heading_text": "#f9feff",
        "body_text": "#e6f7ff",
        "text_color": "#f2fbff",
        "muted_text": "#b7d5df",
        "subtle_text": "#8fb3bf",
        "meta_text": "#8fb3bf",
        "link_text": "#7df9ff",
        "nav_text": "#f2fbff",
        "button_text": "#071018",
        "accent_button_text": "#071018",
        "secondary_button_text": "#e6f7ff",
        "danger_button_text": "#ffffff",
        "input_text": "#f2fbff",
        "placeholder_text": "#9dbac5",
        "card_text": "#e6f7ff",
        "overlay_text": "#ffffff",
        "badge_text": "#071018",
        "chip_text": "#eaffff",
        "success_text": "#9fffdc",
        "danger_text": "#ffb4cf",
        "warning_text": "#fff0a6"
    },
    "purple_space": {
        "panel_style": "Violet depth panels",
        "card_style": "Space-tinted preview cards",
        "button_style": "Lavender pink actions",
        "badge_style": "Purple glow chips",
        "progress_style": "Lavender to rose progress",
        "surface_style": "Dim cosmic overlays",
        "heading_text": "#ffffff",
        "body_text": "#f1e9ff",
        "text_color": "#fbf7ff",
        "muted_text": "#d0bee8",
        "subtle_text": "#ad98ca",
        "meta_text": "#ad98ca",
        "link_text": "#e3d4ff",
        "nav_text": "#fbf7ff",
        "button_text": "#160d22",
        "accent_button_text": "#160d22",
        "secondary_button_text": "#f1e9ff",
        "danger_button_text": "#ffffff",
        "input_text": "#fbf7ff",
        "placeholder_text": "#bda9d9",
        "card_text": "#f1e9ff",
        "overlay_text": "#ffffff",
        "badge_text": "#160d22",
        "chip_text": "#fbf7ff",
        "success_text": "#c5ffd9",
        "danger_text": "#ffc6dc",
        "warning_text": "#fff0b0"
    },
    "minimal_dark": {
        "panel_style": "Clean charcoal panels",
        "card_style": "Low-glow dark cards",
        "button_style": "Monochrome actions",
        "badge_style": "Muted status chips",
        "progress_style": "Silver progress",
        "surface_style": "Quiet dark overlays",
        "heading_text": "#ffffff",
        "body_text": "#e8e8ea",
        "text_color": "#f5f5f5",
        "muted_text": "#b9bcc3",
        "subtle_text": "#969aa4",
        "meta_text": "#969aa4",
        "link_text": "#ffffff",
        "nav_text": "#f5f5f5",
        "button_text": "#101114",
        "accent_button_text": "#101114",
        "secondary_button_text": "#e8e8ea",
        "danger_button_text": "#ffffff",
        "input_text": "#f5f5f5",
        "placeholder_text": "#989ca5",
        "card_text": "#e8e8ea",
        "overlay_text": "#ffffff",
        "badge_text": "#101114",
        "chip_text": "#f5f5f5",
        "success_text": "#bfffd2",
        "danger_text": "#ffc4d2",
        "warning_text": "#fff1ad"
    },
    "cream_glass": {
        "panel_style": "Warm cream glass panels",
        "card_style": "Soft warm preview cards",
        "button_style": "Cream pink actions",
        "badge_style": "Warm pastel chips",
        "progress_style": "Cream to pink progress",
        "surface_style": "Warm translucent overlays",
        "heading_text": "#ffffff",
        "body_text": "#f8edd7",
        "text_color": "#fffaf0",
        "muted_text": "#e5d0b0",
        "subtle_text": "#c6a982",
        "meta_text": "#c6a982",
        "link_text": "#fff0b8",
        "nav_text": "#fffaf0",
        "button_text": "#21150d",
        "accent_button_text": "#21150d",
        "secondary_button_text": "#f8edd7",
        "danger_button_text": "#ffffff",
        "input_text": "#fffaf0",
        "placeholder_text": "#c9ad8b",
        "card_text": "#f8edd7",
        "overlay_text": "#ffffff",
        "badge_text": "#21150d",
        "chip_text": "#fffaf0",
        "success_text": "#d8ffca",
        "danger_text": "#ffd0d0",
        "warning_text": "#fff3a8"
    },
    "ocean_mist": {
        "panel_style": "Sea-glass blue panels",
        "card_style": "Cool mist media cards",
        "button_style": "Aqua coral actions",
        "badge_style": "Foam status chips",
        "progress_style": "Aqua to coral progress",
        "surface_style": "Soft coastal overlays",
        "heading_text": "#f8ffff",
        "body_text": "#dff8f7",
        "text_color": "#efffff",
        "muted_text": "#afd4d3",
        "subtle_text": "#88b6b5",
        "meta_text": "#88b6b5",
        "link_text": "#9ffcf5",
        "nav_text": "#efffff",
        "button_text": "#061917",
        "accent_button_text": "#061917",
        "secondary_button_text": "#dff8f7",
        "danger_button_text": "#ffffff",
        "input_text": "#efffff",
        "placeholder_text": "#9bbfc0",
        "card_text": "#dff8f7",
        "overlay_text": "#ffffff",
        "badge_text": "#061917",
        "chip_text": "#efffff",
        "success_text": "#b9ffd7",
        "danger_text": "#ffc7c9",
        "warning_text": "#fff0aa"
    },
    "ember_noir": {
        "panel_style": "Smoked ember panels",
        "card_style": "Charcoal warm cards",
        "button_style": "Amber crimson actions",
        "badge_style": "Ember status chips",
        "progress_style": "Gold to red progress",
        "surface_style": "Warm dark overlays",
        "heading_text": "#fffaf5",
        "body_text": "#f6dfcf",
        "text_color": "#fff2e8",
        "muted_text": "#d7b39d",
        "subtle_text": "#b98e75",
        "meta_text": "#b98e75",
        "link_text": "#ffd39a",
        "nav_text": "#fff2e8",
        "button_text": "#1f0d06",
        "accent_button_text": "#1f0d06",
        "secondary_button_text": "#f6dfcf",
        "danger_button_text": "#ffffff",
        "input_text": "#fff2e8",
        "placeholder_text": "#bf9984",
        "card_text": "#f6dfcf",
        "overlay_text": "#ffffff",
        "badge_text": "#1f0d06",
        "chip_text": "#fff2e8",
        "success_text": "#d5ffbd",
        "danger_text": "#ffd0c7",
        "warning_text": "#fff0a6"
    },
    "forest_glass": {
        "panel_style": "Moss glass panels",
        "card_style": "Deep green media cards",
        "button_style": "Mint fern actions",
        "badge_style": "Leaf status chips",
        "progress_style": "Mint to gold progress",
        "surface_style": "Shaded green overlays",
        "heading_text": "#f8fff9",
        "body_text": "#e0f5e4",
        "text_color": "#effff2",
        "muted_text": "#bad8c1",
        "subtle_text": "#93b49b",
        "meta_text": "#93b49b",
        "link_text": "#b7ffc6",
        "nav_text": "#effff2",
        "button_text": "#07170b",
        "accent_button_text": "#07170b",
        "secondary_button_text": "#e0f5e4",
        "danger_button_text": "#ffffff",
        "input_text": "#effff2",
        "placeholder_text": "#9abb9f",
        "card_text": "#e0f5e4",
        "overlay_text": "#ffffff",
        "badge_text": "#07170b",
        "chip_text": "#effff2",
        "success_text": "#c5ffd6",
        "danger_text": "#ffc8d0",
        "warning_text": "#fff0ad"
    },
    "sakura_night": {
        "panel_style": "Ink sakura panels",
        "card_style": "Night blossom cards",
        "button_style": "Petal moon actions",
        "badge_style": "Sakura status chips",
        "progress_style": "Petal to moon progress",
        "surface_style": "Soft night overlays",
        "heading_text": "#fff8fc",
        "body_text": "#f7dfea",
        "text_color": "#fff0f7",
        "muted_text": "#d8b2c6",
        "subtle_text": "#b98ba5",
        "meta_text": "#b98ba5",
        "link_text": "#ffd7e8",
        "nav_text": "#fff0f7",
        "button_text": "#1d0a15",
        "accent_button_text": "#1d0a15",
        "secondary_button_text": "#f7dfea",
        "danger_button_text": "#ffffff",
        "input_text": "#fff0f7",
        "placeholder_text": "#c49aad",
        "card_text": "#f7dfea",
        "overlay_text": "#ffffff",
        "badge_text": "#1d0a15",
        "chip_text": "#fff0f7",
        "success_text": "#d1ffd6",
        "danger_text": "#ffcbd7",
        "warning_text": "#fff0ad"
    },
    "arctic_blue": {
        "panel_style": "Frosted slate panels",
        "card_style": "Ice edged media cards",
        "button_style": "Glacier lilac actions",
        "badge_style": "Frost status chips",
        "progress_style": "Ice to lilac progress",
        "surface_style": "Crisp cold overlays",
        "heading_text": "#f8fcff",
        "body_text": "#e5f1ff",
        "text_color": "#eff8ff",
        "muted_text": "#b9cde1",
        "subtle_text": "#96abc0",
        "meta_text": "#96abc0",
        "link_text": "#c9e9ff",
        "nav_text": "#eff8ff",
        "button_text": "#081420",
        "accent_button_text": "#081420",
        "secondary_button_text": "#e5f1ff",
        "danger_button_text": "#ffffff",
        "input_text": "#eff8ff",
        "placeholder_text": "#9aafc4",
        "card_text": "#e5f1ff",
        "overlay_text": "#ffffff",
        "badge_text": "#081420",
        "chip_text": "#eff8ff",
        "success_text": "#c9ffdb",
        "danger_text": "#ffc9d8",
        "warning_text": "#fff0ad"
    }
}


# ---------------- Advanced Theme Studio: live element/page color editing ----------------
THEME_VARIABLE_METADATA = [{'key': 'accent', 'css_var': '--theme-accent', 'css_name': 'theme-accent', 'label': 'Primary Accent', 'group': 'Core colors'}, {'key': 'accent_2', 'css_var': '--theme-accent-2', 'css_name': 'theme-accent-2', 'label': 'Secondary Accent', 'group': 'Core colors'}, {'key': 'panel', 'css_var': '--theme-panel', 'css_name': 'theme-panel', 'label': 'Panel Surface', 'group': 'Surfaces'}, {'key': 'panel_strong', 'css_var': '--theme-panel-strong', 'css_name': 'theme-panel-strong', 'label': 'Strong Panel Surface', 'group': 'Surfaces'}, {'key': 'border', 'css_var': '--theme-border', 'css_name': 'theme-border', 'label': 'Borders', 'group': 'Surfaces'}, {'key': 'heading', 'css_var': '--theme-heading', 'css_name': 'theme-heading', 'label': 'Headings', 'group': 'Text colors'}, {'key': 'text', 'css_var': '--theme-text', 'css_name': 'theme-text', 'label': 'Main Text', 'group': 'Text colors'}, {'key': 'body', 'css_var': '--theme-body', 'css_name': 'theme-body', 'label': 'Body Text', 'group': 'Text colors'}, {'key': 'muted', 'css_var': '--theme-muted', 'css_name': 'theme-muted', 'label': 'Muted Text', 'group': 'Text colors'}, {'key': 'subtle', 'css_var': '--theme-subtle', 'css_name': 'theme-subtle', 'label': 'Subtle Text', 'group': 'Text colors'}, {'key': 'meta', 'css_var': '--theme-meta', 'css_name': 'theme-meta', 'label': 'Meta Text', 'group': 'Text colors'}, {'key': 'link', 'css_var': '--theme-link', 'css_name': 'theme-link', 'label': 'Links', 'group': 'Text colors'}, {'key': 'nav_text', 'css_var': '--theme-nav-text', 'css_name': 'theme-nav-text', 'label': 'Navigation Text', 'group': 'Text colors'}, {'key': 'button_text', 'css_var': '--theme-button-text', 'css_name': 'theme-button-text', 'label': 'Primary Button Text', 'group': 'Buttons'}, {'key': 'on_accent', 'css_var': '--theme-on-accent', 'css_name': 'theme-on-accent', 'label': 'Text On Accent', 'group': 'Buttons'}, {'key': 'secondary_button_text', 'css_var': '--theme-secondary-button-text', 'css_name': 'theme-secondary-button-text', 'label': 'Secondary Button Text', 'group': 'Buttons'}, {'key': 'danger_button_text', 'css_var': '--theme-danger-button-text', 'css_name': 'theme-danger-button-text', 'label': 'Danger Button Text', 'group': 'Buttons'}, {'key': 'input_text', 'css_var': '--theme-input-text', 'css_name': 'theme-input-text', 'label': 'Input Text', 'group': 'Forms'}, {'key': 'placeholder', 'css_var': '--theme-placeholder', 'css_name': 'theme-placeholder', 'label': 'Placeholder Text', 'group': 'Forms'}, {'key': 'card_text', 'css_var': '--theme-card-text', 'css_name': 'theme-card-text', 'label': 'Card Text', 'group': 'Cards / overlays'}, {'key': 'overlay_text', 'css_var': '--theme-overlay-text', 'css_name': 'theme-overlay-text', 'label': 'Overlay Text', 'group': 'Cards / overlays'}, {'key': 'badge_text', 'css_var': '--theme-badge-text', 'css_name': 'theme-badge-text', 'label': 'Badge Text', 'group': 'Badges / chips'}, {'key': 'chip_text', 'css_var': '--theme-chip-text', 'css_name': 'theme-chip-text', 'label': 'Chip Text', 'group': 'Badges / chips'}, {'key': 'success_text', 'css_var': '--theme-success-text', 'css_name': 'theme-success-text', 'label': 'Success Text', 'group': 'State colors'}, {'key': 'danger_text', 'css_var': '--theme-danger-text', 'css_name': 'theme-danger-text', 'label': 'Danger Text', 'group': 'State colors'}, {'key': 'warning_text', 'css_var': '--theme-warning-text', 'css_name': 'theme-warning-text', 'label': 'Warning Text', 'group': 'State colors'}]
THEME_VARIABLE_DEFAULTS = {'soft_pink_glass': {'accent': '#ffd4e6', 'accent_2': '#fff1cf', 'panel': 'rgba(255, 232, 243, 0.15)', 'panel_strong': 'rgba(255, 244, 250, 0.22)', 'border': 'rgba(255, 214, 233, 0.36)', 'heading': '#ffffff', 'text': '#fff8fb', 'body': '#f8edf4', 'muted': '#e7ccd9', 'subtle': '#cfaebf', 'meta': '#cfaebf', 'link': '#fff1c7', 'nav_text': '#fff8fb', 'button_text': '#181016', 'on_accent': '#181016', 'secondary_button_text': '#f8edf4', 'danger_button_text': '#ffffff', 'input_text': '#fff8fb', 'placeholder': '#cfb7c4', 'card_text': '#f8edf4', 'overlay_text': '#ffffff', 'badge_text': '#181016', 'chip_text': '#fff7fb', 'success_text': '#c9ffd8', 'danger_text': '#ffd0dc', 'warning_text': '#fff1b8'}, 'dark_neon': {'accent': '#7df9ff', 'accent_2': '#ff7af5', 'panel': 'rgba(8, 20, 34, 0.58)', 'panel_strong': 'rgba(18, 33, 56, 0.72)', 'border': 'rgba(125, 249, 255, 0.28)', 'heading': '#f9feff', 'text': '#f2fbff', 'body': '#e6f7ff', 'muted': '#b7d5df', 'subtle': '#8fb3bf', 'meta': '#8fb3bf', 'link': '#7df9ff', 'nav_text': '#f2fbff', 'button_text': '#071018', 'on_accent': '#071018', 'secondary_button_text': '#e6f7ff', 'danger_button_text': '#ffffff', 'input_text': '#f2fbff', 'placeholder': '#9dbac5', 'card_text': '#e6f7ff', 'overlay_text': '#ffffff', 'badge_text': '#071018', 'chip_text': '#eaffff', 'success_text': '#9fffdc', 'danger_text': '#ffb4cf', 'warning_text': '#fff0a6'}, 'purple_space': {'accent': '#c7a4ff', 'accent_2': '#ffb3df', 'panel': 'rgba(42, 20, 66, 0.50)', 'panel_strong': 'rgba(71, 36, 102, 0.64)', 'border': 'rgba(209, 177, 255, 0.30)', 'heading': '#ffffff', 'text': '#fbf7ff', 'body': '#f1e9ff', 'muted': '#d0bee8', 'subtle': '#ad98ca', 'meta': '#ad98ca', 'link': '#e3d4ff', 'nav_text': '#fbf7ff', 'button_text': '#160d22', 'on_accent': '#160d22', 'secondary_button_text': '#f1e9ff', 'danger_button_text': '#ffffff', 'input_text': '#fbf7ff', 'placeholder': '#bda9d9', 'card_text': '#f1e9ff', 'overlay_text': '#ffffff', 'badge_text': '#160d22', 'chip_text': '#fbf7ff', 'success_text': '#c5ffd9', 'danger_text': '#ffc6dc', 'warning_text': '#fff0b0'}, 'minimal_dark': {'accent': '#d8d8d8', 'accent_2': '#ffffff', 'panel': 'rgba(14, 15, 18, 0.72)', 'panel_strong': 'rgba(24, 25, 30, 0.82)', 'border': 'rgba(255, 255, 255, 0.16)', 'heading': '#ffffff', 'text': '#f5f5f5', 'body': '#e8e8ea', 'muted': '#b9bcc3', 'subtle': '#969aa4', 'meta': '#969aa4', 'link': '#ffffff', 'nav_text': '#f5f5f5', 'button_text': '#101114', 'on_accent': '#101114', 'secondary_button_text': '#e8e8ea', 'danger_button_text': '#ffffff', 'input_text': '#f5f5f5', 'placeholder': '#989ca5', 'card_text': '#e8e8ea', 'overlay_text': '#ffffff', 'badge_text': '#101114', 'chip_text': '#f5f5f5', 'success_text': '#bfffd2', 'danger_text': '#ffc4d2', 'warning_text': '#fff1ad'}, 'cream_glass': {'accent': '#ffe4b6', 'accent_2': '#ffc4d9', 'panel': 'rgba(255, 240, 209, 0.15)', 'panel_strong': 'rgba(255, 249, 232, 0.24)', 'border': 'rgba(255, 232, 184, 0.32)', 'heading': '#ffffff', 'text': '#fffaf0', 'body': '#f8edd7', 'muted': '#e5d0b0', 'subtle': '#c6a982', 'meta': '#c6a982', 'link': '#fff0b8', 'nav_text': '#fffaf0', 'button_text': '#21150d', 'on_accent': '#21150d', 'secondary_button_text': '#f8edd7', 'danger_button_text': '#ffffff', 'input_text': '#fffaf0', 'placeholder': '#c9ad8b', 'card_text': '#f8edd7', 'overlay_text': '#ffffff', 'badge_text': '#21150d', 'chip_text': '#fffaf0', 'success_text': '#d8ffca', 'danger_text': '#ffd0d0', 'warning_text': '#fff3a8'}, 'ocean_mist': {'accent': '#8df7ee', 'accent_2': '#ffb3a3', 'panel': 'rgba(8, 45, 58, 0.46)', 'panel_strong': 'rgba(18, 74, 88, 0.62)', 'border': 'rgba(141, 247, 238, 0.28)', 'heading': '#f8ffff', 'text': '#efffff', 'body': '#dff8f7', 'muted': '#afd4d3', 'subtle': '#88b6b5', 'meta': '#88b6b5', 'link': '#9ffcf5', 'nav_text': '#efffff', 'button_text': '#061917', 'on_accent': '#061917', 'secondary_button_text': '#dff8f7', 'danger_button_text': '#ffffff', 'input_text': '#efffff', 'placeholder': '#9bbfc0', 'card_text': '#dff8f7', 'overlay_text': '#ffffff', 'badge_text': '#061917', 'chip_text': '#efffff', 'success_text': '#b9ffd7', 'danger_text': '#ffc7c9', 'warning_text': '#fff0aa'}, 'ember_noir': {'accent': '#ffbf7a', 'accent_2': '#ff6b6b', 'panel': 'rgba(40, 18, 10, 0.58)', 'panel_strong': 'rgba(76, 34, 18, 0.70)', 'border': 'rgba(255, 177, 104, 0.30)', 'heading': '#fffaf5', 'text': '#fff2e8', 'body': '#f6dfcf', 'muted': '#d7b39d', 'subtle': '#b98e75', 'meta': '#b98e75', 'link': '#ffd39a', 'nav_text': '#fff2e8', 'button_text': '#1f0d06', 'on_accent': '#1f0d06', 'secondary_button_text': '#f6dfcf', 'danger_button_text': '#ffffff', 'input_text': '#fff2e8', 'placeholder': '#bf9984', 'card_text': '#f6dfcf', 'overlay_text': '#ffffff', 'badge_text': '#1f0d06', 'chip_text': '#fff2e8', 'success_text': '#d5ffbd', 'danger_text': '#ffd0c7', 'warning_text': '#fff0a6'}, 'forest_glass': {'accent': '#9ff2b2', 'accent_2': '#e7d58b', 'panel': 'rgba(12, 38, 24, 0.52)', 'panel_strong': 'rgba(28, 70, 43, 0.66)', 'border': 'rgba(159, 242, 178, 0.28)', 'heading': '#f8fff9', 'text': '#effff2', 'body': '#e0f5e4', 'muted': '#bad8c1', 'subtle': '#93b49b', 'meta': '#93b49b', 'link': '#b7ffc6', 'nav_text': '#effff2', 'button_text': '#07170b', 'on_accent': '#07170b', 'secondary_button_text': '#e0f5e4', 'danger_button_text': '#ffffff', 'input_text': '#effff2', 'placeholder': '#9abb9f', 'card_text': '#e0f5e4', 'overlay_text': '#ffffff', 'badge_text': '#07170b', 'chip_text': '#effff2', 'success_text': '#c5ffd6', 'danger_text': '#ffc8d0', 'warning_text': '#fff0ad'}, 'sakura_night': {'accent': '#ffb3d1', 'accent_2': '#f7e6a6', 'panel': 'rgba(42, 18, 38, 0.54)', 'panel_strong': 'rgba(76, 32, 65, 0.68)', 'border': 'rgba(255, 179, 209, 0.32)', 'heading': '#fff8fc', 'text': '#fff0f7', 'body': '#f7dfea', 'muted': '#d8b2c6', 'subtle': '#b98ba5', 'meta': '#b98ba5', 'link': '#ffd7e8', 'nav_text': '#fff0f7', 'button_text': '#1d0a15', 'on_accent': '#1d0a15', 'secondary_button_text': '#f7dfea', 'danger_button_text': '#ffffff', 'input_text': '#fff0f7', 'placeholder': '#c49aad', 'card_text': '#f7dfea', 'overlay_text': '#ffffff', 'badge_text': '#1d0a15', 'chip_text': '#fff0f7', 'success_text': '#d1ffd6', 'danger_text': '#ffcbd7', 'warning_text': '#fff0ad'}, 'arctic_blue': {'accent': '#b5e2ff', 'accent_2': '#c9b8ff', 'panel': 'rgba(14, 31, 50, 0.58)', 'panel_strong': 'rgba(27, 52, 78, 0.72)', 'border': 'rgba(181, 226, 255, 0.28)', 'heading': '#f8fcff', 'text': '#eff8ff', 'body': '#e5f1ff', 'muted': '#b9cde1', 'subtle': '#96abc0', 'meta': '#96abc0', 'link': '#c9e9ff', 'nav_text': '#eff8ff', 'button_text': '#081420', 'on_accent': '#081420', 'secondary_button_text': '#e5f1ff', 'danger_button_text': '#ffffff', 'input_text': '#eff8ff', 'placeholder': '#9aafc4', 'card_text': '#e5f1ff', 'overlay_text': '#ffffff', 'badge_text': '#081420', 'chip_text': '#eff8ff', 'success_text': '#c9ffdb', 'danger_text': '#ffc9d8', 'warning_text': '#fff0ad'}}

# Single-source theme roles added for exact page previews and grouped controls.
_EXTRA_THEME_VARIABLES = [
    {"key": "pagination_panel", "css_var": "--theme-pagination-panel", "css_name": "theme-pagination-panel", "label": "Pagination Panel", "group": "Pagination"},
    {"key": "pagination_button_bg", "css_var": "--theme-pagination-button-bg", "css_name": "theme-pagination-button-bg", "label": "Pagination Button Background", "group": "Pagination"},
    {"key": "pagination_button_text", "css_var": "--theme-pagination-button-text", "css_name": "theme-pagination-button-text", "label": "Pagination Button Text", "group": "Pagination"},
    {"key": "pagination_active_bg", "css_var": "--theme-pagination-active-bg", "css_name": "theme-pagination-active-bg", "label": "Pagination Active Background", "group": "Pagination"},
    {"key": "pagination_active_text", "css_var": "--theme-pagination-active-text", "css_name": "theme-pagination-active-text", "label": "Pagination Active Text", "group": "Pagination"},
    {"key": "pagination_info_text", "css_var": "--theme-pagination-info-text", "css_name": "theme-pagination-info-text", "label": "Pagination Info Text", "group": "Pagination"},
    {"key": "button_bg", "css_var": "--theme-button-bg", "css_name": "theme-button-bg", "label": "Primary Button Background", "group": "Buttons"},
    {"key": "secondary_button_bg", "css_var": "--theme-secondary-button-bg", "css_name": "theme-secondary-button-bg", "label": "Secondary Button Background", "group": "Buttons"},
    {"key": "card_bg", "css_var": "--theme-card-bg", "css_name": "theme-card-bg", "label": "Card Background", "group": "Cards / overlays"},
    {"key": "input_bg", "css_var": "--theme-input-bg", "css_name": "theme-input-bg", "label": "Input Background", "group": "Forms"},
    {"key": "danger_bg", "css_var": "--theme-danger-bg", "css_name": "theme-danger-bg", "label": "Danger Background", "group": "State colors"},
    {"key": "success_bg", "css_var": "--theme-success-bg", "css_name": "theme-success-bg", "label": "Success Background", "group": "State colors"},
    {"key": "warning_bg", "css_var": "--theme-warning-bg", "css_name": "theme-warning-bg", "label": "Warning Background", "group": "State colors"}
]
_existing_theme_variable_keys = {item["key"] for item in THEME_VARIABLE_METADATA}
for _item in _EXTRA_THEME_VARIABLES:
    if _item["key"] not in _existing_theme_variable_keys:
        THEME_VARIABLE_METADATA.append(_item)
        _existing_theme_variable_keys.add(_item["key"])

_EXTRA_DEFAULTS = {
    "pagination_panel": "var(--theme-panel)",
    "pagination_button_bg": "var(--theme-button-bg)",
    "pagination_button_text": "var(--theme-button-text)",
    "pagination_active_bg": "var(--theme-accent)",
    "pagination_active_text": "var(--theme-on-accent)",
    "pagination_info_text": "var(--theme-muted)",
    "button_bg": "var(--theme-accent)",
    "secondary_button_bg": "var(--theme-panel-strong)",
    "card_bg": "var(--theme-panel-strong)",
    "input_bg": "rgba(0, 0, 0, 0.32)",
    "danger_bg": "rgba(255, 88, 116, 0.28)",
    "success_bg": "rgba(100, 255, 166, 0.22)",
    "warning_bg": "rgba(255, 211, 99, 0.22)"
}
for _theme_defaults in THEME_VARIABLE_DEFAULTS.values():
    _theme_defaults.setdefault("button_bg", _theme_defaults.get("accent", "#ffffff"))
    _theme_defaults.setdefault("secondary_button_bg", _theme_defaults.get("panel_strong", "rgba(255,255,255,.14)"))
    _theme_defaults.setdefault("card_bg", _theme_defaults.get("panel_strong", "rgba(255,255,255,.14)"))
    _theme_defaults.setdefault("input_bg", "rgba(0,0,0,.34)")
    _theme_defaults.setdefault("pagination_panel", _theme_defaults.get("panel", "rgba(255,255,255,.12)"))
    _theme_defaults.setdefault("pagination_button_bg", _theme_defaults.get("accent", "#ffffff"))
    _theme_defaults.setdefault("pagination_button_text", _theme_defaults.get("on_accent", _theme_defaults.get("button_text", "#111111")))
    _theme_defaults.setdefault("pagination_active_bg", _theme_defaults.get("accent_2", _theme_defaults.get("accent", "#ffffff")))
    _theme_defaults.setdefault("pagination_active_text", _theme_defaults.get("on_accent", _theme_defaults.get("button_text", "#111111")))
    _theme_defaults.setdefault("pagination_info_text", _theme_defaults.get("muted", "#e5e7eb"))
    _theme_defaults.setdefault("danger_bg", "rgba(255, 88, 116, 0.28)")
    _theme_defaults.setdefault("success_bg", "rgba(100, 255, 166, 0.22)")
    _theme_defaults.setdefault("warning_bg", "rgba(255, 211, 99, 0.22)")

THEME_VARIABLE_KEYS = [item["key"] for item in THEME_VARIABLE_METADATA]
THEME_VARIABLE_CSS_MAP = {item["key"]: item["css_var"] for item in THEME_VARIABLE_METADATA}

# Merge the CSS-derived variables into the descriptive profiles used by Theme Studio.
for _theme_key, _variables in THEME_VARIABLE_DEFAULTS.items():
    if _theme_key in THEME_STYLE_PROFILES:
        THEME_STYLE_PROFILES[_theme_key].update(_variables)

def sanitize_color_value(value, fallback="#ffffff"):
    value = str(value or "").strip()
    if re.match(r"^#[0-9a-fA-F]{3}(?:[0-9a-fA-F]{3})?$", value):
        return value
    if re.match(r"^rgba?\([0-9.,%\s]+\)$", value):
        return value
    if re.match(r"^hsla?\([0-9.,%\s]+\)$", value):
        return value
    if value.startswith("color-mix(") or value.startswith("linear-gradient("):
        return value
    return fallback

def normalize_theme_variables(payload, fallback_profile=None):
    fallback_profile = fallback_profile or {}
    if not isinstance(payload, dict):
        payload = {}
    normalized = {}
    for item in THEME_VARIABLE_METADATA:
        key = item["key"]
        fallback = fallback_profile.get(key) or THEME_VARIABLE_DEFAULTS.get("soft_pink_glass", {}).get(key, "#ffffff")
        normalized[key] = sanitize_color_value(payload.get(key, fallback), fallback)
    return normalized

def normalize_override_variables(payload):
    if not isinstance(payload, dict):
        return {}
    normalized = {}
    for key, value in payload.items():
        if key in THEME_VARIABLE_KEYS:
            normalized[key] = sanitize_color_value(value, "#ffffff")
        elif isinstance(key, str) and key.startswith("custom_"):
            normalized[key] = sanitize_color_value(value, "#ffffff")
    return normalized

def build_css_variable_string(variable_values):
    pairs = []
    if not isinstance(variable_values, dict):
        return ""
    for key, value in variable_values.items():
        css_var = THEME_VARIABLE_CSS_MAP.get(key)
        if not css_var:
            css_var = "--theme-custom-" + re.sub(r"[^a-zA-Z0-9_-]", "-", key.replace("custom_", "")).strip("-").lower()
        pairs.append(f"{css_var}: {value};")
    return " ".join(pairs)

def get_active_theme_variables(settings, section_key=None):
    section_key = section_key or get_current_section_key()
    active_theme = settings["theme"] if settings.get("same_theme_everywhere") else settings.get("section_themes", {}).get(section_key, settings["theme"])
    profile = normalize_theme_variables(settings.get("theme_profiles", {}).get(active_theme), THEME_STYLE_PROFILES.get(active_theme, {}))
    variables = dict(profile)
    variables.update(normalize_override_variables(settings.get("global_overrides", {})))
    variables.update(normalize_override_variables(settings.get("page_overrides", {}).get(section_key, {})))
    return variables

SECTION_THEME_KEYS = [
    "home", "anime", "manga", "queue", "player", "details", "add", "sections", "settings"
]

ALLOWED_BACKGROUND_EXTENSIONS = {"mp4", "webm", "jpg", "jpeg", "png", "webp", "gif"}

WATCH_STATUS_OPTIONS = [
    "Not Started",
    "Plan to Watch",
    "Watching",
    "On Hold",
    "Dropped",
    "Rewatching",
    "Completed"
]


def normalize_watch_status(value, fallback="Not Started"):
    if value is None and fallback is None:
        return None
    value = str(value or fallback or "").strip()
    return value if value in WATCH_STATUS_OPTIONS else fallback


def get_anime_tracking_context(anime):
    tracking = load_tracking_data()
    entry = get_tracking_anime_entry(tracking, anime, create=False)
    summary = get_anime_progress_summary(anime, entry)
    return tracking, entry, summary


def enrich_episode_progress(anime, tracking_entry):
    progress_entries = (tracking_entry or {}).get("episodes", {})
    for episode in anime.get("episodes", []):
        progress = progress_entries.get(str(episode.get("number")), {})
        episode["tracking"] = progress if isinstance(progress, dict) else {}
        episode["progress_percentage"] = float(episode["tracking"].get("progress_percentage", 0) or 0)
        episode["current_time_label"] = format_duration_label(episode["tracking"].get("current_time", 0))
        episode["duration_label"] = format_duration_label(episode["tracking"].get("total_duration", 0))
        episode["has_resume"] = (not episode.get("watched")) and episode["progress_percentage"] > 0
    return anime


def empty_theme_settings():
    return {
        "schema_version": 1,
        "theme": "soft_pink_glass",
        "dark_mode": False,
        "same_theme_everywhere": True,
        "section_themes": {key: "soft_pink_glass" for key in SECTION_THEME_KEYS},
        "background": {
            "mode": "default_video",
            "url": "/static/images/stars.mp4",
            "type": "video"
        },
        "theme_profiles": {key: profile.copy() for key, profile in THEME_STYLE_PROFILES.items()},
        "global_overrides": {},
        "page_overrides": {key: {} for key in SECTION_THEME_KEYS},
        "updated_at": None
    }


def normalize_theme_name(value):
    value = (value or "soft_pink_glass").strip()
    return value if value in THEME_PRESETS else "soft_pink_glass"


def normalize_theme_settings(data):
    base = empty_theme_settings()
    if not isinstance(data, dict):
        return base

    base["theme"] = normalize_theme_name(data.get("theme"))
    base["dark_mode"] = bool(data.get("dark_mode", False))
    base["same_theme_everywhere"] = bool(data.get("same_theme_everywhere", True))

    section_themes = data.get("section_themes") if isinstance(data.get("section_themes"), dict) else {}
    base["section_themes"] = {
        key: normalize_theme_name(section_themes.get(key, base["theme"]))
        for key in SECTION_THEME_KEYS
    }

    background = data.get("background") if isinstance(data.get("background"), dict) else {}
    mode = background.get("mode", base["background"]["mode"])
    if mode not in {"default_video", "uploaded_video", "uploaded_image", "solid", "none"}:
        mode = "default_video"
    url = background.get("url") or base["background"]["url"]
    media_type = background.get("type") or ("image" if mode == "uploaded_image" else "video")
    base["background"] = {"mode": mode, "url": url, "type": media_type}

    saved_profiles = data.get("theme_profiles") if isinstance(data.get("theme_profiles"), dict) else {}
    base["theme_profiles"] = {}
    for theme_key, default_profile in THEME_STYLE_PROFILES.items():
        saved_profile = saved_profiles.get(theme_key) if isinstance(saved_profiles.get(theme_key), dict) else {}
        profile = default_profile.copy()
        profile.update({
            key: str(value)
            for key, value in saved_profile.items()
            if key in default_profile or key in THEME_VARIABLE_KEYS
        })
        profile.update(normalize_theme_variables(profile, default_profile))
        base["theme_profiles"][theme_key] = profile

    base["global_overrides"] = normalize_override_variables(data.get("global_overrides"))
    saved_page_overrides = data.get("page_overrides") if isinstance(data.get("page_overrides"), dict) else {}
    base["page_overrides"] = {
        key: normalize_override_variables(saved_page_overrides.get(key, {}))
        for key in SECTION_THEME_KEYS
    }

    base["updated_at"] = data.get("updated_at")
    return base


def load_theme_settings():
    if not os.path.exists(THEME_SETTINGS_FILE):
        return empty_theme_settings()
    try:
        return normalize_theme_settings(read_json_file(THEME_SETTINGS_FILE))
    except (json.JSONDecodeError, OSError):
        return empty_theme_settings()


def save_theme_settings(settings):
    settings = normalize_theme_settings(settings)
    settings["updated_at"] = utc_now_iso()
    write_json_file_atomic(THEME_SETTINGS_FILE, settings, indent=4)
    return settings


def get_current_section_key():
    endpoint = request.endpoint or ""
    path = request.path.strip("/")
    if endpoint in {"hub"} or path == "":
        return "home"
    if "queue" in endpoint or path.startswith("queue"):
        return "queue"
    if "player" in endpoint:
        return "player"
    if endpoint in {"anime_detail"}:
        return "details"
    if endpoint in {"add_anime", "add_manga", "add_section_item"}:
        return "add"
    if path.startswith("manga"):
        return "manga"
    if path.startswith("anime"):
        return "anime"
    if endpoint == "section_index" or endpoint == "section_detail":
        return "sections"
    if endpoint == "settings_page":
        return "settings"
    return "anime"


def allowed_background_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_BACKGROUND_EXTENSIONS


@app.context_processor
def inject_theme_settings():
    settings = load_theme_settings()
    section_key = get_current_section_key()
    active_theme = settings["theme"] if settings.get("same_theme_everywhere") else settings.get("section_themes", {}).get(section_key, settings["theme"])
    return {
        "theme_settings": settings,
        "theme_presets": THEME_PRESETS,
        "theme_style_profiles": settings.get("theme_profiles", THEME_STYLE_PROFILES),
        "theme_variable_metadata": THEME_VARIABLE_METADATA,
        "theme_css_overrides": build_css_variable_string(get_active_theme_variables(settings, section_key)),
        "section_theme_keys": SECTION_THEME_KEYS,
        "active_theme": active_theme,
        "active_section_key": section_key
    }



def build_theme_preview_urls():
    preview = {
        "home": url_for("hub") + "?theme_preview=1",
        "anime": url_for("index") + "?theme_preview=1",
        "manga": url_for("manga_index") + "?theme_preview=1",
        "queue": url_for("queue_page") + "?theme_preview=1",
        "settings": url_for("theme_settings_preview_page") + "?theme_preview=1"
    }
    preview["add"] = url_for("add_anime") + "?theme_preview=1"
    preview["sections"] = url_for("hub") + "?theme_preview=1"

    try:
        anime_data = load_anime_data()
        first_anime = anime_data[0] if anime_data else None
        if first_anime:
            preview["details"] = url_for("anime_detail", anime_id=first_anime.get("id")) + "?theme_preview=1"
            episodes = first_anime.get("episodes", [])
            first_episode = episodes[0] if episodes else None
            if first_episode:
                preview["player"] = url_for("player", anime_id=first_anime.get("id"), episode_number=first_episode.get("number", 1)) + "?theme_preview=1"
            else:
                preview["player"] = preview["details"]
        else:
            preview["details"] = preview["anime"]
            preview["player"] = preview["anime"]
    except Exception:
        preview["details"] = preview["anime"]
        preview["player"] = preview["anime"]

    return preview


@app.route('/theme-preview/settings')
def theme_settings_preview_page():
    return render_template("settings_preview.html")

@app.route('/settings')
def settings_page():
    return render_template("settings.html", theme_preview_urls=build_theme_preview_urls())


@app.route('/api/theme', methods=['GET', 'POST'])
def api_theme_settings():
    if request.method == 'GET':
        return jsonify(load_theme_settings())

    payload = request.get_json(silent=True) or {}
    current = load_theme_settings()
    current["theme"] = normalize_theme_name(payload.get("theme", current["theme"]))
    current["dark_mode"] = bool(payload.get("dark_mode", current["dark_mode"]))
    current["same_theme_everywhere"] = bool(payload.get("same_theme_everywhere", current["same_theme_everywhere"]))

    if isinstance(payload.get("section_themes"), dict):
        current["section_themes"].update({
            key: normalize_theme_name(value)
            for key, value in payload["section_themes"].items()
            if key in SECTION_THEME_KEYS
        })

    if isinstance(payload.get("background"), dict):
        background = payload["background"]
        current["background"].update({
            key: background[key]
            for key in ["mode", "url", "type"]
            if key in background
        })
        mode = current["background"].get("mode")
        if mode == "default_video":
            current["background"] = {"mode": "default_video", "url": "/static/images/stars.mp4", "type": "video"}
        elif mode == "solid":
            current["background"]["type"] = "none"
        elif mode == "none":
            current["background"]["type"] = "none"

    if isinstance(payload.get("theme_profiles"), dict):
        for theme_key, profile in payload["theme_profiles"].items():
            if theme_key in THEME_STYLE_PROFILES and isinstance(profile, dict):
                current.setdefault("theme_profiles", {}).setdefault(theme_key, THEME_STYLE_PROFILES[theme_key].copy())
                current["theme_profiles"][theme_key].update({
                    key: str(value)
                    for key, value in profile.items()
                    if key in THEME_STYLE_PROFILES[theme_key] or key in THEME_VARIABLE_KEYS
                })

    if isinstance(payload.get("global_overrides"), dict):
        current["global_overrides"] = normalize_override_variables(payload.get("global_overrides"))

    if isinstance(payload.get("page_overrides"), dict):
        current.setdefault("page_overrides", {key: {} for key in SECTION_THEME_KEYS})
        for section_key, overrides in payload["page_overrides"].items():
            if section_key in SECTION_THEME_KEYS:
                current["page_overrides"][section_key] = normalize_override_variables(overrides)

    saved = save_theme_settings(current)
    return jsonify({"status": "success", "settings": saved})


@app.route('/api/theme/background', methods=['POST'])
def api_upload_theme_background():
    file_storage = request.files.get("background")
    if not file_storage or not file_storage.filename:
        return jsonify({"status": "error", "message": "No background file selected"}), 400
    if not allowed_background_file(file_storage.filename):
        return jsonify({"status": "error", "message": "Unsupported background file type"}), 400

    os.makedirs(THEME_UPLOAD_FOLDER, exist_ok=True)
    original = secure_filename(file_storage.filename)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")
    filename = f"bg_{stamp}_{original}"
    file_path = os.path.join(THEME_UPLOAD_FOLDER, filename)
    file_storage.save(file_path)

    extension = filename.rsplit(".", 1)[1].lower()
    media_type = "video" if extension in {"mp4", "webm"} else "image"
    url = f"/static/theme_uploads/{filename}"

    settings = load_theme_settings()
    settings["background"] = {
        "mode": "uploaded_video" if media_type == "video" else "uploaded_image",
        "url": url,
        "type": media_type
    }
    save_theme_settings(settings)

    return jsonify({"status": "success", "url": url, "type": media_type, "settings": settings})

@app.route('/')
def hub():
    sections = load_sections()
    return render_template("hub.html", sections=sections)

@app.route('/anime')
def index():
    return render_template("index.html", global_queue=build_enriched_queue())

def get_anime_image(title):
    for ext in IMAGE_EXTENSION_ORDER:
        for filename in image_filename_candidates(title, ext):
            filepath = os.path.join(IMAGE_FOLDER, filename)
            if os.path.exists(filepath):
                return f"/static/anime_images/{filename}"
    return DEFAULT_IMAGE

@app.route('/api/anime')
def api_anime():
    anime_data = load_anime_data()
    for anime in anime_data:
        anime["thumbnail_url"] = get_anime_image(anime["title"])
    return jsonify(anime_data)


@app.route('/api/anime-filter-state', methods=['GET'])
def api_get_anime_filter_state():
    return jsonify(load_anime_filter_state())


@app.route('/api/anime-filter-state', methods=['POST'])
def api_save_anime_filter_state():
    payload = request.get_json(silent=True) or {}
    return jsonify(save_anime_filter_state(payload))

@app.route('/api/anime-tags')
def api_anime_tags():
    if os.path.exists(ANIME_TAGS_FILE):
        with open(ANIME_TAGS_FILE, 'r', encoding='utf-8') as file:
            return jsonify(json.load(file))

    anime_data = load_anime_data()
    groups = {"tags": {}, "genres": {}, "themes": {}, "demographics": {}}

    for anime in anime_data:
        for group in groups:
            for value in anime.get(group, []) or []:
                groups[group][value] = groups[group].get(value, 0) + 1

    return jsonify({
        "summary": {f"unique_{group}": len(values) for group, values in groups.items()},
        **{
            group: [
                {"name": name, "count": count}
                for name, count in sorted(values.items(), key=lambda item: (-item[1], item[0].lower()))
            ]
            for group, values in groups.items()
        }
    })

@app.route('/api/tracking')
def api_tracking():
    return jsonify(load_tracking_data())

@app.route('/api/tracking/continue-watching')
def api_continue_watching():
    return jsonify({"items": build_continue_watching_items()})

@app.route('/api/tracking/progress', methods=['POST'])
def api_save_episode_progress():
    payload = request.get_json(silent=True) or {}
    anime_id = payload.get("anime_id")
    episode_number = payload.get("episode_number")

    try:
        anime_id = int(anime_id)
        episode_number = int(episode_number)
    except (TypeError, ValueError):
        return jsonify({"status": "error", "message": "Missing anime_id or episode_number"}), 400

    anime_data = load_anime_data()
    anime = next((item for item in anime_data if item.get("id") == anime_id), None)
    if not anime:
        return jsonify({"status": "error", "message": "Anime not found"}), 404

    episode = next((item for item in anime.get("episodes", []) if item.get("number") == episode_number), None)
    if not episode:
        return jsonify({"status": "error", "message": "Episode not found"}), 404

    current_time = max(0, float(payload.get("current_time") or 0))
    total_duration = max(0, float(payload.get("total_duration") or 0))
    progress_percentage = round(min(100, (current_time / total_duration) * 100), 2) if total_duration else 0
    completed = bool(payload.get("completed")) or (total_duration > 0 and progress_percentage >= 90)
    now = utc_now_iso()

    tracking = load_tracking_data()
    entry = get_tracking_anime_entry(tracking, anime)
    anime_data_changed = False

    if completed:
        episode["watched"] = True
        anime_data_changed = True
        entry.get("episodes", {}).pop(str(episode_number), None)
    elif current_time > 1:
        entry["episodes"][str(episode_number)] = {
            "episode_number": episode_number,
            "episode_title": episode.get("title") or f"Episode {episode_number}",
            "episode_video_path": episode.get("file_path"),
            "current_time": round(current_time, 2),
            "total_duration": round(total_duration, 2),
            "progress_percentage": progress_percentage,
            "completed": False,
            "active_continue": True,
            "last_watched_at": now
        }
        entry["watch_status"] = "Watching"
        entry["last_watched_episode"] = episode_number
        entry["last_watched_at"] = now

    watched_episode_count = sum(1 for item in anime.get("episodes", []) if item.get("watched") is True)
    if anime.get("episodes") and watched_episode_count == len(anime.get("episodes", [])):
        if anime.get("watched") is not True:
            anime["watched"] = True
            anime_data_changed = True

    prune_tracking_entry(tracking, anime)
    tracking["last_use"] = {
        "anime_id": anime_id,
        "anime_title": anime.get("title"),
        "episode_number": episode_number,
        "episode_title": episode.get("title") or f"Episode {episode_number}",
        "current_time": round(current_time, 2),
        "total_duration": round(total_duration, 2),
        "progress_percentage": progress_percentage,
        "last_watched_at": now
    }

    if anime_data_changed:
        save_anime_data(anime_data)
    save_tracking_data(tracking)
    return jsonify({
        "status": "success",
        "completed": completed,
        "progress_percentage": progress_percentage,
        "continue_watching": build_continue_watching_items()
    })

@app.route('/api/tracking/discard', methods=['POST'])
def api_discard_continue_watching():
    payload = request.get_json(silent=True) or {}
    try:
        anime_id = int(payload.get("anime_id"))
        episode_number = int(payload.get("episode_number")) if payload.get("episode_number") is not None else None
    except (TypeError, ValueError):
        return jsonify({"status": "error", "message": "Missing anime_id"}), 400

    tracking = load_tracking_data()
    entry = tracking["anime"].get(str(anime_id))
    if entry:
        if episode_number is None:
            tracking["anime"].pop(str(anime_id), None)
        else:
            entry.get("episodes", {}).pop(str(episode_number), None)
            if not entry.get("episodes"):
                tracking["anime"].pop(str(anime_id), None)
    if (
        tracking.get("last_use", {}).get("anime_id") == anime_id
        and (episode_number is None or tracking.get("last_use", {}).get("episode_number") == episode_number)
    ):
        refresh_tracking_last_use(tracking)

    save_tracking_data(tracking)
    return jsonify({"status": "success", "continue_watching": build_continue_watching_items()})

@app.route('/videos/<int:anime_id>/<path:filename>')
def serve_video(anime_id, filename):
    anime_data = load_anime_data()
    anime = next((item for item in anime_data if item['id'] == anime_id), None)
    if anime:
        file_path = resolve_episode_video_file(anime, filename)
        if file_path:
            return send_file(file_path, mimetype='video/mp4')
    return "File not found", 404

@app.route('/player/<int:index>')
@app.route('/player/<int:anime_id>/<int:episode_number>')
def player(anime_id=None, episode_number=None, index=None):
    from_queue = request.args.get('from_queue', 'false').lower() == 'true'
    queue = load_queue().get("queue", [])

    if from_queue and index is not None:
        if not (0 <= index < len(queue)):
            return "Invalid queue index", 404

        queue_item = queue[index]
        anime_title = queue_item.get("title")
        anime_id = queue_item.get("id")
        episode_number = queue_item.get("episode", 1)

        anime_data = load_anime_data()
        anime = next((a for a in anime_data if a["title"] == anime_title and a["id"] == anime_id), None)

        if not anime:
            return f"Anime '{anime_title}' not found", 404

        episodes = prepare_anime_episodes_for_player(anime)
        episode = next((e for e in episodes if e["number"] == episode_number), None)

        if not episode:
            return f"Episode {episode_number} not found for {anime_title}", 404

        next_episode = next((e for e in episodes if e["number"] > episode_number), None)
        if next_episode:
            next_url = url_for('player', anime_id=anime_id, episode_number=next_episode["number"])
            next_episode_number = next_episode["number"]
        elif index + 1 < len(queue):
            next_url = url_for('player', index=index + 1) + f"?from_queue=true"
            next_episode_number = 1
        else:
            next_url = None
            next_episode_number = None

        saved_progress = {} if request.args.get("start_over") == "1" else get_episode_tracking_progress(anime_id, episode_number)
        adjacent_context = get_adjacent_episode_context(anime, episode)
        return render_template("player.html", anime=anime, episode=episode, queue_index=index,
                               next_url=next_url, next_episode_number=next_episode_number,
                               saved_progress=saved_progress, **adjacent_context)

    anime_data = load_anime_data()
    anime = next((item for item in anime_data if item['id'] == anime_id), None)
    if anime:
        prepare_anime_episodes_for_player(anime)
        episode = next((item for item in anime['episodes'] if item['number'] == episode_number), None)
        if episode:
            saved_progress = {} if request.args.get("start_over") == "1" else get_episode_tracking_progress(anime_id, episode_number)
            adjacent_context = get_adjacent_episode_context(anime, episode)
            return render_template('player.html', anime=anime, episode=episode, saved_progress=saved_progress, **adjacent_context)

    return "Anime or episode not found", 404

@app.context_processor
def inject_queue():
    try:
        return {'global_queue': build_enriched_queue()}
    except:
        return {'global_queue': []}

@app.route("/queue")
def get_queue():
    try:
        return jsonify({"queue": build_enriched_queue()})
    except Exception as e:
        print("Error loading queue:", e)
        return jsonify({"queue": []}), 500

@app.route("/queue-page")
def queue_page():
    return render_template("queue.html", queue_items=build_enriched_queue())

@app.route("/queue-player/<int:index>")
def queue_player(index):
    context = get_queue_player_context(index)
    if not context:
        return "Queue item not found", 404
    return render_template("queue_player.html", **context)

@app.route('/add_video', methods=['POST'])
def add_to_queue():
    data = request.get_json()
    anime_id = data.get('id')
    anime_title = data.get('title')

    if not anime_id or not anime_title:
        return jsonify({'status': 'error', 'message': 'Missing anime ID or title'}), 400

    queue = load_queue().get("queue", [])

    if any(item['id'] == anime_id for item in queue):
        return jsonify({'status': 'error', 'message': 'Anime already in queue'}), 400

    queue.append({'id': anime_id, 'title': anime_title})
    save_queue({'queue': queue})
    sync_tracking_queue()

    return jsonify({'status': 'success'})



def get_anime_explorer_path(anime):
    """Return the best local filesystem path for opening an anime in Explorer."""
    if not anime:
        return None

    directory = (anime.get("directory") or anime.get("folder_path") or anime.get("path") or "").strip()
    if directory:
        return directory

    for episode in anime.get("episodes", []):
        file_path = (episode or {}).get("file_path")
        if file_path:
            return os.path.dirname(file_path) or file_path

    return None



def build_anime_episode_file_check_payload(anime):
    """Build a renderer-safe payload for Electron to verify local episode files.

    Electron does the actual filesystem check so this also works when the
    browser side cannot access local paths directly. The payload keeps the
    same episode-number matching idea used by the player: direct path first,
    then match files in the anime directory by stripped episode number.
    """
    directory = (
        anime.get("directory")
        or anime.get("folder_path")
        or anime.get("path")
        or get_anime_explorer_path(anime)
        or ""
    )

    episodes = []
    for episode in sorted(anime.get("episodes", []), key=lambda item: item.get("number", 0)):
        file_path = (episode or {}).get("file_path") or ""
        episode_number = episode.get("number")
        if not directory and file_path:
            directory = os.path.dirname(file_path)

        episodes.append({
            "number": episode_number,
            "title": episode.get("title") or f"Episode {episode_number}",
            "file_path": file_path,
            "filename": os.path.basename(file_path.replace("\\", "/")) if file_path else "",
            "directory": directory
        })

    return {
        "anime_id": anime.get("id"),
        "title": anime.get("title"),
        "directory": directory,
        "episodes": episodes
    }

def load_queue():
    if not os.path.exists(QUEUE_FILE):
        return {"queue": []}
    with open(QUEUE_FILE, 'r') as f:
        return json.load(f)

def save_queue(data):
    write_json_file_atomic(QUEUE_FILE, data, indent=2)



@app.route('/api/anime/<int:anime_id>/episode-file-targets')
def anime_episode_file_targets(anime_id):
    anime_data = load_anime_data()
    anime = next((item for item in anime_data if item.get('id') == anime_id), None)

    if not anime:
        return jsonify({'status': 'error', 'message': 'Anime not found'}), 404

    return jsonify({
        'status': 'success',
        'payload': build_anime_episode_file_check_payload(anime)
    })

@app.route('/api/anime/<int:anime_id>/explorer-path')
def anime_explorer_path(anime_id):
    anime_data = load_anime_data()
    anime = next((item for item in anime_data if item.get('id') == anime_id), None)

    if not anime:
        return jsonify({'status': 'error', 'message': 'Anime not found'}), 404

    explorer_path = get_anime_explorer_path(anime)
    if not explorer_path:
        return jsonify({'status': 'error', 'message': 'No local file path is saved for this anime'}), 404

    return jsonify({
        'status': 'success',
        'path': explorer_path,
        'exists': os.path.exists(explorer_path)
    })

@app.route('/anime/<int:anime_id>')
def anime_detail(anime_id):
    anime_data = load_anime_data()
    anime = next((item for item in anime_data if item['id'] == anime_id), None)
    if anime:
        prepare_anime_episodes_for_player(anime)
        tracking, tracking_entry, progress_summary = get_anime_tracking_context(anime)
        enrich_episode_progress(anime, tracking_entry)
        active_watch_status = (tracking_entry or {}).get("watch_status") or anime.get("watch_status") or anime.get("status") or "Not Started"
        active_watch_status = normalize_watch_status(active_watch_status, "Not Started")
        return render_template(
            'anime_detail.html',
            anime=anime,
            tracking_entry=tracking_entry or {},
            progress_summary=progress_summary,
            watch_status_options=WATCH_STATUS_OPTIONS,
            active_watch_status=active_watch_status
        )
    else:
        return "Anime not found", 404

@app.route('/add_anime', methods=['GET', 'POST'])
def add_anime():
    if request.method == 'POST':
        title = request.form.get('title', '').strip()
        season = request.form.get('season', '').strip()
        status = request.form.get('status')
        download_link = request.form.get('download_link')
        episodes = int(request.form.get('episodes'))
        metadata = parse_anime_metadata_form()
        missing_metadata = missing_anime_metadata_groups(metadata)

        if not title or not secure_path_title(title):
            return redirect(url_for('add_anime'))

        if missing_metadata:
            return redirect(url_for('add_anime', missing_metadata=",".join(missing_metadata)))

        anime_data = load_anime_data()
        if find_duplicate(anime_data, {"title": title, "season": season, "status": status}):
            return redirect(url_for('add_anime', duplicate=1))

        existing_ids = {anime["id"] for anime in anime_data}
        new_id = 1
        while new_id in existing_ids:
            new_id += 1

        # ✅ FIX: remove "manager"
        ROOT_PATH = os.path.dirname(BASE_PATH)

        directory = os.path.join(ROOT_PATH, title, f"{season}")
        os.makedirs(directory, exist_ok=True)

        episodes_list = [
            {
                "number": i + 1,
                "title": f"Episode {i + 1}",
                "watched": False,
                "file_path": os.path.join(directory, f"{i + 1}.mp4").replace("\\", "/")
            }
            for i in range(episodes)
        ]

        new_anime = {
            "id": new_id,
            "title": title,
            "season": season,
            "status": status,
            "download_link": download_link,
            "directory": directory,
            "episodes": episodes_list,
            "tags": metadata["tags"],
            "genres": metadata["genres"],
            "themes": metadata["themes"],
            "demographics": metadata["demographics"],
            "tag_source": "manual",
            "tag_match_status": "manual"
        }

        anime_data.append(new_anime)
        save_uploaded_thumbnail(request.files.get("thumbnail"), title, IMAGE_FOLDER)
        save_anime_data(anime_data)
        rebuild_unique_anime_tags(anime_data)

        return redirect(url_for('index'))

    return render_template('add_anime.html')

@app.route('/mark_watched/<int:anime_id>/<int:episode_number>', methods=['POST'])
def mark_watched(anime_id, episode_number):
    anime_data = load_anime_data()
    anime = next((item for item in anime_data if item['id'] == anime_id), None)
    if anime:
        matched_episode = None
        for episode in anime['episodes']:
            if episode['number'] == episode_number:
                episode['watched'] = not episode['watched']
                matched_episode = episode
                break
        if matched_episode is None:
            return jsonify({'status': 'error'}), 404
        save_anime_data(anime_data)
        if matched_episode.get('watched') is True:
            remove_tracking_episode(anime_id, episode_number)
        return jsonify({'status': 'success'})
    return jsonify({'status': 'error'}), 404

@app.route('/anime/<int:anime_id>/episodes', methods=['POST'])
def add_anime_episode(anime_id):
    anime_data = load_anime_data()
    anime = find_by_id(anime_data, anime_id)

    if not anime:
        return jsonify({'status': 'error', 'message': 'Anime not found'}), 404

    payload = request.get_json(silent=True) or {}
    next_number = max((episode.get("number", 0) for episode in anime.get("episodes", [])), default=0) + 1
    episode_title = payload.get("title", "").strip() or f"Episode {next_number}"
    directory = anime.get("directory", "")

    new_episode = {
        "number": next_number,
        "title": episode_title,
        "watched": False,
        "file_path": os.path.join(directory, f"{next_number}.mp4").replace("\\", "/") if directory else f"{next_number}.mp4"
    }

    anime.setdefault("episodes", []).append(new_episode)
    save_anime_data(anime_data)

    return jsonify({'status': 'success', 'episode': new_episode, 'total_episodes': len(anime["episodes"])})

@app.route('/anime/<int:anime_id>/episodes/<int:episode_number>', methods=['DELETE'])
def delete_anime_episode(anime_id, episode_number):
    anime_data = load_anime_data()
    anime = find_by_id(anime_data, anime_id)

    if not anime:
        return jsonify({'status': 'error', 'message': 'Anime not found'}), 404

    episodes = anime.get("episodes", [])
    next_episodes = [episode for episode in episodes if episode.get("number") != episode_number]

    if len(next_episodes) == len(episodes):
        return jsonify({'status': 'error', 'message': 'Episode not found'}), 404

    anime["episodes"] = next_episodes
    renumber_anime_episodes(anime)
    save_anime_data(anime_data)
    remove_tracking_episode(anime_id, episode_number)

    return jsonify({'status': 'success', 'episodes': anime["episodes"], 'total_episodes': len(anime["episodes"])})

@app.route('/mark_anime_watched/<int:anime_id>', methods=['POST'])
def mark_anime_watched(anime_id):
    anime_data = load_anime_data()
    anime = next((item for item in anime_data if item['id'] == anime_id), None)

    if anime:
        anime['watched'] = not anime.get('watched', False)  # Toggle watched status
        save_anime_data(anime_data)
        if anime.get('watched') is True:
            remove_tracking_anime(anime_id)
        return jsonify({'status': 'success'})

    return jsonify({'status': 'error'}), 404

@app.route('/update_anime_link/<int:anime_id>', methods=['POST'])
def update_anime_link(anime_id):
    anime_data = load_anime_data()
    anime = find_by_id(anime_data, anime_id)

    if not anime:
        return jsonify({'status': 'error', 'message': 'Anime not found'}), 404

    payload = request.get_json(silent=True) or {}
    link = payload.get("link", "").strip()

    if not link:
        return jsonify({'status': 'error', 'message': 'Missing link'}), 400

    anime["download_link"] = link
    save_anime_data(anime_data)

    return jsonify({'status': 'success', 'link': link})

@app.route('/delete_anime/<int:anime_id>', methods=['DELETE'])
def delete_anime(anime_id):
    anime_data = load_anime_data()
    anime_index = next(
        (index for index, item in enumerate(anime_data) if item['id'] == anime_id),
        None
    )

    if anime_index is not None:
        anime = anime_data[anime_index]
        anime_title = anime['title']

        # ---------- Delete anime image ----------
        for ext in IMAGE_EXTENSION_ORDER:
            for filename in image_filename_candidates(anime_title, ext):
                image_path = os.path.join(IMAGE_FOLDER, filename)
                if os.path.exists(image_path):
                    os.remove(image_path)
                    break

        # ---------- Delete season directory ----------
        season_dir = anime.get('directory')
        if season_dir and os.path.exists(season_dir):
            shutil.rmtree(season_dir)

            # ---------- Check & delete parent anime directory ----------
            parent_anime_dir = os.path.dirname(season_dir)

            # Normalize path (important because of mixed slashes)
            parent_anime_dir = os.path.normpath(parent_anime_dir)

            if os.path.exists(parent_anime_dir) and not os.listdir(parent_anime_dir):
                os.rmdir(parent_anime_dir)

        # ---------- Remove anime entry ----------
        anime_data.pop(anime_index)
        save_anime_data(anime_data)
        remove_tracking_anime(anime_id)

        return jsonify({'status': 'success'})

    return jsonify({'status': 'error'}), 425

@app.route('/static/images/stars.mp4')
def serve_video1():
    return send_file("static/images/stars.mp4", mimetype="video/mp4", conditional=True)

@app.route('/bookmark/<int:anime_id>', methods=['POST'])
def toggle_bookmark(anime_id):
    anime_data = load_anime_data()

    # Find the anime with the given ID
    anime = next((item for item in anime_data if item.get('id') == anime_id), None)

    if anime:
        # Add the 'bookmarked' key if it doesn't exist
        if 'bookmarked' not in anime:
            anime['bookmarked'] = False

        # Toggle the bookmark status
        anime['bookmarked'] = not anime['bookmarked']

        save_anime_data(anime_data)

        return jsonify({'status': 'success', 'bookmarked': anime['bookmarked']})

    return jsonify({'status': 'error', 'message': 'Anime not found'}), 403

@app.route('/update_anime_status/<anime_id>', methods=['POST'])
def update_anime_status(anime_id):
    try:
        anime_id = int(anime_id)
        updated_data = request.get_json(silent=True) or {}
        new_status = normalize_watch_status(updated_data.get('status'), None)

        if not new_status:
            return jsonify({'status': 'error', 'message': 'Invalid or missing status'}), 400

        anime_list = load_anime_data()
        anime = next((item for item in anime_list if item.get('id') == anime_id), None)

        if not anime:
            return jsonify({'status': 'error', 'message': 'Anime not found'}), 404

        anime['watch_status'] = new_status
        if new_status == "Completed":
            anime['watched'] = True
        elif new_status in {"Watching", "On Hold", "Dropped", "Rewatching", "Plan to Watch", "Not Started"}:
            anime['watched'] = False
        save_anime_data(anime_list)

        tracking = load_tracking_data()
        entry = get_tracking_anime_entry(tracking, anime, create=True)
        entry['watch_status'] = new_status
        entry['last_watched_at'] = entry.get('last_watched_at') or utc_now_iso()
        if new_status == "Completed":
            for episode in anime.get('episodes', []):
                episode['watched'] = True
            entry['episodes'] = {}
        save_tracking_data(tracking)

        return jsonify({'status': 'success', 'new_status': new_status})

    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@app.route('/delete_from_queue/<int:index>', methods=['DELETE'])
def delete_from_queue(index):
    queue_data = load_queue()
    queue = queue_data.get("queue", [])

    if 0 <= index < len(queue):
        removed = queue.pop(index)
        save_queue({"queue": queue})
        sync_tracking_queue()
        return jsonify({"status": "success", "removed": removed})
    else:
        return jsonify({"status": "error", "message": "Invalid index"}), 400

@app.route('/queue/clear', methods=['POST'])
def clear_queue():
    save_queue({"queue": []})
    sync_tracking_queue()
    return jsonify({"status": "success", "queue": []})


@app.route('/queue/clear-watched', methods=['POST'])
def clear_watched_queue():
    anime_data = load_anime_data()
    watched_lookup = {
        (anime.get('id'), episode.get('number'))
        for anime in anime_data
        for episode in anime.get('episodes', [])
        if episode.get('watched') is True
    }
    queue = load_queue().get("queue", [])
    next_queue = [
        item for item in queue
        if (item.get('id'), int(item.get('episode', 1) or 1)) not in watched_lookup
    ]
    removed_count = len(queue) - len(next_queue)
    save_queue({"queue": next_queue})
    sync_tracking_queue()
    return jsonify({"status": "success", "removed_count": removed_count, "queue": build_enriched_queue()})


@app.route('/queue/move-top/<int:index>', methods=['POST'])
def move_queue_item_top(index):
    queue = load_queue().get("queue", [])
    if not (0 <= index < len(queue)):
        return jsonify({"status": "error", "message": "Invalid index"}), 400
    item = queue.pop(index)
    queue.insert(0, item)
    save_queue({"queue": queue})
    sync_tracking_queue()
    return jsonify({"status": "success", "queue": build_enriched_queue()})


@app.route('/queue/reorder', methods=['POST'])
def reorder_queue():
    payload = request.get_json(silent=True) or {}
    order = payload.get("order")
    queue_data = load_queue()
    queue = queue_data.get("queue", [])

    if not isinstance(order, list) or len(order) != len(queue):
        return jsonify({"status": "error", "message": "Invalid queue order"}), 400

    try:
        indices = [int(index) for index in order]
    except (TypeError, ValueError):
        return jsonify({"status": "error", "message": "Queue order must use numeric indices"}), 400

    if sorted(indices) != list(range(len(queue))):
        return jsonify({"status": "error", "message": "Queue order does not match current queue"}), 400

    next_queue = [queue[index] for index in indices]
    save_queue({"queue": next_queue})
    sync_tracking_queue()

    return jsonify({"status": "success", "queue": build_enriched_queue()})

if __name__ == '__main__':
    logging.basicConfig(level=logging.DEBUG)
    app.run(port=5000, debug=False)  # Runs Flask on port 5000
