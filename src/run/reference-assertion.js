'use strict';

// The one decision behind a `screenshot_match` verdict (#281), shared by
// `mauto run` (src/run/assertions.js) and `mauto assert`
// (src/run/assert-reference.js). Both build its `input` through the one field
// mapping (src/assertion/fields.js: toEvaluatorInput / fromCliFlags) and its
// paths through ./screenshots.js (runArtifacts / assertArtifacts), then
// capture, mask and compare here the same way, so the same screen cannot
// verdict differently by path.
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
const { timeoutFor } = require('./poll');
const { parseUnitInterval } = require('../util/parse-unit-interval');

const RECT_KEYS = ['x', 'y', 'width', 'height'];

// A scenario's `tolerance` (or the --tolerance flag, already a number): the
// default when absent, else a number in [0, 1].
function toleranceOf(value) {
  if (value === undefined || value === null) return DEFAULT_TOLERANCE;
  const n = parseUnitInterval(value);
  if (n === null) throw new Error(`tolerance must be a number from 0 to 1 (got ${JSON.stringify(value)})`);
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

// Decide one screenshot_match.
//   input   the evaluator input ({ type, reference_screenshot?, tolerance? })
//   masks   the assertion's masks (scenario objects, or parsed --mask specs)
//   paths   { reference, actual, diff }, absolute (./screenshots.js)
// The capture's poll budget is the run settings' (timeoutFor / pollMs).
// Returns { verdict, diff }: `verdict` is the record body
//   { status: 'passed' | 'failed' | 'needs_agent', message, mechanical, judge,
//     reference_screenshot, actual_screenshot, similarity_score }
// with paths relative to `projectRoot` (similarity_score null when nothing was
// compared), and `diff` the project-relative diff image, or null when none was
// written. Throws only on a device or file error (and on a bad tolerance or
// mask, before the device is touched).
async function decideReferenceScreenshot({
  bridge, clock, settings, projectRoot, input, masks, paths, updateReferences = false, findFirst,
}) {
  const tol = toleranceOf(input.tolerance);
  const checkedMasks = masksOf(masks);
  const timeoutMs = timeoutFor({}, settings);
  const rel = (p) => (p ? path.relative(projectRoot, p) : null);
  const capture = await captureStable({ bridge, dest: paths.actual, clock, timeoutMs, pollMs: settings.pollMs });
  const unsettled = capture.stable ? '' : ` (the screen did not settle within ${timeoutMs}ms; the last of ${capture.frames} frames was used)`;
  const referenceRel = rel(paths.reference);
  const record = (status, message, { mechanical = true, judge = { by: 'reference_screenshot' }, similarity = null } = {}) => ({
    status,
    message,
    mechanical,
    judge,
    reference_screenshot: referenceRel,
    actual_screenshot: rel(paths.actual),
    similarity_score: similarity,
  });
  const decided = (status, message, similarity = null) => ({ verdict: record(status, message, { similarity }), diff: null });

  if (updateReferences) {
    // A baseline is what every later run is held to: a frame of a screen
    // still moving would make them all fail (or pass) for the wrong reason,
    // so an unsettled screen records nothing.
    if (!capture.stable) {
      return decided(
        'failed',
        `screen did not settle within ${timeoutMs}ms; no reference recorded (${capture.frames} frames captured)`
      );
    }
    writeReference(paths.actual, paths.reference);
    return decided('passed', `reference updated (--update-references): ${referenceRel}`, 1);
  }
  if (!fs.existsSync(paths.reference)) {
    return {
      verdict: record(
        'needs_agent',
        `no reference screenshot at ${referenceRel}; re-run with --update-references to record it from this screen`,
        { mechanical: false, judge: { by: 'none' } }
      ),
      diff: null,
    };
  }

  const { rects, missing } = await pixelMasks(checkedMasks, { bridge, actualPath: paths.actual, findFirst });
  if (missing !== undefined) {
    return decided('failed', `mask element "${missing}" was not found on screen, so the comparison cannot ignore it`);
  }

  const r = compareScreenshots({
    referencePath: paths.reference, actualPath: paths.actual, tolerance: tol, masks: rects, diffPath: paths.diff,
  });
  if (r.dimensionsMismatch) {
    const { reference: a, actual: b } = r.dimensionsMismatch;
    return decided(
      'failed',
      `screenshot size does not match reference ${referenceRel}: reference is ${a.width}x${a.height}, ` +
      `actual is ${b.width}x${b.height}; never resampled (record a reference for this device with --update-references)`
    );
  }
  const diff = rel(r.diffPath);
  const message = r.pass
    ? `screenshot matches reference ${referenceRel}: similarity ${fmt(r.similarity)} >= tolerance ${fmt(tol)}${unsettled}`
    : `screenshot differs from reference ${referenceRel}: similarity ${fmt(r.similarity)} < tolerance ${fmt(tol)} ` +
      `(${r.diffPixels} of ${r.comparedPixels} pixels differ)` +
      `${diff ? `; diff image: ${diff}` : ''}${unsettled}`;
  return { verdict: record(r.pass ? 'passed' : 'failed', message, { similarity: r.similarity }), diff };
}

module.exports = { decideReferenceScreenshot, toleranceOf, masksOf, parseMaskSpec };
