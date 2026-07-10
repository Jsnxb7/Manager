from flask import Flask, Blueprint, send_file, render_template, jsonify, request, redirect, url_for
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
IMAGE_FOLDER = os.path.join(BASE_PATH, "static", "anime_images")
DEFAULT_IMAGE = "/static/placeholder.jpeg"
MANGA_DATA_FILE = os.path.join(BASE_PATH, 'data', 'manga_data.json')
MANGA_IMAGE_FOLDER = os.path.join(BASE_PATH, "static", "manga_images")
DEFAULT_MANGA_IMAGE = "/static/placeholder.jpeg"
DATA_FILE_SEC = os.path.join(BASE_PATH, 'data', 'sections.json')
DATA_FOLDER = os.path.join(BASE_PATH, 'data')
ANIME_TAGS_FILE = os.path.join(BASE_PATH, 'data', 'unique_anime_tags.json')
ANIME_FILTER_STATE_FILE = os.path.join(BASE_PATH, 'data', 'anime_filter_state.json')
MANGA_FILTER_STATE_FILE = os.path.join(BASE_PATH, 'data', 'manga_filter_state.json')
SECTION_FILTER_STATE_FILE = os.path.join(BASE_PATH, 'data', 'section_filter_state.json')
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

core_bp = Blueprint("core", __name__)
validation_bp = Blueprint("validation", __name__)
sections_bp = Blueprint("sections", __name__)
manga_bp = Blueprint("manga", __name__)
anime_bp = Blueprint("anime", __name__)
tracking_bp = Blueprint("tracking", __name__)
player_bp = Blueprint("player", __name__)
queue_bp = Blueprint("queue", __name__)

# --- Blueprint registration ------------------------------------------------
app.instance_path = os.path.join(BASE_PATH, 'instance')
os.makedirs(app.instance_path, exist_ok=True)

from blueprints.custom_player_routes import custom_player_bp
app.register_blueprint(custom_player_bp)

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


@validation_bp.route("/api/validate-entry")
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

    episode_pattern = re.compile( r'(?:^|[\s._-])(?:s\d{1,2}e|episodes?|eps?|ep|e)?[\s._-]*(\d{1,4})(?:v\d+)?(?:[\s._-]*(?:end|final))?(?=[\s._-]|$)', re.IGNORECASE)
    match = episode_pattern.search(stem)

    if match:
        return int(match.group(1).lstrip("0") or "0")

    return None

def _list_video_files(directory):
    files = []
    for filename in os.listdir(directory):
        filepath = os.path.join(directory, filename)
        if os.path.isfile(filepath) and os.path.splitext(filename)[1].lower() in VIDEO_EXTENSIONS:
            files.append(filepath)
    return files

def find_episode_video_file(directory, episode_number):
    if not directory or not os.path.isdir(directory):
        return None

    video_files = _list_video_files(directory)

    # Detect each file's embedded episode number, keep only files where one
    # was found, then sort ascending by that number. Once sorted, the files
    # are handed out under sequential numbers (1, 2, 3, ...) regardless of
    # what number is actually embedded in the filename -- this way a season
    # folder that keeps the show's absolute numbering (e.g. starts at
    # "14.mkv") still lines up with the app's per-season episode numbers.
    numbered_files = [
        (get_episode_number_from_filename(os.path.basename(filepath)), filepath)
        for filepath in video_files
    ]
    numbered_files = [item for item in numbered_files if item[0] is not None]
    numbered_files.sort(key=lambda item: (item[0], os.path.basename(item[1]).lower()))

    if 1 <= episode_number <= len(numbered_files):
        return numbered_files[episode_number - 1][1]

    return None

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
        "previous_episode_url": url_for("player.player", anime_id=anime["id"], episode_number=previous_episode["number"]) if previous_episode else None,
        "next_episode_url": url_for("player.player", anime_id=anime["id"], episode_number=next_episode["number"]) if next_episode else None,
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

@sections_bp.route("/api/<section>")
def api_section(section):
    if section == "anime-tags":
        return api_anime_tags()

    data = load_section_data(section)

    for item in data:
        item["thumbnail_url"] = get_section_image(section, item["title"])

    return jsonify(data)

