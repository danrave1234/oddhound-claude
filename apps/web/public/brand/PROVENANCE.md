# Oddhound brand asset provenance

Made on 2026-10-28 for Oddhound's own branding (UI/UX Standards §8). No third-party marks were referenced.

| File | What it is | How it was made |
|---|---|---|
| `ui/icons.tsx` `HOUND_PATH`, `oddhound-mark.svg` | The mark: a hound's head in profile with a long drop ear, one colour | Built by hand from simple geometry (two circles and convex hulls for skull, muzzle and ear, a polygon for the neck), combined with boolean operations in Python (shapely). The ear is separated from the head by a 1.7-unit gap and the eye is a hole, so the mark works in a single colour at any size. |
| `oddhound-icon.svg`, `oddhound-icon-{32,64,128,256,512}.png`, `../../app/icon.png` | App icon and favicon | The same mark in white on a forest (#1F3D32) rounded square, rasterised from the path with Pillow. |
| `apple-icon.png`, `../../app/apple-icon.png` | iOS touch icon | The same, on an opaque full square, 180×180. |

In the app the mark is inline SVG filled with `currentColor`, so it follows the text colour in light and dark mode.
