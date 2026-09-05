"""Rewrite saved anime paths after changing the series library folder."""
import argparse
import json
import os
from pathlib import Path
import tempfile

from library_paths import resolve_anime_paths


def atomic_write(path, content):
    path = Path(path)
    fd, temporary = tempfile.mkstemp(prefix=f'.{path.name}.', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as output:
            output.write(content)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.remove(temporary)


def rename_anime_paths(data_file, root, dry_run=False):
    """Validate first, back up changed records, and save paths plus the root setting.

    Media files stay in place. Repeated calls with the same root are harmless.
    """
    root = os.fspath(root)
    if not os.path.isabs(root) or not os.path.isdir(root):
        raise ValueError('Select an existing absolute anime folder path.')
    root = os.path.normpath(root)
    data_file = Path(data_file)
    original = data_file.read_bytes()
    entries = json.loads(original)
    if not isinstance(entries, list):
        raise ValueError('Anime data must contain a JSON list.')
    updated = []
    changed = 0
    for entry in entries:
        record = {'title': entry, 'bookmarked': False} if isinstance(entry, str) else entry
        if not isinstance(record, dict):
            raise ValueError('Each anime entry must be an object or title.')
        before = json.dumps(record, sort_keys=True)
        resolve_anime_paths(record, root)
        changed += before != json.dumps(record, sort_keys=True)
        updated.append(record)
    backup = None
    if not dry_run:
        if changed:
            fd, backup = tempfile.mkstemp(prefix=f'{data_file.name}.paths-', suffix='.bak', dir=data_file.parent)
            with os.fdopen(fd, 'wb') as output:
                output.write(original)
            atomic_write(data_file, json.dumps(updated, indent=4).encode('utf-8'))
        try:
            atomic_write(data_file.parent / 'anime_library.json',
                         json.dumps({'root': root}, indent=4).encode('utf-8'))
        except OSError:
            if changed:
                atomic_write(data_file, original)
            raise
    return {'root': root, 'updated': changed, 'total': len(updated), 'backup': backup}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True, help='Existing absolute folder containing the anime series folders.')
    parser.add_argument('--data-file', type=Path, default=Path(__file__).resolve().parent / 'data' / 'anime_data.json')
    parser.add_argument('--dry-run', action='store_true', help='Preview counts without changing files.')
    args = parser.parse_args()
    try:
        result = rename_anime_paths(args.data_file, args.root, args.dry_run)
    except (ValueError, OSError) as error:
        parser.exit(1, f'Error: {error}\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
