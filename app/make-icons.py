"""Makes every app icon from one picture: python app/make-icons.py
Source: app/icon-source.png (or .jpg) — the owner's green character drawing.
- Removes the white background (flood fill from the edges, so white inside the face stays: eyes, nose, teeth).
- Keeps only the biggest drawn shape (the character); the speech bubble and stray marks are dropped.
- Crops square around the character's head and writes the Android launcher icons (transparent background),
  the web/iPhone icons (on a light background, since iOS fills transparency with black) and the iPhone app's
  icon + launch screen (app/ios-res/).
Needs Pillow, numpy, scipy."""
import glob, os
import numpy as np
from PIL import Image
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
src = (glob.glob(os.path.join(HERE, "icon-source.png")) + glob.glob(os.path.join(HERE, "icon-source.jp*g")))[0]
BG = (242, 244, 241, 255)  # page background --paper

im = Image.open(src).convert("RGB")
a = np.asarray(im).astype(int)
white = (a.min(axis=2) > 200)

# background = white pixels connected to the picture's edge
lab, _ = ndimage.label(white)
edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
bg = np.isin(lab, list(edge))

# the character = biggest connected non-background shape (8-connected so thin outlines hold together)
fg_lab, n = ndimage.label(~bg, structure=np.ones((3, 3)))
sizes = ndimage.sum(np.ones_like(fg_lab), fg_lab, index=range(1, n + 1))
char = fg_lab == (1 + int(np.argmax(sizes)))
char = ndimage.binary_fill_holes(char)

# soft edge: outline pixels next to the background fade by how light they are (no white fringe)
alpha = char.astype(float)
ring = char & ndimage.binary_dilation(bg, iterations=1)
light = a.min(axis=2) / 255.0
alpha[ring] = np.clip((1 - light[ring]) * 1.6, 0, 1)

rgba = np.dstack([a, (alpha * 255).astype(int)]).astype(np.uint8)
cut = Image.fromarray(rgba, "RGBA")

# square crop around the character (head first: keep its top, cut the bottom if the shape is tall)
ys, xs = np.where(char)
x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
side = int(max(x1 - x0, y1 - y0) + 1) if (y1 - y0) < (x1 - x0) else int(x1 - x0 + 1)  # tall: width-sized square from the top
left = int(round((x0 + x1) / 2 - side / 2))
top = int(y0)
sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
sq.paste(cut.crop((left, top, left + side, top + side)), (0, 0))

def icon(px, pad, bg=None):
    inner = int(round(px * (1 - 2 * pad)))
    c = sq.resize((inner, inner), Image.LANCZOS)
    out = Image.new("RGBA", (px, px), bg or (0, 0, 0, 0))
    out.alpha_composite(c, ((px - inner) // 2, (px - inner) // 2))
    return out if bg is None else out.convert("RGB")

www = os.path.join(HERE, "www")
icon(192, 0.10, BG).save(os.path.join(www, "icon-192.png"))
icon(512, 0.10, BG).save(os.path.join(www, "icon-512.png"))
icon(180, 0.08, BG).save(os.path.join(www, "apple-touch-icon.png"))
for name, px in {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}.items():
    out = os.path.join(HERE, "android-res", "mipmap-" + name)
    os.makedirs(out, exist_ok=True)
    icon(px, 0.04).save(os.path.join(out, "ic_launcher.png"))
    icon(px, 0.04).save(os.path.join(out, "ic_launcher_round.png"))
# iPhone app (ios.yml copies these into the generated Xcode project): App Store icon 1024 px, no transparency
# (Apple rejects alpha); launch screen = page background with the icon in the middle (Capacitor's logo replaced).
ios = os.path.join(HERE, "ios-res")
os.makedirs(ios, exist_ok=True)
icon(1024, 0.08, BG).save(os.path.join(ios, "AppIcon-512@2x.png"))
splash = Image.new("RGB", (2732, 2732), BG[:3])
splash.paste(icon(560, 0.0, BG), ((2732 - 560) // 2, (2732 - 560) // 2))
splash.save(os.path.join(ios, "splash-2732x2732.png"))
icon(512, 0.0).save(os.path.join(HERE, "icon-preview.png"))
print("icons written from", os.path.basename(src))
