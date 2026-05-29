from pathlib import Path

# Folders/files to ignore
IGNORE_DIRS = {
    ".git",
    ".idea",
    ".vscode",
    "__pycache__",
    "node_modules",
    "build",
    ".dart_tool",
    ".flutter-plugins",
    ".flutter-plugins-dependencies",
    "venv",
    "env",
    ".venv",
}

IGNORE_FILES = {
    ".DS_Store",
    "Thumbs.db",
}

def should_ignore(path: Path) -> bool:
    if path.name in IGNORE_DIRS or path.name in IGNORE_FILES:
        return True
    return False

def map_folder(folder: Path, prefix: str = "") -> list[str]:
    lines = []

    items = sorted(
        [item for item in folder.iterdir() if not should_ignore(item)],
        key=lambda x: (x.is_file(), x.name.lower())
    )

    for index, item in enumerate(items):
        is_last = index == len(items) - 1
        connector = "└── " if is_last else "├── "
        lines.append(prefix + connector + item.name)

        if item.is_dir():
            extension = "    " if is_last else "│   "
            lines.extend(map_folder(item, prefix + extension))

    return lines

def main():
    root = Path.cwd()
    output_file = root / "folder_structure.txt"

    lines = [root.name + "/"]
    lines.extend(map_folder(root))

    output_file.write_text("\n".join(lines), encoding="utf-8")

    print("\n".join(lines))
    print(f"\nFolder structure saved to: {output_file}")

if __name__ == "__main__":
    main()