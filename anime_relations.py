"""Pure helpers for Anime Manager's local relationship graph."""

from __future__ import annotations

from datetime import datetime, timezone
from difflib import SequenceMatcher
import re
import unicodedata
import uuid


def utc_now_iso():
    return datetime.now(timezone.utc).isoformat()


def empty_relation_data():
    return {
        "schema_version": 1,
        "updated_at": None,
        "groups": [],
        "blocked_pairs": [],
        "last_full_scan_at": None,
    }


def normalize_relation_data(raw):
    result = empty_relation_data()
    if not isinstance(raw, dict):
        return result
    result["updated_at"] = raw.get("updated_at")
    result["last_full_scan_at"] = raw.get("last_full_scan_at")

    seen_members = set()
    for raw_group in raw.get("groups", []):
        if not isinstance(raw_group, dict):
            continue
        members = []
        for value in raw_group.get("ordered_anime_ids", []):
            try:
                anime_id = int(value)
            except (TypeError, ValueError):
                continue
            if anime_id not in members and anime_id not in seen_members:
                members.append(anime_id)
                seen_members.add(anime_id)
        if len(members) < 2:
            continue
        result["groups"].append({
            "id": str(raw_group.get("id") or uuid.uuid4()),
            "ordered_anime_ids": members,
            "order_mode": "custom" if raw_group.get("order_mode") == "custom" else "auto",
            "created_at": raw_group.get("created_at") or utc_now_iso(),
            "updated_at": raw_group.get("updated_at") or utc_now_iso(),
        })

    seen_pairs = set()
    for raw_pair in raw.get("blocked_pairs", []):
        values = raw_pair.get("anime_ids", []) if isinstance(raw_pair, dict) else []
        if not isinstance(values, list) or len(values) != 2:
            continue
        try:
            pair = tuple(sorted((int(values[0]), int(values[1]))))
        except (TypeError, ValueError):
            continue
        if pair[0] == pair[1] or pair in seen_pairs:
            continue
        seen_pairs.add(pair)
        result["blocked_pairs"].append({
            "anime_ids": list(pair),
            "removed_at": raw_pair.get("removed_at") or utc_now_iso(),
        })
    return result


def normalize_relation_title(value):
    normalized = unicodedata.normalize("NFKC", str(value or "")).casefold()
    normalized = re.sub(r"[_\W]+", " ", normalized, flags=re.UNICODE)
    return " ".join(normalized.split())


def titles_are_related(left, right):
    left_title = normalize_relation_title(left)
    right_title = normalize_relation_title(right)
    if not left_title or not right_title:
        return False
    if left_title == right_title:
        return True
    if min(len(left_title), len(right_title)) < 6:
        return False

    left_tokens = left_title.split()
    right_tokens = right_title.split()
    left_set = set(left_tokens)
    right_set = set(right_tokens)
    union = left_set | right_set
    token_overlap = len(left_set & right_set) / len(union) if union else 0
    similarity = SequenceMatcher(None, left_title, right_title).ratio()
    if similarity >= 0.90 and token_overlap >= 0.75:
        return True

    shorter, longer = (left_tokens, right_tokens) if len(left_tokens) <= len(right_tokens) else (right_tokens, left_tokens)
    is_prefix = len(shorter) >= 2 and longer[:len(shorter)] == shorter
    coverage = len(shorter) / len(longer) if longer else 0
    return is_prefix and coverage >= 0.60


def relation_order_key(anime):
    season = normalize_relation_title((anime or {}).get("season"))
    title = normalize_relation_title((anime or {}).get("title"))

    season_match = re.search(r"(?:^|\s)(?:s|season)\s*(\d+)(?:\D+(\d+))?", season)
    if not season_match:
        season_match = re.fullmatch(r"s(\d+)(?:\D+(\d+))?", season.replace(" ", ""))
    if season_match:
        return (0, int(season_match.group(1)), int(season_match.group(2) or 0), title)

    movie_match = re.search(r"(?:movie|film)(?:\s*[-_]?[ ]*(\d+))?", season)
    if movie_match:
        return (2, int(movie_match.group(1) or 1), 0, title)

    if any(token in season for token in ("ova", "ona", "special", "sns", "voc", "extra")):
        number_match = re.search(r"(\d+)", season)
        return (1, int(number_match.group(1)) if number_match else 0, 0, title)

    return (3, 0, 0, f"{season} {title}")


def sort_anime_ids(anime_ids, anime_lookup):
    unique = list(dict.fromkeys(int(value) for value in anime_ids))
    return sorted(unique, key=lambda anime_id: relation_order_key(anime_lookup.get(anime_id, {})))


def find_group(data, anime_id):
    anime_id = int(anime_id)
    return next((group for group in data.get("groups", []) if anime_id in group.get("ordered_anime_ids", [])), None)


def _blocked_pair_set(data):
    return {
        tuple(sorted(pair.get("anime_ids", [])))
        for pair in data.get("blocked_pairs", [])
        if isinstance(pair, dict) and len(pair.get("anime_ids", [])) == 2
    }


def cleanup_relations(data, anime_data):
    data = normalize_relation_data(data)
    valid_ids = {int(anime["id"]) for anime in anime_data if anime.get("id") is not None}
    next_groups = []
    for group in data["groups"]:
        members = [anime_id for anime_id in group["ordered_anime_ids"] if anime_id in valid_ids]
        if len(members) >= 2:
            group["ordered_anime_ids"] = members
            next_groups.append(group)
    data["groups"] = next_groups
    data["blocked_pairs"] = [
        pair for pair in data["blocked_pairs"]
        if all(anime_id in valid_ids for anime_id in pair["anime_ids"])
    ]
    return data


