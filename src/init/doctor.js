'use strict';

// `mauto doctor` (#144): report whether the host integration `mauto init`
// wrote is missing or out of date. A report, not a gate — the CLI always
// renders it as an ok envelope. The inspection is honest: an unexpected fs
// error from inspectHosts (EACCES, ...) propagates to the caller's envelope
// boundary to classify, it is never swallowed.

const { HOSTS } = require('./host-plan');
const { initCommands } = require('./stale-notice');

// Returns { data, hint } for the `mauto doctor` envelope.
function doctorReport({ projectRoot, inspect }) {
  const installed = inspect(projectRoot).filter((h) => h.installed);
  const stale = installed.filter((h) => h.stale).map((h) => h.agent);
  const data = {
    initialised: installed.length > 0,
    hosts: installed.map(({ agent, stale: s, files, mcp }) => ({ agent, stale: s, files, mcp })),
    stale,
  };
  let hint = null;
  if (stale.length) {
    hint = initCommands(stale).map((c) => `run \`${c}\``).join('; ');
  } else if (installed.length === 0) {
    hint = `no host integration found — run \`mauto init --agent <host>\` (${HOSTS.join(' | ')} | all)`;
  }
  return { data, hint };
}

module.exports = { doctorReport };
