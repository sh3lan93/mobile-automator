'use strict';

// prepareRun: everything `mauto run` decides before any device work — the
// flags, the scenario, the run id — driven directly, without the program.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { ScenarioValidator } = require('../../../src/scenario/validator');
const { prepareRun } = require('../../../src/run/prepare');

const RUN_ID = 'run_20261111_093000';
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

// An empty env by default, so a MAUTO_RUN_ID in the developer's shell cannot
// leak into a case that does not set one.
const prepare = (args) => prepareRun({ validator, env: {}, ...args });

describe('the scenario', () => {
  test('an unreadable file is invalid_input', () => {
    const p = prepare({ file: path.join(root, 'missing.json'), runId: RUN_ID });
    expect(p.failure.exitKind).toBe('invalid_input');
    expect(p.failure.envelope.error.message).toMatch(/^cannot read file/);
  });

  test('a schema-invalid scenario is invalid_input', () => {
    const bad = scenario();
    delete bad.app_package;
    const p = prepare({ file: write(bad), runId: RUN_ID });
    expect(p.failure.exitKind).toBe('invalid_input');
    expect(p.failure.envelope.error.message).toBe('scenario failed schema validation');
  });

  test('a strict-blocking replayability finding is invalid_input', () => {
    const dup = scenario([
      { id: 'launch', action: 'launch_app', description: 'Launch' },
      { id: 'launch', action: 'tap', description: 'Tap', target: 'More' },
    ]);
    const p = prepare({ file: write(dup), runId: RUN_ID });
    expect(p.failure.exitKind).toBe('invalid_input');
    expect(p.failure.envelope.error.message).toMatch(/cannot replay unattended/);
  });

  test('a valid scenario comes back parsed', () => {
    const p = prepare({ file: write(scenario()), runId: RUN_ID });
    expect(p.failure).toBeUndefined();
    expect(p.scenario).toEqual(scenario());
  });

  test('carries the file and the sha256 loadScenario hashed (#275)', () => {
    const file = write(scenario());
    const p = prepare({ file, runId: RUN_ID });
    expect(p.file).toBe(file);
    expect(p.sha256).toBe(require('crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex'));
  });
});

describe('--timeout-ms', () => {
  test('absent: timeoutMs is null', () => {
    expect(prepare({ file: write(scenario()), runId: RUN_ID }).timeoutMs).toBeNull();
  });

  test.each([['3000', 3000], [3000, 3000], ['1', 1]])('%j is a positive integer', (raw, expected) => {
    expect(prepare({ file: write(scenario()), runId: RUN_ID, timeoutMs: raw }).timeoutMs).toBe(expected);
  });

  test.each(['0', '-5', '1.5', 'abc', '', ' ', '1e3', 0, -1, 1.5, NaN])('%j is invalid_input', (raw) => {
    const p = prepare({ file: write(scenario()), runId: RUN_ID, timeoutMs: raw });
    expect(p.failure.exitKind).toBe('invalid_input');
    expect(p.failure.envelope.error.message).toBe(`invalid --timeout-ms "${raw}"`);
  });

  test('is checked before the scenario is read', () => {
    const bad = prepare({ file: path.join(root, 'missing.json'), runId: RUN_ID, timeoutMs: '0' });
    expect(bad.failure.envelope.error.message).toBe('invalid --timeout-ms "0"');
  });
});

