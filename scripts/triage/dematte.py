#!/usr/bin/env python3
"""
Knock a painted "fake transparency" checkerboard out of a generated PNG.

Image models asked for a transparent background often *draw* a checkerboard
instead of emitting alpha. The pattern is a flat two-tone grid touching the
border, and the subject is enclosed by ink outlines — so a border flood-fill
over the sampled background colours mattes it without touching the cream and
white *inside* the subject.

    python3 dematte.py in.png out.png [--tol 26]
"""
import sys
from collections import deque
from PIL import Image, ImageFilter


def sample_bg(px, w, h, step=7):
    """Collect distinct colours along the border — those are the checker tones."""
    seen = []
    for x in range(0, w, step):
        for y in (0, h - 1):
            seen.append(px[x, y][:3])
    for y in range(0, h, step):
        for x in (0, w - 1):
            seen.append(px[x, y][:3])
    uniq = []
    for c in seen:
        if not any(sum((a - b) ** 2 for a, b in zip(c, u)) < 400 for u in uniq):
            uniq.append(c)
    return uniq


def matte(src, dst, tol=26):
    im = Image.open(src).convert("RGB")
    w, h = im.size
    px = im.load()
    bg = sample_bg(px, w, h)
    tol2 = tol * tol

    def is_bg(c):
        return any(sum((a - b) ** 2 for a, b in zip(c, u)) <= tol2 * 3 for u in bg)

    # flood from every border pixel; stops at the subject's ink outline
    alpha = Image.new("L", (w, h), 255)
    ap = alpha.load()
    seen = bytearray(w * h)
    q = deque()

    def push(x, y):
        i = y * w + x
        if not seen[i] and is_bg(px[x, y]):
            seen[i] = 1
            q.append((x, y))

    for x in range(w):
        push(x, 0); push(x, h - 1)
    for y in range(h):
        push(0, y); push(w - 1, y)

    while q:
        x, y = q.popleft()
        ap[x, y] = 0
        if x > 0: push(x - 1, y)
        if x < w - 1: push(x + 1, y)
        if y > 0: push(x, y - 1)
        if y < h - 1: push(x, y + 1)

    # soften the cut by a hair so edges don't alias against the card
    alpha = alpha.filter(ImageFilter.GaussianBlur(0.6))
    out = im.convert("RGBA")
    out.putalpha(alpha)
    out.save(dst)

    cleared = sum(1 for i in range(w * h) if seen[i])
    print(f"{dst}  bg_colours={len(bg)}  cleared={cleared * 100 // (w * h)}%")


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    tol = 26
    for a in sys.argv[1:]:
        if a.startswith("--tol"):
            tol = int(a.split("=")[1]) if "=" in a else 26
    matte(args[0], args[1], tol)
