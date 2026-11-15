// Real-device E2E: drive the SHIPPED `mauto` CLI against the Sample Shop app.
//
//   MAUTO_BIN=<prefix>/node_modules/.bin/mauto node sample-app/scripts/run-e2e.mjs
//
// MAUTO_BIN       required. The binary under test — in CI the packed tarball
//                 installed to a temp prefix, locally an `npm link`ed checkout.
// E2E_SCENARIOS   optional comma list of scenario ids (default: all, in order).
// E2E_ENGINE      optional device engine, `mobilecli` (default) or `legacy`
//                 (#251). Applied with `mauto config set engine` in the scratch
//                 workspace — never MOBILEMCP_LEGACY_ROBOT, which the harness
//                 scrubs — and it selects which known failures apply.
// E2E_ARTIFACTS_DIR  optional. Screenshots, results and the session log are
//                 copied here at the end, pass or fail; each scenario's JUnit
//                 report is written to <E2E_ARTIFACTS_DIR>/junit.
//
// A thin caller of the shipped `mauto run` verb (#283): every scenario is one
// `mauto run <file> --run-id <id> --junit <path>`, and the outcome is read off
// the result file that run wrote. The harness executes no step and resolves no
// target itself, so a green job proves the SHIPPED runner on whichever engine
// this leg selected — CI runs both. The remaining logic (classification,
// golden comparison, envelope handling) lives in ./lib (CommonJS, unit-tested
// under tests/unit/e2e-harness).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { createMauto } = require('./lib/mauto.js');
const { outcomeOf } = require('./lib/run-outcome.js');
const { goldenProblems } = require('./lib/golden.js');
const { classify, isJobFailure, outcomeMessage } = require('./lib/known-failures.js');
const { e2eEngine, assertSessionEngine } = require('./lib/engine.js');

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCENARIOS_DIR = path.join(HERE, '..', 'scenarios');
const GOLDEN_DIR = path.join(SCENARIOS_DIR, 'golden');
const KNOWN_FAILURES = path.join(GOLDEN_DIR, 'known-failures.json');
const DEFAULT_ORDER = ['smoke_nav', 'golden_search_empty'];

const log = (msg) => console.log(`[e2e] ${msg}`);
const die = (msg) => {
  console.error(`[e2e] ${msg}`);
  process.exit(2);
};

// --- The binary under test ------------------------------------------------

const bin = process.env.MAUTO_BIN;
if (!bin) die('MAUTO_BIN is not set. Point it at the mauto binary under test (e.g. <prefix>/node_modules/.bin/mauto).');
try {
  fs.accessSync(bin, fs.constants.X_OK);
} catch (err) {
  die(`MAUTO_BIN=${bin} is not an executable file (${err.code || err.message}).`);
}

// `.bin/mauto` is a symlink to <pkg>/bin/mauto.js in a tarball install, and
// resolves into the checkout for `npm link`; either way the package root is
// two levels above the real file.
const pkgDir = path.dirname(path.dirname(fs.realpathSync(bin)));
let pkgName = null;
try {
  pkgName = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')).name;
} catch {
  /* reported below */
}
if (pkgName !== 'mobile-automator') {
  die(`MAUTO_BIN resolves to ${fs.realpathSync(bin)}, which is not inside a mobile-automator package (found ${pkgDir}).`);
}
// `mauto run` arrived with replay R1 (#278), behind src/run/gate.js. An
// install without the gate cannot run a scenario at all. The graduation slice
// (G) deletes the gate, and must retarget this check when it does.
if (!fs.existsSync(path.join(pkgDir, 'src/run/gate.js'))) {
  die(`${pkgDir} has no src/run/gate.js; it predates mauto run (#278).`);
}
const { makeRunId } = require(path.join(pkgDir, 'src/run/run-id.js'));
log(`mauto under test: ${fs.realpathSync(bin)} (package ${pkgDir})`);

// --- The engine, validated against the install under test's config schema ---

