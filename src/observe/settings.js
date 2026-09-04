'use strict';

// Resolves the observability control surface from the environment.
//
// Defaults are asymmetric on purpose: stderr is a HUMAN's channel during an
// interactive run, so it stays quiet at `warn`; the file is a forensic record
// nobody reads unless something broke, so it keeps `info`. One MAUTO_LOG_LEVEL
// overrides both, because a user debugging wants the same detail in both
// places and a second env var to remember is a worse interface.

const { LEVELS } = require('./event');

const DEFAULT_STDERR_LEVEL = 'warn';
const DEFAULT_FILE_LEVEL = 'info';

function resolveLevels(env = process.env) {
  const raw = String((env && env.MAUTO_LOG_LEVEL) || '').toLowerCase();
  if (raw === 'silent') return { stderr: null, file: null };
  if (LEVELS.includes(raw)) return { stderr: raw, file: raw };
  // Unrecognised values fall back rather than throw: a typo in an env var must
  // never break `mauto tap`.
  return { stderr: DEFAULT_STDERR_LEVEL, file: DEFAULT_FILE_LEVEL };
}

// True when `level` is at or above `threshold`. A null threshold means the
// sink is off, so nothing passes.
function atLeast(level, threshold) {
  if (!threshold) return false;
  const a = LEVELS.indexOf(level);
  const b = LEVELS.indexOf(threshold);
  if (a === -1 || b === -1) return false;
  return a >= b;
}

module.exports = { DEFAULT_STDERR_LEVEL, DEFAULT_FILE_LEVEL, resolveLevels, atLeast };
