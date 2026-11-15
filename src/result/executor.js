'use strict';

// Who produced a result and from what (#275): the `executor` block a finalize
// records. Pure apart from reading the workspace config (for `engine` and
// `mode`) and package.json; shared by `result finalize` and `mauto run`.

const path = require('path');

const { version: MAUTO_VERSION } = require('../../package.json');
const manager = require('../config/manager');
const { readEngine } = require('../device/engine');
const resultSchema = require('../schemas/result_schema.json');

// The schema's executor.kind enum, read rather than restated.
const EXECUTOR_KINDS = resultSchema.properties.executor.properties.kind.enum;

// What executor.scenario_path means, the one place it is decided: relative
// to the project root when the file is inside it (so the result stays
// meaningful on another checkout), else absolute. `absolute` must already be
// resolved — against the caller's cwd — since a relative path here could mean
// either directory.
function recordedScenarioPath(projectRoot, absolute) {
  if (!path.isAbsolute(absolute)) {
    throw new Error(`scenario path must be absolute, got "${absolute}" (resolve it against the cwd first)`);
  }
  const relative = path.relative(projectRoot, absolute);
  return relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative)
    ? relative
    : absolute;
}

// The `executor` block a finalize records. `engine` resolves as the device
// layer resolves it (an exported MOBILEMCP_LEGACY_ROBOT wins over config), and
// `mode` as the guides resolve it (unset is platform-aware). The device fields
// are whatever the caller connected to — null when it connected to none.
// `scenarioPath` is absolute (or null); it is recorded per
// recordedScenarioPath, so `mauto run` and `result finalize --scenario` record
// the same value for the same file.
function buildExecutor({
  kind, projectRoot, platform = null, deviceId = null, scenarioPath = null, scenarioSha256 = null, env = process.env,
}) {
  if (!EXECUTOR_KINDS.includes(kind)) {
    throw new Error(`unknown executor kind "${kind}" (expected ${EXECUTOR_KINDS.join(' | ')})`);
  }
  const recordedPath = scenarioPath == null ? null : recordedScenarioPath(projectRoot, scenarioPath);
  return {
    kind,
    mauto_version: MAUTO_VERSION,
    engine: readEngine(projectRoot, { env }).engine,
    platform,
    device_id: deviceId,
    scenario_path: recordedPath,
    scenario_sha256: scenarioSha256,
    mode: manager.resolveMode(manager.load(projectRoot)),
  };
}

module.exports = { buildExecutor, recordedScenarioPath };
