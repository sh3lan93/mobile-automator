'use strict';

// prepareRun: everything `mauto run` decides before any device work — the
// gate, the scenario, the run id — driven directly, without the program.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { ScenarioValidator } = require('../../../src/scenario/validator');
const { prepareRun } = require('../../../src/run/prepare');

const RUN_ID = 'run_20261111_093000';
const ON = { MAUTO_REPLAY: '1' };
const validator = new ScenarioValidator();

function scenario(steps) {
  return {
    $schema_version: '2.1',
    scenario_id: 'demo',
    name: 'Demo',
    description: 'd',
    platform: 'android',
    app_package: 'com.example.app',
    mode: 'platform-agnostic',
    metadata: { app_version: 'debug', environment: 'ci' },
    steps: steps || [
      { id: 'launch', action: 'launch_app', description: 'Launch' },
      { id: 'tap_more', action: 'tap', description: 'Tap More', target: 'More' },
    ],
    assertions: [],
  };
}

let root;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-prepare-'));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

function write(sc) {
  const file = path.join(root, 'demo.json');
  fs.writeFileSync(file, typeof sc === 'string' ? sc : JSON.stringify(sc));
  return file;
}

const prepare = (args) => prepareRun({ validator, ...args });

describe('the MAUTO_REPLAY gate', () => {
  test.each([
    ['unset', {}],
    ["'0'", { MAUTO_REPLAY: '0' }],
    ["'true'", { MAUTO_REPLAY: 'true' }],
  ])('%s refuses with environment before reading the scenario', (_label, env) => {
    const p = prepare({ file: path.join(root, 'missing.json'), runId: RUN_ID, env });
    expect(p.failure.exitKind).toBe('environment');
    expect(p.failure.envelope.error.message).toBe('mauto run is not enabled yet');
    expect(p.failure.envelope.hint).toBe('export MAUTO_REPLAY=1 to try the in-progress replay runner');
  });
});

describe('the scenario', () => {
  test('an unreadable file is invalid_input', () => {
    const p = prepare({ file: path.join(root, 'missing.json'), runId: RUN_ID, env: ON });
    expect(p.failure.exitKind).toBe('invalid_input');
    expect(p.failure.envelope.error.message).toMatch(/^cannot read file/);
  });

  test('a schema-invalid scenario is invalid_input', () => {
    const bad = scenario();
    delete bad.app_package;
    const p = prepare({ file: write(bad), runId: RUN_ID, env: ON });
    expect(p.failure.exitKind).toBe('invalid_input');
    expect(p.failure.envelope.error.message).toBe('scenario failed schema validation');
  });

  test('a strict-blocking replayability finding is invalid_input', () => {
    const dup = scenario([
      { id: 'launch', action: 'launch_app', description: 'Launch' },
      { id: 'launch', action: 'tap', description: 'Tap', target: 'More' },
    ]);
    const p = prepare({ file: write(dup), runId: RUN_ID, env: ON });
    expect(p.failure.exitKind).toBe('invalid_input');
    expect(p.failure.envelope.error.message).toMatch(/cannot replay unattended/);
  });

  test('a valid scenario comes back parsed', () => {
    const p = prepare({ file: write(scenario()), runId: RUN_ID, env: ON });
    expect(p.failure).toBeUndefined();
    expect(p.scenario).toEqual(scenario());
  });

  test('carries the file and the sha256 loadScenario hashed (#275)', () => {
    const file = write(scenario());
    const p = prepare({ file, runId: RUN_ID, env: ON });
    expect(p.file).toBe(file);
    expect(p.sha256).toBe(require('crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
  });
});

describe('the run id', () => {
  const OTHER = 'run_20261111_120000';

  test('the flag wins over MAUTO_RUN_ID', () => {
    const p = prepare({ file: write(scenario()), runId: RUN_ID, env: { ...ON, MAUTO_RUN_ID: OTHER } });
    expect(p.runId).toBe(RUN_ID);
  });

  test('MAUTO_RUN_ID wins over a minted id', () => {
    const p = prepare({ file: write(scenario()), env: { ...ON, MAUTO_RUN_ID: OTHER }, now: () => new Date(0) });
    expect(p.runId).toBe(OTHER);
  });

  test('with neither, one is minted from now()', () => {
    const p = prepare({ file: write(scenario()), env: ON, now: () => new Date(Date.UTC(2026, 10, 11, 9, 30, 0)) });
    expect(p.runId).toBe(RUN_ID);
    expect(p.runId).toMatch(/^run_\d{8}_\d{6}$/);
  });

  test('a minted id defaults to the real time', () => {
    const p = prepare({ file: write(scenario()), env: ON });
    expect(p.runId).toMatch(/^run_\d{8}_\d{6}$/);
  });

  test('an id that cannot name a result file is invalid_input', () => {
    const p = prepare({ file: write(scenario()), runId: '../escape', env: ON });
    expect(p.failure.exitKind).toBe('invalid_input');
    expect(p.failure.envelope.error.message).toBe('invalid run id "../escape"');
    expect(p.failure.envelope.hint).toMatch(/run_YYYYMMDD_HHMMSS/);
  });
});
