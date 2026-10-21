'use strict';

// Which mobile-mcp device robot ("engine") drives the device (#251).
//
// mobile-mcp picks its robot once per process from MOBILEMCP_LEGACY_ROBOT: the
// exact string "1" selects the legacy robot (adb/uiautomator on Android,
// go-ios/WDA on real iOS devices), anything else the default mobilecli robot.
// iOS simulators always use mobilecli. The workspace `engine` config key lets a
// user choose the legacy robot without exporting the variable; the default
// stays mobilecli.
//
// The engine list and default are read from config_schema.json — the single
// source of truth for the key — rather than restated here.

const configSchema = require('../schemas/config_schema.json');
const manager = require('../config/manager');

const ENGINE_PROPERTY = configSchema.properties.engine;
const ENGINES = Object.freeze([...ENGINE_PROPERTY.enum]);
const DEFAULT_ENGINE = ENGINE_PROPERTY.default;
const LEGACY_ENV = 'MOBILEMCP_LEGACY_ROBOT';

function isEngine(value) {
  return typeof value === 'string' && ENGINES.includes(value);
}

// Precedence: an exported MOBILEMCP_LEGACY_ROBOT (ANY defined value) wins,
// because buildEngineEnv never overrides a user-set value — the engine that
// actually runs is the env's, so reporting the config's would be a lie. Then a
// valid config.engine, then the default. An invalid config value (hand-edited;
// `config set` rejects it) is ignored rather than fatal.
function resolveEngine({ config, env = process.env } = {}) {
  if (env && env[LEGACY_ENV] !== undefined) {
    return { engine: env[LEGACY_ENV] === '1' ? 'legacy' : 'mobilecli', source: 'env' };
  }
  if (config && isEngine(config.engine)) return { engine: config.engine, source: 'config' };
  return { engine: DEFAULT_ENGINE, source: 'default' };
}

// resolveEngine against a workspace's config.json. A missing or unreadable
// config resolves like an empty one: picking a device robot must never be the
// reason a device verb fails.
function readEngine(projectRoot, { env = process.env, load = manager.load } = {}) {
  let config = null;
  try {
    config = load(projectRoot);
  } catch (_) {
    config = null;
  }
  return resolveEngine({ config, env });
}

// The engine a session handle records. Daemons spawned before #251 wrote no
// engine; they ran the default robot unless the user exported
// MOBILEMCP_LEGACY_ROBOT, which the handle cannot tell us — so they count as
// mobilecli, and the rare exported-variable case costs one restart.
function handleEngine(handle) {
  return handle && isEngine(handle.engine) ? handle.engine : DEFAULT_ENGINE;
}

const SOURCES = Object.freeze(['env', 'config', 'default']);

// The engine a spawned daemon runs, from the env its spawner set
// (MAUTO_SESSION_ENGINE / _SOURCE, see session-spawn.js). Without it — the
// daemon started by hand, or by a test — the daemon resolves from its own env,
// which is what the engine process will inherit.
function sessionEngineFromEnv(env = process.env) {
  if (isEngine(env.MAUTO_SESSION_ENGINE)) {
    const source = SOURCES.includes(env.MAUTO_SESSION_ENGINE_SOURCE) ? env.MAUTO_SESSION_ENGINE_SOURCE : null;
    return { engine: env.MAUTO_SESSION_ENGINE, source };
  }
  return resolveEngine({ config: null, env });
}

module.exports = {
  ENGINES,
  DEFAULT_ENGINE,
  isEngine,
  resolveEngine,
  readEngine,
  handleEngine,
  sessionEngineFromEnv,
};
