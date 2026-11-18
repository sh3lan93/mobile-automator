'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { crossCheck } = require('../../../src/result/scenario-check');
const { buildExecutor } = require('../../../src/result/executor');
const { pendingHint } = require('../../../src/result/pending-hint');
const { version } = require('../../../package.json');
const { workspaceDir } = require('../../../src/workspace/layout');

const SCENARIO = {
  scenario_id: 'login',
  steps: [
    { id: 'launch', action: 'launch_app' },
    { id: 'login_flow', action: 'tap', sub_steps: [{ id: 'type_user', action: 'type_text', sub_steps: [{ id: 'deep', action: 'tap' }] }] },
  ],
  assertions: [{ id: 'logged_in', type: 'element_exists', after_step: 'login_flow' }],
};

const recorded = (over = {}) => ({
  scenario_id: 'login',
  steps: [{ step_id: 'launch', status: 'passed' }],
  assertions: [{ assertion_id: 'logged_in', status: 'passed' }],
  executor: null,
  ...over,
});

describe('crossCheck (#275)', () => {
  test('everything recorded is in the scenario -> no problems', () => {
    expect(crossCheck(recorded(), SCENARIO)).toEqual([]);
  });

  test('nested sub_steps are known steps', () => {
    const r = recorded({ steps: [{ step_id: 'type_user' }, { step_id: 'deep' }] });
    expect(crossCheck(r, SCENARIO)).toEqual([]);
  });

  test('a different scenario_id is a problem', () => {
    expect(crossCheck(recorded({ scenario_id: 'checkout' }), SCENARIO)).toEqual([
      'the run recorded scenario_id "checkout" but the scenario is "login"',
    ]);
  });

  test('a null recorded scenario_id is not compared', () => {
    expect(crossCheck(recorded({ scenario_id: null }), SCENARIO)).toEqual([]);
  });

  test('an unknown step id is a problem, named once even if recorded twice', () => {
    const r = recorded({ steps: [{ step_id: 'ghost' }, { step_id: 'ghost' }, { step_id: 'launch' }] });
    expect(crossCheck(r, SCENARIO)).toEqual(['step "ghost" is not in the scenario']);
  });

  test('an unknown assertion id is a problem', () => {
    const r = recorded({ assertions: [{ assertion_id: 'made_up' }] });
    expect(crossCheck(r, SCENARIO)).toEqual(['assertion "made_up" is not in the scenario']);
  });

  test('a step id is not an assertion id', () => {
    const r = recorded({ assertions: [{ assertion_id: 'launch' }] });
    expect(crossCheck(r, SCENARIO)).toEqual(['assertion "launch" is not in the scenario']);
  });

  test('every problem is reported together', () => {
    const r = recorded({ scenario_id: 'x', steps: [{ step_id: 'a' }], assertions: [{ assertion_id: 'b' }] });
    expect(crossCheck(r, SCENARIO)).toHaveLength(3);
  });
});

describe('scenarioMismatch (#275)', () => {
  const { scenarioMismatch } = require('../../../src/result/scenario-check');
  const sha = 'd'.repeat(64);

  test('a consistent run with no recorded hash -> null', () => {
    expect(scenarioMismatch(recorded(), { scenario: SCENARIO, sha256: sha })).toBeNull();
  });

  test('the same hash as recorded -> null', () => {
    const r = recorded({ executor: { kind: 'runner', scenario_path: 's.json', scenario_sha256: sha } });
    expect(scenarioMismatch(r, { scenario: SCENARIO, sha256: sha })).toBeNull();
  });

  test('a different hash -> the scenario changed, checked before the ids', () => {
    const r = recorded({ scenario_id: 'other', executor: { kind: 'runner', scenario_path: 's.json', scenario_sha256: 'e'.repeat(64) } });
    const m = scenarioMismatch(r, { scenario: SCENARIO, sha256: sha });
    expect(m.message).toBe('the scenario changed since the run');
    expect(m.data).toEqual({ recorded_sha256: 'e'.repeat(64), scenario_sha256: sha });
  });

  test('cross-check problems are returned in data.problems', () => {
    const m = scenarioMismatch(recorded({ assertions: [{ assertion_id: 'x' }] }), { scenario: SCENARIO, sha256: sha });
    expect(m.data.problems).toEqual(['assertion "x" is not in the scenario']);
  });
});

