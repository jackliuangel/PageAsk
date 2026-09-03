#!/usr/bin/env python3
"""Generate PageAsk extension icons (PNG) with pure stdlib + sips.

Renders a supersampled rounded-square gradient with a white speech
bubble at arbitrary size, then writes 16/32/48/128 PNG icons.
"""
import math, struct, zlib, subprocess, os, sys

SIZE = 512
SS = 6  # supersampling factor


def rounded_rect_sdf(px, py, cx, cy, hw, hh, r):
    qx = abs(px - cx) - (hw - r)
    qy = abs(py - cy) - (hh - r)
    ax, ay = max(qx, 0.0), max(qy, 0.0)
    return math.hypot(ax, ay) + min(max(qx, qy), 0.0) - r


def in_triangle(px, py, a, b, c):
    def sign(p1, p2, p3):
        return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])
    d1, d2, d3 = sign((px, py), a, b), sign((px, py), b, c), sign((px, py), c, a)
    neg = d1 < 0 or d2 < 0 or d3 < 0
    pos = d1 > 0 or d2 > 0 or d3 > 0
    return not (neg and pos)


def bg_color(x, y):
    # vertical gradient: indigo #6366f1 -> violet #a855f7
    t = y
    r = 0x63 + (0xa8 - 0x63) * t
    g = 0x66 + (0x55 - 0x66) * t
    b = 0xf1 + (0xf7 - 0xf1) * t
    return (r / 255.0, g / 255.0, b / 255.0)


def shape_color(x, y):
    """Return (r,g,b,a in 0..1 float) or None for transparent."""
    m = 0.045  # margin
    # rounded square background
    d_sq = rounded_rect_sdf(x, y, 0.5, 0.5, 0.5 - m, 0.5 - m, 0.22)
    if d_sq > 0:
        return None
    # speech bubble (white) with tail, sits slightly low-center
    d_bub = rounded_rect_sdf(x, y, 0.5, 0.565, 0.31, 0.21, 0.085)
    in_bub = d_bub <= 0
    in_tail = in_triangle(x, y, (0.235, 0.60), (0.42, 0.575), (0.235, 0.745))
    if in_bub or in_tail:
        return (1.0, 1.0, 1.0, 1.0)
    # three dots (indigo)
    dot_r = 0.040
    for i, dx in enumerate((-0.115, 0.0, 0.115)):
        cx, cy = 0.5 + dx, 0.565
        if math.hypot(x - cx, y - cy) <= dot_r:
            return (0.376, 0.388, 0.898, 1.0)  # #6062E5-ish
    # tiny sparkle top-right of the tile
    star = ((0.79, 0.20),)
    sx, sy = star[0]
    if abs(x - sx) + abs(y - sy) * 0.55 <= 0.075:
        return (1.0, 1.0, 1.0, 0.92)
    # base background
    r, g, b = bg_color(x, y)
    return (r, g, b, 1.0)


def render(size):
    rows = []
    for py in range(size):
        row = bytearray()
        for px in range(size):
            acc = [0.0, 0.0, 0.0, 0.0]
            for sy in range(SS):
                for sx in range(SS):
                    fx = (px + (sx + 0.5) / SS) / size
                    fy = (py + (sy + 0.5) / SS) / size
                    c = shape_color(fx, fy)
                    if c is None:
                        continue
                    a = c[3]
                    acc[0] += c[0] * a
                    acc[1] += c[1] * a
                    acc[2] += c[2] * a
                    acc[3] += a
            n = SS * SS
            a = acc[3] / n
            if a <= 0.001:
                row += b"\x00\x00\x00\x00"
                continue
            row += bytes((int(acc[0] / acc[3] * 255.999),
                          int(acc[1] / acc[3] * 255.999),
                          int(acc[2] / acc[3] * 255.999),
                          int(a * 255.999)))
        rows.append(bytes(row))
    return rows


def write_png(path, size, rows):
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xffffffff)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0)
    raw = b"".join(b"\x00" + r for r in rows)
    with open(path, "wb") as f:
        f.write(b"\x89PNG\r\n\x1a\n")
        f.write(chunk(b"IHDR", ihdr))
        f.write(chunk(b"IDAT", zlib.compress(raw, 9)))
        f.write(chunk(b"IEND", b""))


def main():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    icons_dir = os.path.join(root, "web-extension", "icons")
    os.makedirs(icons_dir, exist_ok=True)
    big = os.path.join(icons_dir, "icon-512.png")
    print("rendering 512 ...")
    write_png(big, SIZE, render(SIZE))
    for s in (128, 48, 32, 16):
        out = os.path.join(icons_dir, f"icon-{s}.png")
        subprocess.run(["sips", "-z", str(s), str(s), big, "--out", out],
                       check=True, capture_output=True)
        print("wrote", out)
    os.remove(big)


if __name__ == "__main__":
    main()
