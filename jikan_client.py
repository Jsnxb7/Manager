"""Small dependency-free Jikan v4 client and field mapper."""

from __future__ import annotations

from datetime import datetime, timezone
from html import unescape
import json
import re
import threading
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlparse
from urllib.request import Request, urlopen


class JikanError(RuntimeError):
    def __init__(self, message, status=502, retry_after=None):
        super().__init__(message)
        self.status = status
        self.retry_after = retry_after


class JikanClient:
    def __init__(self, base_url="https://api.jikan.moe/v4", timeout=8, min_interval=0.34):
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.min_interval = min_interval
        self._cache = {}
        self._suggestion_items = {}
        self._lock = threading.Lock()
        self._last_request_at = 0.0

    def _get_json(self, path, params=None, ttl=600):
        query = urlencode(params or {})
        url = f"{self.base_url}{path}" + (f"?{query}" if query else "")
        return self._get_json_url(url, ttl=ttl)

    def _get_json_url(self, url, ttl=600):
        now = time.monotonic()
        cached = self._cache.get(url)
        if cached and now - cached[0] < ttl:
            return cached[1]

        with self._lock:
            wait_for = self.min_interval - (time.monotonic() - self._last_request_at)
            if wait_for > 0:
                time.sleep(wait_for)
            request = Request(url, headers={
                "Accept": "application/json",
                "User-Agent": "AnimeManager/1.0 (+local Electron app)",
            })
            try:
                with urlopen(request, timeout=self.timeout) as response:
                    payload = json.loads(response.read().decode("utf-8"))
            except HTTPError as error:
                retry_after = error.headers.get("Retry-After") if error.headers else None
                status = 503 if error.code == 429 else 502
                message = "Jikan rate limit reached" if error.code == 429 else f"Jikan returned HTTP {error.code}"
                raise JikanError(message, status=status, retry_after=retry_after) from error
            except (URLError, TimeoutError) as error:
                raise JikanError("Jikan is currently unavailable", status=503) from error
            except (UnicodeDecodeError, json.JSONDecodeError) as error:
                raise JikanError("Jikan returned an invalid response", status=502) from error
            finally:
                self._last_request_at = time.monotonic()

        if not isinstance(payload, dict):
            raise JikanError("Jikan returned an invalid response", status=502)
        if len(self._cache) >= 128:
            oldest = min(self._cache, key=lambda key: self._cache[key][0])
            self._cache.pop(oldest, None)
        self._cache[url] = (time.monotonic(), payload)
        return payload

    def _get_text_url(self, url, ttl=3600):
        now = time.monotonic()
        cached = self._cache.get(url)
        if cached and now - cached[0] < ttl:
            return cached[1]

        with self._lock:
            wait_for = self.min_interval - (time.monotonic() - self._last_request_at)
            if wait_for > 0:
                time.sleep(wait_for)
            request = Request(url, headers={
                "Accept": "text/html,application/xhtml+xml",
                "User-Agent": "AnimeManager/1.0 (+local Electron app)",
            })
            try:
                with urlopen(request, timeout=self.timeout) as response:
                    payload = response.read(4 * 1024 * 1024 + 1)
                    if len(payload) > 4 * 1024 * 1024:
                        raise JikanError("MyAnimeList returned too much data", status=502)
                    text = payload.decode("utf-8", errors="replace")
            except HTTPError as error:
                retry_after = error.headers.get("Retry-After") if error.headers else None
                raise JikanError(
                    f"MyAnimeList returned HTTP {error.code}",
                    status=503 if error.code == 429 else 502,
                    retry_after=retry_after,
                ) from error
            except (URLError, TimeoutError) as error:
                raise JikanError("MyAnimeList is currently unavailable", status=503) from error
            finally:
                self._last_request_at = time.monotonic()

        if len(self._cache) >= 128:
            oldest = min(self._cache, key=lambda key: self._cache[key][0])
            self._cache.pop(oldest, None)
        self._cache[url] = (time.monotonic(), text)
        return text

    def search(self, media_type, query, limit=8):
        media_type = validate_media_type(media_type)
        limit = min(max(int(limit), 1), 8)
        try:
            payload = self._get_json(
                f"/{media_type}",
                {"q": query, "limit": limit, "sfw": "true"},
            )
            return [
                normalize_search_item(item, media_type)
                for item in payload.get("data", [])
                if isinstance(item, dict)
            ]
        except JikanError as error:
            # A 429 is an intentional throttle and should remain visible to the UI.
            # Jikan search can otherwise return a gateway error when MAL refuses its
            # scraper even though per-title Jikan requests are still healthy. MAL's
            # public suggestion endpoint supplies the same MAL IDs needed by detail().
            if error.retry_after:
                raise
            return self._search_mal_suggestions(media_type, query, limit)

    def _search_mal_suggestions(self, media_type, query, limit):
        url = "https://myanimelist.net/search/prefix.json?" + urlencode({
            "type": media_type,
            "keyword": query,
            "v": 1,
        })
        try:
            payload = self._get_json_url(url, ttl=600)
        except JikanError as error:
            raise JikanError(
                "Anime search is temporarily unavailable",
                status=503,
                retry_after=error.retry_after,
            ) from error

        categories = payload.get("categories")
        if not isinstance(categories, list):
            raise JikanError("Anime search returned an invalid response", status=502)
        items = []
        for category in categories:
            if not isinstance(category, dict) or category.get("type") != media_type:
                continue
            category_items = category.get("items")
            if isinstance(category_items, list):
                items.extend(category_items)
        results = [
            normalize_mal_suggestion(item, media_type)
            for item in items[:limit]
            if isinstance(item, dict)
        ]
        for item in results:
            if item.get("mal_id") is not None:
                self._suggestion_items[(media_type, int(item["mal_id"]))] = item
        return results

    def detail(self, media_type, mal_id):
        media_type = validate_media_type(media_type)
        mal_id = int(mal_id)
        try:
            payload = self._get_json(f"/{media_type}/{mal_id}/full", ttl=3600)
            item = payload.get("data")
            if not isinstance(item, dict):
                raise JikanError("Jikan did not return this title", status=404)
            return normalize_detail_item(item, media_type)
        except JikanError as error:
            if error.retry_after:
                raise
            suggestion = self._suggestion_items.get((media_type, mal_id))
            url = (suggestion or {}).get("url") or f"https://myanimelist.net/{media_type}/{mal_id}"
            try:
                return normalize_mal_detail(
                    self._get_text_url(url), media_type, mal_id, suggestion=suggestion
                )
            except JikanError:
                if suggestion:
                    return partial_detail_from_suggestion(suggestion, media_type)
                raise error


