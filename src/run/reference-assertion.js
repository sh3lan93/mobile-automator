'use strict';

// The one decision behind a `screenshot_match` verdict (#281), shared by
// `mauto run` (src/run/assertions.js) and `mauto assert` (src/cli.js) the way
// src/assertion/fields.js is their one field mapping: both paths capture,
// mask and compare the same way, so the same screen cannot verdict
// differently by path.
//
//   capture a stable frame -> (update: record it as the baseline)
//   -> (no baseline: needs_agent) -> resolve masks -> compare -> verdict
//
// A missing baseline is not a failure: it is left to an agent (or to a re-run
// with --update-references), as any undecided assertion is.

const fs = require('fs');
const path = require('path');

const { compareScreenshots, DEFAULT_TOLERANCE } = require('./reference-screenshot');
const { captureStable, writeReference } = require('./screenshots');
const { scaleFactor, pointsToPixels, boundsToRect, pngSize } = require('./scale');

const RECT_KEYS = ['x', 'y', 'width', 'height'];

// A scenario's `tolerance` (or the --tolerance flag, already a number): the
// default when absent, else a number in [0, 1].
function toleranceOf(value) {
  if (value === undefined || value === null) return DEFAULT_TOLERANCE;
  const n = typeof value === 'number' ? value : (String(value).trim() === '' ? NaN : Number(value));
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    throw new Error(`tolerance must be a number from 0 to 1 (got ${JSON.stringify(value)})`);
  }
  return n;
}

// One mask, checked: `{ element_description }` or `{ x, y, width, height }`
// (numbers >= 0, in element/screen coordinates).
function maskOf(mask, i) {
  if (mask && typeof mask === 'object' && typeof mask.element_description === 'string' && mask.element_description.trim() !== '') {
    return { element_description: mask.element_description };
  }
  if (mask && typeof mask === 'object' && RECT_KEYS.every((k) => typeof mask[k] === 'number' && Number.isFinite(mask[k]) && mask[k] >= 0)) {
    return { x: mask.x, y: mask.y, width: mask.width, height: mask.height };
  }
  throw new Error(`mask ${i + 1} must be { element_description } or { x, y, width, height } numbers >= 0 (got ${JSON.stringify(mask)})`);
}

function masksOf(masks) {
  if (masks === undefined || masks === null) return [];
  if (!Array.isArray(masks)) throw new Error('masks must be an array');
  return masks.map(maskOf);
}

// `mauto assert --mask <spec>`: four comma-separated numbers are a rect
// `x,y,width,height`; anything else is an element description.
function parseMaskSpec(spec) {
  const raw = String(spec);
  const parts = raw.split(',').map((p) => p.trim());
  if (parts.length === 4 && parts.every((p) => p !== '' && Number.isFinite(Number(p)))) {
    const [x, y, width, height] = parts.map(Number);
    return maskOf({ x, y, width, height }, 0);
  }
  return maskOf({ element_description: raw }, 0);
}

const fmt = (n) => n.toFixed(3);

// The pixel rects the masks cover on `actualPath`, or `{ missing }` naming the
// first element description nothing on screen matches. The screen size is
// asked for only when there is a mask to scale.
async function pixelMasks(masks, { bridge, actualPath, findFirst }) {
  if (masks.length === 0) return { rects: [] };
  const factor = scaleFactor(pngSize(actualPath).width, await bridge.getScreenSize());
  let elements = null;
  const rects = [];
  for (const mask of masks) {
    let rect = mask;
    if (mask.element_description !== undefined) {
      if (!elements) elements = await bridge.listElements();
      const found = findFirst(elements, mask.element_description);
      if (!found) return { missing: mask.element_description };
      rect = boundsToRect(found.bounds);
    }
    rects.push(pointsToPixels(rect, factor));
  }
  return { rects };
}

// Decide one screenshot_match. Every path is absolute; the verdict records
// them relative to `projectRoot`. Returns:
//   { status: 'passed' | 'failed' | 'needs_agent', message, mechanical, judge,
//     reference_screenshot, actual_screenshot, similarity_score,
//     diff_screenshot, stable }
// Throws only on a device or file error (and on a bad tolerance or mask).
async function decideReferenceScreenshot({
  bridge, clock, projectRoot, referencePath, actualPath, diffPath = null,
  tolerance, masks, updateReferences = false, timeoutMs, pollMs, findFirst,
}) {
  const tol = toleranceOf(tolerance);
  const checkedMasks = masksOf(masks);
  const rel = (p) => (p ? path.relative(projectRoot, p) : null);
  const capture = await captureStable({ bridge, dest: actualPath, clock, timeoutMs, pollMs });
  const unsettled = capture.stable ? '' : ` (the screen did not settle within ${timeoutMs}ms; the last of ${capture.frames} frames was used)`;
  const base = {
    reference_screenshot: rel(referencePath),
    actual_screenshot: rel(actualPath),
    diff_screenshot: null,
    stable: capture.stable,
  };
  const decided = (status, message, similarity) => ({
    ...base, status, message, mechanical: true, judge: { by: 'reference_screenshot' }, similarity_score: similarity,
  });

  if (updateReferences) {
    writeReference(actualPath, referencePath);
    return decided('passed', `reference updated (--update-references): ${base.reference_screenshot}${unsettled}`, 1);
  }
  if (!fs.existsSync(referencePath)) {
    return {
      ...base,
      status: 'needs_agent',
      message: `no reference screenshot at ${base.reference_screenshot}; re-run with --update-references to record it from this screen`,
      mechanical: false,
      judge: { by: 'none' },
      similarity_score: null,
    };
  }

  const { rects, missing } = await pixelMasks(checkedMasks, { bridge, actualPath, findFirst });
  if (missing !== undefined) {
    return decided('failed', `mask element "${missing}" was not found on screen, so the comparison cannot ignore it`, null);
  }

  const r = compareScreenshots({ referencePath, actualPath, tolerance: tol, masks: rects, diffPath });
  if (r.dimensionsMismatch) {
    const { reference: a, actual: b } = r.dimensionsMismatch;
    return decided(
      'failed',
      `screenshot size does not match reference ${base.reference_screenshot}: reference is ${a.width}x${a.height}, ` +
      `actual is ${b.width}x${b.height}; never resampled (record a reference for this device with --update-references)`,
      null
    );
  }
  const verdict = { ...decided(r.pass ? 'passed' : 'failed', '', r.similarity), diff_screenshot: rel(r.diffPath) };
  verdict.message = r.pass
    ? `screenshot matches reference ${base.reference_screenshot}: similarity ${fmt(r.similarity)} >= tolerance ${fmt(tol)}${unsettled}`
    : `screenshot differs from reference ${base.reference_screenshot}: similarity ${fmt(r.similarity)} < tolerance ${fmt(tol)} ` +
      `(${r.diffPixels} of ${r.comparedPixels} pixels differ)` +
      `${verdict.diff_screenshot ? `; diff image: ${verdict.diff_screenshot}` : ''}${unsettled}`;
  return verdict;
}

module.exports = { decideReferenceScreenshot, toleranceOf, masksOf, parseMaskSpec };
