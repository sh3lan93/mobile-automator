'use strict';

// Which mobile-mcp device robot ("engine") the real-device E2E runs on (#251).
//
// The engine is chosen with E2E_ENGINE and applied the way a user applies it:
// `mauto config set engine <x>` in the harness's workspace. The harness never
// exports MOBILEMCP_LEGACY_ROBOT (lib/mauto.js scrubs it from every child), so
// a green legacy run proves the config key reaches the engine — not that an
// environment variable does.
//
// The valid engines are the install under test's, read from its
// config_schema.json by the runner and passed in here, so this module restates
// nothing but the default.

const DEFAULT_ENGINE = 'mobilecli';

function e2eEngine(env, engines) {
  const raw = env && typeof env.E2E_ENGINE === 'string' ? env.E2E_ENGINE.trim() : '';
  const engine = raw || DEFAULT_ENGINE;
  if (!engines.includes(engine)) {
    const from = raw ? `E2E_ENGINE=${raw}` : `the default engine ${DEFAULT_ENGINE}`;
    throw new Error(`${from} is not an engine the mauto under test accepts (valid: ${engines.join(', ')}).`);
  }
  return engine;
}

// Check a `mauto session status` payload against the requested engine. The
// workspace must resolve it FROM CONFIG — `env` would mean a
// MOBILEMCP_LEGACY_ROBOT slipped through and the config path went untested —
// and a running daemon, if any, must be on it.
function assertSessionEngine(status, engine) {
  if (!status || typeof status.resolved_engine !== 'string') {
    throw new Error('mauto session status reports no resolved_engine; the mauto under test predates the engine config key (#251).');
  }
  if (status.resolved_engine !== engine) {
    throw new Error(`the workspace resolves ${status.resolved_engine}, but E2E_ENGINE=${engine}.`);
  }
  if (status.resolved_engine_source !== 'config') {
    throw new Error(
      `the workspace resolves ${engine} from ${status.resolved_engine_source}, not from config; the harness must select the engine with \`mauto config set engine\`.`
    );
  }
  if (status.running && status.engine !== engine) {
    throw new Error(`the running session uses ${status.engine}, but E2E_ENGINE=${engine}.`);
  }
}

module.exports = { DEFAULT_ENGINE, e2eEngine, assertSessionEngine };
