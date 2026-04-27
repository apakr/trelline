#!/usr/bin/env python3
"""Resize public/app-icon-1024.png to web favicon sizes (LANCZOS)."""
from __future__ import annotations

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1] / "public"
SRC = ROOT / "app-icon-1024.png"
OUT: list[tuple[int, str]] = [
    (16, "favicon-16.png"),
    (32, "favicon-32.png"),
    (48, "favicon-48.png"),
    (180, "apple-touch-icon.png"),
]


def main() -> None:
    im = Image.open(SRC).convert("RGBA")
    r = Image.Resampling.LANCZOS
    for size, name in OUT:
        im.resize((size, size), r).save(ROOT / name, "PNG", optimize=True)
        print("wrote", ROOT / name)


if __name__ == "__main__":
    main()
