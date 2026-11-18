"""Makes each church's install icons and install file (web/icons/<church>/, web/manifest-<church>.webmanifest) from the
neutral grey icons, in the church's colour. Run it again after changing a church's colour or app name:
    python3 .github/scripts/church_icons.py
The app points an installed SongPoint at its church's set once someone signs in (the app's identity stays the same)."""
import json, os
from PIL import Image

CHURCHES = {   # id: (app name, colour) - keep in step with Settings > Churches
    'martindale': ('MMC SongPoint', '#72173b'),
    'cambridge': ('Cambridge SongPoint', '#0071bb'),
    'ephrata': ('EBC SongPoint', '#2e7683'),
    'parkview': ('Parkview SongPoint', '#7e2c18'),
    'shiloh': ('Shiloh SongPoint', '#0071bb'),
}
GREY = 0x55
here = os.path.dirname(os.path.abspath(__file__)); web = os.path.join(here, '..', '..', 'web')
for cid, (name, color) in CHURCHES.items():
    c = tuple(int(color[i:i + 2], 16) for i in (1, 3, 5))
    out = os.path.join(web, 'icons', cid); os.makedirs(out, exist_ok=True)
    for f in ['icon-192', 'icon-512', 'icon-maskable-512', 'apple-touch-icon']:
        im = Image.open(os.path.join(web, 'icons', f + '.png')); mode = im.mode; im = im.convert('RGBA'); px = im.load()
        for y in range(im.size[1]):
            for x in range(im.size[0]):
                r, g, b, a = px[x, y]
                if not a: continue
                t = max(0.0, min(1.0, (g - GREY) / (255 - GREY)))   # 0 = the background colour, 1 = the white note
                px[x, y] = tuple(round(c[i] + (255 - c[i]) * t) for i in range(3)) + (a,)
        (im if mode == 'RGBA' else im.convert(mode)).save(os.path.join(out, f + '.png'))
    m = json.load(open(os.path.join(web, 'manifest.webmanifest')))
    m.update({'name': name, 'theme_color': color, 'icons': [dict(i, src=i['src'].replace('icons/', 'icons/%s/' % cid)) for i in m['icons']]})
    json.dump(m, open(os.path.join(web, 'manifest-%s.webmanifest' % cid), 'w'), indent=2)
print('done')
