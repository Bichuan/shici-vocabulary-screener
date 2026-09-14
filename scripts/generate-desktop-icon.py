from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent
output = root / "build"
output.mkdir(exist_ok=True)

size = 512
image = Image.new("RGBA", (size, size), (0, 0, 0, 0))
draw = ImageDraw.Draw(image)
draw.rounded_rectangle((20, 20, size - 20, size - 20), radius=112, fill="#285b46")

font_paths = [
    Path("C:/Windows/Fonts/msyhbd.ttc"),
    Path("C:/Windows/Fonts/msyh.ttc"),
]
font_path = next((item for item in font_paths if item.exists()), None)
if font_path is None:
    raise RuntimeError("未找到微软雅黑字体，无法生成应用图标。")
font = ImageFont.truetype(str(font_path), 310)
text = "拾"
box = draw.textbbox((0, 0), text, font=font)
x = (size - (box[2] - box[0])) / 2 - box[0]
y = (size - (box[3] - box[1])) / 2 - box[1] - 8
draw.text((x, y), text, font=font, fill="white")

image.save(output / "icon.png")
image.save(output / "icon.ico", sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
print(f"桌面图标已生成：{output / 'icon.ico'}")
