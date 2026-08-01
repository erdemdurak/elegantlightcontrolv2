#!/usr/bin/env python3
"""
SUPERSEDED: the shipped icon is assets/ambient_light_icon3.png, prepared by hand into
Images.xcassets/AppIcon.appiconset/icon-1024.png. Running this script will overwrite it.

Generate the app icon: a glowing W205 turbine air vent.

Drawn at 4x then downsampled, which is cheaper than antialiasing by hand and gives clean
edges on the thin star strokes at 40px.

Usage:  python3 tools/make-icon.py
Writes into ios/ElegantLightControl/Images.xcassets/AppIcon.appiconset/ and rewrites
Contents.json with the generated filenames.
"""

import json
import math
import os

from PIL import Image, ImageDraw, ImageFilter

HERE = os.path.dirname(os.path.abspath(__file__))
ICONSET = os.path.join(
    HERE, "..", "ios", "ElegantLightControl", "Images.xcassets", "AppIcon.appiconset"
)

BASE = 1024
SS = 4  # supersample factor
S = BASE * SS

BG_INNER = (14, 24, 46)
BG_OUTER = (5, 8, 15)
RING_COLD = (80, 200, 255)   # cyan
RING_WARM = (59, 130, 246)   # blue
STAR = (215, 240, 255)   # lit hub


def radial_background() -> Image.Image:
    """Vertical-ish radial falloff, brighter in the middle so the ring has something to sit on."""
    img = Image.new("RGB", (S, S), BG_OUTER)
    px = img.load()
    cx = cy = S / 2
    maxd = math.hypot(cx, cy)
    # Row-wise is fast enough and avoids a per-pixel python loop over 16M pixels.
    small = Image.new("RGB", (256, 256), BG_OUTER)
    spx = small.load()
    for y in range(256):
        for x in range(256):
            d = math.hypot(x - 128, y - 128) / 181.0
            d = min(1.0, d)
            t = d * d
            spx[x, y] = (
                int(BG_INNER[0] + (BG_OUTER[0] - BG_INNER[0]) * t),
                int(BG_INNER[1] + (BG_OUTER[1] - BG_INNER[1]) * t),
                int(BG_INNER[2] + (BG_OUTER[2] - BG_INNER[2]) * t),
            )
    return small.resize((S, S), Image.BICUBIC)


def vent_layer() -> Image.Image:
    """
    The W205 turbine vent: an outer rim, an inner rim, radial fins between them, lit hub.

    Fin width is deliberately generous — at 40px the hairline version from the mock-up
    disappeared entirely, so they are thickened to survive downsampling.
    """
    layer = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    cx = cy = S / 2

    outer = [S * 0.14, S * 0.14, S * 0.86, S * 0.86]
    inner = [S * 0.31, S * 0.31, S * 0.69, S * 0.69]

    d.ellipse(outer, outline=RING_COLD + (255,), width=int(S * 0.048))
    d.ellipse(inner, outline=RING_COLD + (205,), width=int(S * 0.030))

    for k in range(8):
        ang = math.radians(k * 45 + 22.5)
        d.line(
            [
                cx + S * 0.170 * math.cos(ang), cy + S * 0.170 * math.sin(ang),
                cx + S * 0.340 * math.cos(ang), cy + S * 0.340 * math.sin(ang),
            ],
            fill=RING_COLD + (190,),
            width=int(S * 0.022),
        )

    hub = S * 0.062
    d.ellipse([cx - hub, cy - hub, cx + hub, cy + hub], fill=STAR + (255,))

    glow = layer.filter(ImageFilter.GaussianBlur(S * 0.024))
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    out.alpha_composite(glow)
    out.alpha_composite(layer)
    return out


def build() -> Image.Image:
    img = radial_background().convert("RGBA")
    img.alpha_composite(vent_layer())
    return img.convert("RGB").resize((BASE, BASE), Image.LANCZOS)


def main() -> None:
    master = build()
    contents = json.load(open(os.path.join(ICONSET, "Contents.json")))

    # Xcode 15+/26 take a single 1024 master and derive every size themselves.
    master.save(os.path.join(ICONSET, "icon-1024.png"))
    print("  icon-1024.png    1024x1024 (single-size catalog)")
    _ = contents


if __name__ == "__main__":
    main()
