// =============================================================================
// run-smoke.mjs — Real-device E2E that drives the SHIPPED `mauto` CLI.
//
// WHAT THIS PROVES (issue #94, Refs PRD #69):
//   - The real CLI chain (realDeviceBridge -> createCall -> parseToolResult ->
//     element-model) handles LIVE mobile-mcp response shapes. A botched
//     element-model normalization or a drifted mobile-mcp payload shape fails
//     the job loudly, where the unit tests (which inject a fake `call`) cannot.
//   - Agnostic TEXT targeting works end-to-end through the shipped verbs: we
//     resolve tabs by their visible label ("Home"/"Categories"/"More"), never
//     by resource-id/identifier (the locked agnostic invariant). We even assert
//     that NO returned element object carries an `identifier`/`resource_id` key,
//     proving ElementModel stripped them.
//   - The mechanical assertion path (`mauto assert element_exists`) and the
//     result-persistence verbs (`result add-step`/`add-assertion`/`finalize`)
//     produce a result whose mechanical fields match a golden fixture.
//
// WHAT THIS DOES NOT PROVE (intentionally out of scope — no LLM in CI):
//   - LLM disambiguation among visually-similar elements. The bottom-nav labels
//     are UNIQUE by construction, so a deterministic substring match stands in
//     for the "brain". This runner is the deterministic stand-in for the brain's
//     TARGET-RESOLUTION only.
//   - Tier-2 visual / screenshot assertion JUDGMENT. That requires an agent to
//     look at pixels and is deliberately excluded from CI.
//
// The runner shells the worktree's CLI as subprocesses (`node <root>/bin/mauto.js
// <verb> ...`) and acts on each JSON envelope. It imports NOTHING from a parallel
// mobile-mcp client — the device is driven ONLY through `mauto` verbs.
// =============================================================================

import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import assert from 'node:assert/strict';

const __dirname = dirname(fileURLToPath(import.meta.url));
// scripts/ -> sample-app/ -> repo root
const sampleAppDir = resolve(__dirname, '..');
const repoRoot = resolve(sampleAppDir, '..');
// MAUTO_BIN overrides the CLI entrypoint (used only by the offline dry-run that
// validates this runner's logic without a device); defaults to the shipped bin.
const mautoBin = process.env.MAUTO_BIN || join(repoRoot, 'bin', 'mauto.js');

const scenarioPath = join(sampleAppDir, 'scenarios', 'smoke_nav.json');
const goldenPath = join(sampleAppDir, 'scenarios', 'golden', 'smoke_nav.result.golden.json');
const screenshotDir = join(sampleAppDir, 'screenshots', 'smoke_nav');

function log(msg) {
  console.log(`[smoke] ${msg}`);
}

