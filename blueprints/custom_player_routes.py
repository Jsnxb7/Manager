"""
Flask routes for the Custom Media Player.

Register this blueprint in your main app:

    from custom_player_routes import custom_player_bp
    app.register_blueprint(custom_player_bp)

Behavior notes (matching the requirements):
- The JSON "queue" (custom_playlist.json) is wiped EVERY time the
  /custom_player home route is visited fresh -- so each new visit starts
  with an empty log and the user has to (re)import media.
- Navigating between items via /custom_player/<index> (prev/next rails,
  the "Switch Media" dropdown, or autoplay-on-ended) does NOT wipe the
  JSON -- it just reads the existing queue.
- Imported files are saved under static/custom_media and their paths +
  display names are appended to the JSON queue.
"""

import json
import os
import uuid

from flask import (
    Blueprint, render_template, request, jsonify,
    redirect, url_for, current_app
)
from werkzeug.utils import secure_filename

custom_player_bp = Blueprint("custom_player", __name__)


# --- JSON queue storage ----------------------------------------------------

def _playlist_path():
    data_dir = os.path.join(current_app.instance_path, "custom_player_data")
    os.makedirs(data_dir, exist_ok=True)
    return os.path.join(data_dir, "custom_playlist.json")


def load_playlist():
    path = _playlist_path()
    if not os.path.exists(path):
        return []
    try:
        with open(path, "r", encoding="utf-8") as fp:
            return json.load(fp)
    except (json.JSONDecodeError, OSError):
        return []


def save_playlist(playlist):
    with open(_playlist_path(), "w", encoding="utf-8") as fp:
        json.dump(playlist, fp, indent=2)


def reset_playlist():
    # Wipe all files in the custom_media upload folder on each new session
    try:
        upload_dir = os.path.join(current_app.static_folder, "custom_media")
        if os.path.isdir(upload_dir):
            for filename in os.listdir(upload_dir):
                filepath = os.path.join(upload_dir, filename)
                try:
                    if os.path.isfile(filepath):
                        os.remove(filepath)
                except OSError:
                    pass
    except RuntimeError:
        pass  # outside app context - skip file deletion

    save_playlist([])


# --- Page routes -------------------------------------------------------

@custom_player_bp.route("/custom_player")
def custom_player_home():
    # Fresh visit -> clear whatever was queued before.
    reset_playlist()
    return render_template(
        "custom_player.html",
        playlist=[],
        current_index=None,
        current_item=None,
        saved_progress={},
    )


@custom_player_bp.route("/custom_player/<int:index>")
def custom_player_play(index):
    playlist = load_playlist()
    if not playlist or index < 0 or index >= len(playlist):
        return redirect(url_for("custom_player.custom_player_home"))

    current_item = playlist[index]
    return render_template(
        "custom_player.html",
        playlist=playlist,
        current_index=index,
        current_item=current_item,
        saved_progress={},  # plug in real per-media progress lookup if needed
    )


# --- API routes ----------------------------------------------------------

ALLOWED_EXTENSIONS = {"mp4", "webm", "ogg", "mov", "mkv"}


def _allowed_file(filename):
    return "." in filename and filename.rsplit(".", 1)[1].lower() in ALLOWED_EXTENSIONS


@custom_player_bp.route("/api/custom_player/import", methods=["POST"])
def custom_player_import():
    files = request.files.getlist("media_files")
    if not files:
        return jsonify({"error": "No files received"}), 400

    upload_dir = os.path.join(current_app.static_folder, "custom_media")
    os.makedirs(upload_dir, exist_ok=True)

    playlist = load_playlist()

    for f in files:
        if not f.filename or not _allowed_file(f.filename):
            continue
        filename = secure_filename(f.filename)
        unique_name = f"{uuid.uuid4().hex[:8]}_{filename}"  # avoid collisions
        f.save(os.path.join(upload_dir, unique_name))

        playlist.append({
            "id": str(uuid.uuid4()),
            "name": filename,
            "path": url_for("static", filename=f"custom_media/{unique_name}"),
        })

    save_playlist(playlist)
    return jsonify({"playlist": playlist})


@custom_player_bp.route("/api/custom_player/playlist")
def custom_player_get_playlist():
    return jsonify({"playlist": load_playlist()})


@custom_player_bp.route("/api/custom_player/clear", methods=["POST"])
def custom_player_clear():
    reset_playlist()
    return jsonify({"status": "cleared"})


@custom_player_bp.route("/api/custom_player/progress", methods=["POST"])
def custom_player_progress():
    data = request.get_json(silent=True) or {}
    media_id = data.get("media_id")
    if not media_id:
        return jsonify({"status": "ignored"}), 200

    # Hook your real progress-tracking storage here (DB/session/etc.) if
    # you want resume-from-where-you-left-off across visits. Left as a
    # log line for now since the playlist itself is meant to be ephemeral.
    current_app.logger.info(
        "custom_player progress: media_id=%s time=%s/%s completed=%s",
        media_id, data.get("current_time"), data.get("total_duration"),
        data.get("completed"),
    )
    return jsonify({"status": "ok"})

@custom_player_bp.route("/api/custom_player/reorder", methods=["POST"])
def custom_player_reorder():
    data = request.get_json(silent=True) or {}
    order = data.get("order")
    playlist = load_playlist()

    if not isinstance(order, list) or len(order) != len(playlist):
        return jsonify({"error": "Invalid order"}), 400

    try:
        indices = [int(i) for i in order]
    except (TypeError, ValueError):
        return jsonify({"error": "Order must be numeric indices"}), 400

    if sorted(indices) != list(range(len(playlist))):
        return jsonify({"error": "Order indices mismatch"}), 400

    save_playlist([playlist[i] for i in indices])
    return jsonify({"status": "ok", "playlist": load_playlist()})