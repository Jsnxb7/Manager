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


# Ensure folders exist
if not os.path.exists(STATIC_FOLDER) or not os.path.exists(TEMPLATES_FOLDER):
    print("Error: Flask data folder does not contain required directories.")
    sys.exit(1)

app = Flask(__name__, static_folder=STATIC_FOLDER, template_folder=TEMPLATES_FOLDER)

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
    for ext in ["jpg", "png", "jpeg", "avif"]:
        filename = f"{title}.{ext}"
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
        title = request.form.get('title').strip()
        chapters = int(request.form.get('chapters'))
        status = request.form.get('status')
        link = request.form.get("link")

        manga_data = load_manga_data()
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
            "bookmarked": False
        }

        manga_data.append(new_manga)
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

    for ext in [".jpg", ".png", ".jpeg"]:
        path = os.path.join(MANGA_IMAGE_FOLDER, title + ext)
        if os.path.exists(path):
            os.remove(path)
            break

    manga_data.pop(index)
    save_manga_data(manga_data)

    return jsonify({"status": "success"})

def load_anime_data():
    with open(DATA_FILE, 'r') as file:
        data = json.load(file)
        for anime in data:
            if "bookmarked" not in anime:
                anime["bookmarked"] = False
        data.sort(key=lambda anime : anime.get("title", "").lower())
        return data

# Save anime data
def save_anime_data(data):
    with open(DATA_FILE, 'w') as file:
        json.dump(data, file, indent=4)

@app.route('/')
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
    for ext in ["jpg", "png", "jpeg"]:
        filename = f"{title}.{ext}"
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

BASE_PATH = "C:/Users/shour/Documents/Anime"

@app.route('/add_anime', methods=['GET', 'POST'])
def add_anime():
    if request.method == 'POST':
        title = request.form.get('title').strip()
        season = request.form.get('season').strip()
        status = request.form.get('status')
        download_link = request.form.get('download_link')
        episodes = int(request.form.get('episodes'))
        anime_data = load_anime_data()
        existing_ids = {anime["id"] for anime in anime_data}
        new_id = 1
        while new_id in existing_ids:
            new_id += 1
        directory = os.path.join(BASE_PATH, title, f"{season}")
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
            "episodes": episodes_list
        }
        anime_data.append(new_anime)
        save_anime_data(anime_data)
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

@app.route('/mark_anime_watched/<int:anime_id>', methods=['POST'])
def mark_anime_watched(anime_id):
    anime_data = load_anime_data()
    anime = next((item for item in anime_data if item['id'] == anime_id), None)

    if anime:
        anime['watched'] = not anime.get('watched', False)  # Toggle watched status
        save_anime_data(anime_data)
        return jsonify({'status': 'success'})

    return jsonify({'status': 'error'}), 404

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
        for ext in ['.jpg', '.jpeg', '.png']:
            image_path = os.path.join('static/anime_images', anime_title + ext)
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
