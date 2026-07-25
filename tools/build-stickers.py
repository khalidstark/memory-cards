#!/usr/bin/env python3
"""
Turn the raw sticker folder into web-ready cut-outs plus a manifest.

    python3 tools/build-stickers.py

Almost all the sources are JPEGs, which have no transparency — pasted straight
onto a card they'd be rectangles. This removes flat backgrounds by flooding
inward from the edges, so only the background actually *connected to the border*
is cleared. A global colour match would punch holes through white eyes, teeth
and highlights inside the artwork.

Photographic cut-outs will still have rough edges; nothing can fix that without
a proper matting model. Anything left more than 97% opaque after the flood is
reported so it can be checked by eye.

Requires Pillow and numpy (both already present).
"""
from collections import deque
from pathlib import Path
import json
import re

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = Path.home() / "Downloads" / "stickers, designs,photos"
OUT = ROOT / "assets" / "stickers"
MANIFEST = ROOT / "data" / "stickers.json"

MAX_EDGE = 420          # plenty for a sticker on a card
TOLERANCE = 32          # colour distance counted as "same as the background"
GREEN_SCREEN = (60, 200, 60)


def slugify(name: str) -> str:
    """Filenames here contain emoji, spaces and Arabic — none of it URL-safe."""
    stem = Path(name).stem.lower()
    stem = re.sub(r"[^a-z0-9]+", "-", stem).strip("-")
    return stem or "sticker"


def looks_like_green_screen(a: np.ndarray) -> bool:
    r, g, b = a[..., 0].astype(int), a[..., 1].astype(int), a[..., 2].astype(int)
    green = (g > 150) & (g - r > 60) & (g - b > 60)
    return green.mean() > 0.15


def flood_background(a: np.ndarray, tol: int) -> np.ndarray:
    """
    Alpha mask: 0 where the pixel is background reachable from the border.

    Starting from every edge pixel and walking inward means an enclosed white
    region — the whites of an eye, a speech bubble — is kept, because it is not
    connected to the outside.
    """
    h, w = a.shape[:2]
    rgb = a[..., :3].astype(int)
    seeds = [(0, x) for x in range(w)] + [(h - 1, x) for x in range(w)]
    seeds += [(y, 0) for y in range(h)] + [(y, w - 1) for y in range(h)]

    # Background colour = the most common colour around the border.
    border = np.concatenate([rgb[0], rgb[-1], rgb[:, 0], rgb[:, -1]])
    colours, counts = np.unique(border.reshape(-1, 3), axis=0, return_counts=True)
    bg = colours[counts.argmax()]

    out = np.ones((h, w), dtype=bool)  # True = keep
    seen = np.zeros((h, w), dtype=bool)
    q = deque()
    for y, x in seeds:
        if not seen[y, x] and np.abs(rgb[y, x] - bg).sum() <= tol * 3:
            seen[y, x] = True
            out[y, x] = False
            q.append((y, x))

    while q:
        y, x = q.popleft()
        for dy, dx in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            ny, nx = y + dy, x + dx
            if 0 <= ny < h and 0 <= nx < w and not seen[ny, nx]:
                if np.abs(rgb[ny, nx] - bg).sum() <= tol * 3:
                    seen[ny, nx] = True
                    out[ny, nx] = False
                    q.append((ny, nx))
    return out


def build(path: Path):
    im = Image.open(path)
    had_alpha = im.mode in ("RGBA", "LA") or "transparency" in im.info
    im = im.convert("RGBA")
    a = np.array(im)

    if not had_alpha or a[..., 3].min() == 255:
        tol = 70 if looks_like_green_screen(a) else TOLERANCE
        keep = flood_background(a, tol)
        a[..., 3] = np.where(keep, a[..., 3], 0)

    im = Image.fromarray(a)
    bbox = im.getbbox()
    if bbox:
        im = im.crop(bbox)
    im.thumbnail((MAX_EDGE, MAX_EDGE), Image.LANCZOS)

    OUT.mkdir(parents=True, exist_ok=True)
    slug = slugify(path.name)
    dest = OUT / f"{slug}.webp"
    n = 2
    while dest.exists():
        dest = OUT / f"{slug}-{n}.webp"
        n += 1
    im.save(dest, "WEBP", quality=88, method=6)

    opaque = (np.array(im)[..., 3] > 200).mean() * 100
    return {
        "id": dest.stem,
        "file": dest.name,
        "w": im.width,
        "h": im.height,
        "kb": round(dest.stat().st_size / 1024),
        "opaque": round(opaque),
    }


if __name__ == "__main__":
    if not SRC.exists():
        raise SystemExit(f"no such folder: {SRC}")

    files = sorted(p for p in SRC.iterdir() if p.is_file() and not p.name.startswith("."))
    built = []
    for p in files:
        try:
            built.append(build(p))
        except Exception as e:  # a single bad file shouldn't stop the batch
            print(f"  !! {p.name}: {e}")

    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(
        json.dumps({"stickers": [{"id": b["id"], "file": b["file"]} for b in built]}, indent=2)
        + "\n",
        encoding="utf-8",
    )

    total = sum(b["kb"] for b in built)
    print(f"{len(built)} stickers -> assets/stickers/  ({total} KB total)\n")
    suspect = [b for b in built if b["opaque"] > 97]
    if suspect:
        print("Still almost fully opaque — check these by eye, the background")
        print("probably wasn't flat enough to remove:")
        for b in suspect:
            print(f"  {b['id']:45} {b['opaque']}% opaque")