function die(msg) {
  console.error(`[smoke] FATAL: ${msg}`);
  process.exit(1);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// CLI invocation — every device/result interaction goes through here.
// cwd defaults to sample-app/ so the CLI resolves the `mobile-automator/`
// workspace (results land in sample-app/mobile-automator/results/). The bin is
// referenced by ABSOLUTE path, so node resolves src/ deps regardless of cwd.
// ---------------------------------------------------------------------------
function mauto(args, { cwd = sampleAppDir } = {}) {
  const res = spawnSync('node', [mautoBin, ...args], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) {
    die(`failed to spawn mauto ${args.join(' ')}: ${res.error.message}`);
  }
  const stdout = (res.stdout || '').trim();
  if (res.status !== 0) {
    die(`mauto ${args.join(' ')} exited ${res.status}\n  stdout: ${stdout}\n  stderr: ${(res.stderr || '').trim()}`);
  }
  let env;
  try {
    env = JSON.parse(stdout);
  } catch {
    die(`mauto ${args.join(' ')} stdout is not parseable JSON:\n${stdout.slice(0, 400)}`);
  }
  if (env.ok !== true) {
    die(`mauto ${args.join(' ')} returned ok:false -> ${JSON.stringify(env.error)}`);
  }
  return env.data;
}

// Reject any element carrying an OS-specific identifier — the agnostic invariant
// must hold END-TO-END. If the element-model ever stops stripping these, the
// shape leaks here and the job fails loudly.
function assertNoOsIdentifiers(elements) {
  for (const el of elements) {
    if (el && typeof el === 'object' && ('identifier' in el || 'resource_id' in el)) {
      die(`agnostic invariant violated: element exposes an OS identifier -> ${JSON.stringify(el)}`);
    }
  }
}

// Resolve a target by its VISIBLE label — text or accessibility_label,
// case-insensitive substring. This is the agnostic targeting path; there is no
// resource-id / identifier matching anywhere.
function resolveTarget(elements, target) {
  const t = String(target).toLowerCase();
  return elements.find(
    (el) =>
      (el.text || '').toLowerCase().includes(t) ||
      (el.accessibility_label || '').toLowerCase().includes(t)
  );
}

// Poll `mauto elements` until the target label appears or the timeout elapses.
function pollForTarget(target, timeoutMs) {
  const pollMs = 2000;
  const deadline = Date.now() + timeoutMs;
  let lastCount = -1;
  // Synchronous polling loop (spawnSync) with a busy-wait sleep between polls.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const elements = mauto(['elements']);
    if (!Array.isArray(elements)) {
      die(`mauto elements did not return an array: ${JSON.stringify(elements).slice(0, 200)}`);
    }
    if (elements.length === 0 && lastCount !== 0) {
      log(`elements returned empty list (still loading?)`);
    }
    lastCount = elements.length;
    assertNoOsIdentifiers(elements);
    const hit = resolveTarget(elements, target);
    if (hit) return { elements, element: hit };
    if (Date.now() >= deadline) {
      die(`timed out after ${timeoutMs}ms waiting for target "${target}" (last saw ${elements.length} elements)`);
    }
    // Busy sleep via Atomics (spawnSync already blocks; keep the loop simple).
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(pollMs, deadline - Date.now()));
  }
}

// ---------------------------------------------------------------------------
// Golden projection + comparison — mechanical fields ONLY.
// ---------------------------------------------------------------------------
function project(result) {
  return {
    scenario_id: result.scenario_id,
    schema_version: result.schema_version,
    status: result.status,
    total_assertions: result.total_assertions,
    passed_assertions: result.passed_assertions,
    failed_assertions: result.failed_assertions,
    steps: (result.steps_executed || []).map((s) => ({ step_id: s.step_id, status: s.status })),
    assertions: (result.assertion_results || []).map((a) => ({
      assertion_id: a.assertion_id,
      status: a.status,
    })),
  };
}