describe('buildExecutor (#275)', () => {
  const root = (config) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-exec-'));
    if (config) {
      fs.mkdirSync(workspaceDir(dir), { recursive: true });
      fs.writeFileSync(path.join(workspaceDir(dir), 'config.json'), JSON.stringify(config));
    }
    return dir;
  };
  const noEnv = {};

  test('an agent executor from the workspace, device fields null', () => {
    const e = buildExecutor({ kind: 'agent', projectRoot: root({ mode: 'platform-agnostic', engine: 'legacy' }), env: noEnv });
    expect(e).toEqual({
      kind: 'agent',
      mauto_version: version,
      engine: 'legacy',
      platform: null,
      device_id: null,
      scenario_path: null,
      scenario_sha256: null,
      mode: 'platform-agnostic',
    });
  });

  test('no mode and no engine in config: platform-aware and the default engine', () => {
    const e = buildExecutor({ kind: 'agent', projectRoot: root({}), env: noEnv });
    expect(e.mode).toBe('platform-aware');
    expect(e.engine).toBe('mobilecli');
  });

  test('the exported engine variable wins, as it does for the device', () => {
    const e = buildExecutor({ kind: 'agent', projectRoot: root({ engine: 'mobilecli' }), env: { MOBILEMCP_LEGACY_ROBOT: '1' } });
    expect(e.engine).toBe('legacy');
  });

  test('a runner executor carries the device and the scenario', () => {
    const projectRoot = root({});
    const e = buildExecutor({
      kind: 'runner', projectRoot, env: noEnv,
      platform: 'android', deviceId: 'emulator-5554', scenarioPath: path.join(projectRoot, 's.json'), scenarioSha256: 'c'.repeat(64),
    });
    expect(e).toMatchObject({ kind: 'runner', platform: 'android', device_id: 'emulator-5554', scenario_path: 's.json', scenario_sha256: 'c'.repeat(64) });
  });

  // scenario_path has ONE meaning, owned here: relative to the project root
  // when the file is inside it, else absolute.
  test('a scenario inside the project root is recorded relative to it', () => {
    const projectRoot = root({});
    const e = buildExecutor({ kind: 'agent', projectRoot, env: noEnv, scenarioPath: path.join(projectRoot, 'scenarios', 'login.json') });
    expect(e.scenario_path).toBe(path.join('scenarios', 'login.json'));
  });

  test('a scenario outside the project root is recorded by its absolute path', () => {
    const projectRoot = root({});
    const outside = path.join(path.dirname(projectRoot), 'elsewhere', 'login.json');
    const e = buildExecutor({ kind: 'agent', projectRoot, env: noEnv, scenarioPath: outside });
    expect(e.scenario_path).toBe(outside);
  });

  test('a sibling directory sharing the root\'s name as a prefix is outside it', () => {
    const projectRoot = root({});
    const sibling = `${projectRoot}-other${path.sep}login.json`;
    expect(buildExecutor({ kind: 'agent', projectRoot, env: noEnv, scenarioPath: sibling }).scenario_path).toBe(sibling);
  });

  test('a relative scenario path is refused: callers resolve it first', () => {
    expect(() => buildExecutor({ kind: 'agent', projectRoot: root({}), env: noEnv, scenarioPath: 's.json' })).toThrow(/absolute/);
  });

  test('an unknown kind throws', () => {
    expect(() => buildExecutor({ kind: 'human', projectRoot: root({}) })).toThrow(/executor kind/);
  });
});

