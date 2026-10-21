'use strict';

// Structural guard: the real-device E2E stays a test of the SHIPPED CLI, in
// platform-agnostic terms (#94).
//
// The harness it replaced drifted in exactly the ways this guards against. It
// matched elements by OS element id (`el.identifier === step.target`), so it
// exercised a selector mauto's locked invariants forbid; it had its own
// mobile-mcp pin in sample-app/scripts/package.json, so it tested an engine
// users never get; and its matcher was its own, so a green run said nothing
// about how `mauto assert` and `mauto tap` resolve a target. Each rule below is
// one of those regressions, made a build failure:
//
//   1. no OS-id vocabulary anywhere in the harness source;
//   2. targets resolve through the CLI's own matcher, injected from the
//      install under test, and the harness defines no matcher of its own;
//   3. no scenario names an element by a Semantics id from the app source;
//   4. the harness has no package.json, so no private dependency pins;
//   5. every known failure is pinned to an issue, a reason, and the step it
//      fails at — an entry that excuses "failed somewhere" hid a launch crash
//      behind #251 on a real device.

const fs = require('fs');
const path = require('path');

const { REPO_ROOT } = require('./docs-corpus');

const SCRIPTS = path.join(REPO_ROOT, 'sample-app', 'scripts');
const SCENARIOS = path.join(REPO_ROOT, 'sample-app', 'scenarios');
const APP_LIB = path.join(REPO_ROOT, 'sample-app', 'lib');
const KNOWN_FAILURES = path.join(SCENARIOS, 'golden', 'known-failures.json');

function walk(dir, keep) {
  if (!fs.existsSync(dir)) return [];
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full, keep));
    else if (keep(full)) out.push(full);
  }
  return out;
}

const rel = (p) => path.relative(REPO_ROOT, p);
const read = (p) => fs.readFileSync(p, 'utf8');

const scriptFiles = walk(SCRIPTS, () => true);
const scenarioFiles = fs
  .readdirSync(SCENARIOS)
  .filter((f) => f.endsWith('.json'))
  .map((f) => path.join(SCENARIOS, f));
const loadScenario = (p) => JSON.parse(read(p));

// --- 1. No OS-id vocabulary ---------------------------------------------------

// Comments included: a comment explaining "match on the id when the label is
// missing" is the first draft of the regression.
const OS_ID_TOKEN = /identifier|resource[-_]id/i;

