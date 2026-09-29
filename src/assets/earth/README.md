# Earth basemap asset

The 3D globe entry point uses **one** Earth image from this folder. Any image
here is auto-detected at build time (no code change needed) by
`src/globe/GlobeView.js`:

```
import.meta.glob('../assets/earth/*.{jpg,jpeg,png,webp}', …)
```

## Required image spec

- **Projection:** equirectangular / plate-carrée
  - X = longitude −180° (left) → +180° (right); prime meridian (0°) at the
    horizontal centre of the image.
  - Y = latitude +90° (top) → −90° (bottom).
- **Aspect ratio:** 2:1. Recommended **4096×2048** (min 2048×1024; 8192×4096 for
  crisp coastlines).
- **Format:** JPG / PNG / WebP, sRGB colour, continents + oceans
  (NASA Blue Marble / Natural Earth style).

## Current asset

`earth.png` — a real equirectangular Blue-Marble-style basemap supplied by the
user. This is the image the globe renders.

## If this folder is empty

The globe still works: it falls back to a neutral placeholder sphere + a lat/lon
graticule and shows an explicit "add an Earth image" note. Latitude/longitude
picking is real either way (it comes from sphere-intersection math in
`GlobeCoordinateTransform`, not from the texture). **No Earth texture is ever
downloaded, generated, or substituted** — the image is user-supplied only.
