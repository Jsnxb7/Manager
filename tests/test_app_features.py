import json
import os
import tempfile
import unittest
from unittest.mock import patch

import app as manager


def episode(number, watched=False):
    return {
        "number": number,
        "title": f"Episode {number}",
        "watched": watched,
        "file_path": f"C:/missing/{number}.mp4",
    }


class AppFeatureTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        root = self.temp.name
        self.paths = {
            "DATA_FILE": os.path.join(root, "anime_data.json"),
            "MANGA_DATA_FILE": os.path.join(root, "manga_data.json"),
            "QUEUE_FILE": os.path.join(root, "queue.json"),
            "TRACKING_FILE": os.path.join(root, "tracking.json"),
            "ANIME_RELATIONS_FILE": os.path.join(root, "relations.json"),
            "ANIME_TAGS_FILE": os.path.join(root, "anime_tags.json"),
            "MANGA_HEADERS_FILE": os.path.join(root, "manga_headers.json"),
            "IMAGE_FOLDER": os.path.join(root, "anime_images"),
            "MANGA_IMAGE_FOLDER": os.path.join(root, "manga_images"),
        }
        self.patchers = [patch.object(manager, name, value) for name, value in self.paths.items()]
        for patcher in self.patchers:
            patcher.start()
            self.addCleanup(patcher.stop)

        self.library = [
            {"id": 1, "title": "Series", "season": "S1", "status": "Completed", "episodes": [episode(1), episode(2)]},
            {"id": 2, "title": "Queued", "season": "S1", "status": "Completed", "episodes": [episode(1)]},
            {"id": 3, "title": "Series", "season": "S2", "status": "Completed", "episodes": [episode(1)]},
        ]
        self.write("DATA_FILE", self.library)
        self.write("MANGA_DATA_FILE", [])
        self.write("QUEUE_FILE", {"queue": [{"id": 2, "title": "Queued"}]})
        self.write("TRACKING_FILE", manager.empty_tracking_data())
        self.write("ANIME_RELATIONS_FILE", {
            "schema_version": 1, "updated_at": None,
            "groups": [{
                "id": "series", "ordered_anime_ids": [1, 3], "order_mode": "auto",
                "created_at": manager.utc_now_iso(), "updated_at": manager.utc_now_iso(),
            }],
            "blocked_pairs": [], "last_full_scan_at": manager.utc_now_iso(),
        })
        self.write("ANIME_TAGS_FILE", {"genres": [], "themes": [], "demographics": [], "tags": []})
        self.write("MANGA_HEADERS_FILE", {"genres": [], "themes": [], "demographics": [], "tags": []})
        self.client = manager.app.test_client()

    def write(self, key, payload):
        os.makedirs(os.path.dirname(self.paths[key]), exist_ok=True)
        with open(self.paths[key], "w", encoding="utf-8") as file:
            json.dump(payload, file)

    def test_add_forms_render_jikan_search(self):
        anime_response = self.client.get("/add_anime")
        manga_response = self.client.get("/add_manga")
        self.assertEqual(anime_response.status_code, 200)
        self.assertEqual(manga_response.status_code, 200)
        self.assertIn(b"jikan-search-input", anime_response.data)
        self.assertIn(b"jikan-search-input", manga_response.data)

    def test_relation_api_add_reorder_remove(self):
        added = self.client.post("/api/anime/1/relations", json={"related_anime_id": 2})
        self.assertEqual(added.status_code, 200)
        member_ids = [item["id"] for item in added.get_json()["relations"]]
        self.assertEqual(set(member_ids), {1, 2, 3})

        reordered = self.client.post(
            "/api/anime/1/relations/reorder", json={"ordered_anime_ids": [3, 2, 1]}
        )
        self.assertEqual([item["id"] for item in reordered.get_json()["relations"]], [3, 2, 1])

        removed = self.client.delete("/api/anime/1/relations/2")
        self.assertEqual(removed.status_code, 200)
        with open(self.paths["ANIME_RELATIONS_FILE"], encoding="utf-8") as file:
            saved = json.load(file)
        self.assertIn([1, 2], [pair["anime_ids"] for pair in saved["blocked_pairs"]])

    def test_playback_priority_episode_then_relation_then_queue(self):
        with manager.app.test_request_context("/"):
            first = manager.resolve_next_playback_target(self.library[0], self.library[0]["episodes"][0])
            self.assertEqual(first["type"], "episode")
            self.assertEqual(first["episode_number"], 2)

            self.write("QUEUE_FILE", {"queue": [
                {"id": 1, "title": "Series"},
                {"id": 2, "title": "Queued"},
            ]})
            related = manager.resolve_next_playback_target(
                self.library[0], self.library[0]["episodes"][1], queue_index=0
            )
            self.assertEqual(related["type"], "relation")
            self.assertEqual(related["anime_id"], 3)
            self.assertIn("queue_after=0", related["url"])

            queued = manager.resolve_next_playback_target(
                self.library[2], self.library[2]["episodes"][0], continuation_queue_index=0
            )
            self.assertEqual(queued["type"], "queue")
            self.assertEqual(queued["anime_id"], 2)

    def test_previous_playback_episode_relation_then_queue(self):
        with manager.app.test_request_context("/"):
            previous_episode = manager.resolve_previous_playback_target(
                self.library[0], self.library[0]["episodes"][1]
            )
            self.assertEqual(previous_episode["type"], "episode")
            self.assertEqual(previous_episode["episode_number"], 1)

            self.write("QUEUE_FILE", {"queue": [
                {"id": 1, "title": "Series"},
                {"id": 2, "title": "Queued"},
            ]})
            previous_queue = manager.resolve_previous_playback_target(
                self.library[1], self.library[1]["episodes"][0], queue_index=1
            )
            self.assertEqual(previous_queue["type"], "queue")
            self.assertEqual(previous_queue["anime_id"], 1)
            self.assertEqual(previous_queue["episode_number"], 2)

            self.write("QUEUE_FILE", {"queue": [
                {"id": 2, "title": "Queued"},
                {"id": 3, "title": "Series"},
            ]})
            previous_relation = manager.resolve_previous_playback_target(
                self.library[2], self.library[2]["episodes"][0], queue_index=1
            )
            self.assertEqual(previous_relation["type"], "relation")
            self.assertEqual(previous_relation["anime_id"], 1)
            self.assertEqual(previous_relation["episode_number"], 2)

    def test_detail_page_renders_tabs(self):
        response = self.client.get("/anime/1")
        self.assertEqual(response.status_code, 200)
        self.assertIn(b"relations-tab", response.data)
        self.assertIn(b"relations-panel", response.data)


if __name__ == "__main__":
    unittest.main()
