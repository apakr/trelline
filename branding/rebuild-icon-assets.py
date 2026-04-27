#!/usr/bin/env python3
"""
1) Trim off-white/black letterboxing from the source.
2) Fit the squircle: estimate R, clear pixels **outside** the shape to
   **transparent**. Use a uniform `mask_inset` plus optional `corner_erosion`
   (only tightens the four quarter-circle arcs) to lose light anti-alias halos.
3) Tighten to the alpha bounds, place on a transparent **square** canvas, scale to 1024.
4) **Erode the alpha** on the 1024 image: shrinks the **mark** boundary (strips
   light/dark halos on curves and straights), unlike **canvas** crop, which
   only trims **empty** border.
5) Optional **perimeter-1024** (legacy crop+scale) — usually 0.
6) Write public favicons and app-icon-1024.png — then run: npm run tauri:icon
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

from PIL import Image, ImageFilter

def luma(rgb: tuple[int, int, int]) -> float:
    r, g, b = rgb
    return (r + g + b) / 3.0


def is_filler(r: int, g: int, b: int) -> bool:
    """Off-white/gray border, black letterboxing, not part of the icon."""
    t = (r, g, b)
    m = min(t)
    if m > 200 and luma(t) > 200:
        return True
    if max(t) < 8:
        return True
    return luma(t) > 220


def content_bbox(im: Image.Image) -> tuple[int, int, int, int]:
    px = im.load()
    w, h = im.size
    x0, y0, x1, y1 = w, h, 0, 0
    found = False
    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 8:
                continue
            if is_filler(r, g, b):
                continue
            found = True
            x0 = min(x0, x)
            y0 = min(y0, y)
            x1 = max(x1, x)
            y1 = max(y1, y)
    if not found:
        raise ValueError("No non-filler content found; check is_filler logic.")
    return (x0, y0, x1 + 1, y1 + 1)


def in_filled_rounded_rect(
    x: int, y: int, w: int, h: int, r: int, corner_erosion: int = 0
) -> bool:
    """
    Point-in-filled-rounded-rect: 5 axis-aligned bars + 4 quarter-disks
    (standard construction). The old "top" branch wrongly treated the whole
    strip 0..r in y (between the arcs) as filled, which made straight edges
    "step" outward past the curve tangents. corner_erosion shrinks arc radii
    only (anti-alias trim on curves).
    """
    if x < 0 or y < 0 or x >= w or y >= h:
        return False
    r0 = min(r, w // 2, h // 2)
    if r0 <= 0:
        return True
    rc = max(0, r0 - max(0, corner_erosion))
    # 1) central rectangle
    if r0 <= x < w - r0 and r0 <= y < h - r0:
        return True
    # 2) top / bottom thin bars: only 0..r0 in y, not a full "slab" to h-r0
    if r0 <= x < w - r0 and 0 <= y < r0:  # top
        return True
    if r0 <= x < w - r0 and h - r0 <= y < h:  # bottom
        return True
    # 3) left / right thin bars
    if 0 <= x < r0 and r0 <= y < h - r0:  # left
        return True
    if w - r0 <= x < w and r0 <= y < h - r0:  # right
        return True
    # 4) quarter-circles (arc radii can be rc < r0 when corner_erosion > 0)
    if x < r0 and y < r0:  # TL
        return (x - r0) ** 2 + (y - r0) ** 2 <= rc * rc
    if x >= w - r0 and y < r0:  # TR
        return (x - w + r0) ** 2 + (y - r0) ** 2 <= rc * rc
    if x < r0 and y >= h - r0:  # BL
        return (x - r0) ** 2 + (y - h + r0) ** 2 <= rc * rc
    if x >= w - r0 and y >= h - r0:  # BR
        return (x - w + r0) ** 2 + (y - h + r0) ** 2 <= rc * rc
    return False


def in_filled_rounded_rect_inset(
    x: int,
    y: int,
    w: int,
    h: int,
    r: int,
    inset: int,
    corner_erosion: int = 0,
) -> bool:
    """
    Like in_filled_rounded_rect, but the shape is eroded by `inset` px on all
    sides (moves the border inward to drop light anti-alias / off-white from
    the source art on flat edges). corner_erosion is applied on top in local coords
    to trim halos on the four arcs only.
    """
    if inset <= 0:
        return in_filled_rounded_rect(x, y, w, h, r, corner_erosion)
    w2, h2 = w - 2 * inset, h - 2 * inset
    if w2 < 1 or h2 < 1:
        return False
    if x < inset or y < inset or x >= w - inset or y >= h - inset:
        return False
    r2 = r - inset
    return in_filled_rounded_rect(
        x - inset, y - inset, w2, h2, r2, corner_erosion
    )


def _row_ink_width(px, w: int, ry: int) -> int | None:
    xs: list[int] = []
    for x in range(w):
        r, g, b = px[x, ry][:3]
        if is_filler(r, g, b):
            continue
        xs.append(x)
    if not xs:
        return None
    return xs[-1] - xs[0] + 1


def estimate_corner_r(px, w: int, h: int) -> int:
    """R from the span of the straight top (and bottom) of the mark vs W."""
    # Padded letterbox can reintroduce all-filler rows y=0 / h-1 — use first/last
    # content rows instead of literal edge rows.
    ytop = 0
    for y in range(h):
        if any(not is_filler(*px[x, y][:3]) for x in range(w)):
            ytop = y
            break
    ybot = h - 1
    for y in range(h - 1, -1, -1):
        if any(not is_filler(*px[x, y][:3]) for x in range(w)):
            ybot = y
            break
    wtop = _row_ink_width(px, w, ytop) or 0
    wbot = _row_ink_width(px, w, ybot) or 0
    w_str = (wtop + wbot) // 2 if wtop and wbot else (wtop or wbot)
    r = (w - w_str) // 2 if w_str else 0
    r = max(1, min(r, w // 2, h // 2))
    return r


def apply_squircle_mask(
    im: Image.Image, mask_inset: int, corner_erosion: int
) -> Image.Image:
    w, h = im.size
    r = estimate_corner_r(im.load(), w, h)
    out = Image.new("RGBA", (w, h), (0, 0, 0, 0))
    src = im.load()
    d = out.load()
    for y in range(h):
        for x in range(w):
            a0 = src[x, y][3]
            if a0 < 1:
                continue
            r0, g0, b0, a0 = src[x, y]
            if in_filled_rounded_rect_inset(
                x, y, w, h, r, mask_inset, corner_erosion
            ):
                d[x, y] = (r0, g0, b0, a0)
            else:
                d[x, y] = (0, 0, 0, 0)
    return out


def alpha_tight_bbox(im: Image.Image) -> tuple[int, int, int, int]:
    px = im.load()
    w, h = im.size
    x0, y0, x1, y1 = w, h, 0, 0
    for y in range(h):
        for x in range(w):
            if px[x, y][3] < 1:
                continue
            x0, y0 = min(x0, x), min(y0, y)
            x1, y1 = max(x1, x), max(y1, y)
    if x0 > x1:
        return (0, 0, w, h)
    return (x0, y0, x1 + 1, y1 + 1)


def to_square_transparent(im: Image.Image) -> Image.Image:
    w, h = im.size
    s = max(w, h)
    out = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    out.paste(im, ((s - w) // 2, (s - h) // 2), im)
    return out


def erode_alpha_channel(im: Image.Image, radius: int) -> Image.Image:
    """
    Erode the opaque region by `radius` px (Chebyshev / box): any pixel
    with a transparent (or 0) neighbor in the (2*radius+1) square becomes
    transparent. Trims the **mark** perimeter, not the image file border.
    """
    if radius <= 0:
        return im
    k = 2 * radius + 1
    if k < 3:
        return im
    c = k if k % 2 == 1 else k + 1
    r, g, b, a = im.split()
    a2 = a.filter(ImageFilter.MinFilter(c))
    return Image.merge("RGBA", (r, g, b, a2))


def perimeter_trim_square(im: Image.Image, d: int, out_size: int) -> Image.Image:
    """
    Crop the bitmap edges then rescale. Only helps when halos reach the
    *image* boundary; usually prefer erode_alpha_channel for halos on the
    *shape* edge.
    """
    if d <= 0:
        return im
    w, h = im.size
    if w < 2 * d + 1 or h < 2 * d + 1:
        return im
    cr = im.crop((d, d, w - d, h - d))
    return cr.resize((out_size, out_size), Image.Resampling.LANCZOS)


def main() -> None:
    root = Path(__file__).resolve().parent.parent
    ap = argparse.ArgumentParser()
    ap.add_argument(
        "source",
        nargs="?",
        default=root / "branding" / "icon-concepts" / "concept-a-gantt-spine.png",
        type=Path,
    )
    ap.add_argument(
        "--pad",
        type=int,
        default=2,
        help="Extra margin around the letterbox trim (before the squircle mask).",
    )
    ap.add_argument(
        "--mask-inset",
        type=int,
        default=3,
        help="Erode the squircle mask N px inward to remove light edge halos (0=off).",
    )
    ap.add_argument(
        "--corner-erosion",
        type=int,
        default=3,
        help="Extra erosion on the four quarter-circle arcs only (0=flat edges unchanged).",
    )
    ap.add_argument(
        "--erode-alpha",
        type=int,
        default=5,
        help="Erode the alpha mask by N px in final 1024 image (trims the mark, not the empty canvas).",
    )
    ap.add_argument(
        "--perimeter-1024",
        type=int,
        default=0,
        help="Legacy: crop N px from L/R/T/B of 1024 and rescale (0=off).",
    )
    args = ap.parse_args()
    if not args.source.is_file():
        print(f"Missing source image: {args.source}", file=sys.stderr)
        sys.exit(1)

    im0 = Image.open(args.source).convert("RGBA")
    w0, h0 = im0.size
    x0, y0, x1, y1 = content_bbox(im0)
    p0 = args.pad
    x0, y0 = max(0, x0 - p0), max(0, y0 - p0)
    x1, y1 = min(w0, x1 + p0), min(h0, y1 + p0)
    cropped = im0.crop((x0, y0, x1, y1))
    masked = apply_squircle_mask(
        cropped, args.mask_inset, args.corner_erosion
    )
    bbx = alpha_tight_bbox(masked)
    if bbx[2] > bbx[0] and bbx[3] > bbx[1]:
        masked = masked.crop(bbx)
    square = to_square_transparent(masked)
    s1024 = square.resize((1024, 1024), Image.Resampling.LANCZOS)
    s1024 = erode_alpha_channel(s1024, args.erode_alpha)
    s1024 = perimeter_trim_square(s1024, args.perimeter_1024, 1024)

    public = root / "public"
    public.mkdir(exist_ok=True)
    s1024.save(public / "app-icon-1024.png", "PNG")
    for n in (32, 48, 16):
        s1024.resize((n, n), Image.Resampling.LANCZOS).save(
            public / f"favicon-{n}.png", "PNG"
        )
    s1024.resize((180, 180), Image.Resampling.LANCZOS).save(
        public / "apple-touch-icon.png", "PNG"
    )
    r_est = estimate_corner_r(cropped.load(), cropped.size[0], cropped.size[1])
    print(
        f"Letterbox trim → {cropped.size[0]}×{cropped.size[1]}, r≈{r_est} px, "
        f"mask_inset={args.mask_inset}, corner_erosion={args.corner_erosion}, "
        f"erode_alpha_1024={args.erode_alpha}, perimeter_1024={args.perimeter_1024}\n"
        f"Alpha-tight {masked.size[0]}×{masked.size[1]} → square {square.size[0]}² — export 1024²\n"
        f"Wrote {public / 'app-icon-1024.png'} + favicons, apple-touch-icon\n"
        "Next: npm run tauri:icon"
    )


if __name__ == "__main__":
    main()
