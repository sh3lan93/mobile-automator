'use strict';

// Scenario executor for the real-device E2E harness.
//
// This is the `mauto guide execute` recipe done mechanically: every step maps
// to one-shot `mauto` verbs, every outcome is recorded through `mauto result`,
// and the result file is the CLI's own (`result finalize`), not something this
// harness writes. It is deliberately narrow — only the actions the sample-app
// scenarios use — and anything else is a loud step error rather than a skip,
// so a scenario can never pass by exercising less than it claims.
//
// Everything with a side effect is injected (`mauto`, `sleep`, `now`, `log`),
// which is what lets tests/unit/e2e-harness drive it with a fake CLI and a
// fake clock.

const fs = require('fs');
const path = require('path');

const { resolveTarget } = require('./resolve');

const DEFAULT_TIMEOUT_MS = 30000;
const POLL_MS = 1500;
const DEFAULT_BACKOFF_MS = 1000;

// The four agnostic semantic actions; `mauto press <action>` resolves each to
// per-platform mechanics (src/device/semantic-press/).
const SEMANTIC_ACTIONS = new Set(['press_back', 'dismiss_keyboard', 'grant_permission', 'deny_permission']);

// Which assertion field carries the expected value for each mechanical type,
// per the execute guide's assertion table. `--expected` is the one flag
// `mauto assert` reads it from.
const EXPECTED_FIELD = {
  element_text: 'expected_value',
  text_contains: 'expected_substring',
  element_hint: 'expected_text',
  content_description: 'label_value',
  has_accessibility_label: 'label_value',
  element_visible: 'expected_visible',
};

// A failure that retrying cannot fix: a scenario the harness cannot run, or
// an engine that answers a successful launch with an empty screen.
class FatalStepError extends Error {
  constructor(message) {
    super(message);
    this.name = 'FatalStepError';
    this.fatal = true;
  }
}

const pad = (n) => String(n).padStart(2, '0');