let engines = [];
try {
  const enumValues = JSON.parse(fs.readFileSync(path.join(pkgDir, 'src/schemas/config_schema.json'), 'utf8')).properties
    .engine.enum;
  if (Array.isArray(enumValues)) engines = enumValues;
} catch {
  /* reported below */
}
if (!engines.length) die(`${pkgDir} declares no \`engine\` config key; it predates the engine selection the E2E needs (#251).`);
let engine;
try {
  engine = e2eEngine(process.env, engines);
} catch (err) {
  die(err.message);
}
if (process.env.MOBILEMCP_LEGACY_ROBOT !== undefined) {
  log(`ignoring the exported MOBILEMCP_LEGACY_ROBOT ("${process.env.MOBILEMCP_LEGACY_ROBOT}"): the engine is E2E_ENGINE, applied through the workspace config`);
}
log(`engine: ${engine}`);

// --- Scratch project ---------------------------------------------------------

const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-e2e-'));
const workspace = path.join(projectDir, '.mobile-automator');
const mauto = createMauto({ bin, cwd: projectDir, log });

// `mauto run` refuses unless MAUTO_REPLAY is exactly '1' (src/run/gate.js).
// The graduation slice (G) removes the gate and strips this.
const REPLAY_ENV = { MAUTO_REPLAY: '1' };

// One JUnit report per scenario, beside the other artifacts when there are
// any. `mauto run --junit` does not create the directory.
const junitDir = process.env.E2E_ARTIFACTS_DIR
  ? path.join(process.env.E2E_ARTIFACTS_DIR, 'junit')
  : path.join(projectDir, 'junit');

function copyArtifacts() {
  const dest = process.env.E2E_ARTIFACTS_DIR;
  if (!dest) return;
  fs.mkdirSync(dest, { recursive: true });
  for (const name of ['screenshots', 'results', '.session']) {
    const src = path.join(workspace, name);
    if (!fs.existsSync(src)) continue;
    try {
      fs.cpSync(src, path.join(dest, name), { recursive: true });
    } catch (err) {
      // A daemon socket is not copyable; everything else should be.
      log(`artifact copy of ${name} incomplete: ${err.message}`);
    }
  }
  log(`artifacts copied to ${dest}`);
}

// summary.json in the artifacts names the engine, so a downloaded artifact
// says which matrix leg produced it.
function writeSummary(summary) {
  const dest = process.env.E2E_ARTIFACTS_DIR;
  if (!dest) return;
  fs.mkdirSync(dest, { recursive: true });
  const scenarios = summary.map(({ id, outcome, failedStep, details, golden, junit }) => ({ id, outcome, failedStep, details, golden, junit }));
  fs.writeFileSync(path.join(dest, 'summary.json'), `${JSON.stringify({ engine, scenarios }, null, 2)}\n`);
}

// Run ids are second-resolution; two scenarios started within one second
// must still get distinct result files, so step the clock rather than append
// a suffix the execute guide's format does not have.
const usedRunIds = new Set();
function nextRunId() {
  let t = Date.now();
  let id = makeRunId(new Date(t));
  while (usedRunIds.has(id)) {
    t += 1000;
    id = makeRunId(new Date(t));
  }
  usedRunIds.add(id);
  return id;
}

