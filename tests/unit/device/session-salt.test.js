'use strict';

// #236: the daemon's argv marker is HMAC(salt, root), so a user reading `ps`
// cannot confirm a guessed project path by hashing it. The salt is per
// workspace, created once, never rotated, readable only by its owner, and two
// verbs spawning at once must agree on it.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const { ensureSalt, readSalt } = require('../../../src/device/session-salt');
const paths = require('../../../src/device/session-paths');

const SALT_RE = /^[0-9a-f]{64}$/;

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-salt-'));
}

describe('session-salt (#236)', () => {
  test('ensureSalt creates the session dir and a 0600, 32-byte hex salt', () => {
    const root = tmpRoot();
    const salt = ensureSalt(root);
    expect(salt).toMatch(SALT_RE);
    expect(fs.readFileSync(paths.saltPath(root), 'utf8').trim()).toBe(salt);
    expect(fs.statSync(paths.saltPath(root)).mode & 0o777).toBe(0o600);
  });

  test('ensureSalt is stable across calls: created once, never rotated', () => {
    const root = tmpRoot();
    const first = ensureSalt(root);
    expect(ensureSalt(root)).toBe(first);
    expect(readSalt(root)).toBe(first);
  });

  test('two workspaces get different salts', () => {
    expect(ensureSalt(tmpRoot())).not.toBe(ensureSalt(tmpRoot()));
  });

  test('ensureSalt leaves no temp files behind', () => {
    const root = tmpRoot();
    ensureSalt(root);
    expect(fs.readdirSync(paths.sessionDir(root))).toEqual([paths.SALT_NAME]);
  });

  test('readSalt is null when the salt is missing', () => {
    expect(readSalt(tmpRoot())).toBeNull();
  });

  test('any non-empty content is the salt: there is no "malformed" salt to repair', () => {
    const root = tmpRoot();
    fs.mkdirSync(paths.sessionDir(root), { recursive: true });
    fs.writeFileSync(paths.saltPath(root), 'xyz\n');
    expect(readSalt(root)).toBe('xyz');
    expect(ensureSalt(root)).toBe('xyz');
  });

  test('an empty salt file reads as null and is never silently replaced', () => {
    const root = tmpRoot();
    fs.mkdirSync(paths.sessionDir(root), { recursive: true });
    fs.writeFileSync(paths.saltPath(root), '  \n');
    expect(readSalt(root)).toBeNull();
    expect(() => ensureSalt(root)).toThrow(/is empty; delete it/);
    expect(fs.readFileSync(paths.saltPath(root), 'utf8')).toBe('  \n');
    expect(fs.readdirSync(paths.sessionDir(root))).toEqual([paths.SALT_NAME]);
  });

  test('losing the link race (EEXIST) returns the winner\'s salt and cleans up', () => {
    const root = tmpRoot();
    const winner = 'c'.repeat(64);
    // Another process links its salt in between our temp write and our link.
    const racingFs = {
      ...fs,
      linkSync(src, dst) {
        fs.writeFileSync(dst, `${winner}\n`, { mode: 0o600 });
        return fs.linkSync(src, dst);
      },
    };
    expect(ensureSalt(root, { fs: racingFs })).toBe(winner);
    expect(readSalt(root)).toBe(winner);
    expect(fs.readdirSync(paths.sessionDir(root))).toEqual([paths.SALT_NAME]);
  });

  test('concurrent ensureSalt calls in separate processes all return the same salt', async () => {
    const root = tmpRoot();
    const mod = path.join(__dirname, '..', '..', '..', 'src', 'device', 'session-salt.js');
    const script = `process.stdout.write(require(${JSON.stringify(mod)}).ensureSalt(${JSON.stringify(root)}))`;
    const run = () =>
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'inherit'] });
        let out = '';
        child.stdout.on('data', (d) => (out += d));
        child.on('error', reject);
        child.on('exit', (code) => (code === 0 ? resolve(out) : reject(new Error(`exit ${code}`))));
      });
    const salts = await Promise.all(Array.from({ length: 8 }, run));
    expect(new Set(salts).size).toBe(1);
    expect(salts[0]).toMatch(SALT_RE);
    expect(readSalt(root)).toBe(salts[0]);
    expect(fs.readdirSync(paths.sessionDir(root))).toEqual([paths.SALT_NAME]);
    // Eight node processes boot under the full suite's parallel load.
  }, 20000);
});
