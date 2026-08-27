# -*- coding: utf-8 -*-
"""
claude-hub/scripts/make-icons.py

デスクトップ用の .ico を生成し、ショートカット（.url）を作り直す。
外部ライブラリを使わず、ICO を直接書き出す（48x48 / 32bit BGRA）。

  python scripts/make-icons.py
"""
import io, os, math, struct

HUB = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICO_DIR = os.path.join(HUB, 'icons')
if not os.path.isdir(ICO_DIR):
    os.makedirs(ICO_DIR)

S = 48
C = (S - 1) / 2.0

PARCH = (0xEF, 0xE2, 0xC6)   # RGB
INK   = (0x2A, 0x1C, 0x12)
RED   = (0xB8, 0x45, 0x1F)
GOLD  = (0xB5, 0x82, 0x1F)
SEA   = (0x2C, 0x60, 0x76)
GREEN = (0x3F, 0x6B, 0x45)


def blank():
    return [[(0, 0, 0, 0) for _ in range(S)] for _ in range(S)]


def put(px, x, y, rgb, a=255):
    if 0 <= x < S and 0 <= y < S:
        px[y][x] = (rgb[0], rgb[1], rgb[2], a)


def disc(px, cx, cy, r, rgb, a=255):
    for y in range(S):
        for x in range(S):
            d = math.hypot(x - cx, y - cy)
            if d <= r - .5:
                put(px, x, y, rgb, a)
            elif d <= r + .5:                      # 簡易アンチエイリアス
                f = max(0.0, min(1.0, r + .5 - d))
                put(px, x, y, rgb, int(a * f))


def ring(px, cx, cy, r, w, rgb):
    for y in range(S):
        for x in range(S):
            d = math.hypot(x - cx, y - cy)
            if r - w / 2 - .5 <= d <= r + w / 2 + .5:
                f = 1.0
                if d < r - w / 2: f = d - (r - w / 2 - .5)
                if d > r + w / 2: f = (r + w / 2 + .5) - d
                put(px, x, y, rgb, int(255 * max(0.0, min(1.0, f))))


def tri(px, pts, rgb):
    (x1, y1), (x2, y2), (x3, y3) = pts
    def sign(ax, ay, bx, by, cx2, cy2):
        return (ax - cx2) * (by - cy2) - (bx - cx2) * (ay - cy2)
    for y in range(S):
        for x in range(S):
            d1 = sign(x, y, x1, y1, x2, y2)
            d2 = sign(x, y, x2, y2, x3, y3)
            d3 = sign(x, y, x3, y3, x1, y1)
            neg = (d1 < 0) or (d2 < 0) or (d3 < 0)
            pos = (d1 > 0) or (d2 > 0) or (d3 > 0)
            if not (neg and pos):
                put(px, x, y, rgb)


def rect(px, x0, y0, x1, y1, rgb):
    for y in range(int(y0), int(y1) + 1):
        for x in range(int(x0), int(x1) + 1):
            put(px, x, y, rgb)


def write_ico(path, px):
    """32bit BGRA, bottom-up, with AND mask."""
    xor = bytearray()
    for y in range(S - 1, -1, -1):
        for x in range(S):
            r, g, b, a = px[y][x]
            xor += bytes((b, g, r, a))
    row = ((S + 31) // 32) * 4
    andm = bytearray(row * S)          # all zero = すべて不透明扱い（アルファで抜く）
    hdr = struct.pack('<IiiHHIIiiII', 40, S, S * 2, 1, 32, 0, len(xor) + len(andm), 0, 0, 0, 0)
    img = hdr + bytes(xor) + bytes(andm)
    ico = struct.pack('<HHH', 0, 1, 1)
    ico += struct.pack('<BBBBHHII', S, S, 0, 0, 1, 32, len(img), 22)
    io.open(path, 'wb').write(ico + img)


# ── 1) 羅針盤（乗組員ダッシュボード） ────────────────────────
px = blank()
disc(px, C, C, 22.5, INK)
disc(px, C, C, 20.5, PARCH)
ring(px, C, C, 17.5, 1.6, INK)
# 四方位の星（北＝朱）
tri(px, [(C, 5), (C - 4.5, C), (C + 4.5, C)], RED)
tri(px, [(C, S - 6), (C - 4.5, C), (C + 4.5, C)], INK)
tri(px, [(6, C), (C, C - 4.5), (C, C + 4.5)], SEA)
tri(px, [(S - 7, C), (C, C - 4.5), (C, C + 4.5)], SEA)
disc(px, C, C, 3.2, GOLD)
disc(px, C, C, 1.4, INK)
write_ico(os.path.join(ICO_DIR, 'crew.ico'), px)

# ── 2) 航海日誌（経営日次ブリーフ） ──────────────────────────
px = blank()
rect(px, 7, 4, 41, 44, INK)
rect(px, 9, 6, 39, 42, PARCH)
rect(px, 9, 6, 14, 42, RED)          # 背表紙
for i, y in enumerate(range(13, 39, 5)):   # 罫線
    w = 34 if i % 3 else 26
    rect(px, 18, y, 18 + w - 12, y + 1, INK if i % 3 else GOLD)
disc(px, 33, 35, 6.5, PARCH)
ring(px, 33, 35, 6.5, 1.4, INK)
tri(px, [(33, 30), (30.5, 35), (35.5, 35)], RED)
disc(px, 33, 35, 1.6, GOLD)
write_ico(os.path.join(ICO_DIR, 'brief.ico'), px)

print('icons ->', ICO_DIR)

# ── 3) ショートカット ────────────────────────────────────────
DESK = None
for cand in (os.path.join(os.environ['USERPROFILE'], 'OneDrive', 'Desktop'),
             os.path.join(os.environ['USERPROFILE'], 'OneDrive', 'デスクトップ'),
             os.path.join(os.environ['USERPROFILE'], 'Desktop')):
    if os.path.isdir(cand):
        DESK = cand
        break

LINKS = [
    ('経営ダッシュボード.url', 'https://claude.ai/code/artifact/e67f40c7-3e7b-40d3-939e-2e1ad3fcea34',
     os.path.join(ICO_DIR, 'crew.ico')),
    ('経営日次ブリーフ.url', 'https://claude.ai/code/artifact/0778d136-f252-4c7e-8719-713ecda24d06',
     os.path.join(ICO_DIR, 'brief.ico')),
]

for name, url, ico in LINKS:
    body = ('[InternetShortcut]\r\n'
            'URL=%s\r\n'
            'IconFile=%s\r\n'
            'IconIndex=0\r\n' % (url, ico))
    p = os.path.join(DESK, name)
    io.open(p, 'w', encoding='ascii').write(body)
    print('shortcut ->', p)
