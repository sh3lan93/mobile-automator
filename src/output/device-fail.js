'use strict';

// The device-kind failure envelope, shared by every verb handler that touches
// the device (src/cli.js and the handlers split out of it, such as
// src/run/assert-reference.js), so a device fault reads the same from all of
// them.

const { fail } = require('./envelope');
const { engineHint } = require('../device/engine-hints');

// fs error codes that signal an environment/filesystem problem (perms, missing
// path, read-only FS, disk full) rather than a logic bug — surfaced as
// `environment` with a filesystem-specific hint.
const FS_ERROR_CODES = new Set(['EACCES', 'ENOENT', 'EROFS', 'ENOSPC', 'EPERM']);

// The hint for any device-kind failure. Precedence: an explicit err.hint wins
// (our own code attached it knowing the exact cause — a DeviceResolutionError,
// the daemon-log pointer, a timeout); then engineHint, which recognises engine
// messages that are useless on their own (the 1.0.5 engine's missing iOS agent
// and changed Android device ids, #199); then the handler's generic fallback.
// Every device fail() goes through here so no handler can miss it.
function deviceHint(err, fallback) {
  return (err && err.hint) || engineHint(err && err.message) || fallback;
}

function deviceFail(err) {
  // Respect a typed error's kind (e.g. the daemon's 'timeout') so the envelope
  // and exit code reflect the real failure class; anything else defaults to
  // 'device' (exit 2) as before.
  const kind = err.kind || 'device';
  return {
    envelope: fail(
      kind,
      err.message || String(err),
      deviceHint(err, 'Ensure a device or simulator is connected and the app is running.')
    ),
    exitKind: kind,
  };
}

module.exports = { FS_ERROR_CODES, deviceHint, deviceFail };
