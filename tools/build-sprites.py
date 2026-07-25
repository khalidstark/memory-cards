#!/usr/bin/env python3
"""
Turn the raw sprite sheets into web-sized ones.

    python3 tools/build-sprites.py

The sheets exported from the art tool are 6x6 grids at ~3500px square and 4-6 MB
each — fine as masters, far too heavy to send to a phone. This trims the dead
space, scales each frame down to the size it is actually displayed at, and
repacks the grid.

The important detail is the *union* bounding box: every frame is cropped to the
same rectangle, computed across all 36 frames at once. Cropping each frame to
its own content would make the character jump around as the animation plays.

Requires Pillow (already present):  python3 -c "import PIL"
"""
from pathlib import Path
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = Path.home() / "Downloads" / "sprites"
OUT = ROOT / "assets" / "sprites"

COLS = ROWS = 6

# name -> (source file, height of ONE frame in the output)
# Frame heights are 2x the on-screen size, so they stay sharp on a retina phone.
SHEETS = {
    "melt": ("the first page sprite sheet .png", 300),
    "download": ("the download button mascout .png", 150),
    "writing": ("writing a message sprite.png", 190),
}


def frames_of(sheet):
    w, h = sheet.size
    fw, fh = w // COLS, h // ROWS
    for r in range(ROWS):
        for c in range(COLS):
            yield sheet.crop((c * fw, r * fh, (c + 1) * fw, (r + 1) * fh))


def union_bbox(sheet):
    """The smallest rectangle containing visible pixels in *every* frame."""
    box = None
    for frame in frames_of(sheet):
        b = frame.getbbox()  # alpha-aware
        if b is None:
            continue
        box = b if box is None else (
            min(box[0], b[0]), min(box[1], b[1]),
            max(box[2], b[2]), max(box[3], b[3]),
        )
    return box


def build(name, filename, target_h):
    src = SRC / filename
    if not src.exists():
        print(f"  !! missing: {src}")
        return None

    sheet = Image.open(src).convert("RGBA")
    w, h = sheet.size
    fw, fh = w // COLS, h // ROWS
    box = union_bbox(sheet)
    if box is None:
        print(f"  !! {name}: no visible pixels")
        return None

    bw, bh = box[2] - box[0], box[3] - box[1]
    scale = target_h / bh
    ow, oh = max(1, round(bw * scale)), target_h

    out = Image.new("RGBA", (ow * COLS, oh * ROWS), (0, 0, 0, 0))
    for i, frame in enumerate(frames_of(sheet)):
        cropped = frame.crop(box).resize((ow, oh), Image.LANCZOS)
        out.paste(cropped, ((i % COLS) * ow, (i // COLS) * oh))

    OUT.mkdir(parents=True, exist_ok=True)
    # WebP rather than PNG: identical alpha, about a quarter of the bytes on
    # flat cartoon art. Supported since iOS 14, which is older than any phone
    # likely to be scanning these codes.
    dest = OUT / f"{name}.webp"
    out.save(dest, "WEBP", quality=86, method=6)

    before = src.stat().st_size / 1e6
    after = dest.stat().st_size / 1e6
    print(
        f"  {name:9} {w}x{h} ({before:.1f} MB)  ->  {out.size[0]}x{out.size[1]} "
        f"({after:.2f} MB)   frame {ow}x{oh}"
    )
    return {"name": name, "fw": ow, "fh": oh}


if __name__ == "__main__":
    print(f"reading masters from {SRC}")
    built = [build(n, f, h) for n, (f, h) in SHEETS.items()]
    built = [b for b in built if b]
    print("\nFrame sizes for assets/style.css:")
    for b in built:
        print(f"  .sprite-{b['name']} {{ --fw: {b['fw']}px; --fh: {b['fh']}px; }}")
