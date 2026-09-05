import copy
import json
import os
import tempfile
import unittest
from unittest.mock import patch

import app as manager
from library_paths import resolve_anime_paths
from rename_anime_paths import rename_anime_paths
from pathlib import Path


class LibraryPathTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = self.temp.name
        self.data_file = os.path.join(self.root, 'anime_data.json')
        self.record = {
            'id': 1, 'title': 'Renamed display title', 'season': 'S1',
            'directory': 'C:/Users/old/Documents/Anime\\Original folder\\S1',
            'episodes': [{'number': 1, 'watched': True,
                          'file_path': 'C:/Users/old/Documents/Anime/Original folder/S1/Extras/01.mkv'}]
        }
        with open(self.data_file, 'w', encoding='utf-8') as file:
            json.dump([self.record], file)
        for key, value in [('DATA_FOLDER', self.root), ('DATA_FILE', self.data_file)]:
            patcher = patch.object(manager, key, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.client = manager.app.test_client()

    def test_switch_root_persists_explorer_and_episode_paths(self):
        for folder in ['Library A', 'Library B']:
            root = os.path.join(self.root, folder)
            season = os.path.join(root, 'Original folder', 'S1')
            os.makedirs(os.path.join(season, 'Extras'))
            response = self.client.post('/api/anime-library', json={'root': root})
            self.assertEqual(response.status_code, 200)
            loaded = manager.load_anime_data()[0]
            self.assertEqual(loaded['directory'], season)
            self.assertEqual(loaded['episodes'][0]['file_path'],
                             os.path.join(season, 'Extras', '01.mkv').replace('\\', '/'))
            self.assertTrue(loaded['episodes'][0]['watched'])
            explorer = self.client.get('/api/anime/1/explorer-path').get_json()
            self.assertEqual(explorer['path'], season)
            self.assertTrue(explorer['exists'])
        with open(self.data_file, encoding='utf-8') as file:
            saved = json.load(file)[0]
        self.assertEqual(saved['directory'], season)
        self.assertEqual(saved['episodes'], loaded['episodes'])
        backups = list(Path(self.root).glob('anime_data.json.paths-*.bak'))
        self.assertEqual(len(backups), 2)
        self.assertTrue(any(json.loads(backup.read_bytes()) == [self.record] for backup in backups))
        self.assertEqual(manager.get_anime_library_root(), root)

    def test_repeat_same_root_does_not_rewrite_or_backup(self):
        self.client.post('/api/anime-library', json={'root': self.root})
        original = Path(self.data_file).read_bytes()
        response = self.client.post('/api/anime-library', json={'root': self.root})
        self.assertEqual(response.get_json()['updated'], 0)
        self.assertEqual(Path(self.data_file).read_bytes(), original)
        self.assertEqual(len(list(Path(self.root).glob('*.bak'))), 1)

    def test_dry_run_does_not_change_files(self):
        original = Path(self.data_file).read_bytes()
        result = rename_anime_paths(self.data_file, self.root, dry_run=True)
        self.assertEqual(result['updated'], 1)
        self.assertEqual(Path(self.data_file).read_bytes(), original)
        self.assertFalse(Path(self.root, 'anime_library.json').exists())
        self.assertEqual(list(Path(self.root).glob('*.bak')), [])

    def test_invalid_record_leaves_data_and_setting_unchanged(self):
        self.client.post('/api/anime-library', json={'root': self.root})
        entries = [self.record, {'title': 'Bad', 'library_relative_directory': '../outside'}]
        Path(self.data_file).write_text(json.dumps(entries), encoding='utf-8')
        original = Path(self.data_file).read_bytes()
        response = self.client.post('/api/anime-library', json={'root': self.root})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Path(self.data_file).read_bytes(), original)
        self.assertEqual(manager.get_anime_library_root(), self.root)

    def test_setting_write_failure_restores_original_data(self):
        from rename_anime_paths import atomic_write
        original = Path(self.data_file).read_bytes()
        def fail_settings(path, content):
            if Path(path).name == 'anime_library.json':
                raise OSError('Settings write failed')
            atomic_write(path, content)
        with patch('rename_anime_paths.atomic_write', side_effect=fail_settings):
            response = self.client.post('/api/anime-library', json={'root': self.root})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Path(self.data_file).read_bytes(), original)
        self.assertFalse(Path(self.root, 'anime_library.json').exists())

    def test_saved_records_rebase_again_and_preserve_nested_paths(self):
        first = os.path.join(self.root, 'first')
        second = os.path.join(self.root, 'second')
        os.makedirs(first)
        os.makedirs(second)
        self.client.post('/api/anime-library', json={'root': first})
        manager.save_anime_data(manager.load_anime_data())
        self.client.post('/api/anime-library', json={'root': second})
        loaded = manager.load_anime_data()[0]
        self.assertEqual(loaded['episodes'][0]['file_path'],
                         os.path.join(second, 'Original folder', 'S1', 'Extras', '01.mkv').replace('\\', '/'))

    def test_invalid_root_does_not_replace_setting(self):
        self.client.post('/api/anime-library', json={'root': self.root})
        response = self.client.post('/api/anime-library', json={'root': os.path.join(self.root, 'missing')})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(manager.get_anime_library_root(), self.root)

    def test_relative_path_cannot_escape_library(self):
        record = copy.deepcopy(self.record)
        record['library_relative_directory'] = '../outside'
        with self.assertRaises(ValueError):
            resolve_anime_paths(record, self.root)

    def test_cache_reuses_resolution_without_sharing_mutations(self):
        self.client.post('/api/anime-library', json={'root': self.root})
        manager.cached_anime_data.cache_clear()
        with patch.object(manager, 'resolve_anime_paths', wraps=resolve_anime_paths) as resolver:
            first = manager.load_anime_data()
            first[0]['episodes'][0]['watched'] = False
            second = manager.load_anime_data()
            self.assertTrue(second[0]['episodes'][0]['watched'])
            self.assertEqual(resolver.call_count, 1)
            manager.save_anime_data(first)
            self.assertFalse(manager.load_anime_data()[0]['episodes'][0]['watched'])
            self.assertEqual(resolver.call_count, 2)

    def test_external_file_edit_invalidates_cache(self):
        manager.load_anime_data()
        self.record['title'] = 'Externally changed title'
        Path(self.data_file).write_text(json.dumps([self.record]), encoding='utf-8')
        self.assertEqual(manager.load_anime_data()[0]['title'], self.record['title'])

    def test_summary_keeps_metadata_and_full_api_keeps_episodes(self):
        summary = self.client.get('/api/anime?summary=1').get_json()[0]
        full = self.client.get('/api/anime').get_json()[0]
        self.assertIn('episodes', full)
        self.assertNotIn('episodes', summary)
        self.assertEqual(summary, {key: value for key, value in full.items() if key != 'episodes'})

    def test_flask_accepts_electron_idle_shutdown_signal(self):
        with patch.object(manager, 'ELECTRON_INSTANCE_FILE', os.path.join(self.root, 'instances.json')):
            with patch.object(manager, 'idle_backend_shutdown') as scheduler:
                response = self.client.post('/api/backend-lifecycle/idle')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['grace_seconds'], 10)
        scheduler.schedule_if_idle.assert_called_once_with()

    def test_flask_rejects_idle_signal_without_electron_registry(self):
        with patch.object(manager, 'ELECTRON_INSTANCE_FILE', None):
            response = self.client.post('/api/backend-lifecycle/idle')
        self.assertEqual(response.status_code, 503)


if __name__ == '__main__':
    unittest.main()
