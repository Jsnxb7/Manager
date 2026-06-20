import argparse
import json
from pathlib import Path


WINDOWS_RESERVED_NAMES = {
    "con", "prn", "aux", "nul",
    "com1", "com2", "com3", "com4", "com5", "com6", "com7", "com8", "com9",
    "lpt1", "lpt2", "lpt3", "lpt4", "lpt5", "lpt6", "lpt7", "lpt8", "lpt9",
}


def secure_path_part(value):
    cleaned = "".join("-" if char in '<>:"/\\|?*\x00' else char for char in (value or "").strip())
    cleaned = " ".join(cleaned.split()).strip(" .")
    if not cleaned:
        return ""
    if cleaned.casefold() in WINDOWS_RESERVED_NAMES:
        cleaned = f"{cleaned}_"
    return cleaned


def load_anime_entries(data_file):
    with data_file.open("r", encoding="utf-8") as file:
        data = json.load(file)

    if not isinstance(data, list):
        raise ValueError(f"{data_file} must contain a JSON list of anime entries.")

    return data


def collect_folder_paths(entries, target_root):
    folder_paths = {}
    skipped = []

    for index, entry in enumerate(entries, start=1):
        if not isinstance(entry, dict):
            skipped.append((index, "entry is not an object"))
            continue

        title = secure_path_part(entry.get("title"))
        season = secure_path_part(entry.get("season"))

        if not title:
            skipped.append((index, "missing title"))
            continue
        if not season:
            skipped.append((index, f"missing season for {entry.get('title', 'untitled')}"))
            continue

        folder_paths[(title.casefold(), season.casefold())] = target_root / title / season

    return sorted(folder_paths.values(), key=lambda path: str(path).casefold()), skipped


def create_folders(folder_paths, dry_run=False):
    created = []
    existing = []

    for folder_path in folder_paths:
        if folder_path.exists():
            existing.append(folder_path)
            continue

        if not dry_run:
            folder_path.mkdir(parents=True, exist_ok=True)
        created.append(folder_path)

    return created, existing


def parse_args():
    project_root = Path(__file__).resolve().parent

    parser = argparse.ArgumentParser(
        description="Create anime title folders with season subfolders from data/anime_data.json."
    )
    parser.add_argument(
        "--data-file",
        type=Path,
        default=project_root / "data" / "anime_data.json",
        help="Path to the anime JSON file. Defaults to data/anime_data.json.",
    )
    parser.add_argument(
        "--target-root",
        type=Path,
        default=project_root.parent,
        help="Folder where anime title folders are created. Defaults to the parent of this Manager folder.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Show what would be created without creating folders.",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="Print every created or planned folder path.",
    )
    return parser.parse_args()


def main():
    args = parse_args()
    data_file = args.data_file.resolve()
    target_root = args.target_root.resolve()

    if not data_file.exists():
        raise FileNotFoundError(f"Anime data file not found: {data_file}")

    if not args.dry_run:
        target_root.mkdir(parents=True, exist_ok=True)

    entries = load_anime_entries(data_file)
    folder_paths, skipped = collect_folder_paths(entries, target_root)
    created, existing = create_folders(folder_paths, dry_run=args.dry_run)

    action = "Would create" if args.dry_run else "Created"
    print(f"Data file: {data_file}")
    print(f"Target root: {target_root}")
    print(f"Anime season folders checked: {len(folder_paths)}")
    print(f"{action}: {len(created)}")
    print(f"Already existed: {len(existing)}")
    print(f"Skipped entries: {len(skipped)}")

    if created and args.verbose:
        print("\nFolders:")
        for folder_path in created:
            print(f"  {folder_path}")
    elif created:
        print("\nUse --verbose to print the full folder list.")

    if skipped:
        print("\nSkipped:")
        for index, reason in skipped:
            print(f"  Entry {index}: {reason}")


if __name__ == "__main__":
    main()
