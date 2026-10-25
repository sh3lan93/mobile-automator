'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { readHandle, readSessionId } = require('../../../src/device/session-handle');
const paths = require('../../../src/device/session-paths');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-handle-'));
}

function writeHandle(root, handle) {
  fs.mkdirSync(paths.sessionDir(root), { recursive: true });
  fs.writeFileSync(paths.handlePath(root), JSON.stringify(handle, null, 2) + '\n');
}

describe('readHandle', () => {
  it('reads the handle a running daemon wrote', () => {
    const root = tmpRoot();
    writeHandle(root, { pid: 42, session_id: 'abcdef0123456789', device: 'emulator-5554' });
    expect(readHandle(root)).toMatchObject({ pid: 42, device: 'emulator-5554' });
  });

  it('returns null when there is no handle', () => {
    expect(readHandle(tmpRoot())).toBeNull();
  });

  it('returns null on a truncated handle rather than throwing', () => {
    const root = tmpRoot();
    fs.mkdirSync(paths.sessionDir(root), { recursive: true });
    fs.writeFileSync(paths.handlePath(root), '{"pid": 42, "session');
    expect(readHandle(root)).toBeNull();
  });
});

describe('readSessionId', () => {
  it('extracts the id', () => {
    const root = tmpRoot();
    writeHandle(root, { pid: 42, session_id: 'abcdef0123456789' });
    expect(readSessionId(root)).toBe('abcdef0123456789');
  });

  it('returns null for a pre-0.25 handle that predates the field', () => {
    const root = tmpRoot();
    writeHandle(root, { pid: 42, device: null, socket: '/tmp/x.sock' });
    expect(readSessionId(root)).toBeNull();
  });

  it('returns null rather than a non-string when the handle is corrupt', () => {
    const root = tmpRoot();
    writeHandle(root, { session_id: 12345 });
    expect(readSessionId(root)).toBeNull();
  });

  // session_id is sends:true on the grounds that it is random hex. A handle is
  // a plain file, so a stale, hand-edited or corrupt one must not be able to
  // put anything else on the wire.
  it.each([
    ['a path and app id', '/Users/alice/acme-checkout-v2 com.acme.unreleased'],
    ['uppercase hex', 'ABCDEF0123456789'],
    ['15 chars', 'abcdef012345678'],
    ['17 chars', 'abcdef01234567890'],
    ['empty string', ''],
    ['a number', 12345],
    ['an object', {}],
    ['an array', []],
    ['null', null],
  ])('returns null for a session_id that is %s', (_label, value) => {
    const root = tmpRoot();
    writeHandle(root, { pid: 42, session_id: value });
    expect(readSessionId(root)).toBeNull();
  });
});