def validate_media_type(media_type):
    if media_type not in {"anime", "manga"}:
        raise ValueError("media_type must be anime or manga")
    return media_type


def _names(items):
    return list(dict.fromkeys(
        str(item.get("name") or "").strip()
        for item in (items or []) if isinstance(item, dict) and str(item.get("name") or "").strip()
    ))


def _image_url(item):
    images = item.get("images") if isinstance(item.get("images"), dict) else {}
    for format_name in ("webp", "jpg"):
        image_data = images.get(format_name) if isinstance(images.get(format_name), dict) else {}
        for key in ("large_image_url", "image_url", "small_image_url"):
            if image_data.get(key):
                return image_data[key]
    return ""


def normalize_search_item(item, media_type):
    aired = item.get("aired") if isinstance(item.get("aired"), dict) else {}
    published = item.get("published") if isinstance(item.get("published"), dict) else {}
    prop = (aired or published).get("prop") if isinstance((aired or published).get("prop"), dict) else {}
    start = prop.get("from") if isinstance(prop.get("from"), dict) else {}
    return {
        "mal_id": item.get("mal_id"),
        "title": item.get("title") or "Untitled",
        "title_english": item.get("title_english") or "",
        "title_japanese": item.get("title_japanese") or "",
        "media_type": media_type,
        "type": item.get("type") or "",
        "status": item.get("status") or "",
        "episodes": item.get("episodes") if media_type == "anime" else None,
        "year": item.get("year") or start.get("year"),
        "image_url": _image_url(item),
        "url": item.get("url") or "",
    }


