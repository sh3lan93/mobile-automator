'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { newSessionId, readHandle, readSessionId } = require('../../../src/device/session-handle');
const paths = require('../../../src/device/session-paths');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-handle-'));
}

function writeHandle(root, handle) {
  fs.mkdirSync(paths.sessionDir(root), { recursive: true });
  fs.writeFileSync(paths.handlePath(root), JSON.stringify(handle, null, 2) + '\n');
}

describe('newSessionId', () => {
  // This test IS the enforcement of the event catalog's `sends: true` on
  // session_id. The catalog claims the value carries no user-derived content;
  // that claim is only true if the generator is what these assertions say.
  it('is 16 lowercase hex characters', () => {
    expect(newSessionId()).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is unpredictable — 1000 ids collide zero times', () => {
    const ids = new Set();
    for (let i = 0; i < 1000; i++) ids.add(newSessionId());
    expect(ids.size).toBe(1000);
  });

  it('takes no arguments, so it cannot be derived from a path, device or pid', () => {
    expect(newSessionId.length).toBe(0);
  });
});

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
});
