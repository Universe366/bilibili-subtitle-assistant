"""把截图整理成 Edge Add-ons 要求的精确尺寸。

Partner Center 只接受：
  · 640 × 480
  · 1280 × 800

用法：
  # 缩放到完整可见（可能留背景边），适合整窗截图
  python verify/tools/fit-store-screenshot.py shot.png --size 1280x800 --mode contain

  # 填满画布并居中裁切（不留边，可能裁掉边缘）
  python verify/tools/fit-store-screenshot.py shot.png --size 1280x800 --mode cover

  # 只检查尺寸
  python verify/tools/fit-store-screenshot.py shot.png --check

默认输出到 docs/store/screenshot-<宽>x<高>.png。
"""
import argparse
import os
from PIL import Image

ALLOWED = {(640, 480), (1280, 800)}
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DEFAULT_OUT = os.path.join(ROOT, "docs", "store")


def parse_size(value):
    try:
        w, h = [int(x) for x in value.lower().replace("×", "x").split("x")]
    except Exception as exc:
        raise argparse.ArgumentTypeError("尺寸格式应为 1280x800 或 640x480") from exc
    if (w, h) not in ALLOWED:
        raise argparse.ArgumentTypeError(f"只支持 {sorted(ALLOWED)}，收到 {w}x{h}")
    return w, h


def fit_contain(img, size, bg=(11, 18, 32)):
    canvas = Image.new("RGB", size, bg)
    ratio = min(size[0] / img.width, size[1] / img.height)
    nw, nh = max(1, round(img.width * ratio)), max(1, round(img.height * ratio))
    resized = img.resize((nw, nh), Image.LANCZOS)
    canvas.paste(resized, ((size[0] - nw) // 2, (size[1] - nh) // 2))
    return canvas


def fit_cover(img, size):
    ratio = max(size[0] / img.width, size[1] / img.height)
    nw, nh = max(size[0], round(img.width * ratio)), max(size[1], round(img.height * ratio))
    resized = img.resize((nw, nh), Image.LANCZOS)
    left = (nw - size[0]) // 2
    top = (nh - size[1]) // 2
    return resized.crop((left, top, left + size[0], top + size[1]))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input", help="原始截图")
    ap.add_argument("--size", type=parse_size, default=(1280, 800), help="1280x800 或 640x480")
    ap.add_argument("--mode", choices=["contain", "cover"], default="contain")
    ap.add_argument("--out", default="", help="输出路径；默认 docs/store/screenshot-<size>.png")
    ap.add_argument("--check", action="store_true", help="只检查输入尺寸，不写文件")
    args = ap.parse_args()

    img = Image.open(args.input)
    if args.check:
        ok = (img.width, img.height) in ALLOWED
        print(f"{args.input}: {img.width}x{img.height} -> {'OK' if ok else 'NOT allowed'}")
        raise SystemExit(0 if ok else 1)

    img = img.convert("RGB")
    out = args.out or os.path.join(DEFAULT_OUT, f"screenshot-{args.size[0]}x{args.size[1]}.png")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    result = fit_contain(img, args.size) if args.mode == "contain" else fit_cover(img, args.size)
    result.save(out, "PNG", optimize=True)
    print(f"{args.input} ({img.width}x{img.height}) -> {out} ({result.width}x{result.height}, {args.mode})")


if __name__ == "__main__":
    main()
