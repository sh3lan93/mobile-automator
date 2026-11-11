'use strict';

// The gate-then-graduate switch for `mauto run` (replay PRD #271). Until the
// graduation slice deletes this file, the verb refuses unless MAUTO_REPLAY is
// exactly '1' — not 'true', not ' 1' — so a partial replay can only be
// reached on purpose. Same pattern as the retired observability gate (see
// tests/lint/no-observe-gate.test.js).
function replayEnabled(env = process.env) {
  return env.MAUTO_REPLAY === '1';
}

module.exports = { replayEnabled };
