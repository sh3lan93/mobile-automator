#!/usr/bin/env node
'use strict';

// Reads a real iOS Simulator screenshot (any resolution), crops a 200x100
// centre region, alpha-composites a translucent gray disk that mirrors
// iOS Simulator's "Show Single Touches" overlay (the macOS host renders
// it on top of the iOS guest screen, so it is not present in
// `xcrun simctl io booted screenshot` output), and writes the result.
//
// Usage: node composite-ios-touch-overlay.js <input.png> <output.png>
//
// Disk parameters (calibrated against the host-rendered overlay):
//   colour   = RGB(170, 170, 170) — mid-grey, the indicator's intrinsic fill
//   alpha    = 0.92               — high-visibility opacity for the fixture
//                                   (real iOS Simulator overlay is more
//                                   translucent ~0.6, but pure colour-
//                                   thresholding cannot reliably separate
//                                   a heavily-blended overlay from busy
//                                   iOS UI pixels — robust low-opacity
//                                   detection requires frame differencing
//                                   or blob-shape filtering, both deferred
//                                   beyond slice #25)
//   radius   = 14 px              — large enough to clear `minPixels: 6`
//   centre   = (100, 50)          — centre of the 200x100 crop

const fs = require('fs');
const { PNG } = require('pngjs');

const [, , inPath, outPath] = process.argv;
if (!inPath || !outPath) {
  process.stderr.write('usage: composite-ios-touch-overlay.js <input.png> <output.png>\n');
  process.exit(2);
}

const W = 200;
const H = 100;
const DISK = { r: 170, g: 170, b: 170, a: 0.92 };
const RADIUS = 14;
const CX = 100;
const CY = 50;

const src = PNG.sync.read(fs.readFileSync(inPath));

// Centre-crop a W x H region from the source.
const cropX = Math.max(0, Math.floor((src.width - W) / 2));
const cropY = Math.max(0, Math.floor((src.height - H) / 2));
const out = new PNG({ width: W, height: H });

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    const sIdx = ((cropY + y) * src.width + (cropX + x)) * 4;
    const dIdx = (y * W + x) * 4;
    let r = src.data[sIdx];
    let g = src.data[sIdx + 1];
    let b = src.data[sIdx + 2];
    const dx = x - CX;
    const dy = y - CY;
    if (dx * dx + dy * dy <= RADIUS * RADIUS) {
      const a = DISK.a;
      r = Math.round(r * (1 - a) + DISK.r * a);
      g = Math.round(g * (1 - a) + DISK.g * a);
      b = Math.round(b * (1 - a) + DISK.b * a);
    }
    out.data[dIdx] = r;
    out.data[dIdx + 1] = g;
    out.data[dIdx + 2] = b;
    out.data[dIdx + 3] = 255;
  }
}

fs.writeFileSync(outPath, PNG.sync.write(out));
