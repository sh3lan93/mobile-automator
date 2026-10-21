// Real-device E2E: drive the SHIPPED `mauto` CLI against the Sample Shop app.
//
//   MAUTO_BIN=<prefix>/node_modules/.bin/mauto node sample-app/scripts/run-e2e.mjs
//
// MAUTO_BIN       required. The binary under test — in CI the packed tarball
//                 installed to a temp prefix, locally an `npm link`ed checkout.
// E2E_SCENARIOS   optional comma list of scenario ids (default: all, in order).
// E2E_ARTIFACTS_DIR  optional. Screenshots, results and the session log are
//                 copied here at the end, pass or fail.
//
// Thin on purpose: the logic lives in ./lib (CommonJS, unit-tested under
// tests/unit/e2e-harness). The target matcher is loaded from the SAME install
// as MAUTO_BIN, so the harness resolves targets exactly as that build's
// `mauto assert` does.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { createMauto } = require('./lib/mauto.js');
const { runScenario, makeRunId } = require('./lib/executor.js');
const { normalizeResult, diffNormalized } = require('./lib/normalize-result.js');
const { classify, isJobFailure, outcomeMessage } = require('./lib/known-failures.js');

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

// --- The binary under test, and the matcher from the same install ----------

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
const evaluator = require(path.join(pkgDir, 'src', 'assertion', 'evaluator.js'));
if (typeof evaluator.findFirst !== 'function' || typeof evaluator.matches !== 'function') {
  die(`${pkgDir} does not export the target matcher (findFirst/matches); it predates the CLI-driven E2E.`);
}
log(`mauto under test: ${fs.realpathSync(bin)} (package ${pkgDir})`);

// --- Scratch project ---------------------------------------------------------

const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-e2e-'));
const workspace = path.join(projectDir, 'mobile-automator');
const mauto = createMauto({ bin, cwd: projectDir, log });

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

function goldenCheck(scenarioId, resultPath) {
  const goldenPath = path.join(GOLDEN_DIR, `${scenarioId}.result.json`);
  const actual = normalizeResult(JSON.parse(fs.readFileSync(resultPath, 'utf8')));
  if (!fs.existsSync(goldenPath)) {
    log(`no golden at ${path.relative(process.cwd(), goldenPath)}. Normalized result of this run:`);
    console.log(JSON.stringify(actual, null, 2));
    return [
      `golden fixture missing: once this run's result is the intended behaviour, save the JSON above as ` +
        `sample-app/scenarios/golden/${scenarioId}.result.json`,
    ];
  }
  const expected = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
  return diffNormalized(expected, actual).map((line) => `golden mismatch: ${line}`);
}

async function main() {
  log(`scratch project: ${projectDir}`);
  await mauto.run(['setup', '--mode', 'agnostic']);

  const files = fs.readdirSync(SCENARIOS_DIR).filter((f) => f.endsWith('.json'));
  const scenarios = new Map();
  for (const f of files) {
    const dest = path.join(workspace, 'scenarios', f);
    fs.copyFileSync(path.join(SCENARIOS_DIR, f), dest);
    // Strict: a scenario the harness runs must not lean on an action the
    // engine cannot replay.
    await mauto.run(['validate', '--strict', dest]);
    const sc = JSON.parse(fs.readFileSync(dest, 'utf8'));
    scenarios.set(sc.scenario_id, sc);
  }

  const knownFailures = fs.existsSync(KNOWN_FAILURES) ? JSON.parse(fs.readFileSync(KNOWN_FAILURES, 'utf8')) : {};
  const requested = process.env.E2E_SCENARIOS
    ? process.env.E2E_SCENARIOS.split(',').map((s) => s.trim()).filter(Boolean)
    : [...DEFAULT_ORDER, ...[...scenarios.keys()].filter((id) => !DEFAULT_ORDER.includes(id))];

  const summary = [];
  for (const id of requested) {
    const scenario = scenarios.get(id);
    if (!scenario) {
      summary.push({ id, outcome: 'fail', details: [`no scenario with id "${id}" in ${SCENARIOS_DIR}`] });
      continue;
    }
    const runId = nextRunId();
    log(`=== ${id} (${runId}) ===`);
    let details;
    let passed;
    try {
      const r = await runScenario({
        scenario,
        mauto,
        evaluator,
        workspaceDir: projectDir,
        runId,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        now: Date.now,
        log,
      });
      details = [...r.failures];
      if (fs.existsSync(path.join(GOLDEN_DIR, `${id}.result.json`)) || id.startsWith('golden_')) {
        details.push(...goldenCheck(id, r.resultPath));
      }
      passed = r.status === 'passed' && details.length === 0;
    } catch (err) {
      // A recording verb (`result ...`) failing is a harness-level fault.
      details = [`harness error: ${err.message}`];
      passed = false;
    }
    const outcome = classify({ scenarioId: id, passed, knownFailures });
    summary.push({ id, outcome, details });
  }

  console.log('\n[e2e] ===== summary =====');
  for (const { id, outcome, details } of summary) {
    console.log(`[e2e] ${outcomeMessage({ scenarioId: id, outcome, knownFailures })}`);
    for (const d of details) console.log(`[e2e]     ${d}`);
  }
  return summary.some((s) => isJobFailure(s.outcome)) ? 1 : 0;
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