function projectGolden(golden) {
  // The golden file already stores only stable keys; re-project to guarantee the
  // exact same shape/order the comparator sees from the actual result.
  return {
    scenario_id: golden.scenario_id,
    schema_version: golden.schema_version,
    status: golden.status,
    total_assertions: golden.total_assertions,
    passed_assertions: golden.passed_assertions,
    failed_assertions: golden.failed_assertions,
    steps: golden.steps,
    assertions: golden.assertions,
  };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  const scenario = JSON.parse(readFileSync(scenarioPath, 'utf8'));
  const golden = JSON.parse(readFileSync(goldenPath, 'utf8'));
  log(`scenario loaded: "${scenario.name}" (${scenario.steps.length} steps), mode=${scenario.mode}`);

  mkdirSync(screenshotDir, { recursive: true });

  // run_id must match ^run_\d{8}_\d{6}$ (result schema).
  const now = new Date();
  const p = (n, w = 2) => String(n).padStart(w, '0');
  const runId = `run_${now.getUTCFullYear()}${p(now.getUTCMonth() + 1)}${p(now.getUTCDate())}_${p(now.getUTCHours())}${p(now.getUTCMinutes())}${p(now.getUTCSeconds())}`;
  const scenarioId = scenario.scenario_id;
  log(`run_id=${runId}`);

  const waitTimeoutMs =
    scenario.steps.find((s) => s.action === 'wait_for_element')?.wait_config?.timeout_ms ?? 30000;

  // --- Step: launch_app via adb (there is no `mauto launch` verb) ----------
  // Driving the app launch through adb keeps the runner from opening a second
  // mobile-mcp client. `mauto` then drives every on-screen interaction.
  log(`[launch] launching ${scenario.app_package} via adb monkey`);
  const launch = spawnSync(
    'adb',
    ['shell', 'monkey', '-p', scenario.app_package, '-c', 'android.intent.category.LAUNCHER', '1'],
    { encoding: 'utf8' }
  );
  if (launch.status !== 0) {
    die(`adb launch failed (status ${launch.status}): ${(launch.stderr || launch.stdout || '').trim()}`);
  }
  mauto(['result', 'add-step', '--run-id', runId, '--scenario-id', scenarioId, '--step-id', 'launch', '--status', 'pass']);

  // --- Step: wait_for_element "Home" ---------------------------------------
  log(`[wait_home] polling mauto elements for "Home" (timeout ${waitTimeoutMs}ms)`);
  pollForTarget('Home', waitTimeoutMs);
  log(`[wait_home] Home tab visible`);
  mauto(['result', 'add-step', '--run-id', runId, '--scenario-id', scenarioId, '--step-id', 'wait_home', '--status', 'pass']);

  // --- Tap steps (each followed by an element_exists assertion) -------------
  const tabSteps = [
    { stepId: 'tap_home', target: 'Home', assertionId: 'home_tab_active' },
    { stepId: 'tap_categories', target: 'Categories', assertionId: 'categories_tab_active' },
    { stepId: 'tap_more', target: 'More', assertionId: 'more_tab_active' },
  ];

  for (const { stepId, target, assertionId } of tabSteps) {
    log(`[${stepId}] resolving "${target}" via mauto elements`);
    const { element } = pollForTarget(target, waitTimeoutMs);
    const [cx, cy] = element.center;
    log(`[${stepId}] tapping "${target}" at center (${cx},${cy})`);
    mauto(['tap', '--at', `${cx},${cy}`]);

    // Mechanical assertion through the shipped CLI — the CLI decides pass/fail.
    log(`[${stepId}] asserting element_exists target="${target}"`);
    const verdict = mauto(['assert', 'element_exists', '--target', target]);
    if (verdict.pass !== true) {
      die(`[${stepId}] element_exists "${target}" did not pass: ${verdict.message}`);
    }

    // Checkpoint screenshot.
    const shotPath = join(screenshotDir, `step_${stepId}.png`);
    mauto(['screenshot', shotPath]);

    // Persist the step + the assertion verdict.
    mauto(['result', 'add-step', '--run-id', runId, '--scenario-id', scenarioId, '--step-id', stepId, '--status', 'pass']);
    mauto([
      'result', 'add-assertion',
      '--run-id', runId,
      '--scenario-id', scenarioId,
      '--step-id', stepId,
      '--assertion-id', assertionId,
      '--type', 'element_exists',
      '--pass', String(verdict.pass),
      '--message', verdict.message || `Element matching '${target}' is present.`,
    ]);
  }

  // --- Finalize ------------------------------------------------------------
  log(`finalizing result`);
  const result = mauto(['result', 'finalize', '--run-id', runId, '--scenario-id', scenarioId, '--status', 'passed']);

  // --- Golden comparison (mechanical fields only) --------------------------
  const actualProjection = project(result);
  const goldenProjection = projectGolden(golden);

  // Volatile-field sanity check that is NOT part of the deepEqual: run_id shape.
  if (!/^run_\d{8}_\d{6}$/.test(result.run_id)) {
    die(`run_id "${result.run_id}" does not match ^run_\\d{8}_\\d{6}$`);
  }

  try {
    assert.deepStrictEqual(actualProjection, goldenProjection);
  } catch (err) {
    console.error('[smoke] GOLDEN MISMATCH (mechanical fields)');
    console.error('--- actual ---');
    console.error(JSON.stringify(actualProjection, null, 2));
    console.error('--- golden ---');
    console.error(JSON.stringify(goldenProjection, null, 2));
    console.error('--- diff ---');
    console.error(err.message);
    process.exit(1);
  }

  log(`golden match OK — ${result.passed_assertions}/${result.total_assertions} assertions passed across ${result.steps_executed.length} steps`);
  log(`smoke scenario completed successfully`);
}

main().catch((err) => die(err.stack || err.message || String(err)));