describe('pendingHint (#275)', () => {
  const result = {
    run_id: 'run_20261111_120000',
    assertion_results: [
      { assertion_id: 'a_ok', status: 'passed', step_id: 's1', type: 'element_exists' },
      { assertion_id: 'looks_right', status: 'needs_agent', step_id: 's1', type: 'visual_state' },
      { assertion_id: 'copy_ok', status: 'needs_agent', step_id: 's2', type: 'screen_title' },
    ],
  };

  const projectRoot = path.join(os.tmpdir(), 'proj');

  test('lists the pending ids, then one exact command each, then the re-finalize', () => {
    const hint = pendingHint({ ...result, executor: { kind: 'runner', scenario_path: 'scenarios/login.json' } }, { projectRoot });
    expect(hint).toBe([
      'Pending agent judgment: looks_right, copy_ok. Decide each, then re-finalize:',
      'mauto result add-assertion --run-id run_20261111_120000 --step-id s1 --assertion-id looks_right --type visual_state --pass <true|false> --judge agent --message "<why>"',
      'mauto result add-assertion --run-id run_20261111_120000 --step-id s2 --assertion-id copy_ok --type screen_title --pass <true|false> --judge agent --message "<why>"',
      `mauto result finalize --run-id run_20261111_120000 --scenario ${path.join(projectRoot, 'scenarios', 'login.json')}`,
    ].join('\n'));
  });

  // --scenario resolves against the cwd, but the workspace is discovered by
  // walking up from it: a project-relative path is wrong from a subdirectory,
  // an absolute one works from anywhere.
  test('the re-finalize names the scenario by its absolute path', () => {
    const scenarioFinalize = (hint) => hint.split('\n').at(-1).match(/--scenario (\S+)$/)[1];
    const inside = scenarioFinalize(pendingHint({ ...result, executor: { scenario_path: 'login.json' } }, { projectRoot }));
    expect(path.isAbsolute(inside)).toBe(true);
    expect(inside).toBe(path.join(projectRoot, 'login.json'));
    const outside = path.join(os.tmpdir(), 'elsewhere', 'login.json');
    expect(scenarioFinalize(pendingHint({ ...result, executor: { scenario_path: outside } }, { projectRoot }))).toBe(outside);
  });

  test('without a recorded scenario path it names the placeholder', () => {
    expect(pendingHint(result, { projectRoot })).toMatch(/--scenario <scenario\.json>$/);
    expect(pendingHint({ ...result, executor: { kind: 'agent', scenario_path: null } }, { projectRoot })).toMatch(/--scenario <scenario\.json>$/);
  });

  test('a value with a space is quoted so the line stays copyable', () => {
    const r = { ...result, executor: { kind: 'runner', scenario_path: 'my scenarios/login.json' } };
    expect(pendingHint(r, { projectRoot }).endsWith(`--scenario "${path.join(projectRoot, 'my scenarios', 'login.json')}"`)).toBe(true);
  });

  test('nothing pending (e.g. an explicit --status incomplete) still says how to re-finalize', () => {
    expect(pendingHint({ run_id: 'run_20261111_120000', assertion_results: [] }, { projectRoot })).toBe(
      'No assertion is pending; re-finalize once the run is decided:\n' +
        'mauto result finalize --run-id run_20261111_120000 --scenario <scenario.json>'
    );
  });

  // #327: a pending screenshot_match has no reference screenshot yet. It is
  // never judged by eye (docs/reference/assertions.md): the hint names the
  // re-run that records the baselines and the capture to show the user, and
  // prints no add-assertion line for it — every listed assertion is already
  // pending, so one could only replace the runner's entry and drop its
  // screenshot paths (ResultStore#addAssertion replaces in place).
  describe('a pending screenshot_match (#327)', () => {
    const capture = '.mobile-automator/screenshots/runs/login/run_20261111_120000/home_matches.actual.png';
    const shot = {
      assertion_id: 'home_matches', status: 'needs_agent', step_id: 's3', type: 'screenshot_match',
      reference_screenshot: '.mobile-automator/screenshots/reference/login/home_matches.png', actual_screenshot: capture,
    };
    const scenarioPath = path.join(projectRoot, 'scenarios', 'login.json');
    const runner = { kind: 'runner', scenario_path: 'scenarios/login.json' };

    test('names the capture and --update-references, and no add-assertion line', () => {
      const r = { run_id: 'run_20261111_120000', assertion_results: [shot], executor: runner };
      expect(pendingHint(r, { projectRoot })).toBe([
        'Pending reference screenshot: home_matches. Never judge it by eye: show the user each capture.',
        `home_matches: ${path.join(projectRoot, capture)}`,
        'Once the user confirms the screen is correct, record the baselines under a new run id (this re-records every screenshot_match in the scenario):',
        `mauto run ${scenarioPath} --update-references`,
        'Otherwise leave it pending; the run stays incomplete. Re-finalize once the run is decided:',
        `mauto result finalize --run-id run_20261111_120000 --scenario ${scenarioPath}`,
      ].join('\n'));
    });

    test('a pending screenshot_match without a recorded capture says so', () => {
      const r = { run_id: 'run_20261111_120000', assertion_results: [{ ...shot, actual_screenshot: undefined }] };
      expect(pendingHint(r, { projectRoot }).split('\n')).toContain('home_matches: no capture recorded');
    });

    test('beside a Tier-2 pending assertion, each gets its own instruction', () => {
      const r = { ...result, assertion_results: [...result.assertion_results, shot], executor: runner };
      const hint = pendingHint(r, { projectRoot });
      expect(hint).toMatch(/^Pending agent judgment: looks_right, copy_ok\. /);
      expect(hint).toContain('--assertion-id looks_right --type visual_state --pass <true|false> --judge agent');
      expect(hint).toContain(`mauto run ${scenarioPath} --update-references`);
      expect(hint).not.toContain('--assertion-id home_matches');
      expect(hint.split('\n').at(-1)).toMatch(/^mauto result finalize /);
    });

    test('without a recorded scenario path it names the placeholder', () => {
      const hint = pendingHint({ run_id: 'run_20261111_120000', assertion_results: [shot] }, { projectRoot });
      expect(hint).toContain('mauto run <scenario.json> --update-references');
    });

    // The set is the evaluator's, not a copy: a new reference-screenshot type
    // must not fall back to the "judge it" line.
    test('every REFERENCE_SCREENSHOT_TYPES type is handled as a reference', () => {
      const { REFERENCE_SCREENSHOT_TYPES } = require('../../../src/assertion/evaluator');
      for (const type of REFERENCE_SCREENSHOT_TYPES) {
        const hint = pendingHint({ run_id: 'run_20261111_120000', assertion_results: [{ ...shot, type }] }, { projectRoot });
        expect(hint).toMatch(/^Pending reference screenshot: /);
        expect(hint).not.toContain('--judge agent');
      }
    });

    test('incompleteMessage counts a pending reference screenshot apart from agent judgment', () => {
      const { incompleteMessage } = require('../../../src/result/pending-hint');
      expect(incompleteMessage({ run_id: 'run_20261111_120000', assertion_results: [shot] })).toBe(
        'run run_20261111_120000 incomplete: 1 assertion(s) need a reference screenshot'
      );
      expect(incompleteMessage({ ...result, assertion_results: [...result.assertion_results, shot] })).toBe(
        'run run_20261111_120000 incomplete: 2 assertion(s) need agent judgment, 1 need a reference screenshot'
      );
    });
  });

  test('incompleteMessage counts the pending assertions, and names none when only a step is pending', () => {
    const { incompleteMessage } = require('../../../src/result/pending-hint');
    expect(incompleteMessage(result)).toBe('run run_20261111_120000 incomplete: 2 assertion(s) need agent judgment');
    expect(incompleteMessage({ run_id: 'run_20261111_120000', assertion_results: [] })).toBe('run run_20261111_120000 incomplete');
  });

  test('pendingAssertions lists id, step and type', () => {
    const { pendingAssertions } = require('../../../src/result/pending-hint');
    expect(pendingAssertions(result)).toEqual([
      { assertion_id: 'looks_right', step_id: 's1', type: 'visual_state' },
      { assertion_id: 'copy_ok', step_id: 's2', type: 'screen_title' },
    ]);
  });
});

