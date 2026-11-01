"""Regenerates the app-owned WebP UI assets. Development tool only; needs Pillow.

Usage: python tools/generate-ui-assets.py <path to universal-video-bg.webp>
"""
import math
import shutil
import sys
from pathlib import Path

from PIL import Image, ImageDraw

ASSETS = Path(__file__).resolve().parent.parent / "src" / "assets"
PANEL = (10, 19, 29)  # Keep equal to colors.panel in src/design/theme.ts.
RAMP = 128
SS = 4
ICON = 96


def ease(t):
    # Smootherstep has no visible shoulder where a fade meets the solid panel.
    return t * t * t * (t * (t * 6 - 15) + 10)


def fades():
    out = ASSETS / "fade"
    out.mkdir(parents=True, exist_ok=True)
    def save(name, alpha):
        h = len(alpha)
        w = len(alpha[0])
        img = Image.new("RGBA", (w, h))
        img.putdata([(*PANEL, round(a * 255)) for row in alpha for a in row])
        img.save(out / f"{name}.webp", lossless=True, quality=100, method=6)
    r = [ease((i + 0.5) / RAMP) for i in range(RAMP)]
    # Alpha rises toward the solid panel: left ramp is 0 at the outer edge.
    save("left", [r] * RAMP)
    save("right", [r[::-1]] * RAMP)
    save("top", [[a] * RAMP for a in r])
    save("bottom", [[a] * RAMP for a in r[::-1]])
    save("top-left", [[y * x for x in r] for y in r])
    save("top-right", [[y * x for x in r[::-1]] for y in r])
    save("bottom-left", [[y * x for x in r] for y in r[::-1]])
    save("bottom-right", [[y * x for x in r[::-1]] for y in r[::-1]])


class Pen:
    def __init__(self):
        self.size = ICON * SS
        self.img = Image.new("L", (self.size, self.size), 0)
        self.d = ImageDraw.Draw(self.img)
        self.w = round(8 * SS)

    def p(self, v):
        return v * SS

    def line(self, *pts):
        pts = [self.p(v) for v in pts]
        self.d.line(pts, fill=255, width=self.w, joint="curve")
        r = self.w / 2
        for x, y in (pts[i:i + 2] for i in range(0, len(pts), 2)):
            self.d.ellipse([x - r, y - r, x + r, y + r], fill=255)

    def circle(self, x, y, r, fill=False):
        box = [self.p(x - r), self.p(y - r), self.p(x + r), self.p(y + r)]
        self.d.ellipse(box, fill=255 if fill else None, outline=255, width=self.w)

    def rect(self, a, b, c, d, r=6, fill=False):
        self.d.rounded_rectangle(
            [self.p(a), self.p(b), self.p(c), self.p(d)],
            radius=self.p(r),
            fill=255 if fill else None,
            outline=255,
            width=self.w,
        )

    def poly(self, *pts):
        pts = [self.p(v) for v in pts]
        self.d.polygon(pts, fill=255)


def gear(p):
    p.circle(48, 48, 13)
    for i in range(8):
        a = i * math.pi / 4
        p.line(48 + 25 * math.cos(a), 48 + 25 * math.sin(a), 48 + 36 * math.cos(a), 48 + 36 * math.sin(a))
    p.circle(48, 48, 27)


