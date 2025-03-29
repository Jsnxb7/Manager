from flask import Flask, send_file, render_template, jsonify, request, redirect, url_for
import json
import os
import sys

# Get Flask data directory from Electron arguments
if len(sys.argv) > 1:
    BASE_PATH = sys.argv[1]
else:
    print("Error: No Flask data directory provided by Electron.")
    sys.exit(1)

# Use the path received from Electron (default to current dir if not provided)
STATIC_FOLDER = os.path.join(BASE_PATH, 'static')
TEMPLATES_FOLDER = os.path.join(BASE_PATH, 'templates')
DATA_FILE = os.path.join(BASE_PATH, 'data', 'anime_data.json')
IMAGE_FOLDER = os.path.join(BASE_PATH, "static", "anime_images")
DEFAULT_IMAGE = os.path.join(BASE_PATH, "static", "placeholder.jpg")

# Ensure folders exist
if not os.path.exists(STATIC_FOLDER) or not os.path.exists(TEMPLATES_FOLDER):
    print("Error: Flask data folder does not contain required directories.")
    sys.exit(1)

app = Flask(__name__, static_folder=STATIC_FOLDER, template_folder=TEMPLATES_FOLDER)


# Load anime data
def load_anime_data():
    with open(DATA_FILE, 'r') as file:
        return json.load(file)

# Save anime data
def save_anime_data(data):
    with open(DATA_FILE, 'w') as file:
        json.dump(data, file, indent=4)


@app.route('/')
def index():
    anime_data = load_anime_data()
    return render_template('index.html', anime_data=anime_data)

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

# Player page
@app.route('/player/<int:anime_id>/<int:episode_number>')
def player(anime_id, episode_number):
    anime_data = load_anime_data()
    anime = next((item for item in anime_data if item['id'] == anime_id), None)
    if anime:
        episode = next((item for item in anime['episodes'] if item['number'] == episode_number), None)
        if episode:
            filename = os.path.basename(episode["file_path"])
            episode["video_url"] = f"/videos/{anime_id}/{filename}"
            return render_template('player.html', anime=anime, episode=episode)
    return "Anime or episode not found", 404

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
    anime_index = next((index for index, item in enumerate(anime_data) if item['id'] == anime_id), None)
    if anime_index is not None:
        anime_data.pop(anime_index)
        save_anime_data(anime_data)
        return jsonify({'status': 'success'})
    return jsonify({'status': 'error'}), 404

@app.route("/api/anime")
def get_anime():
    anime_data = load_anime_data()
    for anime in anime_data:
        anime["downloaded"] = any(os.path.exists(ep["file_path"]) for ep in anime.get("episodes", []))
    return jsonify(anime_data)
@app.route('/static/images/stars.mp4')
def serve_video1():
    return send_file("static/images/stars.mp4", mimetype="video/mp4", conditional=True)

if __name__ == '__main__':
    app.run(port=5000, debug=True)  # Runs Flask on port 5000
