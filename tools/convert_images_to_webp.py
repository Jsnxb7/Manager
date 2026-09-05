"""Convert Anime Manager cover assets to WebP.

Run once for existing assets, or invoke after an external downloader writes a
cover. Existing WebP files are left untouched. Original files are removed only
after the WebP has been written and verified.
"""
from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image, ImageOps

FORMATS = {".jpg", ".jpeg", ".png", ".gif", ".avif", ".bmp", ".tiff"}


def convert(source: Path, *, quality: int, keep_original: bool) -> bool:
    destination = source.with_suffix(".webp")
    if destination.exists():
        if not keep_original:
            try:
                with Image.open(destination) as check:
                    check.verify()
                source.unlink()
                print(f"removed legacy copy: {source.name}")
                return True
            except (OSError, ValueError):
                # Leave a possibly corrupt WebP and the original untouched so
                # a user can inspect it rather than losing a cover.
                return False
        return False
    try:
        with Image.open(source) as image:
            image = ImageOps.exif_transpose(image).convert("RGBA")
            backdrop = Image.new("RGBA", image.size, (18, 18, 20, 255))
            backdrop.alpha_composite(image)
            backdrop.convert("RGB").save(destination, "WEBP", quality=quality, method=6)
        # Re-open to catch failed/partial encodes before removing source.
        with Image.open(destination) as check:
            check.verify()
        if not keep_original:
            source.unlink()
        print(f"converted: {source.name}")
        return True
    except (OSError, ValueError) as error:
        print(f"skipped: {source.name} ({error})")
        destination.unlink(missing_ok=True)
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description="Convert Anime Manager covers to WebP")
    parser.add_argument("paths", nargs="*", type=Path, help="Folders or individual image files")
    parser.add_argument("--quality", type=int, default=82, choices=range(1, 101))
    parser.add_argument("--keep-original", action="store_true")
    options = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    paths = options.paths or [root / "static" / "anime_images", root / "static" / "manga_images"]
    images = []
    for path in paths:
        images.extend([path] if path.is_file() else path.rglob("*") if path.exists() else [])
    converted = sum(
        convert(image, quality=options.quality, keep_original=options.keep_original)
        for image in images if image.is_file() and image.suffix.lower() in FORMATS
    )
    print(f"Done: {converted} image(s) converted.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