@sections_bp.route("/<section>/<int:item_id>")
def section_detail(section, item_id):
    data = load_section_data(section)
    item = next((i for i in data if i["id"] == item_id), None)

    if not item:
        return "Not found", 404

    return render_template(f"{section}_detail.html", item=item)

@sections_bp.route("/update_link/<section>/<int:item_id>", methods=["POST"])
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

@sections_bp.route("/<section>/add", methods=["GET", "POST"])
def add_section_item(section):
    section = normalize_section(section)

    if request.method == "POST":
        title = request.form.get("title", "").strip()
        status = request.form.get("status")
        link = request.form.get("link")

        if not title or not secure_path_title(title):
            return redirect(url_for("sections.add_section_item", section=section))

        data = load_section_data(section)
        if find_duplicate(data, {"title": title, "status": status, "link": link}):
            return redirect(url_for("sections.add_section_item", section=section, duplicate=1))

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

        return redirect(url_for("sections.section_index", section=section))

    return render_template(
        "add_section_item.html",
        section=section.capitalize(),
        section_slug=section
    )


@sections_bp.route("/mark_read/<section>/<int:item_id>", methods=["POST"])
def toggle_read(section, item_id):
    data = load_section_data(section)
    item = next((i for i in data if i["id"] == item_id), None)

    if not item:
        return jsonify({"error": "Not found"}), 404

    item["read"] = not item["read"]
    save_section_data(section, data)

    return jsonify({"read": item["read"]})

@sections_bp.route("/bookmark/<section>/<int:item_id>", methods=["POST"])
def toggle_bookmark_1(section, item_id):
    data = load_section_data(section)
    item = next((i for i in data if i["id"] == item_id), None)

    if not item:
        return jsonify({"error": "Not found"}), 404

    item["bookmarked"] = not item["bookmarked"]
    save_section_data(section, data)

    return jsonify({"bookmarked": item["bookmarked"]})

@sections_bp.route("/toggle_status/<section>/<int:item_id>", methods=["POST"])
def toggle_status_1(section, item_id):
    data = load_section_data(section)
    item = next((i for i in data if i["id"] == item_id), None)

    if not item:
        return jsonify({"error": "Not found"}), 404

    current = item.get("status", "Ongoing").lower()
    item["status"] = "Completed" if current == "ongoing" else "Ongoing"

    save_section_data(section, data)
    return jsonify({"status": item["status"]})

@sections_bp.route("/delete/<section>/<int:item_id>", methods=["DELETE"])
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


@sections_bp.route("/<section>")
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

@sections_bp.route("/add-section", methods=["POST"])
def add_section():
    name = request.form.get("name")

    if not name:
        return redirect(url_for("core.hub"))

    display_name = name.strip()
    slug = normalize_section(display_name)

    sections = load_sections()

    # avoid duplicates (case-insensitive)
    existing_slugs = {normalize_section(s) for s in sections}

    if slug not in existing_slugs:
        sections.append(display_name)      # 👈 STORE DISPLAY NAME
        save_section(sections)
        create_section(slug)               # 👈 USE SLUG FOR FILES

    return redirect(url_for("core.hub"))


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

@manga_bp.route('/api/manga')
def api_manga():
    manga_data = load_manga_data()
    return jsonify([build_manga_api_item(manga) for manga in manga_data])

@manga_bp.route('/api/manga-headers')
def api_manga_headers():
    if os.path.exists(MANGA_HEADERS_FILE):
        with open(MANGA_HEADERS_FILE, 'r', encoding='utf-8') as file:
            payload = json.load(file)
        if all(isinstance(payload.get(group), list) for group in MANGA_HEADER_GROUPS):
            return jsonify(payload)

    return jsonify(rebuild_unique_manga_headers(load_manga_data()))

@manga_bp.route('/manga')
def manga_index():
    return render_template("manga_index.html")

@manga_bp.route('/manga/<int:manga_id>')
def manga_detail(manga_id):
    manga_data = load_manga_data()
    manga = next((m for m in manga_data if m["id"] == manga_id), None)

    if manga:
        return render_template("manga_detail.html", manga=build_manga_api_item(manga))

    return "Manga not found", 404

