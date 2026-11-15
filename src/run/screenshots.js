'use strict';

// Where reference-screenshot artifacts live and how they are captured (#281).
// This module is the one place that creates directories for them.
//
//   <workspace>/screenshots/reference/<scenario_id>/<assertion_id>.png   the baseline
//
// A scenario may name its own baseline (`reference_screenshot`), relative to
// the workspace; whatever it names must stay inside the project root.

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
  fs.mkdirSync(path.dirname(dest), { recursive: true });
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
  fs.mkdirSync(path.dirname(referencePath), { recursive: true });
  fs.copyFileSync(actualPath, referencePath);
  return referencePath;
}

module.exports = { referencePathFor, resolveReference, captureStable, writeReference };
