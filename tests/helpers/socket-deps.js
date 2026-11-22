'use strict';

// Socket-location deps for one test file (#346).
//
// A project root too deep for an in-workspace socket binds its socket in the
// per-user fallback directory, <os.tmpdir()>/mauto-<uid>/ (session-paths.js
// privateSocketDir). Every mkdtemp root under macOS's long os.tmpdir() is that
// deep, so a suite that starts a daemon would otherwise create and litter the
// real one, and one stray 0755 directory there would fail every such suite on
// the machine `not_private`.
//
// Nothing is patched: the session code takes the location as a deps seam
// ({ tmpdir, getuid }), and a suite passes it. Call once at the top level of a
// test file; it returns a getter for `{ tmpdir }` pointing at a fresh temp dir
// of this file's own (removed afterwards). Pass that one value everywhere the
// suite resolves the socket: startDaemon({ socketDeps }), the session-client
// entry points' second argument, ensureSessionDirs, verifySocket and
// paths.socketPath/socketLocation. The same value on both sides is what makes
// the client find the daemon. A spawned daemon has no seam: give its child
// env a TMPDIR instead.

const fs = require('fs');
const os = require('os');
const path = require('path');

function useSocketDeps() {
  let dir = null;

  beforeAll(() => {
    // Short on purpose: <dir>/mauto-<uid>/<16 hex>.sock must fit the
    // ~104-byte sockaddr limit under macOS's long os.tmpdir().
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mt-'));
  });

  afterAll(() => {
    if (dir) fs.rmSync(dir, { recursive: true, force: true });
  });

  const deps = { tmpdir: () => dir };
  return () => deps;
}

module.exports = { useSocketDeps };
