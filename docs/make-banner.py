from PIL import Image, ImageDraw, ImageFont
import math

W, H = 1280, 380
img = Image.new("RGB", (W, H), "#121214")
d = ImageDraw.Draw(img)

# vertical gradient
for y in range(H):
    t = y / H
    r = int(18 + 8 * t)
    g = int(18 + 10 * t)
    b = int(20 + 14 * t)
    d.line([(0, y), (W, y)], fill=(r, g, b))

# soft accent glow
for radius in range(360, 0, -6):
    alpha = int(26 * (1 - radius / 360))
    if alpha <= 0:
        continue
    d.ellipse(
        [W - 300 - radius, 40 - radius, W - 300 + radius, 40 + radius],
        fill=(79 + alpha, 111 + alpha, 143 + alpha),
    )

sans_bold = "C:/Windows/Fonts/msyhbd.ttc"
sans = "C:/Windows/Fonts/msyh.ttc"

font_kicker = ImageFont.truetype(sans, 22)
font_title = ImageFont.truetype(sans_bold, 168)
font_sub = ImageFont.truetype(sans, 38)
font_tag = ImageFont.truetype(sans, 22)
font_pill = ImageFont.truetype(sans, 20)

d.text((88, 58), "S H I Z I", font=font_kicker, fill=(143, 176, 204))
d.text((84, 92), "拾字", font=font_title, fill=(246, 246, 242))
d.text((92, 286), "视频与网页的 AI 笔记工作台", font=font_sub, fill=(210, 212, 208))

pills = ["B站", "YouTube", "网页", "播客", "本地音视频"]
x = 92
y = 338
for label in pills:
    box = d.textbbox((0, 0), label, font=font_pill)
    pw = box[2] - box[0] + 30
    d.rounded_rectangle([x, y, x + pw, y + 34], radius=17, outline=(70, 74, 82), width=1)
    d.text((x + 15, y + 6), label, font=font_pill, fill=(168, 172, 178))
    x += pw + 10

img.save("docs/banner.png")

# social preview 1280x640
W2, H2 = 1280, 640
img2 = Image.new("RGB", (W2, H2), "#121214")
d2 = ImageDraw.Draw(img2)
for y in range(H2):
    t = y / H2
    d2.line([(0, y), (W2, y)], fill=(int(18 + 8 * t), int(18 + 10 * t), int(20 + 14 * t)))
for radius in range(520, 0, -8):
    alpha = int(22 * (1 - radius / 520))
    if alpha <= 0:
        continue
    d2.ellipse([W2 - 260 - radius, 80 - radius, W2 - 260 + radius, 80 + radius],
               fill=(79 + alpha, 111 + alpha, 143 + alpha))

f_kick2 = ImageFont.truetype(sans, 24)
f_title2 = ImageFont.truetype(sans_bold, 190)
f_sub2 = ImageFont.truetype(sans, 44)
f_tag2 = ImageFont.truetype(sans, 26)
d2.text((96, 150), "S H I Z I", font=f_kick2, fill=(143, 176, 204))
d2.text((90, 190), "拾字", font=f_title2, fill=(246, 246, 242))
d2.text((100, 420), "视频与网页的 AI 笔记工作台", font=f_sub2, fill=(210, 212, 208))
d2.text((100, 486), "B站 · YouTube · 网页 · 播客 · 本地音视频", font=f_tag2, fill=(150, 154, 160))
img2.save("docs/social-preview.png")
print("saved", img.size, img2.size)
