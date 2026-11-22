'use strict';

// The one bounded append shared by the log sink and the telemetry spool
// (#348). The sink and spool suites keep their end-to-end refusals; this suite
// pins the helper's own contract once.

const fs = require('fs');
const path = require('path');

const append = require('../../../src/observe/append');
const {
  CANARY,
  makeSafeFsFixture,
  removeSafeFsFixture,
  expectUnsafe,
  foreignFs,
} = require('../../helpers/safe-fs-fixture');

let fx;
beforeEach(() => {
  fx = makeSafeFsFixture();
});
afterEach(() => removeSafeFsFixture(fx.base));

const logsDir = () => path.join(fx.ws, '.logs');
const settled = (name = 'x.ndjson', deps = {}) => append.settledLeaf(fx.root, logsDir(), name, { create: true }, deps);

describe('allowed: the no-workspace gate', () => {
  it('allows a set-up workspace and refuses a directory without one', () => {
    expect(append.allowed(fx.root, {})).toBe(true);
    expect(append.allowed(fx.outside, {})).toBe(false);
  });

  it('allows MAUTO_LOG_DIR without a workspace', () => {
    expect(append.allowed(fx.outside, { MAUTO_LOG_DIR: fx.outside })).toBe(true);
  });
});

describe('settledLeaf', () => {
  it('creates the directory when asked and names the basename inside it', () => {
    const target = settled(path.join('/somewhere/else', 'x.ndjson'));
    expect(target.path).toBe(path.join(logsDir(), 'x.ndjson'));
    expect(fs.lstatSync(logsDir()).isDirectory()).toBe(true);
  });

  it('refuses a directory in the workspace that is a link', () => {
    fs.symlinkSync(fx.outside, logsDir());
    expectUnsafe(() => settled(), 'symlink');
  });
});

describe('appendLine', () => {
  it('appends one line per call', () => {
    const target = settled();
    expect(append.appendLine(target, 'a\n')).toBe(true);
    expect(append.appendLine(target, 'b\n')).toBe(true);
    expect(fs.readFileSync(target.path, 'utf8')).toBe('a\nb\n');
  });

  it('drops the new line once the file has reached capBytes, and keeps the old bytes', () => {
    const target = settled();
    fs.writeFileSync(target.path, 'x'.repeat(10));
    expect(append.appendLine(target, 'new\n', { capBytes: 10 })).toBe(false);
    expect(fs.readFileSync(target.path, 'utf8')).toBe('x'.repeat(10));
    expect(append.appendLine(target, 'new\n', { capBytes: 11 })).toBe(true);
  });

  it('measures the cap on the fd it opened, not by a stat of the path', () => {
    const target = settled();
    fs.writeFileSync(target.path, 'x'.repeat(10));
    const statSaysEmpty = { ...fs, statSync: () => ({ size: 0 }) };
    expect(append.appendLine(target, 'new\n', { capBytes: 10, fs: statSaysEmpty })).toBe(false);
    expect(fs.statSync(target.path).size).toBe(10);
  });

  it('never writes through a symlinked leaf', () => {
    const target = settled();
    fs.symlinkSync(fx.canaryFile, target.path);
    expectUnsafe(() => append.appendLine(target, 'x\n'), 'symlink');
    expect(fs.readFileSync(fx.canaryFile, 'utf8')).toBe(CANARY);
  });

  it('never writes to a leaf hard-linked to a file elsewhere', () => {
    const target = settled();
    fs.linkSync(fx.canaryFile, target.path);
    expectUnsafe(() => append.appendLine(target, 'x\n'), 'hardlink');
    expect(fs.readFileSync(fx.canaryFile, 'utf8')).toBe(CANARY);
  });

  it('never writes to a leaf owned by another uid', () => {
    const foreign = foreignFs(['fstatSync']);
    const target = settled('x.ndjson', { fs: foreign });
    fs.writeFileSync(target.path, 'old\n');
    expectUnsafe(() => append.appendLine(target, 'x\n', { fs: foreign }), 'foreign_owner');
    expect(fs.readFileSync(target.path, 'utf8')).toBe('old\n');
  });

  it('closes the fd when the write fails', () => {
    const opened = [];
    const closed = [];
    const failing = {
      ...fs,
      openSync: (...args) => {
        const fd = fs.openSync(...args);
        opened.push(fd);
        return fd;
      },
      closeSync: (fd) => {
        closed.push(fd);
        fs.closeSync(fd);
      },
      writeSync: () => {
        throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
      },
    };
    const target = settled('x.ndjson', { fs: failing });
    expect(() => append.appendLine(target, 'x\n', { fs: failing })).toThrow('ENOSPC');
    expect(opened).toHaveLength(1);
    expect(closed).toEqual(opened);
  });
});

describe('atCap', () => {
  it('uses the same comparison as the append: at or past maxBytes', () => {
    const target = settled();
    expect(append.atCap(target.path, { maxBytes: 10 })).toBe(false); // no file yet
    fs.writeFileSync(target.path, 'x'.repeat(9));
    expect(append.atCap(target.path, { maxBytes: 10 })).toBe(false);
    fs.writeFileSync(target.path, 'x'.repeat(10));
    expect(append.atCap(target.path, { maxBytes: 10 })).toBe(true);
  });
});
