# Genera los íconos (barras ascendentes sobre fondo verde azulado) a partir de un dibujo base.
from PIL import Image, ImageDraw
import os, sys
OUT = os.path.join(os.path.dirname(__file__), 'assets')
os.makedirs(OUT, exist_ok=True)
BG = (10, 124, 119, 255)
def bars(size, pad_frac, bg=True, rounded=0.0):
    S = size * 4  # supermuestreo
    im = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    if bg:
        if rounded:
            d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * rounded), fill=BG)
        else:
            d.rectangle([0, 0, S, S], fill=BG)
    # zona de dibujo centrada
    pad = S * pad_frac
    box = S - 2 * pad
    bw = box * 0.2
    gap = box * 0.1
    total = 3 * bw + 2 * gap
    x0 = (S - total) / 2
    heights = [0.38, 0.66, 1.0]
    base = S / 2 + box * 0.5
    for i, h in enumerate(heights):
        x = x0 + i * (bw + gap)
        d.rounded_rectangle([x, base - box * h, x + bw, base], radius=bw * 0.28, fill=(255, 255, 255, 255))
    return im.resize((size, size), Image.LANCZOS)
# ícono para web y manifest (cuadrado completo, apto "maskable")
for n in (192, 512):
    bars(n, 0.24).convert('RGB').save(os.path.join(OUT, f'icon-{n}.png'))
# base para Android
bars(1024, 0.24).save(os.path.join(OUT, 'icon-1024.png'))
bars(432, 0.30, bg=False).save(os.path.join(OUT, 'icon-foreground-432.png'))
print('íconos listos en', OUT)
