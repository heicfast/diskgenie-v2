#!/usr/bin/env python3
"""Session 18 (uiux-23) — the DiskGenie brand icon pipeline, stage 1:
high-quality background removal from the PhotoIcon master.

The master (packaging/icon/icon-source.png, 1254x1254, RGBA) is a
full-bleed orange CIRCLE (r=626, tangent to all edges) with the
photoreal disk+broom drawn on top and soft shadows cast onto the
orange. The owner's ask: remove the background at high quality so
only the disk and broom remain, then re-composite over the theme
gradient (stage 2).

Method (chroma-key with a shadow-aware gate + connectivity):
  1. bg reference = (252, 99, 50) (flat everywhere on the ring).
  2. A pixel is BG-FAMILY when its chromaticity is near the bg OR it
     is a warm shadow (the shadows drop g/b faster than r — they stay
     on the warm side: r/g >= 2.2, g >= 1.3*b, dim). Gold platter
     (r/g 1.5) and purple bristles (g << b) fail the gate on purpose.
  3. Flood fill from the outer ring through the bg-family gate —
     connectivity keeps isolated lookalikes (platter highlights)
     OUT of the background.
  4. Shadow layer: bg-region pixels become black at alpha
     (1 - luminance ratio) so the soft shadows survive over ANY new
     background (including the in-app CSS gradient).
  5. Edge strip: pixels within 2px of the bg region are un-mixed
     against the known bg color (F = (P - s*B)/(1-s)) with a
     feathered s — kills the orange fringe at the object boundary.
"""

from __future__ import annotations

import math
import sys
from collections import deque
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "packaging/icon/icon-source.png"
OUT_DIR = Path("/tmp/icon-work")
OUT_DIR.mkdir(exist_ok=True)

BG = (252.0, 99.0, 50.0)
BG_LUM = 0.299 * 252 + 0.587 * 99 + 0.114 * 50  # 139.1


def chroma(rgb: tuple[float, float, float]) -> tuple[float, float]:
    s = rgb[0] + rgb[1] + rgb[2]
    if s <= 0:
        return (0.0, 0.0)
    return (rgb[0] / s, rgb[1] / s)


BG_CHROMA = chroma(BG)


def is_bg_family(r: float, g: float, b: float) -> bool:
    """The bg gate: near-bg chroma OR warm shadow."""
    # Fully transparent / dim guard
    if r + g + b < 24:
        return False
    c = chroma((r, g, b))
    d = math.hypot(c[0] - BG_CHROMA[0], c[1] - BG_CHROMA[1])
    if d < 0.06:
        return True
    # Warm shadow: ratios preserved on the warm side of bg, dimmer.
    if g <= 0 or b <= 0:
        return False
    rg = r / g
    gb = g / b
    lum = 0.299 * r + 0.587 * g + 0.114 * b
    return rg >= 2.2 and gb >= 1.3 and lum < 0.86 * BG_LUM and r > 40


