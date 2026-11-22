'use strict';

// The shared fixture of the safe-fs suites (tests/unit/workspace/safe-fs*.test.js).
//
// Each fixture has a project root holding `.mobile-automator/` and a sibling
// `outside/` holding a canary file. A refusal must leave `outside/` exactly as
// it was and never put the canary or the outside path in an envelope. Real tmp
// trees, because the guarantees are about how the kernel resolves (or refuses
// to resolve) links; only "another owner" is simulated (an injected getuid or
// a wrapped fs), because jest cannot chown.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { UnsafePathError } = require('../../src/workspace/safe-fs');

const CANARY = 'SECRET-CANARY';
const REAL_UID = process.getuid();
// A uid that is never ours, whatever uid the tests run as (a CI runner is
// often 1001, so no fixed number is safe to compare with the real uid).
const FOREIGN_UID = REAL_UID + 1;
// Root bypasses permission bits and its umask is often 0, so a mode-dependent
// assertion proves nothing there.
const itNotRoot = REAL_UID === 0 ? it.skip : it;

// A fresh fixture; the caller removes `base` afterwards.
function makeFixture() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-safefs-'));
  const root = path.join(base, 'project');
  const ws = path.join(root, '.mobile-automator');
  const outside = path.join(base, 'outside');
  fs.mkdirSync(ws, { recursive: true });
  fs.mkdirSync(outside);
  const canaryFile = path.join(outside, 'secret.txt');
  fs.writeFileSync(canaryFile, CANARY);
  return { base, root, ws, outside, canaryFile };
}

// A snapshot of every name and byte under dir, to prove a refusal wrote,
// created and truncated nothing there.
function snapshot(dir) {
  const out = {};
  for (const name of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    const st = fs.lstatSync(p);
    out[name] = st.isDirectory() ? snapshot(p) : fs.readFileSync(p, 'utf8');
  }
  return out;
}

function expectUnsafe(fn, reason) {
  let caught;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(UnsafePathError);
  expect(caught.code).toBe('EUNSAFEPATH');
  expect(caught.reason).toBe(reason);
  return caught;
}

// An fs whose stat calls report another owner. `which` picks lstat (the dir
// walk), fstat (the leaf) or both.
function foreignFs(which = ['lstatSync', 'fstatSync'], uid = FOREIGN_UID) {
  const wrapped = { ...fs };
  for (const name of which) {
    wrapped[name] = (...args) => {
      const st = fs[name](...args);
      st.uid = uid;
      return st;
    };
  }
  return wrapped;
}

module.exports = { CANARY, REAL_UID, FOREIGN_UID, itNotRoot, makeFixture, snapshot, expectUnsafe, foreignFs };
