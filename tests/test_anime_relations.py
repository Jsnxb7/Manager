import unittest

from anime_relations import (
    empty_relation_data,
    find_group,
    merge_related_ids,
    normalize_relation_title,
    remove_related_id,
    reorder_group,
    scan_relations,
    titles_are_related,
)


def anime(anime_id, title, season):
    return {"id": anime_id, "title": title, "season": season, "episodes": []}


class AnimeRelationTests(unittest.TestCase):
    def setUp(self):
        self.library = [
            anime(1, "One Piece", "Movie-2"),
            anime(2, "One Piece", "S2"),
            anime(3, "One Piece", "S1"),
            anime(4, "One Piece", "OVA"),
            anime(5, "One Punch Man", "S1"),
            anime(6, "One Piece - Final", "Special"),
        ]

    def test_normalization_and_similarity_rules(self):
        self.assertEqual(normalize_relation_title("  K-On__!! "), "k on")
        self.assertTrue(titles_are_related("One Piece", "one_piece"))
        self.assertTrue(titles_are_related("One Piece", "One Piece Final"))
        self.assertFalse(titles_are_related("Gin", "Gintama"))
        self.assertFalse(titles_are_related("One Piece", "One Punch Man"))

    def test_full_scan_and_default_order(self):
        data, linked = scan_relations(empty_relation_data(), self.library)
        group = find_group(data, 1)
        self.assertGreater(linked, 0)
        self.assertEqual(group["ordered_anime_ids"], [3, 2, 4, 6, 1])
        self.assertNotIn(5, group["ordered_anime_ids"])
        self.assertIsNotNone(data["last_full_scan_at"])

    def test_remove_blocks_future_scan_and_manual_add_clears_block(self):
        data, _ = scan_relations(empty_relation_data(), self.library)
        data = remove_related_id(data, self.library, 3, 2)
        data, _ = scan_relations(data, self.library, anime_id=2)
        self.assertNotIn(2, find_group(data, 3)["ordered_anime_ids"])

        data, group, _ = merge_related_ids(data, self.library, 3, 2, manual=True)
        self.assertIn(2, group["ordered_anime_ids"])
        self.assertFalse(any(pair["anime_ids"] == [2, 3] for pair in data["blocked_pairs"]))

    def test_custom_order_persists_and_reset_restores_default(self):
        data, _ = scan_relations(empty_relation_data(), self.library)
        members = list(find_group(data, 3)["ordered_anime_ids"])
        custom = list(reversed(members))
        data, group = reorder_group(data, self.library, 3, custom)
        self.assertEqual(group["order_mode"], "custom")
        self.assertEqual(group["ordered_anime_ids"], custom)
        data, group = reorder_group(data, self.library, 3, reset_default=True)
        self.assertEqual(group["order_mode"], "auto")
        self.assertEqual(group["ordered_anime_ids"], members)

    def test_invalid_reorder_is_rejected(self):
        data, _ = scan_relations(empty_relation_data(), self.library)
        with self.assertRaises(ValueError):
            reorder_group(data, self.library, 3, [3, 2])


if __name__ == "__main__":
    unittest.main()