// `run_YYYYMMDD_HHMMSS`, the format the execute guide and `result` verbs use.
// UTC so two CI machines agree on what a given instant is called.
function makeRunId(date) {
  return (
    `run_${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `_${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}`
  );
}

function assertFlags(assertion) {
  const flags = [];
  if (assertion.element_description !== undefined) flags.push('--target', String(assertion.element_description));
  const field = EXPECTED_FIELD[assertion.type];
  if (field && assertion[field] !== undefined) flags.push('--expected', String(assertion[field]));
  if (assertion.operator !== undefined) flags.push('--operator', String(assertion.operator));
  if (assertion.expected_count !== undefined) flags.push('--count', String(assertion.expected_count));
  if (assertion.pattern !== undefined) flags.push('--pattern', String(assertion.pattern));
  if (assertion.variable_name !== undefined) flags.push('--variable', String(assertion.variable_name));
  return flags;
}

async function runScenario({ scenario, mauto, evaluator, catalog, workspaceDir, runId, sleep, now = Date.now, log = () => {} }) {
  const scenarioId = scenario.scenario_id;
  // Every verb carries the run id, so the CLI writes a trace for this run and
  // `result finalize` measures the duration instead of taking our word for it.
  const verb = (args) => mauto.run(args, { env: { MAUTO_RUN_ID: runId } });
  const failures = [];

  const elements = async () => {
    const data = await verb(['elements']);
    return Array.isArray(data) ? data : [];
  };

  // Poll `probe` until it returns a value or the timeout lapses. The probe is
  // always tried at least once, and once more AT the deadline, so a timeout of
  // N ms means "the screen was looked at for N ms".
  async function poll(timeoutMs, probe) {
    const start = now();
    for (;;) {
      const outcome = await probe();
      if (outcome.done) return outcome;
      if (now() - start >= timeoutMs) return outcome;
      await sleep(Math.min(POLL_MS, timeoutMs - (now() - start)));
    }
  }

  async function resolve(target) {
    const r = resolveTarget(await elements(), target, evaluator);
    if (r.matches.length > 1) {
      log(`  warning: target ${JSON.stringify(target)} matched ${r.matches.length} elements; using the first`);
    }
    return r;
  }

  async function launchApp(step) {
    // mauto launch cold-starts by default (#255); the step fields that change
    // that (`cold: false`) map to flags in the install's action catalog.
    await verb(['launch', scenario.app_package, ...catalog.stepFlagsFor('launch_app', step)]);
    // The drift gate. A launch that succeeded and a screen with nothing on it
    // is not "the target is missing": it is the engine's element response
    // changing shape under us, or the app failing to render. Reporting it as
    // a missing target blames the app for an engine fault, which is how #199
    // was first misread.
    const timeoutMs = (step.wait_config && step.wait_config.timeout_ms) || DEFAULT_TIMEOUT_MS;
    const outcome = await poll(timeoutMs, async () => ({ done: (await elements()).length > 0 }));
    if (!outcome.done) {
      throw new FatalStepError(
        `engine returned zero elements after a successful launch of ${scenario.app_package} ` +
          `(waited ${timeoutMs}ms): the element response shape drifted or the app did not render`
      );
    }
  }

  async function waitForElement(step) {
    const timeoutMs = (step.wait_config && step.wait_config.timeout_ms) || DEFAULT_TIMEOUT_MS;
    const outcome = await poll(timeoutMs, async () => {
      try {
        return { done: true, value: await resolve(step.target) };
      } catch (err) {
        if (err.name !== 'TargetNotFoundError') throw err;
        return { done: false, error: err };
      }
    });
    if (!outcome.done) throw new Error(`timed out after ${timeoutMs}ms: ${outcome.error.message}`);
  }

  async function perform(step) {
    if (SEMANTIC_ACTIONS.has(step.action)) return verb(['press', step.action]);
    switch (step.action) {
      case 'launch_app':
        return launchApp(step);
      case 'wait_for_element':
        return waitForElement(step);
      case 'tap': {
        const { center } = await resolve(step.target);
        return verb(['tap', '--at', `${center[0]},${center[1]}`]);
      }
      case 'type':
        if (step.value === undefined || step.value === null) throw new FatalStepError('type step has no value');
        return verb(['type', String(step.value)]);
      default:
        throw new FatalStepError(`action "${step.action}" is unsupported by the E2E harness`);
    }
  }

  // Run one step under its retry policy. Returns { ok, attempts, error }.
  async function attempt(step) {
    const policy = step.retry_policy || {};
    const maxAttempts = Math.max(1, Number(policy.max_attempts) || 1);
    const backoff = policy.backoff_ms === undefined ? DEFAULT_BACKOFF_MS : Number(policy.backoff_ms);
    let lastError = null;
    for (let n = 1; n <= maxAttempts; n++) {
      try {
        await perform(step);
        return { ok: true, attempts: n, error: null };
      } catch (err) {
        lastError = err;
        log(`  attempt ${n}/${maxAttempts} failed: ${err.message}`);
        if (err.fatal) return { ok: false, attempts: n, error: err };
        if (n < maxAttempts) await sleep(backoff);
      }
    }
    return { ok: false, attempts: maxAttempts, error: lastError };
  }

  // Screenshot path relative to the workspace (what the result file records),
  // and absolute (what the verb writes). The CLI does not create directories.
  async function screenshot(name) {
    const rel = path.join('.mobile-automator', 'screenshots', scenarioId, runId, `${name}.png`);
    const abs = path.join(workspaceDir, rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    try {
      await verb(['screenshot', abs]);
      return rel;
    } catch (err) {
      log(`  screenshot ${rel} failed: ${err.message}`);
      return null;
    }
  }

  async function runAssertion(assertion) {
    let pass = false;
    let message;
    try {
      const verdict = await verb(['assert', assertion.type, ...assertFlags(assertion)]);
      if (verdict && verdict.needs_agent) {
        message = `needs agent judgment; the E2E harness only decides mechanical assertions (${verdict.message})`;
      } else {
        pass = Boolean(verdict && verdict.pass === true);
        message = (verdict && verdict.message) || 'no message';
      }
    } catch (err) {
      message = `mauto assert errored: ${err.message}`;
    }
    const args = [
      'result', 'add-assertion',
      '--run-id', runId,
      '--scenario-id', scenarioId,
      '--step-id', assertion.after_step,
      '--assertion-id', assertion.id,
      '--type', assertion.type,
      '--pass', String(pass),
      '--message', message,
    ];
    const field = EXPECTED_FIELD[assertion.type];
    if (field && assertion[field] !== undefined) args.push('--expected', String(assertion[field]));
    await verb(args);
    log(`  assertion ${assertion.id} (${assertion.type}): ${pass ? 'PASS' : 'FAIL'} — ${message}`);
    if (!pass) failures.push(`assertion ${assertion.id} (${assertion.type}): ${message}`);
  }

  const assertions = Array.isArray(scenario.assertions) ? scenario.assertions : [];
  // The first step that failed, if any. Known failures are pinned to it.
  let failedStep = null;

  for (const step of scenario.steps || []) {
    log(`[${scenarioId}] step ${step.id} (${step.action})`);
    const outcome = await attempt(step);

    let shot = null;
    if (outcome.ok && step.checkpoint) shot = await screenshot(`step_${step.id}`);
    // A failed step always gets evidence, checkpoint or not.
    if (!outcome.ok) shot = await screenshot(`step_${step.id}_failure`);

    const args = [
      'result', 'add-step',
      '--run-id', runId,
      '--scenario-id', scenarioId,
      '--step-id', step.id,
      '--status', outcome.ok ? 'pass' : 'fail',
      '--attempts', String(outcome.attempts),
    ];
    if (shot) args.push('--screenshot', shot);
    if (!outcome.ok) args.push('--error-message', outcome.error.message);
    await verb(args);

    if (!outcome.ok) {
      failures.push(`step ${step.id} (${step.action}): ${outcome.error.message}`);
      failedStep = step.id;
      // Later steps would run against a screen nobody predicted; their
      // failures would only bury this one.
      break;
    }

    for (const assertion of assertions.filter((a) => a.after_step === step.id)) {
      await runAssertion(assertion);
    }
  }

  const status = failedStep || failures.length > 0 ? 'failed' : 'passed';
  await verb(['result', 'finalize', '--run-id', runId, '--scenario-id', scenarioId, '--status', status]);

  return {
    status,
    resultPath: path.join(workspaceDir, '.mobile-automator', 'results', `${runId}.json`),
    failures,
    failedStep,
  };
}

module.exports = { runScenario, makeRunId, assertFlags, SEMANTIC_ACTIONS, POLL_MS, DEFAULT_TIMEOUT_MS };
