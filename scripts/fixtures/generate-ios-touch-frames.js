#!/usr/bin/env node
'use strict';

// Generates the iOS Simulator "Show Single Touches" synthetic test fixtures.
// Run: node scripts/fixtures/generate-ios-touch-frames.js
//
// Produces three 200x100 PNGs under tests/fixtures/recorder/video-frames/:
//   ios-no-indicator.png   — uniform dark background (no match)
//   ios-dot-at-50-30.png   — gray disk centered at (50, 30)
//   ios-dot-at-100-50.png  — gray disk centered at (100, 50)
//
// The disk colour (RGB 180/180/180) and radius (8 px) are calibrated to fall
// inside the `ios_simulator` colour band defined in
// tools/recorder/src/capture/video-tap-detector.js. Real-frame calibration
// uses the captured fixture `ios-real-touch.png`.

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const WIDTH = 200;
const HEIGHT = 100;
const BG = { r: 15, g: 15, b: 15 };
const DOT = { r: 180, g: 180, b: 180 };
const RADIUS = 8;

function paintFrame({ dotX, dotY }) {
  const png = new PNG({ width: WIDTH, height: HEIGHT });
  for (let y = 0; y < HEIGHT; y++) {
    for (let x = 0; x < WIDTH; x++) {
      const idx = (y * WIDTH + x) * 4;
      const inDot = dotX !== null
        && (x - dotX) * (x - dotX) + (y - dotY) * (y - dotY) <= RADIUS * RADIUS;
      const colour = inDot ? DOT : BG;
      png.data[idx] = colour.r;
      png.data[idx + 1] = colour.g;
      png.data[idx + 2] = colour.b;
      png.data[idx + 3] = 255;
    }
  }
  return PNG.sync.write(png);
}

const outDir = path.resolve(__dirname, '../../tests/fixtures/recorder/video-frames');
fs.mkdirSync(outDir, { recursive: true });

const targets = [
  { name: 'ios-no-indicator.png', dotX: null, dotY: null },
  { name: 'ios-dot-at-50-30.png', dotX: 50, dotY: 30 },
  { name: 'ios-dot-at-100-50.png', dotX: 100, dotY: 50 },
];

for (const t of targets) {
  const buf = paintFrame({ dotX: t.dotX, dotY: t.dotY });
  fs.writeFileSync(path.join(outDir, t.name), buf);
  process.stdout.write(`wrote ${t.name}\n`);
}
