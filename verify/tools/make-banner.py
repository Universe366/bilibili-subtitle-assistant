from PIL import Image, ImageDraw, ImageFont, ImageFilter
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ICON = os.path.join(ROOT, "bilibili-subtitle-assistant", "icons", "icon128.png")
OUT_DIR = os.path.join(ROOT, "docs")
os.makedirs(OUT_DIR, exist_ok=True)

PINK = (251, 114, 153)
PINK2 = (232, 92, 134)
BG1 = (11, 18, 32)
BG2 = (27, 36, 54)
WHITE = (248, 250, 252)
MUTED = (148, 163, 184)
MUTED2 = (203, 213, 225)


def font(path, size):
    return ImageFont.truetype(path, size)


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


def draw_text(d, xy, text, f, fill):
    d.text(xy, text, font=f, fill=fill)


def make_banner():
    w, h = 1280, 380
    img = gradient(w, h).convert("RGBA")
    glow(img, (1080, 60), 260, (*PINK, 55))
    glow(img, (980, 360), 220, (56, 189, 248, 35))
    d = ImageDraw.Draw(img)

    # 左侧图标
    icon = Image.open(ICON).convert("RGBA").resize((136, 136), Image.LANCZOS)
    img.alpha_composite(icon, (72, 122))

    # 标题
    title_f = font("C:/Windows/Fonts/msyhbd.ttc", 62)
    sub_f = font("C:/Windows/Fonts/msyh.ttc", 26)
    small_f = font("C:/Windows/Fonts/msyh.ttc", 20)
    draw_text(d, (244, 112), "B站字幕助手", title_f, WHITE)
    draw_text(d, (248, 196), "字幕抓取 · 语音转录 · AI 总结 · 联网补充 · 导出", sub_f, MUTED2)
    draw_text(d, (248, 242), "Chrome / Edge MV3 · 密钥只存本地 · 非官方项目", small_f, MUTED)

    # 顶部细线
    d.rounded_rectangle((72, 70, 1208, 74), radius=2, fill=(*PINK, 220))

    # 右侧装饰：三条“字幕条”
    bar_x = 900
    bars = [(bar_x, 120, 250, 22, 210), (bar_x + 26, 166, 210, 22, 160), (bar_x + 52, 212, 168, 22, 110)]
    for x, y, bw, bh, alpha in bars:
        layer = Image.new("RGBA", img.size, (0, 0, 0, 0))
        ld = ImageDraw.Draw(layer)
        ld.rounded_rectangle((x, y, x + bw, y + bh), radius=bh // 2, fill=(*PINK, alpha))
        img.alpha_composite(layer)

    # 右下角水印
    draw_text(d, (1024, 318), "字幕助手", small_f, (100, 116, 139))

    img.convert("RGB").save(os.path.join(OUT_DIR, "banner.png"), optimize=True)


def make_social():
    w, h = 1280, 640
    img = gradient(w, h).convert("RGBA")
    glow(img, (640, 90), 420, (*PINK, 45))
    glow(img, (1150, 560), 300, (56, 189, 248, 28))
    d = ImageDraw.Draw(img)

    icon = Image.open(ICON).convert("RGBA").resize((176, 176), Image.LANCZOS)
    img.alpha_composite(icon, ((w - 176) // 2, 120))

    title_f = font("C:/Windows/Fonts/msyhbd.ttc", 72)
    sub_f = font("C:/Windows/Fonts/msyh.ttc", 30)
    small_f = font("C:/Windows/Fonts/msyh.ttc", 22)

    title = "B站字幕助手"
    tw = d.textlength(title, font=title_f)
    draw_text(d, ((w - tw) / 2, 330), title, title_f, WHITE)

    sub = "字幕抓取 · 语音转录 · AI 总结 · 导出"
    sw = d.textlength(sub, font=sub_f)
    draw_text(d, ((w - sw) / 2, 430), sub, sub_f, MUTED2)

    small = "Chrome / Edge MV3 扩展 · 非官方项目"
    sw = d.textlength(small, font=small_f)
    draw_text(d, ((w - sw) / 2, 492), small, small_f, MUTED)

    d.rounded_rectangle((480, 560, 800, 564), radius=2, fill=(*PINK, 220))

    img.convert("RGB").save(os.path.join(OUT_DIR, "social-preview.png"), optimize=True)


make_banner()
make_social()
print("generated docs/banner.png and docs/social-preview.png")
