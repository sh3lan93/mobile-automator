'use strict';

// A private temp dir for one test file (#346).
//
// A project root too deep for an in-workspace socket binds its socket in the
// per-user fallback directory, <os.tmpdir()>/mauto-<uid>/ (session-paths.js
// privateSocketDir). Every mkdtemp root under macOS's long os.tmpdir() is that
// deep, so a suite that starts a daemon, or builds the socket path, would
// otherwise create and litter the real one, and one stray 0755 directory
// there would fail every such suite on the machine `not_private`.
//
// Call once at the top level of a test file. For the file's duration the temp
// dir is a fresh, short directory of the file's own, so the fallback becomes
// <that dir>/mauto-<uid>/, and the roots the suite makes with os.tmpdir() land
// there too. Two levers, because jest gives each test file its own copy of
// process.env while the core os module reads the real one:
//   - os.tmpdir is replaced (core modules are shared, and session-paths calls
//     os.tmpdir() at call time), which covers this process;
//   - TMPDIR is set in the file's process.env, which src's spawns pass on, so
//     a spawned daemon's os.tmpdir() agrees.
// Both are restored and the directory removed afterwards. Returns a getter
// for the directory.

const fs = require('fs');
const os = require('os');
const path = require('path');

function usePrivateTmpdir() {
  let dir = null;
  let had = false;
  let prev;
  let realTmpdir = null;

  beforeAll(() => {
    had = Object.prototype.hasOwnProperty.call(process.env, 'TMPDIR');
    prev = process.env.TMPDIR;
    // Short on purpose: <dir>/mauto-<uid>/<16 hex>.sock must fit the
    // ~104-byte sockaddr limit under macOS's long os.tmpdir().
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-'));
    process.env.TMPDIR = dir;
    // Replaced by hand, not jest.spyOn: a suite's jest.restoreAllMocks()
    // must not undo it between tests.
    realTmpdir = os.tmpdir;
    os.tmpdir = () => dir;
  });

  afterAll(() => {
    if (realTmpdir) os.tmpdir = realTmpdir;
    if (had) process.env.TMPDIR = prev;
    else delete process.env.TMPDIR;
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  return () => dir;
}

module.exports = { usePrivateTmpdir };
