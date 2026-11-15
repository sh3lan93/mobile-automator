'use strict';

const pad = (n) => String(n).padStart(2, '0');

// `run_YYYYMMDD_HHMMSS`, the format the execute guide and `result` verbs use.
// UTC so two CI machines agree on what a given instant is called.
function makeRunId(date) {
  return (
    `run_${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `_${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  );
}

module.exports = { makeRunId };
