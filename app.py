from flask import Flask, send_file, render_template, jsonify, request, redirect, url_for
import json
import os
import sys
from werkzeug.utils import secure_filename
import logging
import shutil

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
IMAGE_FOLDER = os.path.join(BASE_PATH, "static", "anime_images")
DEFAULT_IMAGE = os.path.join(BASE_PATH, "static", "placeholder.jpg")
MANGA_DATA_FILE = os.path.join(BASE_PATH, 'data', 'manga_data.json')
MANGA_IMAGE_FOLDER = os.path.join(BASE_PATH, "static", "manga_images")
DEFAULT_MANGA_IMAGE = os.path.join(BASE_PATH, "static", "placeholder.jpg")
DATA_FILE_SEC = os.path.join(BASE_PATH, 'data', 'sections.json')
DATA_FOLDER = os.path.join(BASE_PATH, 'data')
ANIME_TAGS_FILE = os.path.join(BASE_PATH, 'data', 'unique_anime_tags.json')
ALLOWED_IMAGE_EXTENSIONS = {"jpg", "jpeg", "png", "avif", "webp", "gif"}
IMAGE_EXTENSION_ORDER = ["jpg", "png", "jpeg", "avif", "webp", "gif"]
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
            "title": title,
            "status": status,
            "link": link
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


def load_manga_data():
    if not os.path.exists(MANGA_DATA_FILE):
        return []
    with open(MANGA_DATA_FILE, 'r') as file:
        data = json.load(file)
        for manga in data:
            if "bookmarked" not in manga:
                manga["bookmarked"] = False
            if "read" not in manga:
                manga["read"] = False
        data.sort(key=lambda m: m.get("title", "").lower())
        return data

def save_manga_data(data):
    with open(MANGA_DATA_FILE, 'w') as file:
        json.dump(data, file, indent=4)

def get_manga_image(title):
    for ext in IMAGE_EXTENSION_ORDER:
        for filename in image_filename_candidates(title, ext):
            filepath = os.path.join(MANGA_IMAGE_FOLDER, filename)
            if os.path.exists(filepath):
                return f"/static/manga_images/{filename}"
    return DEFAULT_MANGA_IMAGE

@app.route('/api/manga')
def api_manga():
    manga_data = load_manga_data()
    for manga in manga_data:
        manga["thumbnail_url"] = get_manga_image(manga["title"])
    return jsonify(manga_data)

@app.route('/manga')
def manga_index():
    return render_template("manga_index.html")

@app.route('/manga/<int:manga_id>')
def manga_detail(manga_id):
    manga_data = load_manga_data()
    manga = next((m for m in manga_data if m["id"] == manga_id), None)

    if manga:
        return render_template("manga_detail.html", manga=manga)

    return "Manga not found", 404

@app.route('/add_manga', methods=['GET', 'POST'])
def add_manga():
    if request.method == 'POST':
        title = request.form.get('title', '').strip()
        chapters = request.form.get('chapters')
        status = request.form.get('status')
        link = request.form.get("link")

        if not title or not secure_path_title(title):
            return redirect(url_for('add_manga'))

        manga_data = load_manga_data()
        if find_duplicate(manga_data, {"title": title, "status": status, "link": link}):
            return redirect(url_for('add_manga', duplicate=1))
        existing_ids = {m["id"] for m in manga_data}
        new_id = 1
        while new_id in existing_ids:
            new_id += 1

        new_manga = {
            "id": new_id,
            "title": title,
            "chapters": int(chapters) if chapters else None,
            "status": status,
            "link": link,
            "read": False,
            "bookmarked": False
        }

        manga_data.append(new_manga)
        save_uploaded_thumbnail(request.files.get("thumbnail"), title, MANGA_IMAGE_FOLDER)
        save_manga_data(manga_data)

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
    with open(DATA_FILE, 'r') as file:
        data = json.load(file)
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
    with open(DATA_FILE, 'w') as file:
        json.dump(data, file, indent=4)

def normalize_metadata_values(values):
    seen = set()
    normalized = []

    for value in values:
        clean_value = " ".join(str(value or "").strip().split())
        key = clean_value.casefold()
        if clean_value and key not in seen:
            seen.add(key)
            normalized.append(clean_value)

    return normalized

def parse_anime_metadata_form():
    metadata = {}

    for group in ["tags", "genres", "themes", "demographics"]:
        raw_value = request.form.get(group, "[]")
        try:
            parsed = json.loads(raw_value)
        except json.JSONDecodeError:
            parsed = []
        metadata[group] = normalize_metadata_values(parsed if isinstance(parsed, list) else [])

    return metadata

def missing_anime_metadata_groups(metadata):
    labels = {
        "genres": "Genres",
        "themes": "Themes",
        "demographics": "Demographics",
        "tags": "Tags"
    }
    return [label for group, label in labels.items() if not metadata.get(group)]

def rebuild_unique_anime_tags(anime_data):
    groups = {"tags": {}, "genres": {}, "themes": {}, "demographics": {}}

    for anime in anime_data:
        for group in groups:
            for value in anime.get(group, []) or []:
                clean_value = " ".join(str(value or "").strip().split())
                if clean_value:
                    groups[group][clean_value] = groups[group].get(clean_value, 0) + 1

    payload = {
        "summary": {f"unique_{group}": len(values) for group, values in groups.items()}
    }
    payload.update({
        group: [
            {"name": name, "count": count}
            for name, count in sorted(values.items(), key=lambda item: (-item[1], item[0].lower()))
        ]
        for group, values in groups.items()
    })

    with open(ANIME_TAGS_FILE, "w", encoding="utf-8") as file:
        json.dump(payload, file, indent=4, ensure_ascii=False)

