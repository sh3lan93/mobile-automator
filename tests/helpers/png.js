'use strict';

// Synthetic PNGs for the reference-screenshot tests (#281), built with the
// same pngjs the comparator decodes with.
//
//   solidPng(w, h, rgba)                  one colour everywhere
//   quadrantPng(w, h, base, { quadrant, rgba })
//                                         `base` everywhere except one quadrant
//                                         ('tl' | 'tr' | 'bl' | 'br') in `rgba`
//   writePng(file, buffer)                write it, creating the parent
//
// Each returns the encoded PNG bytes (a Buffer).

const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

function fill(png, rgba, inside = () => true) {
  for (let y = 0; y < png.height; y++) {
    for (let x = 0; x < png.width; x++) {
      if (!inside(x, y)) continue;
      const i = (png.width * y + x) << 2;
      png.data[i] = rgba[0];
      png.data[i + 1] = rgba[1];
      png.data[i + 2] = rgba[2];
      png.data[i + 3] = rgba.length > 3 ? rgba[3] : 255;
    }
  }
}

function solidPng(width, height, rgba = [255, 255, 255, 255]) {
  const png = new PNG({ width, height });
  fill(png, rgba);
  return PNG.sync.write(png);
}

const QUADRANTS = {
  tl: (x, y, w, h) => x < w / 2 && y < h / 2,
  tr: (x, y, w, h) => x >= w / 2 && y < h / 2,
  bl: (x, y, w, h) => x < w / 2 && y >= h / 2,
  br: (x, y, w, h) => x >= w / 2 && y >= h / 2,
};

function quadrantPng(width, height, base = [255, 255, 255, 255], { quadrant = 'tl', rgba = [0, 0, 0, 255] } = {}) {
  const png = new PNG({ width, height });
  fill(png, base);
  const inQuadrant = QUADRANTS[quadrant];
  if (!inQuadrant) throw new Error(`unknown quadrant "${quadrant}"`);
  fill(png, rgba, (x, y) => inQuadrant(x, y, width, height));
  return PNG.sync.write(png);
}

function writePng(file, buffer) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buffer);
  return file;
}

module.exports = { solidPng, quadrantPng, writePng };
