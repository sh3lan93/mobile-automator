'use strict';

// A private XDG_RUNTIME_DIR for one test file (#346).
//
// A project root too deep for an in-workspace socket binds its socket in the
// per-user fallback directory (session-paths.js privateSocketDir). Every
// mkdtemp root under macOS's long os.tmpdir() is that deep, so a suite that
// starts a daemon, or builds the socket path, would otherwise create and
// litter the real <os.tmpdir()>/mauto-<uid>/, and one stray 0755 directory
// there would fail every such suite on the machine `not_private`.
//
// Call once at the top level of a test file. For the file's duration
// XDG_RUNTIME_DIR names a fresh 0700 temp directory (mkdtemp makes it 0700, as
// the XDG spec requires of a runtime dir), so the fallback is
// <that dir>/mauto/. The previous value is restored and the directory removed
// afterwards. process.env is the jest worker's own, and the daemons these
// suites start run in-process or inherit it, so both sides of the socket agree.
// Returns a getter for the directory.

const fs = require('fs');
const os = require('os');
const path = require('path');

function usePrivateRuntimeDir() {
  let dir = null;
  let had = false;
  let prev;

  beforeAll(() => {
    had = Object.prototype.hasOwnProperty.call(process.env, 'XDG_RUNTIME_DIR');
    prev = process.env.XDG_RUNTIME_DIR;
    // Short on purpose: the socket path inside it must fit the ~104-byte
    // sockaddr limit under macOS's long os.tmpdir().
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'xdg-'));
    process.env.XDG_RUNTIME_DIR = dir;
  });

  afterAll(() => {
    if (had) process.env.XDG_RUNTIME_DIR = prev;
    else delete process.env.XDG_RUNTIME_DIR;
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  return () => dir;
}

module.exports = { usePrivateRuntimeDir };
