'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const { archiveExistingScreenshots } = require('../../../tools/recorder/src/archive');

describe('archiveExistingScreenshots', () => {
  let projectRoot;
  beforeEach(() => {
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rec-archive-'));
    fs.mkdirSync(path.join(projectRoot, 'mobile-automator', 'screenshots'), { recursive: true });
  });
  afterEach(() => {
    fs.rmSync(projectRoot, { recursive: true, force: true });
  });

  function seed(scenarioId, files = { 'step_a.png': 'A' }) {
    const dir = path.join(projectRoot, 'mobile-automator', 'screenshots', scenarioId);
    fs.mkdirSync(dir, { recursive: true });
    for (const [name, body] of Object.entries(files)) {
      fs.writeFileSync(path.join(dir, name), body);
    }
    return dir;
  }

  test('returns null when nothing exists to archive', () => {
    const result = archiveExistingScreenshots({
      projectRoot,
      scenarioId: 'nope',
      now: new Date('2026-05-21T20:31:09.123Z'),
    });
    expect(result).toBeNull();
  });

  test('moves existing screenshots dir to .archive/<id>-<ts>/ atomically', () => {
    const src = seed('login_flow', { 'step_open.png': 'X', 'step_tap.png': 'Y' });

    const dest = archiveExistingScreenshots({
      projectRoot,
      scenarioId: 'login_flow',
      now: new Date('2026-05-21T20:31:09.123Z'),
    });

    expect(dest).toBe(
      path.join(projectRoot, 'mobile-automator', 'screenshots', '.archive', 'login_flow-2026-05-21T20-31-09Z'),
    );
    expect(fs.existsSync(src)).toBe(false);
    expect(fs.existsSync(dest)).toBe(true);
    expect(fs.readFileSync(path.join(dest, 'step_open.png'), 'utf8')).toBe('X');
    expect(fs.readFileSync(path.join(dest, 'step_tap.png'), 'utf8')).toBe('Y');
  });

  test('strips milliseconds and uses Z suffix in timestamp', () => {
    seed('s');
    const dest = archiveExistingScreenshots({
      projectRoot,
      scenarioId: 's',
      now: new Date('2026-05-21T20:31:09.999Z'),
    });
    expect(path.basename(dest)).toBe('s-2026-05-21T20-31-09Z');
  });

  test('appends numeric suffix on collision (-2, -3, ...)', () => {
    const now = new Date('2026-05-21T20:31:09.000Z');
    const archiveRoot = path.join(projectRoot, 'mobile-automator', 'screenshots', '.archive');
    fs.mkdirSync(archiveRoot, { recursive: true });
    fs.mkdirSync(path.join(archiveRoot, 's-2026-05-21T20-31-09Z'));
    fs.mkdirSync(path.join(archiveRoot, 's-2026-05-21T20-31-09Z-2'));

    seed('s');
    const dest = archiveExistingScreenshots({ projectRoot, scenarioId: 's', now });

    expect(path.basename(dest)).toBe('s-2026-05-21T20-31-09Z-3');
    expect(fs.existsSync(dest)).toBe(true);
  });

  test('creates the .archive/ parent dir if it does not exist', () => {
    seed('s');
    const archiveRoot = path.join(projectRoot, 'mobile-automator', 'screenshots', '.archive');
    expect(fs.existsSync(archiveRoot)).toBe(false);

    archiveExistingScreenshots({
      projectRoot,
      scenarioId: 's',
      now: new Date('2026-05-21T20:31:09.000Z'),
    });

    expect(fs.existsSync(archiveRoot)).toBe(true);
  });

  test('defaults `now` to current time when omitted', () => {
    seed('s');
    const dest = archiveExistingScreenshots({ projectRoot, scenarioId: 's' });
    expect(dest).toMatch(
      /\/\.archive\/s-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z$/,
    );
  });

  test('does not touch sibling scenarios', () => {
    seed('target', { 'step_x.png': 'T' });
    seed('other', { 'step_y.png': 'O' });

    archiveExistingScreenshots({
      projectRoot,
      scenarioId: 'target',
      now: new Date('2026-05-21T20:31:09.000Z'),
    });

    const otherDir = path.join(projectRoot, 'mobile-automator', 'screenshots', 'other');
    expect(fs.existsSync(otherDir)).toBe(true);
    expect(fs.readFileSync(path.join(otherDir, 'step_y.png'), 'utf8')).toBe('O');
  });
});
