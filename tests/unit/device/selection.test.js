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
    expect(fs.existsSync(path.join(root, 'mobile-automator', '.session'))).toBe(true);
    expect(selection.read(root)).toBe('emulator-5554');
  });

  test('the selection file lives under .session/ and is separate from config.json', () => {
    const root = tmpRoot();
    selection.write(root, 'A');
    const p = selection.selectionPath(root);
    expect(p).toBe(path.join(root, 'mobile-automator', '.session', 'selection.json'));
    expect(p).not.toContain(path.join('mobile-automator', 'config.json'));
    expect(fs.existsSync(path.join(root, 'mobile-automator', 'config.json'))).toBe(false);
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
