'use strict';

// The per-user telemetry consent record (#348, decision D1).
//
// Why per user: the on-switch used to be `telemetry.enabled: true` in
// .mobile-automator/config.json alone. That file lives in the repository and
// is routinely committed, so one developer's opt-in, once committed, turned
// telemetry on for everyone who cloned the repo, none of whom had consented.
// Consent belongs to a person on a machine, not to a checkout, so it is
// recorded here, in the user's own config directory, outside every repository.
//
// Why keyed by the project's realpath: consent is per project as well as per
// user (opting in for one app must not opt in every workspace on the machine),
// and one project is reachable through several paths (macOS's /tmp is
// /private/tmp; a checkout can sit behind a symlink). The realpath is the one
// name they share, so the record is found however the project is reached.
//
// Why no safe-fs: the file is NOT read through src/workspace/safe-fs.js and
// gets no owner or symlink checks. Those checks defend against a hostile
// repository, and a repository can commit .mobile-automator/ but cannot write
// the developer's ~/.config. Where the file lives comes from XDG_CONFIG_HOME
// and HOME, and the environment is trusted the same way MAUTO_TELEMETRY_HOST
// is: whoever controls it already controls this process.

const os = require('os');
const path = require('path');

const FILE_NAME = 'telemetry-consent.json';

// $XDG_CONFIG_HOME/mauto/telemetry-consent.json, else
// ~/.config/mauto/telemetry-consent.json. The XDG spec says a relative
// XDG_CONFIG_HOME is invalid and must be ignored, so only an absolute one is
// used.
function consentPath({ env = process.env, homedir = os.homedir } = {}) {
  const xdg = env && env.XDG_CONFIG_HOME;
  const base = typeof xdg === 'string' && path.isAbsolute(xdg) ? xdg : path.join(homedir(), '.config');
  return path.join(base, 'mauto', FILE_NAME);
}

module.exports = { consentPath };