describe('E2E harness — no OS element ids', () => {
  test('the harness source exists (the rules below are not vacuous)', () => {
    expect(scriptFiles.map(rel)).toEqual(
      expect.arrayContaining(['sample-app/scripts/run-e2e.mjs', 'sample-app/scripts/lib/resolve.js'])
    );
  });

  test('no file under sample-app/scripts names identifier / resource-id / resource_id', () => {
    const offenders = [];
    for (const file of scriptFiles) {
      read(file).split('\n').forEach((line, i) => {
        if (OS_ID_TOKEN.test(line)) offenders.push(`${rel(file)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

// --- 2. The CLI's matcher, and only the CLI's ---------------------------------

describe('E2E harness — targets resolve through the CLI evaluator', () => {
  const resolveSrc = read(path.join(SCRIPTS, 'lib', 'resolve.js'));
  const runnerSrc = read(path.join(SCRIPTS, 'run-e2e.mjs'));
  const executorSrc = read(path.join(SCRIPTS, 'lib', 'executor.js'));

  test('resolve.js takes findFirst/matches as an injected parameter and requires no matcher module', () => {
    expect(resolveSrc).toMatch(/function resolveTarget\(\s*elements\s*,\s*target\s*,\s*\{\s*findFirst\s*,\s*matches\s*\}\s*\)/);
    expect(resolveSrc).not.toMatch(/\brequire\(/);
  });

  test('the executor hands resolveTarget the evaluator it was given', () => {
    expect(executorSrc).toMatch(/resolveTarget\(.*,\s*evaluator\s*\)/);
  });

  test('run-e2e.mjs loads src/assertion/evaluator.js from the install under test', () => {
    expect(runnerSrc).toMatch(/require\(\s*path\.join\(\s*pkgDir\s*,\s*['"]src\/assertion\/evaluator\.js['"]\s*\)\s*\)/);
  });

  test('no file under sample-app/scripts defines its own matcher', () => {
    const OWN_MATCHER = [
      /\bfunction\s+(matches|findFirst)\b/,
      /\b(const|let|var)\s+(matches|findFirst)\s*=/,
      /\b(matches|findFirst)\s*:\s*(function|\(|[a-z_]+\s*=>)/,
      /toLowerCase\(\)\s*\.\s*includes\(/,
    ];
    const offenders = [];
    for (const file of scriptFiles) {
      read(file).split('\n').forEach((line, i) => {
        if (OWN_MATCHER.some((re) => re.test(line))) offenders.push(`${rel(file)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

// --- 3. Scenarios never name a Semantics id -----------------------------------

// Every `identifier: '...'` literal in the app source (Semantics ids, which the
// engine surfaces as OS element ids). An interpolated id such as
// 'cart_item_$id' becomes a prefix.
function semanticsIds() {
  const exact = new Set();
  const prefixes = new Set();
  for (const file of walk(APP_LIB, (p) => p.endsWith('.dart'))) {
    for (const m of read(file).matchAll(/identifier:\s*'([^']+)'/g)) {
      const id = m[1];
      const dollar = id.indexOf('$');
      if (dollar === -1) exact.add(id);
      else if (dollar > 0) prefixes.add(id.slice(0, dollar));
    }
  }
  return { exact, prefixes };
}

// The scenario fields that name or describe an element.
const STEP_FIELDS = ['target'];
const ASSERTION_FIELDS = ['target', 'element_description', 'expected_value', 'expected_substring', 'expected_text', 'label_value'];

describe('E2E scenarios — on-screen strings, not Semantics ids', () => {
  const ids = semanticsIds();

  test('the app source declares Semantics ids (the rule is not vacuous)', () => {
    expect(ids.exact.size).toBeGreaterThan(0);
  });

  test('no step target or assertion target/expected value equals a Semantics id', () => {
    const offenders = [];
    for (const file of scenarioFiles) {
      const sc = loadScenario(file);
      const check = (where, value) => {
        if (typeof value !== 'string') return;
        const hit = ids.exact.has(value) || [...ids.prefixes].some((p) => value.startsWith(p));
        if (hit) offenders.push(`${rel(file)} ${where}: ${JSON.stringify(value)}`);
      };
      for (const step of sc.steps || []) for (const f of STEP_FIELDS) check(`step ${step.id}.${f}`, step[f]);
      for (const a of sc.assertions || []) for (const f of ASSERTION_FIELDS) check(`assertion ${a.id}.${f}`, a[f]);
    }
    expect(offenders).toEqual([]);
  });
});

// --- 4. No private dependency pins ---------------------------------------------

describe('E2E harness — no private dependencies', () => {
  test('sample-app/scripts/package.json does not exist (the harness runs the shipped mauto, nothing else)', () => {
    expect(fs.existsSync(path.join(SCRIPTS, 'package.json'))).toBe(false);
  });
});

// --- 5. Known failures are pinned ----------------------------------------------

describe('E2E known failures — each pinned to an issue, a reason and a step', () => {
  const known = JSON.parse(read(KNOWN_FAILURES));
  const byId = new Map(scenarioFiles.map((f) => [loadScenario(f).scenario_id, loadScenario(f)]));

  test('every entry names a scenario that exists', () => {
    expect(Object.keys(known).filter((id) => !byId.has(id))).toEqual([]);
  });

  test.each(Object.keys(known))('%s has a numeric issue, a reason, and a failing_step in its scenario', (id) => {
    const entry = known[id];
    expect(Number.isInteger(entry.issue)).toBe(true);
    expect(typeof entry.reason).toBe('string');
    expect(entry.reason.trim()).not.toBe('');
    expect(typeof entry.failing_step).toBe('string');
    const steps = byId.has(id) ? byId.get(id).steps.map((s) => s.id) : [];
    expect(steps).toContain(entry.failing_step);
  });
});
