"""Draws the app icons (run once, PNGs are committed): python app/make-icons.py"""
from PIL import Image, ImageDraw, ImageFont
import os
HERE = os.path.dirname(os.path.abspath(__file__))
GREEN, WHITE = (14, 107, 82), (255, 255, 255)
FONT = r"C:\Windows\Fonts\malgunbd.ttf"

def draw(size, shape):
    s = size * 4  # draw big, scale down for smooth edges
    im = Image.new("RGBA", (s, s), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if shape == "round":
        d.ellipse([0, 0, s - 1, s - 1], fill=GREEN)
    elif shape == "rounded":
        d.rounded_rectangle([0, 0, s - 1, s - 1], radius=int(s * 0.22), fill=GREEN)
    else:
        d.rectangle([0, 0, s, s], fill=GREEN)
    f = ImageFont.truetype(FONT, int(s * 0.34))
    d.text((s / 2, s / 2 - s * 0.02), "취식", font=f, fill=WHITE, anchor="mm")
    return im.resize((size, size), Image.LANCZOS)

www = os.path.join(HERE, "www")
draw(192, "square").save(os.path.join(www, "icon-192.png"))
draw(512, "square").save(os.path.join(www, "icon-512.png"))
draw(180, "square").save(os.path.join(www, "apple-touch-icon.png"))
for name, px in {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}.items():
    out = os.path.join(HERE, "android-res", "mipmap-" + name)
    os.makedirs(out, exist_ok=True)
    draw(px, "rounded").save(os.path.join(out, "ic_launcher.png"))
    draw(px, "round").save(os.path.join(out, "ic_launcher_round.png"))
print("icons written")
