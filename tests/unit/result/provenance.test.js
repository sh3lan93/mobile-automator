'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { crossCheck, buildExecutor, pendingHint } = require('../../../src/result/provenance');
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
  const { scenarioMismatch } = require('../../../src/result/provenance');
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
    const e = buildExecutor({
      kind: 'runner', projectRoot: root({}), env: noEnv,
      platform: 'android', deviceId: 'emulator-5554', scenarioPath: 's.json', scenarioSha256: 'c'.repeat(64),
    });
    expect(e).toMatchObject({ kind: 'runner', platform: 'android', device_id: 'emulator-5554', scenario_path: 's.json', scenario_sha256: 'c'.repeat(64) });
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

  test('lists the pending ids, then one exact command each, then the re-finalize', () => {
    const hint = pendingHint({ ...result, executor: { kind: 'runner', scenario_path: 'scenarios/login.json' } });
    expect(hint).toBe([
      'Pending agent judgment: looks_right, copy_ok. Decide each, then re-finalize:',
      'mauto result add-assertion --run-id run_20261111_120000 --step-id s1 --assertion-id looks_right --type visual_state --pass <true|false> --judge agent --message "<why>"',
      'mauto result add-assertion --run-id run_20261111_120000 --step-id s2 --assertion-id copy_ok --type screen_title --pass <true|false> --judge agent --message "<why>"',
      'mauto result finalize --run-id run_20261111_120000 --scenario scenarios/login.json',
    ].join('\n'));
  });

  test('without a recorded scenario path it names the placeholder', () => {
    expect(pendingHint(result)).toMatch(/--scenario <scenario\.json>$/);
    expect(pendingHint({ ...result, executor: { kind: 'agent', scenario_path: null } })).toMatch(/--scenario <scenario\.json>$/);
  });

  test('a value with a space is quoted so the line stays copyable', () => {
    const r = { ...result, executor: { kind: 'runner', scenario_path: 'my scenarios/login.json' } };
    expect(pendingHint(r)).toMatch(/--scenario "my scenarios\/login\.json"$/);
  });

  test('nothing pending (e.g. an explicit --status incomplete) still says how to re-finalize', () => {
    expect(pendingHint({ run_id: 'run_20261111_120000', assertion_results: [] })).toBe(
      'No assertion is pending; re-finalize once the run is decided:\n' +
        'mauto result finalize --run-id run_20261111_120000 --scenario <scenario.json>'
    );
  });

  test('pendingAssertions lists id, step and type', () => {
    const { pendingAssertions } = require('../../../src/result/provenance');
    expect(pendingAssertions(result)).toEqual([
      { assertion_id: 'looks_right', step_id: 's1', type: 'visual_state' },
      { assertion_id: 'copy_ok', step_id: 's2', type: 'screen_title' },
    ]);
  });
});
