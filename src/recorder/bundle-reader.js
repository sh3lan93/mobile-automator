'use strict';

// Reader for recorder artifact bundles persisted under
//   <projectRoot>/mobile-automator/.recorder/<scenario_id>/
//
// Slice 8 decouples recording from synthesis: the recorder now PERSISTS the
// bundle on a successful Save (instead of deleting it), and a separate offline
// step (`mauto record-bundle <id>`) reads the structured bundle so an agent can
// synthesize a scenario JSON. After synthesis the caller `consume`s the bundle
// to delete it. The bundle shape is platform-agnostic — it carries whatever the
// recorder wrote; no OS-specific assumptions live here.

const fs = require('fs');
const path = require('path');

const SCREENSHOT_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp']);

function bundleRoot(projectRoot, scenarioId) {
  return path.join(projectRoot, 'mobile-automator', '.recorder', scenarioId);
}

// Parse a JSON-lines file into an array of objects. Missing file → []. Blank
// lines are skipped. A malformed line throws (corrupt bundle is a hard error).
function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const raw = fs.readFileSync(filePath, 'utf8');
  return raw
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
    .map((l) => JSON.parse(l));
}

function readJsonFile(filePath, fallback) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

// List hierarchy snapshots as {t, path}. Filenames are zero-padded timestamps
// (e.g. 0001000.json → t=1000). Sorted ascending by t so the consumer can scan
// chronologically.
function readHierarchy(root) {
  const dir = path.join(root, 'hierarchy');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => ({ t: Number.parseInt(path.basename(f, '.json'), 10), path: path.join(dir, f) }))
    .filter((e) => Number.isFinite(e.t))
    .sort((a, b) => a.t - b.t);
}

function readScreenshots(root) {
  const dir = path.join(root, 'screenshots');
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => SCREENSHOT_EXTS.has(path.extname(f).toLowerCase()))
    .sort()
    .map((f) => path.join(dir, f));
}

/**
 * Read a persisted recorder bundle into a structured object.
 *
 * @returns {{
 *   scenario_id: string,
 *   root: string,
 *   metadata: object,
 *   events: object[],
 *   hierarchy: {t:number, path:string}[],
 *   assertions: object[],
 *   edits: object[],
 *   screenshots: string[]
 * }}
 * @throws if the bundle directory does not exist.
 */
function readBundle(projectRoot, scenarioId) {
  const root = bundleRoot(projectRoot, scenarioId);
  if (!fs.existsSync(root)) {
    throw new Error(`no recording bundle for ${scenarioId}`);
  }

  return {
    scenario_id: scenarioId,
    root,
    metadata: readJsonFile(path.join(root, 'metadata.json'), {}),
    events: readJsonl(path.join(root, 'events.jsonl')),
    hierarchy: readHierarchy(root),
    assertions: readJsonFile(path.join(root, 'assertions.json'), []),
    edits: readJsonl(path.join(root, 'edits.jsonl')),
    screenshots: readScreenshots(root),
  };
}

// Delete the bundle (post-synthesis cleanup). Idempotent — no-op when absent.
function consume(projectRoot, scenarioId) {
  const root = bundleRoot(projectRoot, scenarioId);
  if (fs.existsSync(root)) fs.rmSync(root, { recursive: true, force: true });
}

module.exports = { readBundle, consume, bundleRoot };
