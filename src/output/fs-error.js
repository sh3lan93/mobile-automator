'use strict';

// What a filesystem error is, in one place. Requires nothing of mauto's, so
// any layer (a verb handler, a store) can ask.

const os = require('os');

// fs error codes that signal an environment/filesystem problem (perms, missing
// path, read-only FS, disk full) rather than a logic bug: the envelope
// boundary (toEnvelope, src/cli.js) surfaces these as `environment` with a
// filesystem-specific hint, and anything else as `internal`.
const FS_ERROR_CODES = new Set(['EACCES', 'ENOENT', 'EROFS', 'ENOSPC', 'EPERM']);

// Whether `err` is one a filesystem call raised: a Node system error, whose
// code is one of this platform's errno names (EACCES, EISDIR, ENOTDIR, ...).
// Wider than FS_ERROR_CODES on purpose: a handler that reports its own write
// failure (could not write the report to ...) owns every errno its write can
// raise. Narrower than "any error": a typed refusal carries a code of its own
// (UnsafePathError's EUNSAFEPATH is no errno name) or none, and a code bug
// carries none, so both pass through such a handler to the envelope boundary,
// which reports a refusal's own kind and hint and a bug as `internal`.
function isFsError(err) {
  return Boolean(err) && typeof err.code === 'string' && Object.hasOwn(os.constants.errno, err.code);
}

module.exports = { FS_ERROR_CODES, isFsError };
