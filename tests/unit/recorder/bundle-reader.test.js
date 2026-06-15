'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const { readBundle, consume } = require('../../../src/recorder/bundle-reader');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const FIXTURE_PLAIN = path.join(REPO_ROOT, 'tests', 'fixtures', 'recorder', 'sample-bundle');
const FIXTURE_ASSERTIONS = path.join(
  REPO_ROOT, 'tests', 'fixtures', 'recorder', 'sample-bundle-with-assertions'
);

// Recursively copy a directory tree (the fixture) into a tmp bundle location.
function copyTree(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name);
    const d = path.join(dest, entry.name);
    if (entry.isDirectory()) copyTree(s, d);
    else fs.copyFileSync(s, d);
  }
}

function seedBundle(fixtureDir, scenarioId) {
  const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-reader-'));
  const bundleRoot = path.join(projectRoot, 'mobile-automator', '.recorder', scenarioId);
  copyTree(fixtureDir, bundleRoot);
  return { projectRoot, bundleRoot };
}

describe('bundle-reader.readBundle', () => {
  let projectRoot;
  let bundleRoot;

  afterEach(() => {
    if (projectRoot && fs.existsSync(projectRoot)) {
      fs.rmSync(projectRoot, { recursive: true, force: true });
    }
  });

  test('parses metadata, events.jsonl, hierarchy, assertions, edits, screenshots', () => {
    ({ projectRoot, bundleRoot } = seedBundle(FIXTURE_PLAIN, 'login_flow'));

    const bundle = readBundle(projectRoot, 'login_flow');

    expect(bundle.scenario_id).toBe('login_flow');
    expect(bundle.metadata).toMatchObject({ scenario_id: 'login_flow', mode: 'platform-aware' });

    // events.jsonl parsed into an array of objects.
    expect(Array.isArray(bundle.events)).toBe(true);
    expect(bundle.events).toHaveLength(3);
    expect(bundle.events[0]).toMatchObject({ seq: 1, kind: 'tap', step_id: 'tap_login' });

    // hierarchy listed as {t, path} entries, sorted by t.
    expect(Array.isArray(bundle.hierarchy)).toBe(true);
    expect(bundle.hierarchy).toHaveLength(2);
    expect(bundle.hierarchy[0].t).toBe(1000);
    expect(bundle.hierarchy[1].t).toBe(2000);
    expect(fs.existsSync(bundle.hierarchy[0].path)).toBe(true);

    // assertions / edits.
    expect(bundle.assertions).toEqual([]);
    expect(bundle.edits).toEqual([]);

    // screenshots: array of paths (none present beyond .gitkeep is filtered).
    expect(Array.isArray(bundle.screenshots)).toBe(true);
  });

  test('parses assertions, edits, and screenshots when present', () => {
    ({ projectRoot, bundleRoot } = seedBundle(FIXTURE_ASSERTIONS, 'login_flow'));

    const bundle = readBundle(projectRoot, 'login_flow');

    expect(bundle.assertions).toHaveLength(2);
    expect(bundle.assertions[0]).toMatchObject({ id: 'a1', anchor_step_id: 'tap_login' });

    // screenshots are real .png files in the fixture.
    const names = bundle.screenshots.map((p) => path.basename(p)).sort();
    expect(names).toEqual(['assert_a1.png', 'assert_a2.png', 'step_1.png']);
    for (const p of bundle.screenshots) expect(fs.existsSync(p)).toBe(true);
  });

  test('throws a clear error when the bundle is missing', () => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-reader-missing-'));
    expect(() => readBundle(projectRoot, 'does_not_exist')).toThrow(/no recording bundle/i);
  });
});

describe('bundle-reader.consume', () => {
  test('deletes the bundle directory', () => {
    const { projectRoot } = seedBundle(FIXTURE_PLAIN, 'login_flow');
    const bundleRoot = path.join(projectRoot, 'mobile-automator', '.recorder', 'login_flow');
    expect(fs.existsSync(bundleRoot)).toBe(true);

    consume(projectRoot, 'login_flow');

    expect(fs.existsSync(bundleRoot)).toBe(false);
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  test('is safe when the bundle does not exist', () => {
    const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-reader-consume-'));
    expect(() => consume(projectRoot, 'nope')).not.toThrow();
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });
});