@manga_bp.route('/add_manga', methods=['GET', 'POST'])
def add_manga():
    if request.method == 'POST':
        title = request.form.get('title', '').strip()
        status = request.form.get('status')
        link = request.form.get("link")
        metadata = parse_manga_metadata_form()
        missing_metadata = missing_manga_metadata_groups(metadata)

        if not title or not secure_path_title(title):
            return redirect(url_for('manga.add_manga'))

        if missing_metadata:
            return redirect(url_for('manga.add_manga', missing_metadata=",".join(missing_metadata)))

        manga_data = load_manga_data()
        if find_duplicate(manga_data, {"title": title}):
            return redirect(url_for('manga.add_manga', duplicate=1))
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

        return redirect(url_for('manga.manga_index'))

    return render_template("add_manga.html")

@manga_bp.route('/mark_manga_read/<int:manga_id>', methods=['POST'])
def mark_manga_read(manga_id):
    manga_data = load_manga_data()
    manga = next((m for m in manga_data if m["id"] == manga_id), None)

    if manga:
        manga["read"] = not manga.get("read", False)
        save_manga_data(manga_data)
        return jsonify({"status": "success", "read": manga["read"]})

    return jsonify({"status": "error"}), 404

@manga_bp.route('/manga_bookmark/<int:manga_id>', methods=['POST'])
def manga_bookmark(manga_id):
    manga_data = load_manga_data()
    manga = next((m for m in manga_data if m["id"] == manga_id), None)

    if manga:
        manga["bookmarked"] = not manga.get("bookmarked", False)
        save_manga_data(manga_data)
        return jsonify({"status": "success", "bookmarked": manga["bookmarked"]})

    return jsonify({"status": "error"}), 404

@manga_bp.route('/update_manga_link/<int:manga_id>', methods=['POST'])
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

@manga_bp.route('/toggle_manga_status/<int:manga_id>', methods=['POST'])
def toggle_manga_status(manga_id):
    manga_data = load_manga_data()   # same pattern as anime
    manga = next((m for m in manga_data if m['id'] == manga_id), None)

    if not manga:
        return jsonify({'error': 'Manga not found'}), 404

    status_flow = ["Ongoing", "Completed", "Haitus"]
    current_status = str(manga.get('status', 'Ongoing')).lower()
    current_index = next(
        (index for index, status in enumerate(status_flow) if status.lower() == current_status),
        -1
    )
    manga['status'] = status_flow[(current_index + 1) % len(status_flow)]

    save_manga_data(manga_data)

    return jsonify({
        'status': manga['status']
    })

@manga_bp.route('/delete_manga/<int:manga_id>', methods=['DELETE'])
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

FILTER_PAGE_SIZE_OPTIONS = {8, 12, 16, 24}
FILTER_QUICK_KEYS = ("unread", "unwatched", "ongoing", "bookmarked")
FILTER_GROUP_KEYS = ("tags", "genres", "themes", "demographics")


def empty_filter_state():
    return {
        "schema_version": 1,
        "updated_at": None,
        "search": "",
        "quick_filters": {key: False for key in FILTER_QUICK_KEYS},
        "tag_filters": {key: [] for key in FILTER_GROUP_KEYS},
        "page": 1,
        "items_per_page": 12
    }


def normalize_filter_state(raw_state):
    state = empty_filter_state()
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
    if state["items_per_page"] not in FILTER_PAGE_SIZE_OPTIONS:
        state["items_per_page"] = 12

    return state


def load_filter_state(file_path):
    if not os.path.exists(file_path):
        return empty_filter_state()
    try:
        return normalize_filter_state(read_json_file(file_path))
    except (json.JSONDecodeError, OSError):
        return empty_filter_state()


def save_filter_state(file_path, state):
    normalized = normalize_filter_state(state)
    normalized["updated_at"] = utc_now_iso()
    write_json_file_atomic(file_path, normalized, indent=4)
    return normalized


def load_anime_filter_state():
    return load_filter_state(ANIME_FILTER_STATE_FILE)