@app.route('/')
def hub():
    sections = load_sections()
    return render_template("hub.html", sections=sections)

@app.route('/anime')
def index():
    anime_data = load_anime_data()  # loads anime_details.json
    queue_raw = load_queue()["queue"]

    # Enrich each queue item with anime details
    enriched_queue = []
    for item in queue_raw:
        anime = next((a for a in anime_data if a["id"] == item["id"]), None)
        if anime:
            enriched_queue.append({
                "title": anime["title"],
                "season": anime.get("season", "N/A"),
                "id": anime["id"]
            })

    return render_template("index.html", global_queue=enriched_queue)

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

@app.route('/videos/<int:anime_id>/<path:filename>')
def serve_video(anime_id, filename):
    anime_data = load_anime_data()
    anime = next((item for item in anime_data if item['id'] == anime_id), None)
    if anime:
        file_path = os.path.join(anime["directory"], filename)
        if os.path.exists(file_path):
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

        episodes = sorted(anime["episodes"], key=lambda x: x["number"])
        episode = next((e for e in episodes if e["number"] == episode_number), None)

        if not episode:
            return f"Episode {episode_number} not found for {anime_title}", 404

        filename = os.path.basename(episode["file_path"])
        episode["video_url"] = f"/videos/{anime_id}/{filename}"

        next_episode = next((e for e in episodes if e["number"] > episode_number), None)
        if next_episode:
            next_url = url_for('player', index=index) + f"?from_queue=true"
            next_episode_number = next_episode["number"]
        elif index + 1 < len(queue):
            next_url = url_for('player', index=index + 1) + f"?from_queue=true"
            next_episode_number = 1
        else:
            next_url = None
            next_episode_number = None

        return render_template("player.html", anime=anime, episode=episode, queue_index=index,
                               next_url=next_url, next_episode_number=next_episode_number)

    anime_data = load_anime_data()
    anime = next((item for item in anime_data if item['id'] == anime_id), None)
    if anime:
        episode = next((item for item in anime['episodes'] if item['number'] == episode_number), None)
        if episode:
            filename = os.path.basename(episode["file_path"])
            episode["video_url"] = f"/videos/{anime_id}/{filename}"
            return render_template('player.html', anime=anime, episode=episode)

    return "Anime or episode not found", 404

@app.context_processor
def inject_queue():
    try:
        queue_data = load_queue()
        return {'global_queue': queue_data.get('queue', [])}
    except:
        return {'global_queue': []}

@app.route("/queue")
def get_queue():
    try:
        queue_data = load_queue()
        return jsonify(queue_data)
    except Exception as e:
        print("Error loading queue:", e)
        return jsonify({"queue": []}), 40114

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

    return jsonify({'status': 'success'})

def load_queue():
    if not os.path.exists(QUEUE_FILE):
        return {"queue": []}
    with open(QUEUE_FILE, 'r') as f:
        return json.load(f)

def save_queue(data):
    with open(QUEUE_FILE, 'w') as f:
        json.dump(data, f)

@app.route('/anime/<int:anime_id>')
def anime_detail(anime_id):
    anime_data = load_anime_data()
    anime = next((item for item in anime_data if item['id'] == anime_id), None)
    if anime:
        for episode in anime["episodes"]:
            filename = os.path.basename(episode["file_path"])
            episode["video_url"] = f"/videos/{anime_id}/{filename}"
        return render_template('anime_detail.html', anime=anime)
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
        for episode in anime['episodes']:
            if episode['number'] == episode_number:
                episode['watched'] = not episode['watched']
                break
        save_anime_data(anime_data)
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

    return jsonify({'status': 'success', 'episodes': anime["episodes"], 'total_episodes': len(anime["episodes"])})

@app.route('/mark_anime_watched/<int:anime_id>', methods=['POST'])
def mark_anime_watched(anime_id):
    anime_data = load_anime_data()
    anime = next((item for item in anime_data if item['id'] == anime_id), None)

    if anime:
        anime['watched'] = not anime.get('watched', False)  # Toggle watched status
        save_anime_data(anime_data)
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

        return jsonify({'status': 'success'})

    return jsonify({'status': 'error'}), 425

@app.route("/api/anime")
def get_anime():
    anime_data = load_anime_data()
    for anime in anime_data:
        anime["thumbnail_url"] = get_anime_image(anime["title"])
        anime["downloaded"] = any(os.path.exists(ep["file_path"]) for ep in anime.get("episodes", []))
    return jsonify(anime_data)

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
        updated_data = request.get_json()
        new_status = updated_data.get('status')

        if not new_status:
            return jsonify({'status': 'error', 'message': 'Missing status'}), 400

        with open(DATA_FILE, 'r+', encoding='utf-8') as f:
            anime_list = json.load(f)
            updated = False

            for anime in anime_list:
                if anime['id'] == anime_id:
                    anime['status'] = new_status
                    updated = True
                    break

            if not updated:
                return jsonify({'status': 'error', 'message': 'Anime not found'}), 404

            f.seek(0)
            json.dump(anime_list, f, indent=4)
            f.truncate()

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
        return jsonify({"status": "success", "removed": removed})
    else:
        return jsonify({"status": "error", "message": "Invalid index"}), 400

if __name__ == '__main__':
    logging.basicConfig(level=logging.DEBUG)
    app.run(port=5000, debug=False)  # Runs Flask on port 5000
