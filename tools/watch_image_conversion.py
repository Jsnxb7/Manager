"""Keep cover folders WebP-only when another tool downloads files into them.

Start alongside any external downloader:
    python tools/watch_image_conversion.py
The Flask upload/Jikan paths already convert synchronously; this watcher covers
files placed directly in the image folders.
"""
from __future__ import annotations

import argparse
import time
from pathlib import Path

from convert_images_to_webp import FORMATS, convert


def scan(paths: list[Path], quality: int) -> None:
    for folder in paths:
        if not folder.exists():
            continue
        for image in folder.rglob("*"):
            if image.is_file() and image.suffix.lower() in FORMATS:
                # Ignore files still being copied; the next polling pass retries.
                try:
                    if time.time() - image.stat().st_mtime >= 2:
                        convert(image, quality=quality, keep_original=False)
                except OSError:
                    pass


def main() -> int:
    parser = argparse.ArgumentParser(description="Watch cover folders and convert new images to WebP")
    parser.add_argument("--interval", type=float, default=3.0)
    parser.add_argument("--quality", type=int, default=82, choices=range(1, 101))
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    folders = [root / "static" / "anime_images", root / "static" / "manga_images"]
    print("Watching cover folders for non-WebP images. Press Ctrl+C to stop.")
    try:
        while True:
            scan(folders, args.quality)
            time.sleep(max(1.0, args.interval))
    except KeyboardInterrupt:
        return 0


if __name__ == "__main__":
    raise SystemExit(main())
