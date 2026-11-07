"""Trace the TMP monogram from a screenshot into a clean SVG path.

usage: python3 trace_logo.py <screenshot.png> <out.json>
The crop box is in the screenshot's pixel space (set below for the 1290px-wide phone screenshot).
"""
import sys, json
import numpy as np
from PIL import Image
import potrace

src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert('RGB')
k = im.width / 923.0                       # box below was measured on a 923px-wide preview
box = tuple(int(v * k) for v in (40, 140, 215, 250))
mark = im.crop(box)
S = 8                                      # upscale before thresholding => smooth, sub-pixel edges
big = mark.resize((mark.width * S, mark.height * S), Image.BICUBIC)
a = np.asarray(big).astype(float)
navy = np.array([0x19, 0x25, 0x5a], float)
gold = np.array([0xf6, 0xc4, 0x45], float)
d = gold - navy
t = ((a - navy) @ d) / (d @ d)             # 0 = navy, 1 = gold (projection)
mask = t > 0.5

ys, xs = np.where(mask)
x0, x1, y0, y1 = xs.min(), xs.max(), ys.min(), ys.max()
pad = 2 * S
mask = mask[y0 - pad:y1 + pad + 1, x0 - pad:x1 + pad + 1]
H, W = mask.shape

bm = potrace.Bitmap(~mask)   # potracer fills the False pixels
plist = bm.trace(turdsize=40, turnpolicy=potrace.POTRACE_TURNPOLICY_MINORITY, alphamax=1.0, opticurve=True, opttolerance=1.2)

def pt(p): return f"{p.x/S:.1f} {p.y/S:.1f}"
parts = []
for curve in plist:
    parts.append(f"M{pt(curve.start_point)}")
    for seg in curve.segments:
        if seg.is_corner:
            parts.append(f"L{pt(seg.c)}L{pt(seg.end_point)}")
        else:
            parts.append(f"C{pt(seg.c1)} {pt(seg.c2)} {pt(seg.end_point)}")
    parts.append("Z")
json.dump({"d": "".join(parts), "w": round(W / S, 1), "h": round(H / S, 1)}, open(out, "w"))
print("paths:", len(plist), "viewBox", round(W / S, 2), round(H / S, 2), "chars", len("".join(parts)))
