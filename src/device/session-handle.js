'use strict';

// Read side of mobile-automator/.session/session.json, plus the generator for
// the session id it carries.
//
// The handle is where session_id lives because it is a file that is ALREADY
// there, already written at exactly the right moment (once the daemon is
// listening) and already removed at exactly the right moment (stop()). A verb
// that wants to stamp its events with the live session's id must not have to
// pay a socket round trip for it, and a second copy in the ping reply would be
// a second source of truth that can disagree with this one.
//
// Nothing here throws: an absent, unreadable or malformed handle means "no
// session", which is a normal state, not an error.

const realFs = require('fs');
const crypto = require('crypto');

const { handlePath } = require('./session-paths');

// 16 hex chars from the CSPRNG, derived from NOTHING — not the project root,
// not the device, not the pid. That is what makes the event catalog's
// `sends: true` on session_id true rather than merely asserted, and
// tests/unit/device/session-handle.test.js is where the claim is enforced.
//
// Deliberately NOT persisted across daemon restarts. A stable id would be a
// machine fingerprint; this one changes exactly when the daemon does, which is
// the fact it exists to report — run_id cannot express "the daemon died and
// respawned mid-run".
function newSessionId() {
  return crypto.randomBytes(8).toString('hex');
}

function readHandle(projectRoot, { fs = realFs } = {}) {
  try {
    const parsed = JSON.parse(fs.readFileSync(handlePath(projectRoot), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch (_) {
    return null;
  }
}

function readSessionId(projectRoot, { fs = realFs } = {}) {
  const handle = readHandle(projectRoot, { fs });
  const id = handle && handle.session_id;
  return typeof id === 'string' && id ? id : null;
}

module.exports = { newSessionId, readHandle, readSessionId };
