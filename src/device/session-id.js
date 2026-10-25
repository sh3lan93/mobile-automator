'use strict';

// The session id: the function that mints it and the shape it is minted in.
//
// This is its own module, rather than living beside the handle reader in
// session-handle.js, because the event catalog (src/observe/event.js) imports
// the shape — and so this module must import nothing local. The device layer
// already imports observe/ (session-daemon.js, failure-probe.js,
// mobile-mcp-client.js); if anything on this module's require path ever
// reached back into observe/, the cycle could hand event.js a half-built
// exports object with SESSION_ID_PATTERN still undefined. The session_id check
// would then throw when telemetryPayload() runs it, and safeObserve
// (src/observe/recorder.js) swallows that — session_id telemetry would vanish
// with nothing failing. Requiring only `crypto` makes that impossible, and
// tests/lint/session-id-pure.test.js keeps it that way (#196).

const crypto = require('crypto');

// 16 hex chars from the CSPRNG, derived from NOTHING — not the project root,
// not the device, not the pid. That is what makes the event catalog's
// `sends: true` on session_id true rather than merely asserted, and
// tests/unit/device/session-id.test.js is where the claim is enforced.
// session-handle.readSessionId() holds the read side to the same shape
// (SESSION_ID_PATTERN).
//
// Deliberately NOT persisted across daemon restarts. A stable id would be a
// machine fingerprint; this one changes exactly when the daemon does, which is
// the fact it exists to report — run_id cannot express "the daemon died and
// respawned mid-run".
function newSessionId() {
  return crypto.randomBytes(8).toString('hex');
}

// The shape of what newSessionId() mints (8 CSPRNG bytes as hex) and the only
// shape readSessionId() will return. The handle file is just a file, so the
// shape is what keeps `sends: true` true for a stale or hand-edited one. It
// lives here, with its minter; the event catalog imports it (#196).
const SESSION_ID_PATTERN = /^[0-9a-f]{16}$/;

module.exports = { SESSION_ID_PATTERN, newSessionId };