ICONS = {
    "back": lambda p: p.line(56, 22, 30, 48, 56, 74),
    "forward": lambda p: p.line(40, 22, 66, 48, 40, 74),
    "up": lambda p: p.line(22, 58, 48, 32, 74, 58),
    "home": lambda p: (p.line(14, 46, 48, 16, 82, 46), p.line(24, 40, 24, 80, 72, 80, 72, 40), p.line(40, 80, 40, 58, 56, 58, 56, 80)),
    "play": lambda p: p.poly(28, 16, 80, 48, 28, 80),
    "queue": lambda p: (p.line(16, 26, 80, 26), p.line(16, 48, 80, 48), p.line(16, 70, 54, 70), p.poly(62, 58, 84, 70, 62, 82)),
    "search": lambda p: (p.circle(42, 42, 26), p.line(62, 62, 82, 82)),
    "filter": lambda p: (p.line(14, 28, 82, 28), p.line(26, 48, 70, 48), p.line(38, 68, 58, 68)),
    "settings": gear,
    "plus": lambda p: (p.line(48, 18, 48, 78), p.line(18, 48, 78, 48)),
    "check": lambda p: p.line(18, 50, 40, 72, 80, 26),
    "close": lambda p: (p.line(24, 24, 72, 72), p.line(72, 24, 24, 72)),
    "bookmark": lambda p: p.line(26, 14, 70, 14, 70, 82, 48, 64, 26, 82, 26, 14),
    "bookmark-filled": lambda p: p.poly(22, 10, 74, 10, 74, 88, 48, 68, 22, 88),
    "trash": lambda p: (p.line(14, 26, 82, 26), p.line(36, 26, 36, 14, 60, 14, 60, 26), p.line(24, 26, 28, 82, 68, 82, 72, 26), p.line(48, 40, 48, 68)),
    "grid": lambda p: (p.rect(14, 14, 42, 42), p.rect(54, 14, 82, 42), p.rect(14, 54, 42, 82), p.rect(54, 54, 82, 82)),
    "list": lambda p: (p.line(16, 26, 80, 26), p.line(16, 48, 80, 48), p.line(16, 70, 80, 70)),
    "tag": lambda p: (p.line(14, 14, 50, 14, 84, 48, 48, 84, 14, 50, 14, 14), p.circle(34, 34, 4, True)),
    "link": lambda p: (p.line(40, 56, 56, 40), p.line(34, 44, 22, 56, 22, 62, 34, 74, 40, 74, 52, 62), p.line(44, 34, 56, 22, 62, 22, 74, 34, 74, 40, 62, 52)),
    "reset": lambda p: (p.line(24, 30, 24, 52), p.d.arc([p.p(20), p.p(18), p.p(78), p.p(76)], 200, 520 - 360 + 360, fill=255, width=p.w), p.poly(10, 24, 40, 24, 24, 50)),
    "folder": lambda p: p.line(14, 26, 38, 26, 46, 36, 82, 36, 82, 76, 14, 76, 14, 26),
    "player": lambda p: (p.rect(12, 20, 84, 76), p.poly(40, 34, 62, 48, 40, 62)),
    "down": lambda p: p.line(22, 38, 48, 64, 74, 38),
    "pause": lambda p: (p.line(34, 20, 34, 76), p.line(62, 20, 62, 76)),
    "fullscreen": lambda p: (p.line(16, 34, 16, 16, 34, 16), p.line(62, 16, 80, 16, 80, 34), p.line(80, 62, 80, 80, 62, 80), p.line(34, 80, 16, 80, 16, 62)),
    "volume": lambda p: (p.line(14, 38, 30, 38, 50, 20, 50, 76, 30, 58, 14, 58, 14, 38), p.line(64, 36, 72, 48, 64, 60)),
    "mute": lambda p: (p.line(12, 38, 28, 38, 46, 20, 46, 76, 28, 58, 12, 58, 12, 38), p.line(60, 38, 82, 60), p.line(82, 38, 60, 60)),
    "captions": lambda p: (p.rect(10, 22, 86, 74), p.line(24, 48, 40, 48), p.line(50, 48, 72, 48), p.line(24, 60, 56, 60)),
    "alert": lambda p: (p.circle(48, 48, 36), p.line(48, 28, 48, 54), p.circle(48, 68, 4, True)),
    "top": lambda p: (p.line(20, 20, 76, 20), p.line(24, 64, 48, 40, 72, 64)),
    "edit": lambda p: (p.line(18, 78, 22, 58, 62, 18, 78, 34, 38, 74, 18, 78), p.line(52, 28, 68, 44)),
    "more": lambda p: (p.circle(20, 48, 5, True), p.circle(48, 48, 5, True), p.circle(76, 48, 5, True)),
}


def icons():
    out = ASSETS / "icons"
    out.mkdir(parents=True, exist_ok=True)
    for name, draw in ICONS.items():
        pen = Pen()
        draw(pen)
        mask = pen.img.resize((ICON, ICON), Image.LANCZOS)
        img = Image.new("RGBA", (ICON, ICON), (255, 255, 255, 0))
        img.putalpha(mask)
        img.save(out / f"{name}.webp", lossless=True, quality=100, method=6)


def background(source):
    out = ASSETS / "backgrounds"
    out.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, out / "mountains.webp")


if __name__ == "__main__":
    background(sys.argv[1])
    fades()
    icons()
    print("UI assets written to", ASSETS)