def _clear_blocks_between(data, left_ids, right_ids):
    clear_pairs = {
        tuple(sorted((int(left), int(right))))
        for left in left_ids for right in right_ids if int(left) != int(right)
    }
    data["blocked_pairs"] = [
        pair for pair in data["blocked_pairs"]
        if tuple(sorted(pair["anime_ids"])) not in clear_pairs
    ]


def merge_related_ids(data, anime_data, left_id, right_id, *, manual=False):
    data = normalize_relation_data(data)
    anime_lookup = {int(anime["id"]): anime for anime in anime_data if anime.get("id") is not None}
    left_id, right_id = int(left_id), int(right_id)
    if left_id == right_id or left_id not in anime_lookup or right_id not in anime_lookup:
        raise ValueError("Both anime IDs must exist and be different")

    left_group = find_group(data, left_id)
    right_group = find_group(data, right_id)
    left_members = list(left_group["ordered_anime_ids"]) if left_group else [left_id]
    right_members = list(right_group["ordered_anime_ids"]) if right_group else [right_id]
    if manual:
        _clear_blocks_between(data, left_members, right_members)
    elif tuple(sorted((left_id, right_id))) in _blocked_pair_set(data):
        return data, find_group(data, left_id), False

    if left_group is not None and left_group is right_group:
        return data, left_group, False

    now = utc_now_iso()
    combined = list(dict.fromkeys(left_members + right_members))
    order_mode = "custom" if any(
        group and group.get("order_mode") == "custom" for group in (left_group, right_group)
    ) else "auto"
    if order_mode == "auto":
        combined = sort_anime_ids(combined, anime_lookup)

    groups_to_remove = {id(group) for group in (left_group, right_group) if group}
    data["groups"] = [group for group in data["groups"] if id(group) not in groups_to_remove]
    created_at = min(
        [group.get("created_at") for group in (left_group, right_group) if group and group.get("created_at")] or [now]
    )
    merged = {
        "id": (left_group or right_group or {}).get("id") or str(uuid.uuid4()),
        "ordered_anime_ids": combined,
        "order_mode": order_mode,
        "created_at": created_at,
        "updated_at": now,
    }
    data["groups"].append(merged)
    return data, merged, True


def scan_relations(data, anime_data, anime_id=None):
    data = cleanup_relations(data, anime_data)
    anime_items = [anime for anime in anime_data if anime.get("id") is not None]
    blocked = _blocked_pair_set(data)
    comparisons = []
    if anime_id is None:
        for index, left in enumerate(anime_items):
            comparisons.extend((left, right) for right in anime_items[index + 1:])
    else:
        scoped_id = int(anime_id)
        left = next((anime for anime in anime_items if int(anime["id"]) == scoped_id), None)
        if not left:
            raise ValueError("Anime not found")
        comparisons = [(left, right) for right in anime_items if int(right["id"]) != scoped_id]

    linked = 0
    for left, right in comparisons:
        pair = tuple(sorted((int(left["id"]), int(right["id"]))))
        if pair in blocked or not titles_are_related(left.get("title"), right.get("title")):
            continue
        data, _group, changed = merge_related_ids(data, anime_items, pair[0], pair[1])
        linked += int(changed)

    now = utc_now_iso()
    if anime_id is None:
        data["last_full_scan_at"] = now
    data["updated_at"] = now
    return data, linked


def remove_related_id(data, anime_data, group_anchor_id, removed_id):
    data = cleanup_relations(data, anime_data)
    anchor_id, removed_id = int(group_anchor_id), int(removed_id)
    group = find_group(data, anchor_id)
    if not group or removed_id not in group["ordered_anime_ids"] or removed_id == anchor_id:
        raise ValueError("Related anime is not in this group")

    remaining = [anime_id for anime_id in group["ordered_anime_ids"] if anime_id != removed_id]
    existing_blocks = _blocked_pair_set(data)
    for anime_id in remaining:
        pair = tuple(sorted((removed_id, anime_id)))
        if pair not in existing_blocks:
            data["blocked_pairs"].append({"anime_ids": list(pair), "removed_at": utc_now_iso()})
            existing_blocks.add(pair)

    if len(remaining) < 2:
        data["groups"].remove(group)
    else:
        group["ordered_anime_ids"] = remaining
        group["updated_at"] = utc_now_iso()
    data["updated_at"] = utc_now_iso()
    return data


def reorder_group(data, anime_data, anime_id, ordered_ids=None, reset_default=False):
    data = cleanup_relations(data, anime_data)
    group = find_group(data, int(anime_id))
    if not group:
        raise ValueError("Anime has no relation group")
    anime_lookup = {int(anime["id"]): anime for anime in anime_data if anime.get("id") is not None}
    if reset_default:
        group["ordered_anime_ids"] = sort_anime_ids(group["ordered_anime_ids"], anime_lookup)
        group["order_mode"] = "auto"
    else:
        try:
            requested = [int(value) for value in ordered_ids]
        except (TypeError, ValueError):
            raise ValueError("Order must contain anime IDs")
        if len(requested) != len(set(requested)) or set(requested) != set(group["ordered_anime_ids"]):
            raise ValueError("Order must contain every group member exactly once")
        group["ordered_anime_ids"] = requested
        group["order_mode"] = "custom"
    group["updated_at"] = utc_now_iso()
    data["updated_at"] = utc_now_iso()
    return data, group

