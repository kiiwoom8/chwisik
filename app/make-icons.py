"""Makes every app icon from one picture: python app/make-icons.py
Source: app/icon-source.png (or .jpg) - the owner's green character drawing.
- Removes the white background (flood fill from the edges, so white inside the face stays: eyes, nose, teeth).
- Keeps only the biggest drawn shape (the character); the speech bubble and stray marks are dropped.
- Android adaptive icon (8+): the character rising from the bottom edge with a soft shadow (foreground), on a deep
  green radial gradient in the page's --accent family (background), plus a monochrome layer for Android 13+ themed
  icons (the character's shape with its lines cut out). The launcher masks the 108 dp canvas to its own shape; the
  head stays inside the 66 dp safe circle and the crop's flat bottom edge sits below the visible 72 dp.
- Legacy launcher PNGs (Android 6-7), the launch-screen mark, the web/iPhone home-screen icons and the iPhone app's
  icon + launch screen are the same picture flattened.
Needs Pillow, numpy, scipy."""
import glob, os
import numpy as np
from PIL import Image, ImageDraw, ImageFilter
from scipy import ndimage

HERE = os.path.dirname(os.path.abspath(__file__))
src = (glob.glob(os.path.join(HERE, "icon-source.png")) + glob.glob(os.path.join(HERE, "icon-source.jp*g")))[0]
PAPER = (242, 244, 241)                   # page background --paper
BG_IN, BG_OUT = (0x22, 0xA0, 0x7E), (0x0A, 0x4A, 0x3A)  # gradient around --accent #0e6b52
S = 1024                                   # working canvas = 108 dp
DP = S / 108.0

# --- cut the character out -------------------------------------------------------------------------------------
a = np.asarray(Image.open(src).convert("RGB")).astype(int)
white = a.min(axis=2) > 200
lab, _ = ndimage.label(white)               # background = white pixels connected to the picture's edge
edge = set(np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))) - {0}
bg = np.isin(lab, list(edge))
fl, n = ndimage.label(~bg, structure=np.ones((3, 3)))   # 8-connected so thin outlines hold together
sizes = ndimage.sum(np.ones_like(fl), fl, index=range(1, n + 1))
char = ndimage.binary_fill_holes(fl == 1 + int(np.argmax(sizes)))
alpha = char.astype(float)                  # soft edge: outline pixels next to the background fade by lightness
ring = char & ndimage.binary_dilation(bg, iterations=1)
alpha[ring] = np.clip((1 - a.min(axis=2)[ring] / 255) * 1.6, 0, 1)
art = Image.fromarray(np.dstack([a, (alpha * 255).astype(int)]).astype(np.uint8), "RGBA")
art = art.crop(art.getbbox())

# --- layers ----------------------------------------------------------------------------------------------------
def radial(c_in, c_out, cx=0.34, cy=0.22, r=1.05):
    y, x = np.mgrid[0:S, 0:S] / S
    t = np.clip(np.hypot(x - cx, y - cy) / r, 0, 1) ** 1.15
    rgb = np.array(c_in, float) * (1 - t[..., None]) + np.array(c_out, float) * t[..., None]
    return Image.fromarray(rgb.round().astype(np.uint8), "RGB").convert("RGBA")

def foreground():
    nw = round(52 * DP); nh = round(art.size[1] * nw / art.size[0])      # 52 dp wide, bottom at 97 dp
    fg = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    fg.paste(art.resize((nw, nh), Image.LANCZOS), (round(55 * DP - nw / 2), round(97 * DP - nh)))
    sh = Image.new("RGBA", (S, S), (0, 0, 0, 0))                          # soft drop shadow
    sh.putalpha(fg.getchannel("A").filter(ImageFilter.GaussianBlur(2.6 * DP)).point(lambda v: int(v * 0.35)))
    out = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    out.alpha_composite(sh, (0, round(1.8 * DP)))
    out.alpha_composite(fg)
    return out

def monochrome(fg):
    p = np.asarray(fg).astype(int)
    shape = p[..., 3] > 110
    dark = Image.fromarray((((p[..., :3].max(axis=2) < 110) & shape) * 255).astype(np.uint8), "L").filter(ImageFilter.MaxFilter(3))
    inner = Image.fromarray((shape * 255).astype(np.uint8), "L").filter(ImageFilter.MinFilter(int(2 * DP) | 1))
    keep = shape & ~((np.asarray(dark) > 0) & (np.asarray(inner) > 0))   # outer outline stays, inner lines cut
    out = np.zeros((S, S, 4), np.uint8); out[..., :3] = 255; out[..., 3] = keep * 255
    return Image.fromarray(out, "RGBA").filter(ImageFilter.GaussianBlur(0.6))

