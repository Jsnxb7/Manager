from flask import Flask, render_template, request, jsonify, redirect, url_for
import json

app = Flask(__name__)

# Load data from JSON files
def load_anime_data():
    with open('anime_list.json', 'r') as file:
        return json.load(file)

def save_anime_data(data):
    with open('anime_list.json', 'w') as file:
        json.dump(data, file, indent=4)

def load_bookmarks():
    with open('bookmark.json', 'r') as file:
        return json.load(file)

def save_bookmarks(data):
    with open('bookmark.json', 'w') as file:
        json.dump(data, file, indent=4)

@app.route('/')
def home():
    anime_list = load_anime_data()
    return render_template('index.html', anime_list=anime_list)

@app.route('/bookmarks')
def bookmarks_page():
    bookmarks = load_bookmarks()
    return render_template('bookmarks.html', bookmarks=bookmarks)

@app.route('/anime/<int:anime_id>')
def anime_details(anime_id):
    anime_list = load_anime_data()
    anime = next((a for a in anime_list if a["id"] == anime_id), None)
    if anime:
        return render_template('anime.html', anime=anime)
    return "Anime not found", 404

@app.route('/bookmark/<int:anime_id>', methods=['POST'])
def bookmark_anime(anime_id):
    anime_list = load_anime_data()
    bookmarks = load_bookmarks()
    anime = next((a for a in anime_list if a["id"] == anime_id), None)
    if anime and anime not in bookmarks:
        bookmarks.append(anime)
        save_bookmarks(bookmarks)
    return redirect(url_for('bookmarks_page'))

@app.route('/remove_bookmark/<int:anime_id>', methods=['POST'])
def remove_bookmark(anime_id):
    bookmarks = load_bookmarks()
    bookmarks = [a for a in bookmarks if a["id"] != anime_id]
    save_bookmarks(bookmarks)
    return redirect(url_for('bookmarks_page'))

@app.route('/toggle_watch/<int:anime_id>/<int:episode_number>', methods=['POST'])
def toggle_watch(anime_id, episode_number):
    anime_list = load_anime_data()
    anime = next((a for a in anime_list if a["id"] == anime_id), None)
    if anime:
        episode = next((e for e in anime["episodes"] if e["number"] == episode_number), None)
        if episode:
            episode["watched"] = not episode["watched"]
            save_anime_data(anime_list)
    return jsonify(success=True)

if __name__ == '__main__':
    app.run(debug=True)
