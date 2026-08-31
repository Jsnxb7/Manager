import json
import os
import tempfile
import unittest

from flask import Flask

from blueprints.custom_player_routes import cleanup_custom_media


class CustomMediaCleanupTests(unittest.TestCase):
    def test_cleanup_removes_all_media_and_resets_playlist(self):
        with tempfile.TemporaryDirectory() as root:
            static_folder = os.path.join(root, "static")
            media_folder = os.path.join(static_folder, "custom_media")
            nested_folder = os.path.join(media_folder, "nested")
            instance_folder = os.path.join(root, "instance")
            playlist_folder = os.path.join(instance_folder, "custom_player_data")
            playlist_path = os.path.join(playlist_folder, "custom_playlist.json")

            os.makedirs(nested_folder)
            os.makedirs(playlist_folder)
            with open(os.path.join(media_folder, "video.mp4"), "wb") as file:
                file.write(b"video")
            with open(os.path.join(nested_folder, "segment.webm"), "wb") as file:
                file.write(b"segment")
            with open(playlist_path, "w", encoding="utf-8") as file:
                json.dump([{"path": "/static/custom_media/video.mp4"}], file)

            app = Flask(__name__, static_folder=static_folder)
            app.instance_path = instance_folder

            result = cleanup_custom_media(app)

            self.assertEqual(result, {"removed": 2, "failures": []})
            self.assertTrue(os.path.isdir(media_folder))
            self.assertEqual(os.listdir(media_folder), [])
            with open(playlist_path, encoding="utf-8") as file:
                self.assertEqual(json.load(file), [])


if __name__ == "__main__":
    unittest.main()
