'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

const selection = require('../../../src/device/selection');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-sel-'));
}

describe('device selection store', () => {
  test('read returns null when no selection exists', () => {
    expect(selection.read(tmpRoot())).toBeNull();
  });

  test('write -> read round-trips and lazily creates .session/', () => {
    const root = tmpRoot();
    selection.write(root, 'emulator-5554');
    expect(fs.existsSync(path.join(root, '.mobile-automator', '.session'))).toBe(true);
    expect(selection.read(root)).toBe('emulator-5554');
  });

  test('the selection file lives under .session/ and is separate from config.json', () => {
    const root = tmpRoot();
    selection.write(root, 'A');
    const p = selection.selectionPath(root);
    expect(p).toBe(path.join(root, '.mobile-automator', '.session', 'selection.json'));
    expect(p).not.toContain(path.join('.mobile-automator', 'config.json'));
    expect(fs.existsSync(path.join(root, '.mobile-automator', 'config.json'))).toBe(false);
  });

  test('clear is idempotent (no-op when absent, removes when present)', () => {
    const root = tmpRoot();
    expect(() => selection.clear(root)).not.toThrow();
    selection.write(root, 'A');
    selection.clear(root);
    expect(selection.read(root)).toBeNull();
    expect(() => selection.clear(root)).not.toThrow();
  });

  test('corrupt JSON -> read returns null (graceful)', () => {
    const root = tmpRoot();
    fs.mkdirSync(path.dirname(selection.selectionPath(root)), { recursive: true });
    fs.writeFileSync(selection.selectionPath(root), '{not json');
    expect(selection.read(root)).toBeNull();
  });

  test('write coerces a non-string id to string', () => {
    const root = tmpRoot();
    selection.write(root, 12345);
    expect(selection.read(root)).toBe('12345');
  });
});

describe('resolveDevice (pure precedence)', () => {
  test('explicit flag wins and does NOT write the store', () => {
    const writes = [];
    const store = {
      read: () => 'persisted-id',
      write: (root, id) => writes.push([root, id]),
    };
    const r = selection.resolveDevice({ explicit: 'flag-id', projectRoot: '/x', store });
    expect(r).toEqual({ device: 'flag-id', source: 'flag' });
    expect(writes).toEqual([]);
  });

  test('falls back to the persisted selection when no flag', () => {
    const store = { read: () => 'persisted-id' };
    const r = selection.resolveDevice({ explicit: undefined, projectRoot: '/x', store });
    expect(r).toEqual({ device: 'persisted-id', source: 'session' });
  });

  test('neither flag nor persisted -> none with null device', () => {
    const store = { read: () => null };
    const r = selection.resolveDevice({ explicit: undefined, projectRoot: '/x', store });
    expect(r).toEqual({ device: null, source: 'none' });
  });
});

// #345: a checked-in .session/ can be a symlink out of the workspace. The
// selection store must refuse it rather than read, write or delete through it.
describe('device selection store refuses symlinked workspace paths (#345)', () => {
  const { UnsafePathError } = require('../../../src/workspace/safe-fs');

  function plantedSession() {
    const root = fs.realpathSync(tmpRoot());
    const outside = path.join(root, 'outside');
    fs.mkdirSync(outside);
    fs.writeFileSync(path.join(outside, 'selection.json'), JSON.stringify({ device: 'SECRET-CANARY' }));
    fs.mkdirSync(path.join(root, '.mobile-automator'));
    fs.symlinkSync(outside, path.join(root, '.mobile-automator', '.session'));
    return { root, outside };
  }

  function thrown(fn) {
    try {
      fn();
    } catch (err) {
      return err;
    }
    return null;
  }

  test('read throws UnsafePathError through a symlinked .session/ instead of reading it', () => {
    const { root } = plantedSession();
    const err = thrown(() => selection.read(root));
    expect(err).toBeInstanceOf(UnsafePathError);
    expect(err.reason).toBe('symlink');
  });

  test('read throws UnsafePathError on a symlinked selection.json leaf', () => {
    const root = fs.realpathSync(tmpRoot());
    const outside = path.join(root, 'outside.json');
    fs.writeFileSync(outside, JSON.stringify({ device: 'SECRET-CANARY' }));
    fs.mkdirSync(path.dirname(selection.selectionPath(root)), { recursive: true });
    fs.symlinkSync(outside, selection.selectionPath(root));
    expect(thrown(() => selection.read(root))).toBeInstanceOf(UnsafePathError);
  });

  test('write through a symlinked .session/ throws and leaves the outside file alone', () => {
    const { root, outside } = plantedSession();
    expect(thrown(() => selection.write(root, 'emulator-5554'))).toBeInstanceOf(UnsafePathError);
    expect(fs.readdirSync(outside)).toEqual(['selection.json']);
    expect(fs.readFileSync(path.join(outside, 'selection.json'), 'utf8')).toContain('SECRET-CANARY');
  });

  test('clear through a symlinked .session/ throws and never deletes the outside file', () => {
    const { root, outside } = plantedSession();
    expect(thrown(() => selection.clear(root))).toBeInstanceOf(UnsafePathError);
    expect(fs.existsSync(path.join(outside, 'selection.json'))).toBe(true);
  });

  test('clear on a symlinked selection.json leaf removes the link, never its target', () => {
    const root = fs.realpathSync(tmpRoot());
    const outside = path.join(root, 'outside.json');
    fs.writeFileSync(outside, '{}');
    fs.mkdirSync(path.dirname(selection.selectionPath(root)), { recursive: true });
    fs.symlinkSync(outside, selection.selectionPath(root));
    selection.clear(root);
    expect(fs.existsSync(selection.selectionPath(root))).toBe(false);
    expect(fs.readFileSync(outside, 'utf8')).toBe('{}');
  });

  test('clear with no workspace at all is a no-op', () => {
    expect(() => selection.clear(path.join(tmpRoot(), 'nope'))).not.toThrow();
  });
});
