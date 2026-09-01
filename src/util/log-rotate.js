'use strict';

// The codebase's ONE log rotation policy, in one place.
//
// mauto keeps two log artifacts with different consumers — the daemon's raw
// stdio at mobile-automator/.session/daemon.log (#176) and the structured
// NDJSON event stream at mobile-automator/.logs/ — but they want identical
// disk hygiene, and the design says so explicitly. This module is what makes
// that true rather than asserted: previously each file implemented rotation
// itself, and the two copies had drifted in their failure semantics.
//
// Policy: at or above the cap, rename to `<log>.1`, clobbering whatever `.1`
// was there. A single generation is the intended bound — enough to survive a
// crash loop that overwrites the interesting part of the live log, cheap to
// reason about, and it cannot grow without limit.

const realFs = require('fs');

const MAX_LOG_BYTES = 1024 * 1024;

// Best effort, and that is the contract, not a shortcut. Every failure here is
// survivable — no log yet (ENOENT on stat), a concurrent writer that already
// rotated (ENOENT on rename), an unwritable directory (EACCES) — while the
// caller's actual job (opening the daemon log, appending an event) is not.
// An oversized log beats no log, so a rotation that cannot run is swallowed.
function rotateIfLarge(logPath, { maxBytes = MAX_LOG_BYTES, fs = realFs } = {}) {
  try {
    if (fs.statSync(logPath).size >= maxBytes) fs.renameSync(logPath, `${logPath}.1`);
  } catch (_) {
    /* nothing to rotate, or someone beat us to it */
  }
}

module.exports = { MAX_LOG_BYTES, rotateIfLarge };