def normalize_mal_suggestion(item, media_type):
    payload = item.get("payload") if isinstance(item.get("payload"), dict) else {}
    return {
        "mal_id": item.get("id"),
        "title": item.get("name") or "Untitled",
        "title_english": "",
        "title_japanese": "",
        "media_type": media_type,
        "type": payload.get("media_type") or "",
        "status": payload.get("status") or "",
        "episodes": None,
        "year": payload.get("start_year"),
        "image_url": item.get("image_url") or item.get("thumbnail_url") or "",
        "url": item.get("url") or "",
    }


def _strip_html(fragment):
    fragment = re.sub(r"<script\b[^>]*>.*?</script>", " ", fragment, flags=re.IGNORECASE | re.DOTALL)
    fragment = re.sub(r"<style\b[^>]*>.*?</style>", " ", fragment, flags=re.IGNORECASE | re.DOTALL)
    fragment = re.sub(r"<[^>]+>", " ", fragment)
    return " ".join(unescape(fragment).split())


def _mal_meta(document, name):
    pattern = rf'<meta[^>]+(?:property|name)=["\']{re.escape(name)}["\'][^>]+content=["\'](.*?)["\']'
    match = re.search(pattern, document, flags=re.IGNORECASE | re.DOTALL)
    if not match:
        reverse = rf'<meta[^>]+content=["\'](.*?)["\'][^>]+(?:property|name)=["\']{re.escape(name)}["\']'
        match = re.search(reverse, document, flags=re.IGNORECASE | re.DOTALL)
    return unescape(match.group(1)).strip() if match else ""


def _mal_field_fragment(document, label):
    pattern = (
        rf'<span[^>]*class=["\'][^"\']*dark_text[^"\']*["\'][^>]*>\s*'
        rf'{re.escape(label)}:\s*</span>(.*?)(?=<br\s*/?>|</div>)'
    )
    match = re.search(pattern, document, flags=re.IGNORECASE | re.DOTALL)
    return match.group(1) if match else ""


def _mal_field(document, label):
    return _strip_html(_mal_field_fragment(document, label))


def _mal_values(document, label):
    fragment = _mal_field_fragment(document, label)
    values = [
        _strip_html(value)
        for value in re.findall(r"<a\b[^>]*>(.*?)</a>", fragment, flags=re.IGNORECASE | re.DOTALL)
    ]
    if not values:
        plain = _strip_html(fragment)
        values = [value.strip() for value in plain.split(",")]
    return list(dict.fromkeys(value for value in values if value and value.casefold() != "none found"))


def normalize_mal_detail(document, media_type, mal_id, suggestion=None):
    suggestion = suggestion or {}
    title = _mal_meta(document, "og:title") or suggestion.get("title") or "Untitled"
    image_url = _mal_meta(document, "og:image") or suggestion.get("image_url") or ""
    media_kind = _mal_field(document, "Type") or suggestion.get("type") or ""
    status = _mal_field(document, "Status") or suggestion.get("status") or ""
    year_text = _mal_field(document, "Aired") or _mal_field(document, "Published")
    year_match = re.search(r"\b(19|20)\d{2}\b", year_text)
    episode_text = _mal_field(document, "Episodes") if media_type == "anime" else ""
    episode_match = re.search(r"\d+", episode_text)
    genres = _mal_values(document, "Genres") or _mal_values(document, "Genre")
    themes = _mal_values(document, "Themes") or _mal_values(document, "Theme")
    demographics = _mal_values(document, "Demographics") or _mal_values(document, "Demographic")
    result = {
        "mal_id": mal_id,
        "title": title,
        "title_english": _mal_field(document, "English"),
        "title_japanese": _mal_field(document, "Japanese"),
        "media_type": media_type,
        "type": media_kind,
        "status": status,
        "episodes": int(episode_match.group()) if episode_match else None,
        "year": int(year_match.group()) if year_match else suggestion.get("year"),
        "image_url": image_url,
        "url": _mal_meta(document, "og:url") or suggestion.get("url") or f"https://myanimelist.net/{media_type}/{mal_id}",
        "status_local": map_status(media_type, status),
        "genres": genres,
        "themes": themes,
        "demographics": demographics,
        "tags": list(dict.fromkeys(genres + themes + demographics)),
    }
    if media_type == "anime":
        result["season_local"] = infer_anime_season(title, media_kind)
    return result


