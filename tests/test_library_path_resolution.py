import copy
import os
import unittest

from library_paths import resolve_anime_paths


class PathResolutionTests(unittest.TestCase):
    def setUp(self):
        self.record = {
            'title': 'Different display title', 'season': 'S1',
            'directory': 'C:/Old/Anime\\Original folder\\S1',
            'episodes': [{'number': 1, 'watched': True,
                          'file_path': 'C:/Old/Anime/Original folder/S1/Extras/01.mkv'}],
        }

    def test_relocation_preserves_folders_filename_and_watch_state(self):
        root = os.path.abspath('new library')
        result = resolve_anime_paths(copy.deepcopy(self.record), root)
        self.assertEqual(result['directory'], os.path.join(root, 'Original folder', 'S1'))
        self.assertEqual(result['episodes'][0]['file_path'],
                         os.path.join(root, 'Original folder', 'S1', 'Extras', '01.mkv').replace('\\', '/'))
        self.assertTrue(result['episodes'][0]['watched'])

    def test_switch_root_twice(self):
        record = copy.deepcopy(self.record)
        resolve_anime_paths(record, os.path.abspath('first library'))
        second = os.path.abspath('second library')
        resolve_anime_paths(record, second)
        self.assertEqual(record['episodes'][0]['file_path'],
                         os.path.join(second, 'Original folder', 'S1', 'Extras', '01.mkv').replace('\\', '/'))

    def test_explicit_relative_directory_preserves_deeper_layout(self):
        record = copy.deepcopy(self.record)
        record['library_relative_directory'] = 'Collection/Original folder/S1'
        result = resolve_anime_paths(record, os.path.abspath('library'))
        self.assertTrue(result['directory'].endswith(os.path.join('Collection', 'Original folder', 'S1')))

    def test_missing_paths_are_generated(self):
        record = {'title': 'Series', 'season': 'S2', 'episodes': [{'number': 3}]}
        result = resolve_anime_paths(record, os.path.abspath('library'))
        self.assertTrue(result['episodes'][0]['file_path'].endswith('/Series/S2/3.mp4'))

    def test_cannot_escape_root(self):
        for relative in ['../outside', 'C:/outside', '/outside']:
            record = copy.deepcopy(self.record)
            record['library_relative_directory'] = relative
            with self.assertRaises(ValueError):
                resolve_anime_paths(record, os.path.abspath('library'))

    def test_episode_from_another_drive_uses_original_basename(self):
        record = copy.deepcopy(self.record)
        record['episodes'][0]['file_path'] = 'D:/Downloads/Special 01.mkv'
        result = resolve_anime_paths(record, os.path.abspath('library'))
        self.assertTrue(result['episodes'][0]['file_path'].endswith('/Original folder/S1/Special 01.mkv'))


if __name__ == '__main__':
    unittest.main()
