'use strict';

// #345: atomicWrite into a checked-in workspace must not follow a committed
// symlink out of it. With a projectRoot the directory is walked by safe-fs;
// either way the temp file is created O_EXCL|O_NOFOLLOW under a random name.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { atomicWrite } = require('../../../src/util/atomic');
const { UnsafePathError } = require('../../../src/workspace/safe-fs');

const ORIGINAL = '# Run History\nSECRET-CANARY\n';

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-atomic-')));
  const outside = path.join(root, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'run-history.md'), ORIGINAL);
  const ws = path.join(root, '.mobile-automator');
  fs.mkdirSync(ws);
  return { root, outside, ws };
}

function thrown(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return null;
}

describe('atomicWrite with a projectRoot (#345)', () => {
  test.each([
    ['an absolute', (outside) => outside],
    ['a relative', () => path.join('..', 'outside')],
  ])('refuses memory/ as %s symlink to an outside dir', (_label, target) => {
    const { root, outside, ws } = fixture();
    fs.symlinkSync(target(outside), path.join(ws, 'memory'));
    const file = path.join(ws, 'memory', 'run-history.md');

    const err = thrown(() => atomicWrite(file, 'pwned\n', { projectRoot: root }));

    expect(err).toBeInstanceOf(UnsafePathError);
    expect(err.reason).toBe('symlink');
    expect(fs.readFileSync(path.join(outside, 'run-history.md'), 'utf8')).toBe(ORIGINAL);
    expect(fs.readdirSync(outside)).toEqual(['run-history.md']);
  });

  test('a symlink leaf at the target is replaced by a regular file; its target is unchanged', () => {
    const { root, outside, ws } = fixture();
    fs.mkdirSync(path.join(ws, 'memory'));
    const file = path.join(ws, 'memory', 'run-history.md');
    fs.symlinkSync(path.join(outside, 'run-history.md'), file);

    atomicWrite(file, 'fresh\n', { projectRoot: root });

    expect(fs.lstatSync(file).isFile()).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe('fresh\n');
    expect(fs.readFileSync(path.join(outside, 'run-history.md'), 'utf8')).toBe(ORIGINAL);
  });

  test('creates missing workspace directories and leaves no temp file behind', () => {
    const { root, ws } = fixture();
    const file = path.join(ws, 'results', 'r1.json');
    atomicWrite(file, '{}\n', { projectRoot: root });
    expect(fs.readFileSync(file, 'utf8')).toBe('{}\n');
    expect(fs.readdirSync(path.join(ws, 'results'))).toEqual(['r1.json']);
  });
});

describe('atomicWrite without a projectRoot', () => {
  test('writes, creating parent directories, with no temp file left', () => {
    const { root } = fixture();
    const file = path.join(root, 'out', 'deep', 'report.xml');
    atomicWrite(file, '<x/>');
    expect(fs.readFileSync(file, 'utf8')).toBe('<x/>');
    expect(fs.readdirSync(path.dirname(file))).toEqual(['report.xml']);
  });

  test('overwrites an existing file', () => {
    const { root } = fixture();
    const file = path.join(root, 'report.xml');
    fs.writeFileSync(file, 'old');
    atomicWrite(file, 'new');
    expect(fs.readFileSync(file, 'utf8')).toBe('new');
  });

  test('the temp file name carries a random suffix, so it cannot be pre-planted', () => {
    const { root } = fixture();
    const file = path.join(root, 'report.xml');
    const opened = [];
    const realOpen = fs.openSync;
    const spy = jest.spyOn(fs, 'openSync').mockImplementation((p, ...rest) => {
      opened.push(p);
      return realOpen(p, ...rest);
    });
    try {
      atomicWrite(file, 'a');
      atomicWrite(file, 'b');
    } finally {
      spy.mockRestore();
    }
    expect(opened).toHaveLength(2);
    expect(opened[0]).not.toBe(opened[1]);
    for (const p of opened) expect(path.basename(p)).toMatch(/^\.report\.xml\.tmp\.\d+\.\d+\.[0-9a-f]{12}$/);
  });
});
