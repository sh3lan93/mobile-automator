'use strict';

// Which hosts can run the device session, and the error for the ones that
// cannot (#165). The session daemon binds a Unix domain socket, and the
// session layer identifies and reaps its daemon with `ps`, process-group kill
// (`kill(-pid)`) and POSIX signals. None of that exists on Windows, where it
// used to fail as a confusing `device` error — as if no phone were connected —
// rather than saying the host itself is unsupported.
//
// package.json `os` is the single source of truth: npm refuses the install on
// any other host, and this guard catches what slips past it (`--force`,
// `npm link`, a vendored copy). Pure — no I/O; the caller decides how to emit.

const pkg = require('../../package.json');

const SUPPORTED_HOSTS = Object.freeze([...(pkg.os || [])]);

// Human names for the error text — the ONE copy; the docs-agreement lint test
// (tests/lint/host-support-agreement.test.js) consumes it rather than
// restating it. Deliberately no fallback: a host added to package.json `os`
// without a name here is a test failure and a crash at render time, not a raw
// platform id leaking into the user-facing error.
const HOST_NAMES = Object.freeze({ darwin: 'macOS', linux: 'Linux' });

const TROUBLESHOOTING_REF = 'see TROUBLESHOOTING.md ("mauto refuses to run on Windows")';

// Per-host guidance. Unknown hosts get the generic pointer instead of a
// Windows-specific instruction — a freebsd user must not be told about WSL2.
const HOST_HINTS = Object.freeze({
  win32: `On Windows, install and run mauto inside WSL2 (a Linux distribution); ${TROUBLESHOOTING_REF}.`,
});

// For hosts with no specific hint: point at the troubleshooting entry without
// naming an OS-specific route.
const GENERIC_HINT = `See TROUBLESHOOTING.md for where mauto runs and how to get there.`;

function isSupportedHost(platform = process.platform) {
  return SUPPORTED_HOSTS.includes(platform);
}

function unsupportedHostError(platform = process.platform) {
  const names = SUPPORTED_HOSTS.map((p) => HOST_NAMES[p]).join(' or ');
  const err = new Error(
    `mauto's device session needs a POSIX host (${names}); "${platform}" is not supported`
  );
  err.kind = 'environment';
  err.hint = HOST_HINTS[platform] || GENERIC_HINT;
  return err;
}

module.exports = { SUPPORTED_HOSTS, HOST_NAMES, isSupportedHost, unsupportedHostError };
