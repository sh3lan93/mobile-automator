'use strict';

// Points vs pixels for reference screenshots (#281). Element bounds and
// `getScreenSize()` are in the device's coordinate space — pixels on Android,
// points on iOS — while a screenshot PNG is always pixels (an iOS @3x screen is
// 390 points but 1170 pixels wide). A mask given in element/screen
// coordinates has to be scaled before it can cover the right pixels; nothing
// is ever resampled.

const { readPng } = require('./screenshots');

// The PNG pixels per device coordinate unit: ~1 on Android, 2 or 3 on iOS.
function scaleFactor(pngWidth, screenSize) {
  const screenWidth = screenSize && Number(screenSize.width);
  const factor = Number(pngWidth) / screenWidth;
  if (!Number.isFinite(factor) || factor <= 0 || !(Number(pngWidth) > 0) || !(screenWidth > 0)) {
    throw new Error(
      `cannot derive a scale factor from a ${pngWidth}px-wide screenshot and a screen ` +
      `${screenSize ? `${screenSize.width}` : 'of unknown'} wide`
    );
  }
  return factor;
}

// A rect in device coordinates -> the pixel rect it covers, rounded.
function pointsToPixels({ x, y, width, height }, factor) {
  return {
    x: Math.round(x * factor),
    y: Math.round(y * factor),
    width: Math.round(width * factor),
    height: Math.round(height * factor),
  };
}

// An element's `bounds` (src/device/element-model.js: [x1, y1, x2, y2]) -> a
// rect in the same coordinates.
function boundsToRect(bounds) {
  if (!Array.isArray(bounds) || bounds.length !== 4 || !bounds.every((v) => Number.isFinite(v))) {
    throw new Error(`element bounds must be [x1, y1, x2, y2] numbers (got ${JSON.stringify(bounds)})`);
  }
  const [x1, y1, x2, y2] = bounds;
  return { x: x1, y: y1, width: x2 - x1, height: y2 - y1 };
}

// A PNG file's pixel size, read under `projectRoot` (./screenshots.js readPng).
function pngSize(projectRoot, file) {
  const png = readPng(projectRoot, file);
  return { width: png.width, height: png.height };
}

module.exports = { scaleFactor, pointsToPixels, boundsToRect, pngSize };