def masked(full, kind, px):
    """The visible 72 dp of the canvas, cut to a launcher-like shape (legacy icons, splash)."""
    vis = full.crop((round(18 * DP), round(18 * DP), round(90 * DP), round(90 * DP))).resize((px * 4, px * 4), Image.LANCZOS)
    m = Image.new("L", vis.size, 0)
    d = ImageDraw.Draw(m)
    if kind == "circle":
        d.ellipse([0, 0, vis.size[0] - 1, vis.size[1] - 1], fill=255)
    else:
        d.rounded_rectangle([0, 0, vis.size[0] - 1, vis.size[1] - 1], radius=vis.size[0] * 0.22, fill=255)
    out = Image.new("RGBA", vis.size, (0, 0, 0, 0))
    out.paste(vis, (0, 0), m)
    return out.resize((px, px), Image.LANCZOS)

def square(full, px, inset_dp=12):
    """Full-bleed square for web/iOS: their own masks round it (maskable keeps the middle 80 %)."""
    i = round(inset_dp * DP)
    return full.crop((i, i, S - i, S - i)).resize((px, px), Image.LANCZOS).convert("RGB")

back = radial(BG_IN, BG_OUT)
fg = foreground()
mono = monochrome(fg)
full = back.copy(); full.alpha_composite(fg)

# --- Android ---------------------------------------------------------------------------------------------------
res = os.path.join(HERE, "android-res")
for name, k in {"mdpi": 1, "hdpi": 1.5, "xhdpi": 2, "xxhdpi": 3, "xxxhdpi": 4}.items():
    out = os.path.join(res, "mipmap-" + name)
    os.makedirs(out, exist_ok=True)
    px = round(108 * k)
    fg.resize((px, px), Image.LANCZOS).save(os.path.join(out, "ic_launcher_foreground.png"))
    back.resize((px, px), Image.LANCZOS).convert("RGB").save(os.path.join(out, "ic_launcher_background.png"))
    mono.resize((px, px), Image.LANCZOS).save(os.path.join(out, "ic_launcher_monochrome.png"))
    leg = round(48 * k)
    masked(full, "rounded", leg).save(os.path.join(out, "ic_launcher.png"))
    masked(full, "circle", leg).save(os.path.join(out, "ic_launcher_round.png"))
os.makedirs(os.path.join(res, "drawable-nodpi"), exist_ok=True)
masked(full, "rounded", 288).save(os.path.join(res, "drawable-nodpi", "splash_icon.png"))
os.makedirs(os.path.join(res, "mipmap-anydpi-v26"), exist_ok=True)
for name in ("ic_launcher", "ic_launcher_round"):
    with open(os.path.join(res, "mipmap-anydpi-v26", name + ".xml"), "w", encoding="utf-8", newline="\n") as f:
        f.write('<?xml version="1.0" encoding="utf-8"?>\n'
                '<!-- written by app/make-icons.py -->\n'
                '<adaptive-icon xmlns:android="http://schemas.android.com/apk/res/android">\n'
                '    <background android:drawable="@mipmap/ic_launcher_background" />\n'
                '    <foreground android:drawable="@mipmap/ic_launcher_foreground" />\n'
                '    <monochrome android:drawable="@mipmap/ic_launcher_monochrome" />\n'
                '</adaptive-icon>\n')

# --- web / iPhone ----------------------------------------------------------------------------------------------
www = os.path.join(HERE, "www")
square(full, 192).save(os.path.join(www, "icon-192.png"))
square(full, 512).save(os.path.join(www, "icon-512.png"))
square(full, 180).save(os.path.join(www, "apple-touch-icon.png"))
ios = os.path.join(HERE, "ios-res")   # ios.yml copies these into the generated Xcode project; no alpha (Apple rejects it)
os.makedirs(ios, exist_ok=True)
square(full, 1024).save(os.path.join(ios, "AppIcon-512@2x.png"))
splash = Image.new("RGB", (2732, 2732), PAPER)
mark = masked(full, "rounded", 560)
splash.paste(mark, ((2732 - 560) // 2, (2732 - 560) // 2), mark)
splash.save(os.path.join(ios, "splash-2732x2732.png"))
masked(full, "rounded", 512).save(os.path.join(HERE, "icon-preview.png"))
print("icons written from", os.path.basename(src))
