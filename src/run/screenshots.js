'use strict';

// Where reference-screenshot artifacts live and how they are captured (#281).
// This module owns every path the comparison reads or writes, and ensureParent
// is the one place that creates their directories.
//
//   <workspace>/screenshots/reference/<scenario_id>/<assertion_id>.png   the baseline
//   <workspace>/screenshots/<scenario_id>/<run_id>/assert_<id>.png        `mauto run`'s actual
//   <workspace>/screenshots/<scenario_id>/<run_id>/assert_<id>.diff.png   ... and its diff
//   <workspace>/screenshots/assert/<assert_YYYYMMDD_HHMMSS_hex>/actual.png `mauto assert`'s actual
//   <workspace>/screenshots/assert/<assert_YYYYMMDD_HHMMSS_hex>/diff.png   ... and its diff
//
// A scenario may name its own baseline (`reference_screenshot`), relative to
// the workspace; whatever it names must stay inside the project root. The diff
// always lands beside its actual, so creating the actual's directory (the
// capture does) is enough for it.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { PNG } = require('pngjs');

const { workspaceDir } = require('../workspace/layout');

// One path segment: no separator, not `.`/`..`, not empty.
function segment(kind, value) {
  const s = String(value === undefined || value === null ? '' : value);
  if (s === '' || s === '.' || s === '..' || /[/\\]/.test(s) || s.includes('\0')) {
    throw new Error(`${kind} "${s}" must be a single path segment to name a reference screenshot`);
  }
  return s;
}

function referencePathFor(projectRoot, scenarioId, assertionId) {
  return path.join(
    workspaceDir(projectRoot), 'screenshots', 'reference',
    segment('scenario_id', scenarioId), `${segment('assertion_id', assertionId)}.png`
  );
}

// `file` resolved, refused unless it is inside the project root.
function insideProject(projectRoot, file) {
  const root = path.resolve(projectRoot);
  const rel = path.relative(root, file);
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`reference screenshot ${file} is outside the project root ${root}`);
  }
  return file;
}

// The baseline an assertion compares against: its `reference_screenshot`
// (relative to the workspace dir, or absolute inside the project root), else
// the default path for (scenarioId, assertion.id).
function resolveReference(projectRoot, assertion, scenarioId) {
  const explicit = assertion && assertion.reference_screenshot;
  if (typeof explicit === 'string' && explicit.trim() !== '') {
    const file = path.isAbsolute(explicit) ? path.resolve(explicit) : path.resolve(workspaceDir(projectRoot), explicit);
    return insideProject(projectRoot, file);
  }
  return referencePathFor(projectRoot, scenarioId, assertion && assertion.id);
}

// The artifacts of one `mauto run` screenshot_match: the baseline its
// evaluator `input` names (or the default for scenarioId/assertionId), and the
// actual and diff beside the run's other evidence. Absolute paths.
function runArtifacts({ projectRoot, scenarioId, runId, assertionId, input }) {
  const dir = path.join(workspaceDir(projectRoot), 'screenshots', scenarioId, runId);
  return {
    reference: resolveReference(projectRoot, { id: assertionId, reference_screenshot: input.reference_screenshot }, scenarioId),
    actual: path.join(dir, `assert_${assertionId}.png`),
    diff: path.join(dir, `assert_${assertionId}.diff.png`),
  };
}

// A fresh `assert_<YYYYMMDD_HHMMSS>_<hex>` directory name for one `mauto
// assert` screenshot_match's artifacts.
function assertArtifactId(now) {
  const stamp = now.toISOString().replace(/[-:T]/g, '').replace(/\..*$/, '');
  return `assert_${stamp.slice(0, 8)}_${stamp.slice(8, 14)}_${crypto.randomBytes(3).toString('hex')}`;
}

// The artifacts of one `mauto assert` screenshot_match: the baseline its
// `input` names (required: assert has no scenario to default it from), and a
// fresh directory, stamped with `now` (a Date), for the actual and diff.
function assertArtifacts({ projectRoot, input, now }) {
  const explicit = input.reference_screenshot;
  if (typeof explicit !== 'string' || explicit.trim() === '') {
    throw new Error('a reference screenshot path is required');
  }
  const dir = path.join(workspaceDir(projectRoot), 'screenshots', 'assert', assertArtifactId(now));
  return {
    reference: resolveReference(projectRoot, { reference_screenshot: explicit }),
    actual: path.join(dir, 'actual.png'),
    diff: path.join(dir, 'diff.png'),
  };
}

// Create `file`'s directory (and its parents) if it does not exist yet.
function ensureParent(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return file;
}

function decodeFrame(file) {
  try {
    return PNG.sync.read(fs.readFileSync(file));
  } catch (err) {
    throw new Error(`screenshot ${file} is not a readable PNG (${err.message})`);
  }
}

const sameFrame = (a, b) => a.width === b.width && a.height === b.height && a.data.equals(b.data);

const removeQuietly = (file) => fs.rmSync(file, { force: true });

// Capture the screen until two consecutive frames decode to identical pixels,
// or until `timeoutMs` has elapsed since the first capture. The last frame is
// left at `dest`; the temporary frames (siblings of `dest`) are removed either
// way. Returns { path: dest, stable, frames }.
async function captureStable({ bridge, dest, clock, timeoutMs, pollMs }) {
  ensureParent(dest);
  const temps = [0, 1].map((i) => path.join(path.dirname(dest), `.${path.basename(dest)}.frame${i}.tmp.png`));
  const capture = async (file) => {
    removeQuietly(file);
    await bridge.screenshot(file);
    return decodeFrame(file);
  };

  try {
    const start = clock.now();
    let current = 0;
    let previous = await capture(temps[current]);
    let frames = 1;
    let stable = false;
    while (clock.now() - start < timeoutMs) {
      await clock.sleep(pollMs);
      const next = 1 - current;
      const frame = await capture(temps[next]);
      frames++;
      current = next;
      if (sameFrame(previous, frame)) {
        stable = true;
        break;
      }
      previous = frame;
    }
    fs.renameSync(temps[current], dest);
    return { path: dest, stable, frames };
  } finally {
    temps.forEach(removeQuietly);
  }
}

// Record `actualPath` as the baseline at `referencePath`.
function writeReference(actualPath, referencePath) {
  ensureParent(referencePath);
  fs.copyFileSync(actualPath, referencePath);
  return referencePath;
}

module.exports = {
  referencePathFor, resolveReference, runArtifacts, assertArtifacts, assertArtifactId, ensureParent, captureStable, writeReference,
};
