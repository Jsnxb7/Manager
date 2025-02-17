from flask import Flask, send_file, render_template, jsonify, request, redirect, url_for
import json
import os

app = Flask(__name__)

# Load anime data from JSON file
def load_anime_data():
    with open('data/anime_data.json', 'r') as file:
        return json.load(file)

# Save anime data to JSON file
def save_anime_data(data):
    with open('data/anime_data.json', 'w') as file:
        json.dump(data, file, indent=4)

@app.route('/')
def index():
    anime_data = load_anime_data()
    return render_template('index.html', anime_data=anime_data)

@app.route('/api/anime')
def api_anime():
    anime_data = load_anime_data()
    return jsonify(anime_data)

@app.route('/videos/<int:anime_id>/<path:filename>')
def serve_video(anime_id, filename):
    anime_data = load_anime_data()
    anime = next((item for item in anime_data if item['id'] == anime_id), None)
    
    if anime:
        # Construct the absolute file path
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

        # Load existing anime data
        anime_data = load_anime_data()

        # Find the next available unique ID
        existing_ids = {anime["id"] for anime in anime_data}  # Get all existing IDs
        new_id = 1  # Start with 1

        while new_id in existing_ids:
            new_id += 1  # Find the next available number

        # Automatically determine the directory path
        directory = os.path.join(BASE_PATH, title, f"{season}")

        # Ensure the directory exists
        os.makedirs(directory, exist_ok=True)

        # Create episodes list with file paths
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
            "id": new_id,  # Use the dynamically found ID
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

@app.route('/delete_anime/<int:anime_id>', methods=['DELETE'])
def delete_anime(anime_id):
    anime_data = load_anime_data()
    anime_index = next((index for index, item in enumerate(anime_data) if item['id'] == anime_id), None)
    if anime_index is not None:
        anime_data.pop(anime_index)
        save_anime_data(anime_data)
        return jsonify({'status': 'success'})
    return jsonify({'status': 'error'}), 404

if __name__ == '__main__':
    app.run(debug=True)