def save_anime_filter_state(state):
    return save_filter_state(ANIME_FILTER_STATE_FILE, state)

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
            tracking_entry = tracking.get("anime", {}).get(str(anime_id), {})
            progress_summary = get_anime_progress_summary(anime, tracking_entry)
        else:
            tracking_entry = {}
            progress_summary = {
                "completion_percentage": 0,
                "completed_episodes": 0,
                "total_episodes": 0
            }

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
            "watch_status": tracking_entry.get("watch_status", "Watching") if isinstance(tracking_entry, dict) else "Watching",
            "progress_percentage": progress_summary.get("completion_percentage", 0),
            "progress_label": f"{progress_summary.get('completion_percentage', 0)}% watched",
            "completed_episodes": progress_summary.get("completed_episodes", 0),
            "total_episodes": progress_summary.get("total_episodes", 0),
            "video_url": (episode or {}).get("video_url"),
            "player_url": url_for("queue.queue_player", index=index),
            "legacy_player_url": url_for("player.player", index=index) + "?from_queue=true",
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
    seen_keys = set()

    def add_continue_item(anime, anime_entry, progress_episode, force_start_over=False):
        anime_id = anime.get("id") or anime_entry.get("anime_id")
        if anime_id is None:
            return

        episodes_from_data = prepare_anime_episodes_for_player(anime)
        episode_number = progress_episode.get("episode_number")
        source_episode = next((episode for episode in episodes_from_data if episode.get("number") == episode_number), None)
        if not source_episode:
            return

        item_key = (anime_id, episode_number)
        if item_key in seen_keys:
            return
        seen_keys.add(item_key)

        adjacent = get_adjacent_episode_context(anime, source_episode)
        player_url = url_for("player.player", anime_id=anime_id, episode_number=episode_number)
        continue_query = "?start_over=1" if force_start_over else "?resume=1"

        items.append({
            "anime_id": anime_id,
            "anime_title": anime.get("title") or anime_entry.get("anime_title"),
            "anime_thumbnail": get_anime_image(anime.get("title", "")),
            "watch_status": anime_entry.get("watch_status", "Watching"),
            "episode_number": episode_number,
            "episode_title": source_episode.get("title") or progress_episode.get("episode_title"),
            "episode_video_url": source_episode.get("video_url"),
            "previous_episode_number": (adjacent.get("previous_episode") or {}).get("number"),
            "previous_episode_title": (adjacent.get("previous_episode") or {}).get("title"),
            "previous_episode_video_url": adjacent.get("previous_episode_video_url"),
            "next_episode_number": (adjacent.get("next_episode") or {}).get("number"),
            "next_episode_title": (adjacent.get("next_episode") or {}).get("title"),
            "next_episode_video_url": adjacent.get("next_episode_video_url"),
            "current_time": 0 if force_start_over else progress_episode.get("current_time", 0),
            "total_duration": progress_episode.get("total_duration", 0),
            "progress_percentage": 100 if source_episode.get("watched") else progress_episode.get("progress_percentage", 0),
            "last_watched_at": progress_episode.get("last_watched_at"),
            "continue_url": player_url + continue_query,
            "start_over_url": player_url + "?start_over=1"
        })

    for anime_entry in tracking.get("anime", {}).values():
        anime_id = anime_entry.get("anime_id")
        anime = anime_lookup.get(anime_id)
        if not anime:
            continue

        episodes = [
            episode
            for episode in anime_entry.get("episodes", {}).values()
            if not episode.get("completed")
        ]
        if not episodes:
            continue

        latest_episode = max(episodes, key=lambda episode: episode.get("last_watched_at") or "")
        add_continue_item(anime, anime_entry, latest_episode)

    # Fallback: completed or manually watched anime are pruned from active progress,
    # but last_use still knows the most recent episode. Keep it visible so users
    # can rewatch/continue from the home page even after an anime is already watched.
    last_use = tracking.get("last_use", {}) if isinstance(tracking.get("last_use"), dict) else {}
    last_anime_id = last_use.get("anime_id")
    last_episode_number = last_use.get("episode_number")
    fallback_anime = anime_lookup.get(last_anime_id)
    if fallback_anime and last_episode_number is not None:
        add_continue_item(
            fallback_anime,
            {
                "anime_id": last_anime_id,
                "anime_title": fallback_anime.get("title"),
                "watch_status": "Completed" if fallback_anime.get("watched") else "Watching"
            },
            {
                "episode_number": last_episode_number,
                "episode_title": last_use.get("episode_title"),
                "current_time": last_use.get("current_time", 0),
                "total_duration": last_use.get("total_duration", 0),
                "progress_percentage": last_use.get("progress_percentage", 0),
                "last_watched_at": last_use.get("last_watched_at")
            },
            force_start_over=True
        )

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

