# Oddhound brand asset provenance

Generated on 2026-10-28 for Oddhound's own branding (UI/UX Standards §8: explore a hound mark and two illustration states, record provenance, no third-party marks).

| File | What it is | How it was made |
|---|---|---|
| `oddhound-icon-{32,64,128,256,512}.png`, `../../app/icon.png` | App mark and favicon: cream hound head with a brown ear, blaze-orange collar and scent dots on a forest-green tile | Generated with Recraft V4.1 Vector (via Moda `canvas_edit_image`), prompt-constrained to the palette #1E3B30, #FBF7EF, #8A5A3C, #F2541B. Cropped from a 2× export; rounded-square mask (22% radius) applied locally with Pillow. |
| `apple-icon.png`, `../../app/apple-icon.png` | iOS touch icon | Same icon composited on an opaque #1E3B30 square, 180×180. |
| `hound-tracking.png` | Illustration: the hound follows a scent trail past simplified web page cards | Recraft V4.1 Vector, same palette (no black). Background removed locally (border-connected near-white flood fill, colour-to-alpha on the edge fringe). |
| `hound-found.png` | Illustration: the hound points at a flagged problem on a page card | Recraft V4.1 Vector, same palette. Background removed the same way. |

Source boards (private, Moda): "Oddhound brand assets" (four logo directions) and "Oddhound illustrations" (final icon and the two states). Prompts described an original hound character only: no existing logos, brands or characters were referenced.

The animated hounds in `app/hero-trail.tsx` and `app/runs/[id]/trail-map.tsx` are hand-written SVG, drawn to match.