describe('the run id', () => {
  const OTHER = 'run_20261111_120000';

  test('the flag wins over MAUTO_RUN_ID', () => {
    const p = prepare({ file: write(scenario()), runId: RUN_ID, env: { MAUTO_RUN_ID: OTHER } });
    expect(p.runId).toBe(RUN_ID);
  });

  test('MAUTO_RUN_ID wins over a minted id', () => {
    const p = prepare({ file: write(scenario()), env: { MAUTO_RUN_ID: OTHER }, now: () => new Date(0) });
    expect(p.runId).toBe(OTHER);
  });

  test('with neither, one is minted from now()', () => {
    const p = prepare({ file: write(scenario()), now: () => new Date(Date.UTC(2026, 10, 11, 9, 30, 0)) });
    expect(p.runId).toBe(RUN_ID);
    expect(p.runId).toMatch(/^run_\d{8}_\d{6}$/);
  });

  test('a minted id defaults to the real time', () => {
    const p = prepare({ file: write(scenario()) });
    expect(p.runId).toMatch(/^run_\d{8}_\d{6}$/);
  });

  test('an id that cannot name a result file is invalid_input', () => {
    const p = prepare({ file: write(scenario()), runId: '../escape' });
    expect(p.failure.exitKind).toBe('invalid_input');
    expect(p.failure.envelope.error.message).toBe('invalid run id "../escape"');
    expect(p.failure.envelope.hint).toMatch(/run_YYYYMMDD_HHMMSS/);
  });
});

describe('--judge (#282)', () => {
  test('absent or none: accepted, and not part of what prepareRun returns', () => {
    for (const judge of [undefined, 'none']) {
      const p = prepare({ file: write(scenario()), runId: RUN_ID, judge });
      expect(p.failure).toBeUndefined();
      expect(p).not.toHaveProperty('judge');
    }
  });

  test.each(['agent', 'llm', 'NONE', ''])('%j is invalid_input naming the accepted values', (value) => {
    const p = prepare({ file: write(scenario()), runId: RUN_ID, judge: value });
    expect(p.failure.exitKind).toBe('invalid_input');
    expect(p.failure.envelope.error.message).toBe(`unknown --judge "${value}"`);
    expect(p.failure.envelope.hint).toMatch(/Accepted: none\b/);
  });

  test('is checked before the scenario is read', () => {
    const bad = prepare({ file: path.join(root, 'missing.json'), runId: RUN_ID, judge: 'agent' });
    expect(bad.failure.envelope.error.message).toBe('unknown --judge "agent"');
  });
});

describe('--junit (#282)', () => {
  test('absent: junitPath is null', () => {
    expect(prepare({ file: write(scenario()), runId: RUN_ID }).junitPath).toBeNull();
  });

  test('resolved against cwd to an absolute path', () => {
    fs.mkdirSync(path.join(root, 'reports'));
    const p = prepare({ file: write(scenario()), runId: RUN_ID, junit: path.join('reports', 'r.xml'), cwd: root });
    expect(p.failure).toBeUndefined();
    expect(p.junitPath).toBe(path.join(root, 'reports', 'r.xml'));
  });

  test('a missing parent directory is invalid_input, before the scenario is read', () => {
    const p = prepare({ file: path.join(root, 'missing.json'), runId: RUN_ID, junit: 'nope/r.xml', cwd: root });
    expect(p.failure.exitKind).toBe('invalid_input');
    expect(p.failure.envelope.error.message).toBe(`--junit directory does not exist: ${path.join(root, 'nope')}`);
  });

  test('a parent that is a file is invalid_input', () => {
    fs.writeFileSync(path.join(root, 'afile'), 'x');
    const p = prepare({ file: write(scenario()), runId: RUN_ID, junit: 'afile/r.xml', cwd: root });
    expect(p.failure.exitKind).toBe('invalid_input');
    expect(p.failure.envelope.error.message).toBe(`--junit directory is not a directory: ${path.join(root, 'afile')}`);
  });

  test('a path that is itself a directory is invalid_input', () => {
    fs.mkdirSync(path.join(root, 'reports'));
    const p = prepare({ file: write(scenario()), runId: RUN_ID, junit: 'reports', cwd: root });
    expect(p.failure.exitKind).toBe('invalid_input');
    expect(p.failure.envelope.error.message).toBe(`--junit names a directory: ${path.join(root, 'reports')}`);
  });
});