ANIME_RELEASE_STATUS_OPTIONS = [
    "Ongoing",
    "Completed",
    "Not_Aired"
]

def normalize_anime_release_status(value, fallback="Ongoing"):
    if value is None and fallback is None:
        return None
    normalized = str(value or fallback or "").strip()
    aliases = {
        "not aired": "Not_Aired",
        "not_aired": "Not_Aired",
        "not-yet-aired": "Not_Aired",
        "not yet aired": "Not_Aired",
        "unaired": "Not_Aired",
        "airing": "Ongoing",
        "ongoing": "Ongoing",
        "completed": "Completed",
        "complete": "Completed",
        "finished": "Completed"
    }
    return aliases.get(normalized.lower(), normalized if normalized in ANIME_RELEASE_STATUS_OPTIONS else fallback)

def anime_release_status_label(status):
    return "Not Aired" if status == "Not_Aired" else status


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

def build_hub_card(section):
    slug = normalize_section(section)
    badge_map = {
        "anime": "AN",
        "manga": "MG",
        "tv_shows": "TV"
    }

    if slug == "anime":
        items = load_anime_data()
        image_getter = lambda item: get_anime_image(item.get("title", ""))
    elif slug == "manga":
        items = load_manga_data()
        image_getter = get_manga_image
    else:
        items = load_section_data(slug)
        image_getter = lambda item: get_section_image(slug, item.get("title", ""))

    bookmarked_items = [item for item in items if item.get("bookmarked")]
    fallback_items = [item for item in items if not item.get("bookmarked")]

    images = []
    for item in [*bookmarked_items, *fallback_items]:
        image_url = image_getter(item)
        if image_url and image_url not in {DEFAULT_IMAGE, DEFAULT_MANGA_IMAGE}:
            images.append(image_url)
        if len(images) >= 4:
            break

    return {
        "name": section,
        "slug": slug,
        "badge": badge_map.get(slug, "".join(word[:1] for word in section.split()[:2]).upper() or "LIB"),
        "count": len(items),
        "images": images
    }

@core_bp.route('/')
def hub():
    sections = load_sections()
    hub_cards = [build_hub_card(section) for section in sections]
    return render_template("hub.html", sections=sections, hub_cards=hub_cards)

@anime_bp.route('/anime')
def index():
    return render_template("index.html", global_queue=build_enriched_queue())

def get_anime_image(title):
    for ext in IMAGE_EXTENSION_ORDER:
        for filename in image_filename_candidates(title, ext):
            filepath = os.path.join(IMAGE_FOLDER, filename)
            if os.path.exists(filepath):
                return f"/static/anime_images/{filename}"
    return DEFAULT_IMAGE

@anime_bp.route('/api/anime')
def api_anime():
    anime_data = load_anime_data()
    for anime in anime_data:
        anime["thumbnail_url"] = get_anime_image(anime["title"])
    return jsonify(anime_data)


@anime_bp.route('/api/anime-filter-state', methods=['GET'])
def api_get_anime_filter_state():
    return jsonify(load_anime_filter_state())


@anime_bp.route('/api/anime-filter-state', methods=['POST'])
def api_save_anime_filter_state():
    payload = request.get_json(silent=True) or {}
    return jsonify(save_anime_filter_state(payload))


@manga_bp.route('/api/manga-filter-state', methods=['GET'])
def api_get_manga_filter_state():
    return jsonify(load_filter_state(MANGA_FILTER_STATE_FILE))


