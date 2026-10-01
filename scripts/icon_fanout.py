#!/usr/bin/env python3
"""Session 18 (uiux-23) — the DiskGenie brand icon pipeline, stage 2:
re-composite + fan-out.

Inputs:  /tmp/icon-work/transparent-master.png (stage 1's cutout).
Outputs:
  packaging/icon/icon-source.png   — the new master: the disk+broom+shadow
                                     over the DEFAULT theme's ink gradient
                                     (light: #ff7e5f → #ff6b4a → #f96036),
                                     full-bleed circle silhouette.
  src-tauri/icons/*                — every committed platform size (PNG
                                     Lanczos + unsharp ≤48px per the pack's
                                     small-size policy), icon.ico (BMP
                                     entries ≤48px + PNG entries ≥64px),
                                     icon.icns (ic07..ic14 PNG chunks).
  public/*                         — favicons + apple-touch-icon.
  src/assets/brand-mark.png        — the TRANSPARENT cutout at 128px (the
                                     in-app mark paints var(--ink-grad)
                                     under it, so the logo follows the
                                     selected theme live).
"""

from __future__ import annotations

import struct
from pathlib import Path

from PIL import Image, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
WORK = Path("/tmp/icon-work")
CUT = WORK / "transparent-master.png"

# The default (light) theme's --ink-grad — the brand gradient the icon
# background must match exactly (tokens.css light block).
GRAD_STOPS = [(0.0, (255, 126, 95)), (0.55, (255, 107, 74)), (1.0, (249, 96, 54))]


def gradient_rgb(y_frac: float) -> tuple[int, int, int]:
    for (p0, c0), (p1, c1) in zip(GRAD_STOPS, GRAD_STOPS[1:]):
        if y_frac <= p1 or p1 == 1.0:
            t = 0.0 if p1 == p0 else min(1.0, max(0.0, (y_frac - p0) / (p1 - p0)))
            return tuple(round(c0[i] + (c1[i] - c0[i]) * t) for i in range(3))
    return GRAD_STOPS[-1][1]


def make_gradient_master(cut: Image.Image) -> Image.Image:
    """The disk+broom cutout composited over the brand gradient circle."""
    w, h = cut.size
    base = Image.new("RGBA", (w, h))
    bpx = base.load()
    for y in range(h):
        r, g, b = gradient_rgb(y / (h - 1))
        for x in range(w):
            bpx[x, y] = (r, g, b, 255)
    # The cutout (fg + shadow layer) lands on the gradient; the circle
    # silhouette comes from the ORIGINAL master's alpha (the cutout's
    # own alpha never extends beyond the circle).
    out = base.copy()
    out.alpha_composite(cut)
    # Re-clip to the original circle: anything the cutout left
    # transparent OUTSIDE the artwork becomes gradient (it WAS bg) —
    # no clipping needed because the gradient fills the full square and
    # the circle silhouette must be restored from the source alpha.
    src = Image.open(ROOT / "packaging/icon/icon-source.png").convert("RGBA")
    spx = src.load()
    opx = out.load()
    for y in range(h):
        for x in range(w):
            if spx[x, y][3] == 0:
                opx[x, y] = (0, 0, 0, 0)
            elif opx[x, y][3] < spx[x, y][3]:
                # keyed-out bg inside the circle: restore the pure
                # gradient at full circle alpha
                r, g, b = gradient_rgb(y / (h - 1))
                opx[x, y] = (r, g, b, spx[x, y][3])
    return out


def resize_sharp(im: Image.Image, size: int, unsharp: bool) -> Image.Image:
    """Lanczos downsample; the pack's ≤48px policy adds a light unsharp."""
    r = im.resize((size, size), Image.LANCZOS)
    if unsharp and size <= 48:
        r = r.filter(ImageFilter.UnsharpMask(radius=1.2, percent=70, threshold=2))
    elif unsharp and size <= 128:
        r = r.filter(ImageFilter.UnsharpMask(radius=0.8, percent=40, threshold=2))
    return r


