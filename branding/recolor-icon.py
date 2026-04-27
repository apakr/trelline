#!/usr/bin/env python3
"""Map concept-a-gantt-spine.png gold → today red, teal → default task purple."""
from __future__ import annotations

import math
import sys
from pathlib import Path

from PIL import Image

# App tokens (src/App.css and WorkspaceContext / createWorkspace)
TODAY = (0xF8, 0x71, 0x71)  # #f87171
DEFAULT_TASK = (0x63, 0x66, 0xF1)  # #6366f1
# Averaged from concept-a source asset
GOLD_REF = (216, 161, 44)
TEAL_REF = (62, 140, 152)


def dist3(a: tuple[int, int, int], b: tuple[int, int, int]) -> float:
    return math.sqrt(
        (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2
    )


def main() -> None:
    concepts = Path(__file__).parent / "icon-concepts"
    # Prefer the backed-up gold/blue source so re-runs are idempotent
    default_src = concepts / "concept-a-gantt-spine-gold-original.png"
    if not default_src.is_file():
        default_src = concepts / "concept-a-gantt-spine.png"
    src = default_src
    dst = concepts / "concept-a-gantt-spine.png"
    if len(sys.argv) >= 2:
        src = Path(sys.argv[1])
    if len(sys.argv) >= 3:
        dst = Path(sys.argv[2])

    im = Image.open(src).convert("RGBA")
    px = im.load()
    w, h = im.size
    # Max distance in RGB where we still count as "that color" (tuned for this asset)
    max_d = 115.0

    for y in range(h):
        for x in range(w):
            r, g, b, a = px[x, y]
            if a < 8:
                continue
            p = (r, g, b)
            d_gold = dist3(p, GOLD_REF)
            d_teal = dist3(p, TEAL_REF)
            d_bg = min(r, g, b)
            # near-black is background, ignore
            if r < 35 and g < 40 and b < 45 and max(r, g, b) < 50:
                continue
            if d_gold < d_teal and d_gold < max_d:
                strength = 1.0 - (d_gold / max_d)
                strength = max(0, min(1, strength**0.7))
                nr, ng, nb = TODAY
                out_r = int(round(r + (nr - r) * strength))
                out_g = int(round(g + (ng - g) * strength))
                out_b = int(round(b + (nb - b) * strength))
                px[x, y] = (out_r, out_g, out_b, a)
            elif d_teal < d_gold and d_teal < max_d:
                strength = 1.0 - (d_teal / max_d)
                strength = max(0, min(1, strength**0.7))
                tr, tg, tb = DEFAULT_TASK
                out_r = int(round(r + (tr - r) * strength))
                out_g = int(round(g + (tg - g) * strength))
                out_b = int(round(b + (tb - b) * strength))
                px[x, y] = (out_r, out_g, out_b, a)

    im.save(dst, "PNG")
    print(f"Wrote {dst}")


if __name__ == "__main__":
    main()
