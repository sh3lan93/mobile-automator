'use strict';

// Per-user config for tests that inject their own `env` into telemetry code.
//
// The per-file isolation (tests/helpers/isolate-user-config.js) covers code
// that reads process.env. An injected env does not inherit it: `{}` has no
// XDG_CONFIG_HOME, so the consent record falls back to the developer's real
// ~/.config. Any env a test builds for telemetry code starts here instead.

const fs = require('fs');
const os = require('os');
const path = require('path');

const consent = require('../../src/observe/consent');

// A fresh, empty per-user config dir, plus whatever the test needs.
function userConfigEnv(extra = {}) {
  return { XDG_CONFIG_HOME: fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-xdg-')), ...extra };
}

// Records this user's consent for the project, in the dir `env` names. An env
// without XDG_CONFIG_HOME would write the real ~/.config, so it is refused.
function grantLocalConsent(projectRoot, env) {
  if (!env || !env.XDG_CONFIG_HOME) {
    throw new Error('grantLocalConsent needs an env with an isolated XDG_CONFIG_HOME (see userConfigEnv)');
  }
  consent.setLocalConsent(projectRoot, true, { env });
}

module.exports = { userConfigEnv, grantLocalConsent };
