'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const { ResultStore } = require('../../../src/result/store');

const RESULT_SCHEMA_PATH = path.resolve(
  __dirname,
  '../../../src/schemas/result_schema.json'
);

function ajvValidator() {
  const schema = JSON.parse(fs.readFileSync(RESULT_SCHEMA_PATH, 'utf8'));
  const ajv = new Ajv({ allErrors: true, strict: false });
  return ajv.compile(schema);
}

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-store-'));
}

const RUN_ID = 'run_20260614_101500';

describe('ResultStore', () => {
  test('finalize assembles a result that conforms to result_schema.json', () => {
    const projectRoot = tmpRoot();
    const store = new ResultStore({ runId: RUN_ID, scenarioId: 'login_smoke', projectRoot });

    store.addStep({ step_id: 'launch', status: 'pass' });
    store.addStep({ step_id: 'tap_login', status: 'pass' });
    store.addAssertion({ step_id: 'launch', type: 'element_exists', pass: true, message: 'Login present' });
    store.addAssertion({ step_id: 'tap_login', type: 'element_text', pass: false, message: 'wrong text' });

    const result = store.finalize({ status: 'failed', durationSeconds: 12.5 });

    const validate = ajvValidator();
    const valid = validate(result);
    if (!valid) {
      // surface schema errors for debugging
      // eslint-disable-next-line no-console
      console.error(validate.errors);
    }
    expect(valid).toBe(true);

    expect(result.run_id).toBe(RUN_ID);
    expect(result.scenario_id).toBe('login_smoke');
    expect(result.status).toBe('failed');
    expect(result.duration_seconds).toBe(12.5);
    expect(result.steps_executed).toHaveLength(2);
  });

  test('maintains passed/failed/total assertion counts', () => {
    const store = new ResultStore({ runId: RUN_ID, scenarioId: 's', projectRoot: tmpRoot() });
    store.addAssertion({ step_id: 'a', type: 'element_exists', pass: true, message: 'ok' });
    store.addAssertion({ step_id: 'b', type: 'element_exists', pass: true, message: 'ok' });
    store.addAssertion({ step_id: 'c', type: 'element_exists', pass: false, message: 'no' });

    const result = store.finalize();
    expect(result.total_assertions).toBe(3);
    expect(result.passed_assertions).toBe(2);
    expect(result.failed_assertions).toBe(1);
  });

  test('records a flakiness observation when a passing step took more than one attempt', () => {
    const store = new ResultStore({ runId: RUN_ID, scenarioId: 's', projectRoot: tmpRoot() });
    store.addStep({ step_id: 'flaky_tap', status: 'pass', attempts: 3 });
    store.addStep({ step_id: 'steady', status: 'pass', attempts: 1 });

    const result = store.finalize();
    const flaky = result.observations.filter((o) => o.type === 'flakiness');
    expect(flaky).toHaveLength(1);
    expect(flaky[0].step_id).toBe('flaky_tap');
    expect(flaky[0].message).toMatch(/3/);
  });

  test('does not record flakiness for a step that ultimately failed even with retries', () => {
    const store = new ResultStore({ runId: RUN_ID, scenarioId: 's', projectRoot: tmpRoot() });
    store.addStep({ step_id: 'bad', status: 'fail', attempts: 4 });
    const result = store.finalize();
    expect(result.observations.filter((o) => o.type === 'flakiness')).toHaveLength(0);
  });

  test('writes the finalized result to <projectRoot>/mobile-automator/results/<runId>.json', () => {
    const projectRoot = tmpRoot();
    const store = new ResultStore({ runId: RUN_ID, scenarioId: 's', projectRoot });
    store.addStep({ step_id: 'launch', status: 'pass' });
    store.finalize({ status: 'passed' });

    const file = path.join(projectRoot, 'mobile-automator', 'results', `${RUN_ID}.json`);
    expect(fs.existsSync(file)).toBe(true);
    const onDisk = JSON.parse(fs.readFileSync(file, 'utf8'));
    expect(onDisk.run_id).toBe(RUN_ID);
  });

  test('reloads an in-progress file across separate instances (incremental updates)', () => {
    const projectRoot = tmpRoot();

    const a = new ResultStore({ runId: RUN_ID, scenarioId: 's', projectRoot });
    a.addStep({ step_id: 'launch', status: 'pass' });

    // A fresh process / instance picks up where the first left off.
    const b = new ResultStore({ runId: RUN_ID, scenarioId: 's', projectRoot });
    b.addStep({ step_id: 'tap', status: 'pass' });

    const result = b.finalize({ status: 'passed' });
    expect(result.steps_executed.map((s) => s.step_id)).toEqual(['launch', 'tap']);
  });

  // --- Atomicity & corruption recovery (#119) ----------------------------

  function resultsDir(projectRoot) {
    return path.join(projectRoot, 'mobile-automator', 'results');
  }

  test('a corrupt result file is preserved as a .corrupt sidecar and surfaced as a warning, not silently emptied', () => {
    const projectRoot = tmpRoot();
    const dir = resultsDir(projectRoot);
    fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, `${RUN_ID}.json`);
    const garbage = '{ "steps_executed": [ {"step_id": "launch"  <<< TRUNCATED';
    fs.writeFileSync(file, garbage);

    const store = new ResultStore({ runId: RUN_ID, scenarioId: 's', projectRoot });

    // The corrupt bytes must survive somewhere — never silently clobbered.
    const sidecars = fs
      .readdirSync(dir)
      .filter((f) => f.startsWith(`${RUN_ID}.json.corrupt.`));
    expect(sidecars).toHaveLength(1);
    expect(fs.readFileSync(path.join(dir, sidecars[0]), 'utf8')).toBe(garbage);

    // The store surfaces the corruption via its structured, envelope-threadable
    // channel (the model stays print-free — no console spy needed).
    expect(store.warnings.length).toBeGreaterThan(0);
    expect(store.warnings.join(' ')).toMatch(/corrupt/i);

    // It starts a fresh, valid accumulator rather than carrying garbage forward.
    store.addStep({ step_id: 'launch', status: 'pass' });
    const result = store.finalize({ status: 'passed' });
    const validate = ajvValidator();
    expect(validate(result)).toBe(true);
    expect(result.steps_executed.map((s) => s.step_id)).toEqual(['launch']);
  });

  test('a missing file (ENOENT) is a clean first step — no warning, no sidecar', () => {
    const projectRoot = tmpRoot();
    const store = new ResultStore({ runId: RUN_ID, scenarioId: 's', projectRoot });
    expect(store.warnings).toEqual([]);

    store.addStep({ step_id: 'launch', status: 'pass' });
    const dir = resultsDir(projectRoot);
    const sidecars = fs.readdirSync(dir).filter((f) => f.includes('.corrupt.'));
    expect(sidecars).toHaveLength(0);
  });

  test('leaves no .tmp residue after a normal write', () => {
    const projectRoot = tmpRoot();
    const store = new ResultStore({ runId: RUN_ID, scenarioId: 's', projectRoot });
    store.addStep({ step_id: 'launch', status: 'pass' });
    store.addAssertion({ step_id: 'launch', type: 'element_exists', pass: true, message: 'ok' });
    store.finalize({ status: 'passed' });

    const dir = resultsDir(projectRoot);
    const entries = fs.readdirSync(dir);
    expect(entries.filter((f) => f.includes('.tmp'))).toEqual([]);
    // Only the canonical result file remains.
    expect(entries).toEqual([`${RUN_ID}.json`]);
  });

  describe('addObservation', () => {
    function freshStore() {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-obs-'));
      return new ResultStore({ runId: 'run_20260804_090000', scenarioId: 'obs', projectRoot });
    }

    test('appends a typed entry to the ROOT observations array', () => {
      const store = freshStore();
      store.addStep({ step_id: 'verify', status: 'fail' });
      store.addObservation({ type: 'regression', step_id: 'verify', message: 'logo is gone' });

      const result = store.finalize({ status: 'failed' });
      expect(result.observations).toContainEqual({
        type: 'regression', step_id: 'verify', message: 'logo is gone',
      });
    });

    test('does not touch the deprecated step-level observations string', () => {
      const store = freshStore();
      store.addStep({ step_id: 'verify', status: 'fail' });
      store.addObservation({ type: 'state_context', step_id: 'verify', message: 'dark mode' });

      const result = store.finalize({ status: 'failed' });
      expect(result.steps_executed[0].observations).toBeNull();
    });

    test('defaults step_id to null when the observation is run-wide', () => {
      const store = freshStore();
      store.addObservation({ type: 'flakiness', message: 'network was slow throughout' });
      expect(store.finalize({ status: 'passed' }).observations[0].step_id).toBeNull();
    });

    test('coexists with the auto-derived flakiness observation', () => {
      const store = freshStore();
      store.addStep({ step_id: 'tap_login', status: 'pass', attempts: 2 });
      store.addObservation({ type: 'regression', step_id: 'tap_login', message: 'banner missing' });

      const types = store.finalize({ status: 'passed' }).observations.map((o) => o.type);
      expect(types).toEqual(['flakiness', 'regression']);
    });

    test('throws on an unknown type rather than persisting it', () => {
      const store = freshStore();
      expect(() => store.addObservation({ type: 'typo', message: 'x' })).toThrow(/unknown observation type/);
      expect(store.finalize({ status: 'passed' }).observations).toEqual([]);
    });

    test('survives across store instances (one-shot CLI invocations)', () => {
      const projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-obs-'));
      const runId = 'run_20260804_091500';
      new ResultStore({ runId, scenarioId: 'obs', projectRoot })
        .addObservation({ type: 'regression', step_id: 'a', message: 'first process' });

      const second = new ResultStore({ runId, scenarioId: 'obs', projectRoot });
      second.addObservation({ type: 'state_context', step_id: 'b', message: 'second process' });

      expect(second.finalize({ status: 'passed' }).observations).toHaveLength(2);
    });

    test('throws when message is missing rather than persisting it', () => {
      const store = freshStore();
      expect(() => store.addObservation({ type: 'regression', step_id: 'a' })).toThrow(/message/i);
      expect(store.finalize({ status: 'passed' }).observations).toEqual([]);
    });

    test('throws when message is whitespace-only rather than persisting it', () => {
      const store = freshStore();
      expect(() => store.addObservation({ type: 'regression', step_id: 'a', message: '   ' })).toThrow(/message/i);
      expect(store.finalize({ status: 'passed' }).observations).toEqual([]);
    });

    test('coerces a numeric message to a string', () => {
      const store = freshStore();
      store.addObservation({ type: 'regression', step_id: 'a', message: 42 });
      const result = store.finalize({ status: 'passed' });
      expect(result.observations[0].message).toBe('42');
      expect(typeof result.observations[0].message).toBe('string');
    });
  });

  describe('measurements', () => {
    const root = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-measure-'));

    const measured = (over = {}) => ({
      source: 'trace',
      reported_duration_seconds: 30,
      duration_disagreement: false,
      trace_events: 12,
      device_failures: 0,
      trace_truncated: false,
      failure_screenshots: [],
      ...over,
    });

    it('writes the measurement block when one is supplied', () => {
      const store = new ResultStore({ runId: 'run_20260905_000001', scenarioId: 's', projectRoot: root() });
      store.addStep({ step_id: 'a', status: 'pass' });
      const result = store.finalize({ durationSeconds: 140.25, measurements: measured() });
      expect(result.duration_seconds).toBe(140.25);
      expect(result.measurements).toMatchObject({ source: 'trace', trace_events: 12 });
    });

    // A run with no trace must produce a file shaped exactly as 0.24.0 wrote it,
    // so an absent measurement is OMITTED rather than emitted as an empty
    // placeholder object.
    it('omits the key entirely when there is nothing measured', () => {
      const store = new ResultStore({ runId: 'run_20260905_000002', scenarioId: 's', projectRoot: root() });
      store.addStep({ step_id: 'a', status: 'pass' });
      const result = store.finalize({ durationSeconds: 30 });
      expect(result).not.toHaveProperty('measurements');
    });

    // Disagreements land in the TYPED observation array as well as in
    // `measurements`, because src/memory/store.js harvests observations into
    // run-history — so a scenario whose reported durations are chronically wrong
    // becomes a cross-session fact rather than a per-file one.
    it('notes a duration disagreement as a typed observation', () => {
      const store = new ResultStore({ runId: 'run_20260905_000003', scenarioId: 's', projectRoot: root() });
      store.addStep({ step_id: 'a', status: 'pass' });
      const result = store.finalize({
        durationSeconds: 140.25,
        measurements: measured({ duration_disagreement: true, reported_duration_seconds: 30 }),
      });
      const note = result.observations.find((o) => o.type === 'state_context');
      expect(note.message).toContain('30');
      expect(note.message).toContain('140.25');
    });

    it('notes under-reported retries when the device failed and no step admits it', () => {
      const store = new ResultStore({ runId: 'run_20260905_000004', scenarioId: 's', projectRoot: root() });
      store.addStep({ step_id: 'a', status: 'pass', attempts: 1 });
      const result = store.finalize({ durationSeconds: 10, measurements: measured({ device_failures: 3 }) });
      const note = result.observations.find((o) => o.type === 'flakiness');
      expect(note.message).toContain('3 device call');
    });

    it('stays quiet when the reported attempts already account for the failures', () => {
      const store = new ResultStore({ runId: 'run_20260905_000005', scenarioId: 's', projectRoot: root() });
      store.addStep({ step_id: 'a', status: 'pass', attempts: 3 });
      const result = store.finalize({ durationSeconds: 10, measurements: measured({ device_failures: 2 }) });
      expect(result.observations.filter((o) => o.message.includes('device call'))).toEqual([]);
    });

    // finalize is re-runnable — the guide tells an agent to retry a failed one.
    it('does not stack duplicate notes when finalize runs twice', () => {
      const projectRoot = root();
      const args = { runId: 'run_20260905_000006', scenarioId: 's', projectRoot };
      new ResultStore(args).addStep({ step_id: 'a', status: 'pass' });
      const m = measured({ duration_disagreement: true });
      new ResultStore(args).finalize({ durationSeconds: 140.25, measurements: m });
      const second = new ResultStore(args).finalize({ durationSeconds: 140.25, measurements: m });
      expect(second.observations.filter((o) => o.type === 'state_context')).toHaveLength(1);
    });
  });

  describe('addCrash', () => {
    const newStore = (runId) =>
      new ResultStore({ runId, scenarioId: 'login', projectRoot: tmpRoot() });

    it('records a crash and carries it into the finalized result', () => {
      const store = newStore('run_20260905_000001');
      store.addStep({ step_id: 'step_3', status: 'fail' });
      store.addCrash({
        crash_id: 'r1',
        process: 'com.acme.app',
        timestamp: '2026-09-05T10:30:00.000Z',
        step_id: 'step_3',
        excerpt: 'FATAL EXCEPTION: main',
        report_path: 'mobile-automator/results/r1.txt',
      });
      const result = store.finalize({});
      expect(result.crashes).toEqual([
        {
          crash_id: 'r1',
          process: 'com.acme.app',
          timestamp: '2026-09-05T10:30:00.000Z',
          step_id: 'step_3',
          excerpt: 'FATAL EXCEPTION: main',
          report_path: 'mobile-automator/results/r1.txt',
          detected_at: expect.any(String),
        },
      ]);
    });

    it('omits `crashes` entirely when there were none — a clean run is byte-identical to today', () => {
      const store = newStore('run_20260905_000002');
      store.addStep({ step_id: 'step_1', status: 'pass' });
      expect(store.finalize({})).not.toHaveProperty('crashes');
    });

    it('requires a crash_id, because without it the full report is unreachable', () => {
      const store = newStore('run_20260905_000003');
      expect(() => store.addCrash({ process: 'com.acme.app' })).toThrow(/crash_id/i);
    });

    it('caps the excerpt at 2000 chars in the STORE, not in the caller', () => {
      // A result file gets read into an agent's context and committed to repos.
      // Trusting the caller to bound a native tombstone is how a 60KB blob ends
      // up inline in JSON forever.
      const store = newStore('run_20260905_000004');
      store.addCrash({ crash_id: 'r1', excerpt: 'x'.repeat(5000) });
      const result = store.finalize({});
      expect(result.crashes[0].excerpt).toHaveLength(2000);
      expect(result.crashes[0].excerpt.startsWith('xx')).toBe(true);
    });

    it('survives the one-shot process boundary via the in-progress file', () => {
      const root = tmpRoot();
      const opts = { runId: 'run_20260905_000005', scenarioId: 'login', projectRoot: root };
      new ResultStore(opts).addCrash({ crash_id: 'r1', process: 'com.acme.app' });
      // A separate process would construct a fresh store against the same root.
      const result = new ResultStore(opts).finalize({});
      expect(result.crashes.map((c) => c.crash_id)).toEqual(['r1']);
    });

    it('nulls the optional fields rather than dropping them, so the shape is stable', () => {
      const store = newStore('run_20260905_000006');
      store.addCrash({ crash_id: 'r1' });
      const [crash] = store.finalize({}).crashes;
      expect(crash.process).toBeNull();
      expect(crash.timestamp).toBeNull();
      expect(crash.step_id).toBeNull();
      expect(crash.excerpt).toBeNull();
      expect(crash.report_path).toBeNull();
    });
  });
});