@manga_bp.route('/api/manga-filter-state', methods=['POST'])
def api_save_manga_filter_state():
    payload = request.get_json(silent=True) or {}
    return jsonify(save_filter_state(MANGA_FILTER_STATE_FILE, payload))


@sections_bp.route('/api/section-filter-state/<section>', methods=['GET'])
def api_get_section_filter_state(section):
    try:
        section_states = read_json_file(SECTION_FILTER_STATE_FILE) if os.path.exists(SECTION_FILTER_STATE_FILE) else {}
    except (json.JSONDecodeError, OSError):
        section_states = {}
    if isinstance(section_states, dict) and isinstance(section_states.get(section), dict):
        return jsonify(normalize_filter_state(section_states.get(section)))
    return jsonify(empty_filter_state())


@sections_bp.route('/api/section-filter-state/<section>', methods=['POST'])
def api_save_section_filter_state(section):
    payload = request.get_json(silent=True) or {}
    try:
        section_states = read_json_file(SECTION_FILTER_STATE_FILE) if os.path.exists(SECTION_FILTER_STATE_FILE) else {}
    except (json.JSONDecodeError, OSError):
        section_states = {}
    if not isinstance(section_states, dict):
        section_states = {}
    normalized = normalize_filter_state(payload)
    normalized["updated_at"] = utc_now_iso()
    section_states[section] = normalized
    write_json_file_atomic(SECTION_FILTER_STATE_FILE, section_states, indent=4)
    return jsonify(normalized)

@anime_bp.route('/api/anime-tags')
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

@tracking_bp.route('/api/tracking')
def api_tracking():
    return jsonify(load_tracking_data())

@tracking_bp.route('/api/tracking/continue-watching')
def api_continue_watching():
    return jsonify({"items": build_continue_watching_items()})

@tracking_bp.route('/api/tracking/progress', methods=['POST'])
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

@tracking_bp.route('/api/tracking/discard', methods=['POST'])
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

@player_bp.route('/videos/<int:anime_id>/<path:filename>')
def serve_video(anime_id, filename):
    anime_data = load_anime_data()
    anime = next((item for item in anime_data if item['id'] == anime_id), None)
    if anime:
        file_path = resolve_episode_video_file(anime, filename)
        if file_path:
            return send_file(file_path, mimetype='video/mp4')
    return "File not found", 404

@player_bp.route('/player/<int:index>')
@player_bp.route('/player/<int:anime_id>/<int:episode_number>')
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
            next_url = url_for('player.player', anime_id=anime_id, episode_number=next_episode["number"])
            next_episode_number = next_episode["number"]
        elif index + 1 < len(queue):
            next_url = url_for('player.player', index=index + 1) + f"?from_queue=true"
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

@queue_bp.route("/queue")
def get_queue():
    try:
        return jsonify({"queue": build_enriched_queue()})
    except Exception as e:
        print("Error loading queue:", e)
        return jsonify({"queue": []}), 500

@queue_bp.route("/queue-page")
def queue_page():
    return render_template("queue.html", queue_items=build_enriched_queue())

@queue_bp.route("/queue-player/<int:index>")
def queue_player(index):
    context = get_queue_player_context(index)
    if not context:
        return "Queue item not found", 404
    return render_template("queue_player.html", **context)

@queue_bp.route('/add_video', methods=['POST'])
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



@anime_bp.route('/api/anime/<int:anime_id>/episode-file-targets')
def anime_episode_file_targets(anime_id):
    anime_data = load_anime_data()
    anime = next((item for item in anime_data if item.get('id') == anime_id), None)

    if not anime:
        return jsonify({'status': 'error', 'message': 'Anime not found'}), 404

    return jsonify({
        'status': 'success',
        'payload': build_anime_episode_file_check_payload(anime)
    })

@anime_bp.route('/api/anime/<int:anime_id>/explorer-path')
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

