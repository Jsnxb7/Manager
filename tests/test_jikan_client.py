import io
import json
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

from jikan_client import (
    JikanClient,
    JikanError,
    infer_anime_season,
    is_allowed_cover_url,
    map_status,
    normalize_detail_item,
)


class FakeResponse:
    def __init__(self, payload):
        self.payload = json.dumps(payload).encode("utf-8")
        self.headers = {"Content-Type": "application/json"}

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def read(self, *_args):
        return self.payload


class FakeHtmlResponse(FakeResponse):
    def __init__(self, payload):
        self.payload = payload.encode("utf-8")


class JikanClientTests(unittest.TestCase):
    def test_mapping_and_season_inference(self):
        item = normalize_detail_item({
            "mal_id": 10,
            "title": "Example 2nd Season",
            "type": "TV",
            "status": "Finished Airing",
            "episodes": 12,
            "url": "https://myanimelist.net/anime/10",
            "genres": [{"name": "Comedy"}],
            "themes": [{"name": "School"}],
            "demographics": [{"name": "Shounen"}],
            "images": {"jpg": {"large_image_url": "https://cdn.myanimelist.net/cover.jpg"}},
        }, "anime")
        self.assertEqual(item["status_local"], "Completed")
        self.assertEqual(item["season_local"], "S2")
        self.assertEqual(item["tags"], ["Comedy", "School", "Shounen"])
        self.assertEqual(infer_anime_season("Example", "Movie"), "Movie")
        self.assertEqual(map_status("manga", "On Hiatus"), "Hiatus")

    def test_allowed_cover_hosts(self):
        self.assertTrue(is_allowed_cover_url("https://cdn.myanimelist.net/images/a.jpg"))
        self.assertFalse(is_allowed_cover_url("http://cdn.myanimelist.net/images/a.jpg"))
        self.assertFalse(is_allowed_cover_url("https://example.com/a.jpg"))

    @patch("jikan_client.urlopen")
    def test_search_is_normalized_and_cached(self, mocked_urlopen):
        mocked_urlopen.return_value = FakeResponse({"data": [{
            "mal_id": 1, "title": "Cowboy Bebop", "type": "TV",
            "status": "Finished Airing", "episodes": 26, "year": 1998,
            "images": {"webp": {"image_url": "https://cdn.myanimelist.net/a.webp"}},
        }]})
        client = JikanClient(min_interval=0)
        first = client.search("anime", "Cowboy Bebop")
        second = client.search("anime", "Cowboy Bebop")
        self.assertEqual(first[0]["episodes"], 26)
        self.assertEqual(first, second)
        self.assertEqual(mocked_urlopen.call_count, 1)

    @patch("jikan_client.urlopen")
    def test_rate_limit_is_translated(self, mocked_urlopen):
        mocked_urlopen.side_effect = HTTPError(
            "https://api.jikan.moe/v4/anime", 429, "Too Many", {"Retry-After": "2"}, io.BytesIO()
        )
        with self.assertRaises(JikanError) as raised:
            JikanClient(min_interval=0).search("anime", "Bebop")
        self.assertEqual(raised.exception.status, 503)
        self.assertEqual(raised.exception.retry_after, "2")

    @patch("jikan_client.urlopen")
    def test_search_falls_back_to_mal_suggestions_on_jikan_gateway_error(self, mocked_urlopen):
        gateway_error = HTTPError(
            "https://api.jikan.moe/v4/anime", 504, "Gateway Timeout", {}, io.BytesIO()
        )
        suggestion = FakeResponse({"categories": [{
            "type": "anime",
            "items": [{
                "id": 25879,
                "type": "anime",
                "name": "Working!!!",
                "url": "https://myanimelist.net/anime/25879/Working",
                "image_url": "https://cdn.myanimelist.net/images/anime/7/73886.jpg",
                "payload": {
                    "media_type": "TV",
                    "start_year": 2015,
                    "status": "Finished Airing",
                },
            }],
        }]})
        mocked_urlopen.side_effect = [gateway_error, suggestion]

        results = JikanClient(min_interval=0).search("anime", "Working")

        self.assertEqual(results[0]["mal_id"], 25879)
        self.assertEqual(results[0]["title"], "Working!!!")
        self.assertEqual(results[0]["year"], 2015)
        self.assertEqual(mocked_urlopen.call_count, 2)

    @patch("jikan_client.urlopen")
    def test_detail_falls_back_to_mal_page_on_jikan_gateway_error(self, mocked_urlopen):
        gateway_error = HTTPError(
            "https://api.jikan.moe/v4/anime/25879/full", 504, "Gateway Timeout", {}, io.BytesIO()
        )
        html = """
            <meta property="og:title" content="Working!!!">
            <meta property="og:image" content="https://cdn.myanimelist.net/images/anime/7/73886.jpg">
            <meta property="og:url" content="https://myanimelist.net/anime/25879/Working">
            <div><span class="dark_text">English:</span> Wagnaria!!3<br></div>
            <div><span class="dark_text">Type:</span> TV<br></div>
            <div><span class="dark_text">Episodes:</span> 13<br></div>
            <div><span class="dark_text">Status:</span> Finished Airing<br></div>
            <div><span class="dark_text">Aired:</span> Jul 5, 2015 to Sep 27, 2015<br></div>
            <div><span class="dark_text">Genres:</span>
                <a href="/anime/genre/4/Comedy">Comedy</a>,
                <a href="/anime/genre/22/Romance">Romance</a><br>
            </div>
            <div><span class="dark_text">Theme:</span>
                <a href="/anime/theme/57/Workplace">Workplace</a><br>
            </div>
        """
        mocked_urlopen.side_effect = [gateway_error, FakeHtmlResponse(html)]

        result = JikanClient(min_interval=0).detail("anime", 25879)

        self.assertEqual(result["title"], "Working!!!")
        self.assertEqual(result["title_english"], "Wagnaria!!3")
        self.assertEqual(result["episodes"], 13)
        self.assertEqual(result["status_local"], "Completed")
        self.assertEqual(result["tags"], ["Comedy", "Romance", "Workplace"])


if __name__ == "__main__":
    unittest.main()