def write_ico(path: Path, master: Image.Image, sizes: list[int]) -> None:
    """Multi-size ICO: BMP entries (32-bit BGRA + AND mask) for ≤48px,
    PNG payloads for ≥64px — maximum Explorer compatibility with the
    pack's sharpening policy applied per size."""
    entries: list[tuple[int, bytes]] = []
    for s in sizes:
        frame = resize_sharp(master, s, unsharp=True)
        if s <= 48:
            data = bytearray()
            # BITMAPINFOHEADER: height = 2*h (XOR + AND rows)
            data += struct.pack(
                "<IiiHHIIiiII", 40, s, s * 2, 1, 32, 0, s * s * 4 + s * 4, 0, 0, 0, 0
            )
            # BGRA rows, bottom-up
            fpx = frame.load()
            for y in range(s - 1, -1, -1):
                for x in range(s):
                    r, g, b, a = fpx[x, y]
                    data += struct.pack("<4B", b, g, r, a)
            # AND mask: all-zero rows (alpha channel governs), each row
            # padded to a 32-bit boundary (s px -> s//32 words; s is
            # always a multiple of 8 here, 16/24/32/48 divide 32? no —
            # pad per row to 4-byte units).
            row_bytes = ((s + 31) // 32) * 4
            data += b"\x00" * (row_bytes * s)
            entries.append((s, bytes(data)))
        else:
            import io

            buf = io.BytesIO()
            frame.save(buf, "PNG", optimize=True)
            entries.append((s, buf.getvalue()))

    header = struct.pack("<HHH", 0, 1, len(entries))
    offset = 6 + 16 * len(entries)
    dir_entries = b""
    payload = b""
    for s, data in entries:
        w_b = 0 if s >= 256 else s
        dir_entries += struct.pack("<BBBBHHII", w_b, w_b, 0, 0, 1, 32, len(data), offset)
        payload += data
        offset += len(data)
    path.write_bytes(header + dir_entries + payload)


def write_icns(path: Path, master: Image.Image) -> None:
    """Modern icns: PNG payloads in the ic07..ic14 chunk types (macOS
    10.7+; covers 32..1024 with the @2x hints)."""
    import io

    # (type, size) — the full modern set the pack shipped.
    spec = [
        (b"ic11", 32),  # 16@2x
        (b"ic12", 64),  # 32@2x
        (b"ic07", 128),
        (b"ic13", 256),  # 128@2x
        (b"ic08", 256),
        (b"ic14", 512),  # 256@2x
        (b"ic09", 512),
        (b"ic10", 1024),  # 512@2x / largest
    ]
    chunks = bytearray()
    for typ, s in spec:
        frame = master if s == master.width else resize_sharp(master, s, unsharp=True)
        buf = io.BytesIO()
        frame.save(buf, "PNG", optimize=True)
        png = buf.getvalue()
        chunks += typ + struct.pack(">I", 8 + len(png)) + png
    path.write_bytes(b"icns" + struct.pack(">I", 8 + len(chunks)) + bytes(chunks))


def main() -> None:
    cut = Image.open(CUT).convert("RGBA")

    # 1. The in-app asset: the transparent cutout at 128px (4x headroom
    #    over the 31px CSS frame; mild unsharp keeps the photoreal read).
    brand = resize_sharp(cut, 128, unsharp=True)
    (ROOT / "src/assets/brand-mark.png").write_bytes(_png_bytes(brand))

    # 2. The new static master: cutout over the default ink gradient.
    master = make_gradient_master(cut)
    master.save(ROOT / "packaging/icon/icon-source.png")
    preview = master.copy()
    preview.thumbnail((700, 700))
    preview.convert("RGB").save(WORK / "new-master-preview.png")

    # 3. src-tauri/icons fan-out (the exact committed set).
    icons = ROOT / "src-tauri/icons"
    resize_sharp(master, 32, True).save(icons / "32x32.png")
    resize_sharp(master, 64, True).save(icons / "64x64.png")
    resize_sharp(master, 128, True).save(icons / "128x128.png")
    resize_sharp(master, 256, True).save(icons / "128x128@2x.png")
    resize_sharp(master, 512, True).save(icons / "icon.png")
    for s in (30, 44, 71, 89, 107, 142, 150, 284, 310):
        resize_sharp(master, s, True).save(icons / f"Square{s}x{s}Logo.png")
    resize_sharp(master, 50, True).save(icons / "StoreLogo.png")
    write_ico(icons / "icon.ico", master, [16, 24, 32, 48, 64, 128, 256])
    write_icns(icons / "icon.icns", master)

    # 4. public/ favicons + apple-touch.
    resize_sharp(master, 180, True).save(ROOT / "public/apple-touch-icon.png")
    for s in (16, 32, 48, 96):
        resize_sharp(master, s, True).save(ROOT / f"public/favicon-{s}x{s}.png")
    write_ico(ROOT / "public/favicon.ico", master, [16, 32, 48])

    print("[fanout] all sizes written")


def _png_bytes(im: Image.Image) -> bytes:
    import io

    buf = io.BytesIO()
    im.save(buf, "PNG", optimize=True)
    return buf.getvalue()


if __name__ == "__main__":
    main()