@anime_bp.route('/anime/<int:anime_id>')
def anime_detail(anime_id):
    anime_data = load_anime_data()
    anime = next((item for item in anime_data if item['id'] == anime_id), None)
    if anime:
        prepare_anime_episodes_for_player(anime)
        tracking, tracking_entry, progress_summary = get_anime_tracking_context(anime)
        enrich_episode_progress(anime, tracking_entry)
        active_release_status = normalize_anime_release_status(anime.get("status"), "Ongoing")
        anime["status"] = active_release_status
        return render_template(
            'anime_detail.html',
            anime=anime,
            tracking_entry=tracking_entry or {},
            progress_summary=progress_summary,
            anime_status_options=ANIME_RELEASE_STATUS_OPTIONS,
            active_anime_status=active_release_status,
            anime_status_label=anime_release_status_label
        )
    else:
        return "Anime not found", 404

@anime_bp.route('/add_anime', methods=['GET', 'POST'])
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
            return redirect(url_for('anime.add_anime'))

        if missing_metadata:
            return redirect(url_for('anime.add_anime', missing_metadata=",".join(missing_metadata)))

        anime_data = load_anime_data()
        if find_duplicate(anime_data, {"title": title, "season": season, "status": status}):
            return redirect(url_for('anime.add_anime', duplicate=1))

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

        return redirect(url_for('anime.index'))

    return render_template('add_anime.html')

@anime_bp.route('/mark_watched/<int:anime_id>/<int:episode_number>', methods=['POST'])
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

@anime_bp.route('/anime/<int:anime_id>/episodes', methods=['POST'])
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

@anime_bp.route('/anime/<int:anime_id>/episodes/<int:episode_number>', methods=['DELETE'])
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

@anime_bp.route('/mark_anime_watched/<int:anime_id>', methods=['POST'])
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

@anime_bp.route('/update_anime_link/<int:anime_id>', methods=['POST'])
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

@anime_bp.route('/delete_anime/<int:anime_id>', methods=['DELETE'])
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

@core_bp.route('/static/images/stars.mp4')
def serve_video1():
    return send_file("static/images/stars.mp4", mimetype="video/mp4", conditional=True)

@anime_bp.route('/bookmark/<int:anime_id>', methods=['POST'])
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

@anime_bp.route('/update_anime_status/<anime_id>', methods=['POST'])
def update_anime_status(anime_id):
    try:
        anime_id = int(anime_id)
        updated_data = request.get_json(silent=True) or {}
        new_status = normalize_anime_release_status(updated_data.get('status'), None)

        if not new_status:
            return jsonify({'status': 'error', 'message': 'Invalid or missing anime status'}), 400

        anime_list = load_anime_data()
        anime = next((item for item in anime_list if item.get('id') == anime_id), None)

        if not anime:
            return jsonify({'status': 'error', 'message': 'Anime not found'}), 404

        # This updates the anime release/airing status only.
        # Watched/unwatched progress remains controlled by the existing watched toggle.
        anime['status'] = new_status
        save_anime_data(anime_list)

        return jsonify({
            'status': 'success',
            'new_status': new_status,
            'new_status_label': anime_release_status_label(new_status)
        })

    except Exception as e:
        return jsonify({'status': 'error', 'message': str(e)}), 500

@queue_bp.route('/delete_from_queue/<int:index>', methods=['DELETE'])
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

@queue_bp.route('/queue/clear', methods=['POST'])
def clear_queue():
    save_queue({"queue": []})
    sync_tracking_queue()
    return jsonify({"status": "success", "queue": []})


@queue_bp.route('/queue/clear-watched', methods=['POST'])
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


@queue_bp.route('/queue/move-top/<int:index>', methods=['POST'])
def move_queue_item_top(index):
    queue = load_queue().get("queue", [])
    if not (0 <= index < len(queue)):
        return jsonify({"status": "error", "message": "Invalid index"}), 400
    item = queue.pop(index)
    queue.insert(0, item)
    save_queue({"queue": queue})
    sync_tracking_queue()
    return jsonify({"status": "success", "queue": build_enriched_queue()})


@queue_bp.route('/queue/reorder', methods=['POST'])
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


for blueprint in (
    core_bp,
    validation_bp,
    sections_bp,
    manga_bp,
    anime_bp,
    tracking_bp,
    player_bp,
    queue_bp,
):
    app.register_blueprint(blueprint)

if __name__ == '__main__':
    logging.basicConfig(level=logging.DEBUG)
    app.run(port=7777, debug=False)  # Runs Flask on port 7777
