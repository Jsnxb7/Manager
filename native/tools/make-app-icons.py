"""Resizes the approved app icon into every platform format. Development tool; needs Pillow.

Usage: python tools/make-app-icons.py <approved 1024px PNG>
"""
import sys
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
PANEL = (10, 19, 29, 255)  # Keep equal to colors.panel in src/design/theme.ts.


def square(source: Image.Image) -> Image.Image:
    side = min(source.size)
    left, top = (source.width - side) // 2, (source.height - side) // 2
    return source.crop((left, top, left + side, top + side)).convert("RGBA")


def shrink(image: Image.Image, size: int) -> Image.Image:
    # One Lanczos pass straight from the full-size art, then a light unsharp mask on
    # small sizes, where downscaling softens the face and outlines most.
    out = image.resize((size, size), Image.LANCZOS, reducing_gap=None)
    if size <= 128:
        strength = 80 if size <= 48 else 50
        out = out.filter(ImageFilter.UnsharpMask(radius=0.6 if size <= 48 else 0.9, percent=strength, threshold=1))
    return out


def cutout(source: Image.Image) -> Image.Image:
    """Lifts the character off the artwork's night-blue tile onto transparency."""
    src = square(source).convert("RGB")
    side = src.width
    bg = src.getpixel((side // 2, side // 12))
    key = (255, 0, 255)
    work = src.copy()
    ImageDraw.floodfill(work, (3, 3), key, thresh=80)
    for seed in ((side // 2, side // 20), (side // 20, side // 2), (side - side // 20, side // 2), (side // 2, side - side // 20)):
        if work.getpixel(seed) != key:
            ImageDraw.floodfill(work, seed, key, thresh=40)

    def diff(c):
        return abs(c[0] - bg[0]) + abs(c[1] - bg[1]) + abs(c[2] - bg[2])

    sp, wp = src.load(), work.load()
    keep = Image.new("L", src.size, 0)
    kp = keep.load()
    for y in range(side):
        for x in range(side):
            if wp[x, y] != key and diff(sp[x, y]) >= 18:
                kp[x, y] = 255
    # Drop the anti-aliased rim of the original rounded tile.
    inset = Image.new("L", src.size, 0)
    margin = side * 0.03
    ImageDraw.Draw(inset).rounded_rectangle([margin, margin, side - margin, side - margin], radius=side * 0.2, fill=255)
    keep = ImageChops.multiply(keep, inset)
    edge = keep.point(lambda v: 255 - v).filter(ImageFilter.MaxFilter(5)).load()
    kp = keep.load()
    out = Image.new("RGBA", src.size, (0, 0, 0, 0))
    op = out.load()
    for y in range(side):
        for x in range(side):
            if not kp[x, y]:
                continue
            c = sp[x, y]
            if edge[x, y]:
                # Soft edge: alpha from the distance to the tile colour, with the
                # tile's share removed from the colour so no blue fringe remains.
                a = max(0, min(255, int((diff(c) - 18) / 52 * 255)))
                if not a:
                    continue
                f = a / 255
                c = tuple(max(0, min(255, round((c[i] - (1 - f) * bg[i]) / f))) for i in range(3))
                op[x, y] = (*c, a)
            else:
                op[x, y] = (*c, 255)
    left, top, right, bottom = out.getbbox()
    # Square canvas around the character, with a little air so it never touches edges.
    size = round(max(right - left, bottom - top) * 1.04)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.alpha_composite(out.crop((left, top, right, bottom)), ((size - (right - left)) // 2, (size - (bottom - top)) // 2))
    return canvas


def on_panel(image: Image.Image, width: int, height: int, scale: float, fill=(0, 0, 0, 0)) -> Image.Image:
    # Tiles stay transparent so only the character shows; the splash screen keeps the panel.
    canvas = Image.new("RGBA", (width, height), fill)
    side = int(min(width, height) * scale)
    canvas.alpha_composite(shrink(image, side), ((width - side) // 2, (height - side) // 2))
    return canvas


def main(path: str) -> None:
    # Only the character: the tile behind her is dropped so each platform shows
    # her on its own surface.
    art = cutout(Image.open(path))
    art.save(ROOT / "tools/icon-candidates/takagi-character.png")

    # The top bar shows the icon at 30 points. Exact pixel sizes for each display
    # scale mean the app never resamples it at run time.
    for scale in (1, 1.5, 2, 3, 4):
        suffix = "" if scale == 1 else f"@{scale:g}x"
        shrink(art, round(30 * scale)).save(ROOT / f"src/assets/app-icon{suffix}.webp", lossless=True, quality=100, method=6)

    for folder, size in {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}.items():
        out = ROOT / f"android/app/src/main/res/mipmap-{folder}"
        shrink(art, size).save(out / "ic_launcher.png", optimize=True)
        shrink(art, size).save(out / "ic_launcher_round.png", optimize=True)
        # Android 8+ adaptive icon: a 108 dp transparent canvas, the character inside the
        # 66 dp safe zone, so launchers show her alone instead of on a white tile.
        canvas = round(108 * size / 48)
        on_panel(art, canvas, canvas, 66 / 108).save(out / "ic_launcher_foreground.png", optimize=True)

    # Every frame is rendered on its own, so Windows never scales a frame itself
    # for the taskbar, title bar, Start or Explorer at common display scales.
    sizes = [16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 128, 256]
    frames = [shrink(art, size) for size in sizes]
    for name in ("AnimeManager.ico", "small.ico"):
        frames[-1].save(ROOT / f"windows/AnimeManager/{name}", sizes=[(n, n) for n in sizes], append_images=frames[:-1], bitmap_format="png")

    images = ROOT / "windows/AnimeManager.Package/Images"
    for name, (w, h, scale) in {
        "LockScreenLogo.scale-200.png": (48, 48, 1.0),
        "Square150x150Logo.scale-200.png": (300, 300, 0.8),
        "Square44x44Logo.scale-200.png": (88, 88, 1.0),
        "Square44x44Logo.targetsize-24_altform-unplated.png": (24, 24, 1.0),
        "StoreLogo.png": (50, 50, 1.0),
        "Wide310x150Logo.scale-200.png": (620, 300, 0.8),
        "SplashScreen.scale-200.png": (1240, 600, 0.6),
    }.items():
        on_panel(art, w, h, scale, PANEL if name.startswith("Splash") else (0, 0, 0, 0)).save(images / name)
    anydpi = ROOT / "android/app/src/main/res/mipmap-anydpi-v26"
    anydpi.mkdir(exist_ok=True)
    xml = """<?xml version="1.0" encoding="utf-8"?>
<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">
    <background android:drawable="@android:color/transparent" />
    <foreground android:drawable="@mipmap/ic_launcher_foreground" />
</adaptive-icon>
"""
    for name in ("ic_launcher.xml", "ic_launcher_round.xml"):
        (anydpi / name).write_text(xml, encoding="utf-8")
    print("App icons written")


if __name__ == "__main__":
    main(sys.argv[1])