async function main() {
  log(`scratch project: ${projectDir}`);
  await mauto.run(['setup', '--mode', 'agnostic']);
  // Before any device verb, so no session ever starts on the other engine.
  await mauto.run(['config', 'set', 'engine', engine]);
  assertSessionEngine(await mauto.run(['session', 'status']), engine);

  const files = fs.readdirSync(SCENARIOS_DIR).filter((f) => f.endsWith('.json'));
  const scenarios = new Map();
  const scenarioPaths = new Map();
  for (const f of files) {
    const dest = path.join(workspace, 'scenarios', f);
    fs.copyFileSync(path.join(SCENARIOS_DIR, f), dest);
    // Strict: a scenario the harness runs must not lean on an action the
    // engine cannot replay.
    await mauto.run(['validate', '--strict', dest]);
    const sc = JSON.parse(fs.readFileSync(dest, 'utf8'));
    scenarios.set(sc.scenario_id, sc);
    scenarioPaths.set(sc.scenario_id, dest);
  }

  const knownFailures = fs.existsSync(KNOWN_FAILURES) ? JSON.parse(fs.readFileSync(KNOWN_FAILURES, 'utf8')) : {};
  const requested = process.env.E2E_SCENARIOS
    ? process.env.E2E_SCENARIOS.split(',').map((s) => s.trim()).filter(Boolean)
    : [...DEFAULT_ORDER, ...[...scenarios.keys()].filter((id) => !DEFAULT_ORDER.includes(id))];

  const summary = [];
  for (const id of requested) {
    const scenario = scenarios.get(id);
    if (!scenario) {
      summary.push({ id, outcome: 'fail', failedStep: null, details: [`no scenario with id "${id}" in ${SCENARIOS_DIR}`], golden: [], junit: null });
      continue;
    }
    const runId = nextRunId();
    log(`=== ${id} (${runId}) ===`);
    let details = [];
    let golden = [];
    let passed = false;
    let failedStep = null;
    let junit = null;
    try {
      fs.mkdirSync(junitDir, { recursive: true });
      const junitPath = path.join(junitDir, `${runId}.xml`);
      // A failed run (test_failed, exit 6) and an incomplete one (exit 7: a
      // step needed an agent) are answers, not tool errors; anything else —
      // including a JUnit write failure (environment) — throws.
      const data = await mauto.run(['run', scenarioPaths.get(id), '--run-id', runId, '--junit', junitPath], {
        acceptKinds: ['test_failed', 'incomplete'],
        env: REPLAY_ENV,
      });
      junit = data.junit_path || junitPath;
      log(`junit: ${junit}`);
      // result_path is relative to the project root.
      const resultPath = path.join(projectDir, data.result_path);
      const r = outcomeOf(JSON.parse(fs.readFileSync(resultPath, 'utf8')));
      details = [...r.details];
      passed = r.passed;
      failedStep = r.failedStep;
      // Golden problems are kept apart from the run's outcome so a known
      // failure can never absorb them: the gate is the scenario's `golden`
      // tag (lib/golden.js — loud in both directions), a missing fixture is
      // always reported and always fails the job, and a mismatch is only
      // meaningful for a run that got all the way through.
      golden = goldenProblems({
        scenarioId: id,
        tags: scenario.tags,
        goldenDir: GOLDEN_DIR,
        resultPath,
        passed,
        log,
      });
    } catch (err) {
      // `mauto run` failing outright (device, environment, a contract
      // violation) or an unreadable result is a harness-level fault.
      details = [`harness error: ${err.message}`];
    }
    const outcome = classify({ scenarioId: id, passed, failedStep, knownFailures, engine });
    summary.push({ id, outcome, failedStep, details, golden, junit });
  }

  // The live daemon must have run the requested engine, not just resolved it.
  let engineProblem = null;
  try {
    assertSessionEngine(await mauto.run(['session', 'status']), engine);
  } catch (err) {
    engineProblem = err.message;
  }

  console.log(`\n[e2e] ===== summary (engine: ${engine}) =====`);
  writeSummary(summary);
  for (const { id, outcome, failedStep, details, golden } of summary) {
    console.log(`[e2e] ${outcomeMessage({ scenarioId: id, outcome, knownFailures, failedStep, engine })}`);
    for (const d of details) console.log(`[e2e]     ${d}`);
    for (const g of golden) console.log(`[e2e]     ${g}`);
  }
  if (engineProblem) console.log(`[e2e] engine check FAILED: ${engineProblem}`);
  const failed = summary.filter((s) => isJobFailure(s.outcome) || s.golden.length > 0);
  if (failed.length) console.log(`[e2e] job FAILED: ${failed.map((s) => s.id).join(', ')}`);
  return failed.length || engineProblem ? 1 : 0;
}

let exitCode = 1;
try {
  exitCode = await main();
} catch (err) {
  console.error(`[e2e] aborted: ${err.message}`);
  exitCode = 1;
} finally {
  // End the daemon first so its log is flushed and its socket is gone before
  // the session directory is copied.
  try {
    await mauto.run(['session', 'end']);
  } catch (err) {
    log(`session end: ${err.message}`);
  }
  copyArtifacts();
}
process.exitCode = exitCode;
