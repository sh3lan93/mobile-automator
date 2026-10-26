'use strict';

// Read side of .mobile-automator/.session/session.json — the ONLY one. The
// session id it carries is minted, and its shape defined, in session-id.js.
// resolve-connection.js's readHandleDevice() is a projection onto the `device`
// field and delegates here; it used to parse the file itself, which meant two
// readers of one artifact.
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

const { handlePath } = require('./session-paths');
const { SESSION_ID_PATTERN } = require('./session-id');

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
  return typeof id === 'string' && SESSION_ID_PATTERN.test(id) ? id : null;
}

module.exports = { readHandle, readSessionId };
