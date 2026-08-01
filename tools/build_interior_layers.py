#!/usr/bin/env python3
"""
Split assets/interior.png into a light-free base plate plus one alpha mask per area.

The app then recolours the *actual* fibre-optic lines and vent rings in the photo by
tinting each mask, instead of pasting coloured rectangles over the top of them.

How the masks are found: every ambient light in the source photo is blue, and nothing
else in the cabin is. `blueness = B - (R + G) / 2` isolates them almost perfectly —
matte trim scores under 10, the lit strips score 55-155. Screens and the windshield
also score high, so they are cut out by rectangle, as is each light assigned to its
area. Coordinates are pixel coords in the 1399x1124 source.

Run:  python3 tools/build_interior_layers.py
"""

import os
from PIL import Image, ImageChops, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "assets", "interior.png")
OUT = os.path.join(ROOT, "assets")

# blueness -> alpha ramp. Below FLOOR is unlit trim; CEIL is the core of a lit strip.
FLOOR, CEIL = 22, 150

# Bright things that are blue but are not ambient lights.
EXCLUDE = [
    (0, 0, 1399, 345),      # windshield, headliner, everything above the dash top
    (280, 400, 575, 580),   # instrument cluster
    (598, 378, 842, 478),   # centre MBUX screen
]

# Area 2 — air vents and Burmester tweeter grilles.
AREA2 = [
    (100, 345, 205, 448),    # upper left turbine vent
    (103, 468, 194, 557),    # left tweeter grille
    (1213, 345, 1322, 448),  # upper right turbine vent
    (1230, 468, 1322, 557),  # right tweeter grille
    (178, 448, 260, 528),    # left dash vent
    (1141, 445, 1230, 530),  # right dash vent
    (586, 486, 840, 568),    # three centre vents
    (838, 452, 1125, 502),   # AMG dash trim line
]

# Area 1 — door trim lines, door cards, footwells, seat piping, centre console.
AREA1 = [
    (0, 552, 232, 702),      # left door card, switch panel and trim line
    (1248, 552, 1399, 702),  # right door card
    (388, 655, 622, 872),    # left footwell and pedals
    (838, 648, 1062, 832),   # right footwell
    (0, 866, 342, 978),      # left seat piping
    (1038, 866, 1399, 978),  # right seat piping
    (598, 698, 842, 902),    # centre console
]


def blueness_alpha(im):
    r, g, b = im.split()
    lut = [max(0, min(255, int((v - FLOOR) * 255 / (CEIL - FLOOR)))) for v in range(256)]
    return ImageChops.subtract(b, Image.blend(r, g, 0.5)).point(lut)


def region_mask(size, rects, blur=6):
    m = Image.new("L", size, 0)
    d = ImageDraw.Draw(m)
    for rect in rects:
        d.rectangle(rect, fill=255)
    return m.filter(ImageFilter.GaussianBlur(blur))


def split_by_territory(glow, size):
    """
    Every lit pixel belongs to one area or the other — no blue may survive, or a red cabin
    ends up with blue spill on the dash. The boxes above only bound the light sources; the
    bloom they throw onto surrounding trim lands outside them. So each area's boxes are
    blurred wide into a territory field and every lit pixel is split between the two in
    proportion, which both covers the spill and keeps the handover smooth.
    """
    soft1 = region_mask(size, AREA1, blur=70).point(lambda v: v // 4 + 4).getdata()
    soft2 = region_mask(size, AREA2, blur=70).point(lambda v: v // 4).getdata()
    # A light inside its own box must not be split with the neighbour's field — without this
    # the tweeters sit close enough to the door cards to come out a muddy mix of both colours.
    hard1 = region_mask(size, AREA1, blur=8).getdata()
    hard2 = region_mask(size, AREA2, blur=8).getdata()
    gd = glow.getdata()
    d1, d2 = [0] * len(gd), [0] * len(gd)
    for i, g in enumerate(gd):
        if not g:
            continue
        w1 = soft1[i] + 8 * hard1[i]
        w2 = soft2[i] + 8 * hard2[i]
        d1[i] = g * w1 // (w1 + w2)
        d2[i] = g - d1[i]
    a1, a2 = Image.new("L", size), Image.new("L", size)
    a1.putdata(d1)
    a2.putdata(d2)
    return a1, a2


def main():
    im = Image.open(SRC).convert("RGB")
    size = im.size

    glow = blueness_alpha(im)
    keep = ImageChops.invert(region_mask(size, EXCLUDE, blur=3))
    glow = ImageChops.multiply(glow, keep)

    a1, a2 = split_by_territory(glow, size)

    # Base plate: wherever a light burns, drop to a dim desaturated version of the photo.
    # Keeping the luminance detail means vent slats and switch legends survive the wash.
    combined = ImageChops.lighter(a1, a2)
    dim = Image.merge("RGB", [im.convert("L").point(lambda v: int(v * 0.30))] * 3)
    base = Image.composite(dim, im, combined)

    base.save(os.path.join(OUT, "interior-base.png"), "PNG", optimize=True)
    for name, alpha in (("interior-area1.png", a1), ("interior-area2.png", a2)):
        layer = Image.new("RGBA", size, (255, 255, 255, 0))
        layer.putalpha(alpha)
        layer.save(os.path.join(OUT, name), "PNG", optimize=True)
        print(name, "lit px:", sum(alpha.histogram()[26:]))


if __name__ == "__main__":
    main()