def main() -> int:
    im = Image.open(SRC).convert("RGBA")
    w, h = im.size
    px = im.load()

    # ── 1. The bg-family gate map ──────────────────────────────────
    gate = [[False] * w for _ in range(h)]
    for y in range(h):
        row = gate[y]
        for x in range(w):
            r, g, b, a = px[x, y]
            if a > 8 and is_bg_family(r, g, b):
                row[x] = True

    # ── 2. Flood fill from the ring (r just inside the circle edge) ─
    cx, cy = w / 2, h / 2
    visited = [[False] * w for _ in range(h)]
    q: deque[tuple[int, int]] = deque()
    r0 = int(w / 2) - 6
    for ang in range(0, 360):
        a = math.radians(ang)
        x, y = int(cx + r0 * math.cos(a)), int(cy + r0 * math.sin(a))
        if gate[y][x] and not visited[y][x]:
            visited[y][x] = True
            q.append((x, y))
    while q:
        x, y = q.popleft()
        for nx, ny in ((x - 1, y), (x + 1, y), (x, y - 1), (x, y + 1)):
            if 0 <= nx < w and 0 <= ny < h and not visited[ny][nx] and gate[ny][nx]:
                visited[ny][nx] = True
                q.append((nx, ny))

    bg_region = visited
    bg_count = sum(sum(1 for v in row if v) for row in bg_region)
    print(f"[matte] bg-family gate: {bg_count} px reachable from the ring")

    # ── 3. Distance-to-bg-region (for the edge feather strip) ──────
    # Two-pass chamfer distance (in px) from the nearest bg pixel.
    INF = 1e9
    dist = [[INF] * w for _ in range(h)]
    for y in range(h):
        drow, brow = dist[y], bg_region[y]
        for x in range(w):
            if brow[x]:
                drow[x] = 0.0
    # forward pass
    for y in range(h):
        for x in range(w):
            d = dist[y][x]
            if x > 0:
                d = min(d, dist[y][x - 1] + 1.0)
            if y > 0:
                d = min(d, dist[y - 1][x] + 1.0)
                if x > 0:
                    d = min(d, dist[y - 1][x - 1] + 1.4142)
                if x < w - 1:
                    d = min(d, dist[y - 1][x + 1] + 1.4142)
            dist[y][x] = d
    # backward pass
    for y in range(h - 1, -1, -1):
        for x in range(w - 1, -1, -1):
            d = dist[y][x]
            if x < w - 1:
                d = min(d, dist[y][x + 1] + 1.0)
            if y < h - 1:
                d = min(d, dist[y + 1][x] + 1.0)
                if x < w - 1:
                    d = min(d, dist[y + 1][x + 1] + 1.4142)
                if x > 0:
                    d = min(d, dist[y + 1][x - 1] + 1.4142)
            dist[y][x] = d

    # ── 4. Compose the transparent master ─────────────────────────
    # Two layers:
    #   fg      (disk+broom): alpha 1-s, color un-mixed against bg
    #   shadow  (on bg):      black at alpha (1 - lum ratio) * s
    # fg-over-shadow premultiplied composite, then straight (RGBA).
    FEATHER = 1.6  # px strip width for the boundary unmix
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    opx = out.load()
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a == 0:
                continue
            if bg_region[y][x]:
                # Background pixel: pure bg -> transparent; shadowed ->
                # black alpha (preserved soft shadow).
                lum = 0.299 * r + 0.587 * g + 0.114 * b
                ratio = min(1.0, lum / BG_LUM)
                sh = 1.0 - ratio
                # gentle curve: shadows read ~1.15x stronger as black
                # over a light gradient than they did over flat orange
                sh = min(1.0, sh * 1.15)
                if sh <= 0.004:
                    continue
                opx[x, y] = (0, 0, 0, int(round(sh * a)))
            else:
                # Object pixel: feather the 2px strip near bg, unmix
                # the bg contribution so no orange fringe survives.
                d = dist[y][x]
                if d >= FEATHER:
                    opx[x, y] = (r, g, b, a)
                else:
                    s = max(0.0, 1.0 - d / FEATHER)  # bg fraction est.
                    if s <= 0.02:
                        opx[x, y] = (r, g, b, a)
                    else:
                        keep = 1.0 - s
                        fr = (r - s * BG[0]) / keep
                        fg_ = (g - s * BG[1]) / keep
                        fb = (b - s * BG[2]) / keep
                        fr = min(255.0, max(0.0, fr))
                        fg_ = min(255.0, max(0.0, fg_))
                        fb = min(255.0, max(0.0, fb))
                        # also kill the bg fraction of alpha (object
                        # coverage): the original a is the circle alpha
                        opx[x, y] = (
                            int(round(fr)),
                            int(round(fg_)),
                            int(round(fb)),
                            int(round(a * keep)),
                        )

    out.save(OUT_DIR / "transparent-master.png")
    print(f"[matte] wrote {OUT_DIR/'transparent-master.png'}")

    # ── 5. Verification montage (on neutral + gradient + checker) ──
    montage = Image.new("RGB", (w * 3 + 40, h + 20), (245, 245, 247))
    for i, base in enumerate(
        [
            (245, 245, 247),  # light neutral
            (28, 28, 32),  # dark neutral
            (120, 120, 126),  # mid gray
        ]
    ):
        tile = Image.new("RGB", (w, h), base)
        tile.paste(out, (0, 0), out)
        montage.paste(tile, (i * (w + 10) + 10, 10))
    montage.save(OUT_DIR / "verify-montage.png")
    print(f"[matte] wrote {OUT_DIR/'verify-montage.png'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