def partial_detail_from_suggestion(suggestion, media_type):
    result = dict(suggestion)
    result.update({
        "status_local": map_status(media_type, suggestion.get("status")),
        "genres": [],
        "themes": [],
        "demographics": [],
        "tags": [],
    })
    if media_type == "anime":
        result["season_local"] = infer_anime_season(
            suggestion.get("title"), suggestion.get("type")
        )
    return result


def infer_anime_season(title, media_type):
    media_type = str(media_type or "").strip().casefold()
    direct = {"movie": "Movie", "ova": "OVA", "special": "Special"}
    if media_type in direct:
        return direct[media_type]
    title = str(title or "")
    patterns = [
        r"\bseason\s*(\d+)\b",
        r"\b(\d+)(?:st|nd|rd|th)\s+season\b",
        r"\bpart\s*(\d+)\b",
    ]
    for pattern in patterns:
        match = re.search(pattern, title, flags=re.IGNORECASE)
        if match:
            return f"S{int(match.group(1))}"
    return "S1"


def map_status(media_type, status):
    normalized = str(status or "").casefold()
    if media_type == "anime":
        if "currently airing" in normalized:
            return "Ongoing"
        if "finished" in normalized:
            return "Completed"
        if "not yet" in normalized:
            return "Not_Aired"
        return "Ongoing"
    if "publishing" in normalized:
        return "Ongoing"
    if "finished" in normalized:
        return "Completed"
    if "hiatus" in normalized:
        return "Hiatus"
    return "Ongoing"


def normalize_detail_item(item, media_type):
    genres = _names(item.get("genres")) + _names(item.get("explicit_genres"))
    genres = list(dict.fromkeys(genres))
    themes = _names(item.get("themes"))
    demographics = _names(item.get("demographics"))
    tags = list(dict.fromkeys(genres + themes + demographics))
    title = item.get("title") or "Untitled"
    result = normalize_search_item(item, media_type)
    result.update({
        "status_local": map_status(media_type, item.get("status")),
        "genres": genres,
        "themes": themes,
        "demographics": demographics,
        "tags": tags,
    })
    if media_type == "anime":
        result["season_local"] = infer_anime_season(title, item.get("type"))
    return result


def external_source(detail):
    return {
        "provider": "jikan",
        "mal_id": int(detail["mal_id"]),
        "url": detail.get("url") or "",
        "fetched_at": datetime.now(timezone.utc).isoformat(),
    }


def is_allowed_cover_url(url):
    parsed = urlparse(str(url or ""))
    return parsed.scheme == "https" and parsed.hostname in {"cdn.myanimelist.net", "myanimelist.net"}


def download_cover_bytes(url, timeout=8, max_bytes=8 * 1024 * 1024):
    if not is_allowed_cover_url(url):
        raise JikanError("Jikan cover URL was not allowed", status=400)
    request = Request(url, headers={"User-Agent": "AnimeManager/1.0 (+local Electron app)"})
    try:
        with urlopen(request, timeout=timeout) as response:
            content_type = str(response.headers.get("Content-Type") or "").split(";", 1)[0].strip().casefold()
            if content_type not in {"image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"}:
                raise JikanError("Jikan cover was not an image", status=502)
            data = response.read(max_bytes + 1)
            if len(data) > max_bytes:
                raise JikanError("Jikan cover was too large", status=502)
            extension = {
                "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
                "image/gif": "gif", "image/avif": "avif",
            }[content_type]
            return data, extension
    except (URLError, TimeoutError) as error:
        raise JikanError("Could not download the Jikan cover", status=503) from error
