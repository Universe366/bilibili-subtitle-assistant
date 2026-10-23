from PIL import Image, ImageDraw, ImageFont

BOLD = "C:/Windows/Fonts/msyhbd.ttc"
SANS = "C:/Windows/Fonts/msyh.ttc"


def canvas(width, height):
    img = Image.new("RGB", (width, height), "#121214")
    draw = ImageDraw.Draw(img)
    for y in range(height):
        t = y / max(1, height)
        draw.line(
            [(0, y), (width, y)],
            fill=(int(18 + 8 * t), int(18 + 10 * t), int(20 + 14 * t)),
        )
    return img, draw


def logo():
    size = 300
    img, d = canvas(size, size)
    f = ImageFont.truetype(BOLD, 112)
    text = "拾字"
    box = d.textbbox((0, 0), text, font=f)
    d.text(
        ((size - (box[2] - box[0])) / 2 - box[0], (size - (box[3] - box[1])) / 2 - box[1]),
        text,
        font=f,
        fill=(246, 246, 242),
    )
    img.save("docs/store/logo-300.png")


def promo(width, height, title_size, sub_size, small=False):
    img, d = canvas(width, height)
    f_title = ImageFont.truetype(BOLD, title_size)
    f_sub = ImageFont.truetype(SANS, sub_size)
    f_kick = ImageFont.truetype(SANS, max(14, sub_size // 3))
    x = int(width * 0.07)
    y = int(height * (0.28 if small else 0.26))
    d.text((x, y - sub_size * 1.4), "S H I Z I", font=f_kick, fill=(143, 176, 204))
    d.text((x, y), "拾字", font=f_title, fill=(246, 246, 242))
    d.text(
        (x, y + title_size * 1.08),
        "视频与网页的 AI 笔记工作台" if not small else "AI 笔记工作台",
        font=f_sub,
        fill=(210, 212, 208),
    )
    img.save(f"docs/store/promo-{'large' if not small else 'small'}-{width}x{height}.png")


logo()
promo(1400, 560, 132, 38)
promo(440, 280, 64, 20, small=True)
print("store assets saved")
