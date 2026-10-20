'use strict';

// Structural guard: which host OSes can run mauto (#165). For months nothing
// said — Windows installs succeeded, then every device verb failed with a
// `device` error as if no phone were connected, because the session daemon
// binds a Unix domain socket and the session layer leans on `ps`, process-group
// kill and POSIX signals. The fix is a declaration, and a declaration made in
// several places is free to drift, so this guard derives every site from one.
//
// `package.json` `os` is the single source of truth — it is the only one npm
// enforces (EBADPLATFORM at install). Everything else must agree with it:
//   - src/device/host-support.js, which catches what slips past npm (`--force`,
//     `npm link`) and must not keep its own list;
//   - the install docs, which must name every supported host and tell Windows
//     users where to go instead (WSL2);
//   - TROUBLESHOOTING.md, which the runtime hint points at by heading — rename
//     the heading and the hint dangles.
//
// Hosts are named through the ONE map in src/device/host-support.js, keyed on
// `os`, so adding a host to package.json fails here until the map and the docs
// learn its name. The lockfile's copy of `os` is asserted by
// ./lockfile-in-sync.test.js.

const fs = require('fs');
const path = require('path');

const { REPO_ROOT } = require('./docs-corpus');
const pkg = require('../../package.json');
const { HOST_NAMES } = require('../../src/device/host-support');

// --- Derived truth (never hardcode the host list) -------------------------

const OS = pkg.os;

// Human names come FROM src/device/host-support.js — the single copy. Because
// that map has no fallback, this guard's name checks and the runtime error text
// can never disagree, and a host missing a name fails both here and at render.

// The heading the runtime hint in host-support.js cites.
const TROUBLESHOOTING_HEADING = 'mauto refuses to run on Windows';

// Docs where a user decides whether mauto will run on their machine.
const INSTALL_DOCS = ['README.md', 'docs/getting-started/installation.md'];

function read(rel) {
  return fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');
}

describe('supported hosts — structural agreement', () => {
  test('package.json declares a non-empty os list', () => {
    expect(Array.isArray(OS)).toBe(true);
    expect(OS.length).toBeGreaterThan(0);
  });

  test('package.json os does not claim win32 (the session layer is POSIX-only)', () => {
    expect(OS).not.toContain('win32');
  });

  test('every declared host has a human name', () => {
    expect(OS.filter((p) => !HOST_NAMES[p])).toEqual([]);
  });

  test('host-support.js derives SUPPORTED_HOSTS from package.json os', () => {
    const { SUPPORTED_HOSTS } = require('../../src/device/host-support');
    expect([...SUPPORTED_HOSTS]).toEqual(OS);
  });

  test.each(INSTALL_DOCS)('%s names every supported host and the Windows/WSL2 route', (rel) => {
    const text = read(rel);
    const missing = [];
    for (const p of OS) {
      const name = HOST_NAMES[p];
      if (!text.includes(name)) missing.push(name);
    }
    for (const word of ['Windows', 'WSL2']) {
      if (!text.includes(word)) missing.push(word);
    }
    expect(missing).toEqual([]);
  });

  test('TROUBLESHOOTING.md has the heading the runtime hint points at', () => {
    const headings = read('TROUBLESHOOTING.md')
      .split('\n')
      .filter((l) => /^#{1,6}\s/.test(l));
    expect(headings.some((h) => h.includes(TROUBLESHOOTING_HEADING))).toBe(true);
  });

  test('the runtime hint still cites that heading', () => {
    const { unsupportedHostError } = require('../../src/device/host-support');
    expect(unsupportedHostError('win32').hint).toContain(TROUBLESHOOTING_HEADING);
  });
});
