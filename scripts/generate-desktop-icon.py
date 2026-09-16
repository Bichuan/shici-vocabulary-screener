from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent
build_output = root / "build"
public_output = root / "public" / "icons"
build_output.mkdir(exist_ok=True)
public_output.mkdir(parents=True, exist_ok=True)

GREEN = "#285b46"
WHITE = "white"
font_paths = [
    Path("C:/Windows/Fonts/msyhbd.ttc"),
    Path("C:/Windows/Fonts/msyh.ttc"),
]
font_path = next((item for item in font_paths if item.exists()), None)
if font_path is None:
    raise RuntimeError("未找到微软雅黑字体，无法生成应用图标。")


def draw_mark(size: int, full_bleed: bool = False) -> Image.Image:
    image = Image.new("RGBA", (size, size), GREEN if full_bleed else (0, 0, 0, 0))
    draw = ImageDraw.Draw(image)
    if not full_bleed:
        inset = round(size * 20 / 512)
        draw.rounded_rectangle(
            (inset, inset, size - inset, size - inset),
            radius=round(size * 112 / 512),
            fill=GREEN,
        )
    font = ImageFont.truetype(str(font_path), round(size * (0.56 if full_bleed else 310 / 512)))
    text = "拾"
    box = draw.textbbox((0, 0), text, font=font)
    x = (size - (box[2] - box[0])) / 2 - box[0]
    y = (size - (box[3] - box[1])) / 2 - box[1] - round(size * (0.015 if full_bleed else 8 / 512))
    draw.text((x, y), text, font=font, fill=WHITE)
    return image


desktop = draw_mark(512)
desktop.save(build_output / "icon.png")
desktop.save(build_output / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])

draw_mark(192).save(public_output / "pwa-192.png")
draw_mark(512).save(public_output / "pwa-512.png")
draw_mark(512, full_bleed=True).save(public_output / "pwa-maskable-512.png")
draw_mark(180, full_bleed=True).convert("RGB").save(public_output / "apple-touch-icon.png")
draw_mark(32).save(public_output / "favicon-32.png")

print(f"桌面图标已生成：{build_output / 'icon.ico'}")
print(f"PWA 图标已生成：{public_output}")