// #335: `result finalize --scenario` names what the scenario declares that the
// run never recorded. Without `unrecorded` (how `mauto run` calls these) the
// output is unchanged.
describe('the incomplete message and hint with unrecorded entries (#335)', () => {
  const { incompleteMessage, incompleteEnvelope } = require('../../../src/result/pending-hint');
  const projectRoot = path.join(os.tmpdir(), 'proj');
  const runId = 'run_20261118_120000';
  const scenarioPath = path.join(projectRoot, 'login.json');
  const clean = { run_id: runId, assertion_results: [], steps_executed: [{ step_id: 'launch', status: 'passed' }], executor: { scenario_path: 'login.json' } };
  const shown = { assertion_id: 'shown', step_id: 'confirm', type: 'element_exists' };
  const gaps = { steps: ['tap', 'confirm'], assertions: [shown] };

  test('the message counts the declared steps and assertions never recorded', () => {
    expect(incompleteMessage(clean, { unrecorded: gaps })).toBe(
      `run ${runId} incomplete: 2 declared step(s) and 1 assertion(s) never recorded`
    );
    expect(incompleteMessage(clean, { unrecorded: { steps: ['tap'], assertions: [] } })).toBe(
      `run ${runId} incomplete: 1 declared step(s) never recorded`
    );
    expect(incompleteMessage(clean, { unrecorded: { steps: [], assertions: [shown] } })).toBe(
      `run ${runId} incomplete: 1 declared assertion(s) never recorded`
    );
  });

  test('the message keeps the pending counts first', () => {
    const r = { ...clean, assertion_results: [{ assertion_id: 'looks', status: 'needs_agent', type: 'visual_state' }] };
    expect(incompleteMessage(r, { unrecorded: gaps })).toBe(
      `run ${runId} incomplete: 1 assertion(s) need agent judgment, 2 declared step(s) and 1 assertion(s) never recorded`
    );
  });

  test('empty gap lists leave the message unchanged', () => {
    expect(incompleteMessage(clean, { unrecorded: { steps: [], assertions: [] } })).toBe(incompleteMessage(clean));
  });

  test('the hint lists each unrecorded id with its record line, then the re-finalize', () => {
    expect(pendingHint(clean, { projectRoot, unrecorded: gaps })).toBe([
      'Never recorded: steps tap, confirm; assertions shown. Perform each step with one-shot verbs and record it, ' +
        'and record each assertion after its step:',
      `mauto result add-step --run-id ${runId} --step-id tap --status <pass|fail|skipped>`,
      `mauto result add-step --run-id ${runId} --step-id confirm --status <pass|fail|skipped>`,
      `mauto result add-assertion --run-id ${runId} --step-id confirm --assertion-id shown --type element_exists --pass <true|false> --message "<why>"`,
      'A step whose condition does not hold, or that was optional and missed, is recorded --status skipped; its assertions still apply.',
      'Re-finalize once every declared step and assertion is recorded:',
      `mauto result finalize --run-id ${runId} --scenario ${scenarioPath}`,
    ].join('\n'));
  });

  test('beside a pending step, the pending step comes first and the gaps before the re-finalize', () => {
    const r = { ...clean, steps_executed: [{ step_id: 'launch', status: 'skipped', needs_agent: true, error_message: 'by hand' }] };
    const lines = pendingHint(r, { projectRoot, unrecorded: gaps }).split('\n');
    expect(lines[0]).toBe('Pending step launch: by hand');
    expect(lines.findIndex((l) => l.startsWith('Never recorded:'))).toBeGreaterThan(0);
    expect(lines).not.toContain('No assertion is pending; re-finalize once the run is decided:');
    expect(lines.at(-1)).toMatch(/^mauto result finalize /);
  });

  test('declared values are shell-quoted like every other argument', () => {
    const odd = { ...shown, step_id: 'step one' };
    expect(pendingHint(clean, { projectRoot, unrecorded: { steps: [], assertions: [odd] } })).toContain(
      '--step-id "step one" --assertion-id shown --type element_exists'
    );
  });

  test('without unrecorded the hint is unchanged', () => {
    expect(pendingHint(clean, { projectRoot, unrecorded: { steps: [], assertions: [] } })).toBe(pendingHint(clean, { projectRoot }));
    expect(pendingHint(clean, { projectRoot })).toContain('No assertion is pending');
  });

  test('incompleteEnvelope threads unrecorded into the message and the hint', () => {
    const env = incompleteEnvelope(clean, { hints: [], projectRoot, data: clean, unrecorded: gaps });
    expect(env.error.message).toMatch(/never recorded$/);
    expect(env.hint).toContain('Never recorded: steps tap, confirm; assertions shown.');
    const plain = incompleteEnvelope(clean, { hints: [], projectRoot, data: clean });
    expect(plain.error.message).toBe(`run ${runId} incomplete`);
    expect(plain.hint).not.toContain('Never recorded');
  });
});
