"""生成 Edge Add-ons 商店素材：300×300 logo、440×280 小促销图、1400×560 大促销图。

截图（1280×800 / 640×480）是可选的，且必须来自真实侧边栏，
所以这个脚本不伪造截图。运行方式：

    python verify/tools/make-store-assets.py

输出到 repo/docs/store/。
"""
from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
OUT = os.path.join(ROOT, "docs", "store")
os.makedirs(OUT, exist_ok=True)

PINK = (251, 114, 153)
PINK2 = (232, 92, 134)
BG1 = (11, 18, 32)
BG2 = (27, 36, 54)
WHITE = (248, 250, 252)
MUTED = (148, 163, 184)
MUTED2 = (203, 213, 225)

FONT_BD = "C:/Windows/Fonts/msyhbd.ttc"
FONT_RG = "C:/Windows/Fonts/msyh.ttc"


def font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()


def gradient(w, h):
    img = Image.new("RGB", (w, h), BG1)
    px = img.load()
    for y in range(h):
        t = y / max(1, h - 1)
        r = int(BG1[0] + (BG2[0] - BG1[0]) * t)
        g = int(BG1[1] + (BG2[1] - BG1[1]) * t)
        b = int(BG1[2] + (BG2[2] - BG1[2]) * t)
        for x in range(w):
            px[x, y] = (r, g, b)
    return img


def glow(img, xy, radius, color):
    layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    d.ellipse((xy[0] - radius, xy[1] - radius, xy[0] + radius, xy[1] + radius), fill=color)
    layer = layer.filter(ImageFilter.GaussianBlur(radius // 2))
    img.alpha_composite(layer)


def make_logo():
    # 4 倍绘制再降采样，边缘更干净
    S = 1200
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    pad, r = int(S * 0.055), int(S * 0.235)
    # 渐变底
    grad = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    gd = ImageDraw.Draw(grad)
    for y in range(S):
        t = y / (S - 1)
        c = (
            int(PINK[0] + (PINK2[0] - PINK[0]) * t),
            int(PINK[1] + (PINK2[1] - PINK[1]) * t),
            int(PINK[2] + (PINK2[2] - PINK[2]) * t),
            255,
        )
        gd.line([(0, y), (S, y)], fill=c)
    mask = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mask).rounded_rectangle((pad, pad, S - pad, S - pad), radius=r, fill=255)
    img.alpha_composite(Image.composite(grad, Image.new("RGBA", (S, S), (0, 0, 0, 0)), mask))
    # 顶部高光
    hl = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hl)
    hd.rounded_rectangle((pad, pad, S - pad, int(S * 0.55)), radius=r, fill=(255, 255, 255, 40))
    img.alpha_composite(hl)
    # 三条字幕条
    bars = [(0.60, 0.285, 0.105, 255), (0.60, 0.475, 0.105, 255), (0.34, 0.665, 0.105, 178)]
    for w, y, h, a in bars:
        bw, bh = S * w, S * h
        x0 = S * 0.5 - bw / 2
        y0 = S * y
        d.rounded_rectangle((x0, y0, x0 + bw, y0 + bh), radius=bh / 2, fill=(255, 255, 255, a))
    out = img.resize((300, 300), Image.LANCZOS)
    path = os.path.join(OUT, "logo-300.png")
    out.save(path, "PNG", optimize=True)
    return path


def make_promo(w, h, name):
    img = gradient(w, h).convert("RGBA")
    glow(img, (w * 0.82, h * 0.15), int(w * 0.24), (*PINK, 50))
    d = ImageDraw.Draw(img)
    icon = Image.open(os.path.join(ROOT, "bilibili-subtitle-assistant", "icons", "icon128.png")).convert("RGBA")
    isz = int(h * 0.42)
    icon = icon.resize((isz, isz), Image.LANCZOS)
    ix = int(w * 0.075)
    iy = int((h - isz) / 2) - int(h * 0.05)
    img.alpha_composite(icon, (ix, iy))
    title_f = font(FONT_BD, int(h * 0.13))
    sub_f = font(FONT_RG, int(h * 0.058))
    small_f = font(FONT_RG, int(h * 0.045))
    d.text((ix + isz + int(w * 0.035), iy + int(h * 0.02)), "B站字幕助手", font=title_f, fill=WHITE)
    d.text((ix + isz + int(w * 0.035), iy + int(h * 0.20)), "字幕抓取 · 语音转录 · AI 总结 · 导出", font=sub_f, fill=MUTED2)
    d.text((ix + isz + int(w * 0.035), iy + int(h * 0.30)), "Chrome / Edge MV3 · 密钥只存本地 · 非官方项目", font=small_f, fill=MUTED)
    d.rounded_rectangle((ix, int(h * 0.86), w - ix, int(h * 0.86) + max(3, h // 120)), radius=2, fill=(*PINK, 220))
    path = os.path.join(OUT, name)
    img.convert("RGB").save(path, "PNG", optimize=True)
    return path


if __name__ == "__main__":
    print(make_logo())
    print(make_promo(440, 280, "promo-small-440x280.png"))
    print(make_promo(1400, 560, "promo-large-1400x560.png"))
