'use strict';

// The deterministic comparator behind `screenshot_match` (#281): one PNG
// against its reference, pixel for pixel, with pixelmatch. Pure apart from the
// file reads and the one diff-image write.
//
// - Different sizes are never resampled: the result says so and is a failure
//   (a reference captured on another device profile is the wrong reference).
// - Masks are pixel rects ({x, y, width, height}, already scaled — see
//   ./scale.js) that the comparison ignores: the reference's pixels are copied
//   over the actual's under each one, and masked pixels are not counted.
// - similarity = 1 - diffPixels / comparedPixels (1 when everything is masked).

const fs = require('fs');
const { PNG } = require('pngjs');
const pixelmatch = require('pixelmatch');

const { atomicWorkspaceWrite } = require('../util/atomic');

const DEFAULT_TOLERANCE = 0.9;
// pixelmatch's per-pixel colour threshold (0..1): smaller is more sensitive.
const DEFAULT_THRESHOLD = 0.1;

const read = (file) => PNG.sync.read(fs.readFileSync(file));

// Whether a similarity meets the tolerance. A null similarity (nothing was
// compared) never does.
function pass(similarity, tolerance = DEFAULT_TOLERANCE) {
  return typeof similarity === 'number' && similarity >= tolerance;
}

// Paint every masked pixel of `actual` with `reference`'s and return how many
// distinct pixels were masked. Masks are clamped to the image.
function applyMasks(reference, actual, masks) {
  const { width, height } = reference;
  const masked = new Uint8Array(width * height);
  let count = 0;
  for (const m of masks) {
    const x0 = Math.max(0, Math.floor(m.x));
    const y0 = Math.max(0, Math.floor(m.y));
    const x1 = Math.min(width, Math.floor(m.x + m.width));
    const y1 = Math.min(height, Math.floor(m.y + m.height));
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const p = y * width + x;
        if (masked[p]) continue;
        masked[p] = 1;
        count++;
        reference.data.copy(actual.data, p << 2, p << 2, (p << 2) + 4);
      }
    }
  }
  return count;
}

// `projectRoot` is needed only to write the diff (when `diffPath` is given).
function compareScreenshots({
  projectRoot, referencePath, actualPath, tolerance = DEFAULT_TOLERANCE, masks = [], diffPath = null,
  threshold = DEFAULT_THRESHOLD,
}) {
  const reference = read(referencePath);
  const actual = read(actualPath);
  if (reference.width !== actual.width || reference.height !== actual.height) {
    return {
      similarity: 0,
      diffPixels: null,
      comparedPixels: null,
      dimensionsMismatch: {
        reference: { width: reference.width, height: reference.height },
        actual: { width: actual.width, height: actual.height },
      },
      diffPath: null,
      pass: false,
    };
  }

  const { width, height } = reference;
  const maskedPixels = applyMasks(reference, actual, masks || []);
  const diff = new PNG({ width, height });
  const diffPixels = pixelmatch(reference.data, actual.data, diff.data, width, height, { threshold });
  const comparedPixels = width * height - maskedPixels;
  const similarity = comparedPixels === 0 ? 1 : 1 - diffPixels / comparedPixels;

  // The diff lands beside the actual, in the workspace (./screenshots.js
  // runArtifacts / assertArtifacts). Written atomically through the checked
  // walk (#347): a link on the way is refused, and the rename replaces a link
  // planted at diffPath rather than writing through it.
  let written = null;
  if (diffPixels > 0 && diffPath) {
    atomicWorkspaceWrite(projectRoot, diffPath, PNG.sync.write(diff));
    written = diffPath;
  }
  return {
    similarity, diffPixels, comparedPixels, dimensionsMismatch: null, diffPath: written, pass: pass(similarity, tolerance),
  };
}

module.exports = { compareScreenshots, pass, DEFAULT_TOLERANCE, DEFAULT_THRESHOLD };
