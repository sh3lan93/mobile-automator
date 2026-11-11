'use strict';

// ResultStore provenance (#275): assertion type/step/mechanical/judge,
// `needs_agent` entries and their in-place upsert, never-downgrade, the
// `executor` block, and the read-only `recorded()` snapshot.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { ResultStore, AlreadyDecidedError } = require('../../../src/result/store');
const { createCliAjv } = require('../../../src/schemas/cli-ajv');
const schema = require('../../../src/schemas/result_schema.json');

let n = 0;
function newStore(extra = {}) {
  n += 1;
  const projectRoot = extra.projectRoot || fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-prov-'));
  return new ResultStore({
    runId: `run_20261111_1300${String(n).padStart(2, '0')}`,
    scenarioId: 'prov',
    projectRoot,
    ...extra,
  });
}
const reopen = (store) => new ResultStore({ runId: store.runId, projectRoot: store.projectRoot });
const readFile = (store) => JSON.parse(fs.readFileSync(store.file, 'utf8'));

const validate = (() => {
  const ajv = createCliAjv();
  ajv.addFormat('date-time', true);
  return ajv.compile(schema);
})();

const EXECUTOR = Object.freeze({
  kind: 'runner',
  mauto_version: '0.40.0',
  engine: 'mobilecli',
  platform: 'android',
  device_id: 'emulator-5554',
  scenario_path: 'scenarios/s.json',
  scenario_sha256: 'a'.repeat(64),
  mode: 'platform-aware',
});

describe('addAssertion persists provenance fields (#275)', () => {
  test('type, step_id and a derived mechanical land in the entry', () => {
    const store = newStore();
    const tier1 = store.addAssertion({ step_id: 's1', assertion_id: 'a1', type: 'element_exists', pass: true });
    const tier2 = store.addAssertion({ step_id: 's1', assertion_id: 'a2', type: 'visual_state', pass: false });
    expect(tier1).toMatchObject({ type: 'element_exists', step_id: 's1', mechanical: true });
    expect(tier2).toMatchObject({ type: 'visual_state', step_id: 's1', mechanical: false });
    expect(readFile(store).assertion_results).toEqual([tier1, tier2]);
  });

  test('an explicit mechanical wins over the derived one', () => {
    const store = newStore();
    expect(store.addAssertion({ assertion_id: 'a', type: 'element_exists', pass: true, mechanical: false }).mechanical).toBe(false);
  });

  test('a non-boolean mechanical throws instead of being coerced', () => {
    const store = newStore();
    expect(() => store.addAssertion({ assertion_id: 'a', type: 'element_exists', pass: true, mechanical: 'yes' }))
      .toThrow(/mechanical must be a boolean/);
  });

  test('no type: neither type nor mechanical is written', () => {
    const store = newStore();
    const entry = store.addAssertion({ step_id: 's1', assertion_id: 'a', pass: true });
    expect(entry).not.toHaveProperty('type');
    expect(entry).not.toHaveProperty('mechanical');
  });

  test('judge is written when given and omitted otherwise', () => {
    const store = newStore();
    expect(store.addAssertion({ assertion_id: 'a', type: 'element_exists', pass: true, judge: { by: 'agent' } }).judge)
      .toEqual({ by: 'agent' });
    expect(store.addAssertion({ assertion_id: 'b', type: 'element_exists', pass: true })).not.toHaveProperty('judge');
  });

  test('pass: pending records needs_agent', () => {
    const store = newStore();
    const entry = store.addAssertion({ step_id: 's1', assertion_id: 'a', type: 'visual_state', pass: 'pending', judge: { by: 'none' } });
    expect(entry.status).toBe('needs_agent');
    expect(entry.judge).toEqual({ by: 'none' });
  });
});

describe('needs_agent upsert and never-downgrade (#275)', () => {
  test('a decided verdict replaces the needs_agent entry in place', () => {
    const store = newStore();
    store.addAssertion({ assertion_id: 'first', type: 'element_exists', pass: true });
    store.addAssertion({ assertion_id: 'judged', type: 'visual_state', pass: 'pending', judge: { by: 'none' } });
    store.addAssertion({ assertion_id: 'last', type: 'element_exists', pass: true });

    const later = reopen(store);
    const decided = later.addAssertion({
      step_id: 's1', assertion_id: 'judged', type: 'visual_state', pass: true, judge: { by: 'agent' }, message: 'looks right',
    });

    const ids = readFile(store).assertion_results.map((a) => a.assertion_id);
    expect(ids).toEqual(['first', 'judged', 'last']);
    expect(readFile(store).assertion_results[1]).toEqual(decided);
    expect(decided).toMatchObject({ status: 'passed', judge: { by: 'agent' }, message: 'looks right' });
  });

  test('pending over a decided entry throws AlreadyDecidedError and writes nothing', () => {
    const store = newStore();
    store.addAssertion({ assertion_id: 'a', type: 'element_exists', pass: false });
    const before = fs.readFileSync(store.file, 'utf8');
    let err;
    try {
      store.addAssertion({ assertion_id: 'a', type: 'element_exists', pass: 'pending' });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(AlreadyDecidedError);
    expect(err.kind).toBe('invalid_input');
    expect(err.message).toMatch(/"a" is already decided \(failed\)/);
    expect(fs.readFileSync(store.file, 'utf8')).toBe(before);
  });

  test('pending over pending replaces in place rather than duplicating', () => {
    const store = newStore();
    store.addAssertion({ assertion_id: 'a', type: 'visual_state', pass: 'pending', message: 'one' });
    store.addAssertion({ assertion_id: 'a', type: 'visual_state', pass: 'pending', message: 'two' });
    const all = readFile(store).assertion_results;
    expect(all).toHaveLength(1);
    expect(all[0].message).toBe('two');
  });

  test('decided over decided appends, as before', () => {
    const store = newStore();
    store.addAssertion({ assertion_id: 'a', type: 'element_exists', pass: false });
    store.addAssertion({ assertion_id: 'a', type: 'element_exists', pass: true });
    expect(readFile(store).assertion_results.map((a) => a.status)).toEqual(['failed', 'passed']);
  });

  test('a derived id never upserts: two id-less entries both append', () => {
    const store = newStore();
    store.addAssertion({ step_id: 's1', type: 'visual_state', pass: 'pending' });
    store.addAssertion({ step_id: 's1', type: 'visual_state', pass: true });
    const all = readFile(store).assertion_results;
    expect(all.map((a) => a.status)).toEqual(['needs_agent', 'passed']);
    expect(all[0].assertion_id).not.toBe(all[1].assertion_id);
  });
});

describe('finalize with pending entries (#275)', () => {
  test('counts and summary name the pending ones; status incomplete; schema-valid', () => {
    const store = newStore();
    store.addStep({ step_id: 's1', status: 'pass' });
    store.addAssertion({ step_id: 's1', assertion_id: 'a', type: 'element_exists', pass: true });
    store.addAssertion({ step_id: 's1', assertion_id: 'b', type: 'visual_state', pass: 'pending' });
    store.addAssertion({ step_id: 's1', assertion_id: 'c', type: 'visual_state', pass: 'pending' });
    const result = store.finalize({});
    expect(result.status).toBe('incomplete');
    expect(result).toMatchObject({ total_assertions: 3, passed_assertions: 1, failed_assertions: 0 });
    expect(result.summary).toBe('incomplete: 1/3 assertion(s) passed across 1 step(s), 2 pending agent judgment.');
    expect(validate(result)).toBe(true);
  });

  test('no pending: the summary is unchanged', () => {
    const store = newStore();
    store.addStep({ step_id: 's1', status: 'pass' });
    expect(store.finalize({}).summary).toBe('passed: 0/0 assertion(s) passed across 1 step(s).');
  });

  test('deciding the pending ones and re-finalizing passes', () => {
    const store = newStore();
    store.addAssertion({ step_id: 's1', assertion_id: 'b', type: 'visual_state', pass: 'pending' });
    expect(store.finalize({}).status).toBe('incomplete');
    const later = reopen(store);
    later.addAssertion({ step_id: 's1', assertion_id: 'b', type: 'visual_state', pass: true, judge: { by: 'agent' } });
    const result = later.finalize({});
    expect(result.status).toBe('passed');
    expect(result.total_assertions).toBe(1);
  });
});

describe('executor (#275)', () => {
  test('finalize writes it; it survives add-assertion and re-finalize unchanged', () => {
    const store = newStore();
    store.addAssertion({ step_id: 's1', assertion_id: 'b', type: 'visual_state', pass: 'pending' });
    expect(store.finalize({ executor: EXECUTOR }).executor).toEqual(EXECUTOR);

    const later = reopen(store);
    later.addAssertion({ step_id: 's1', assertion_id: 'b', type: 'visual_state', pass: true, judge: { by: 'agent' } });
    expect(readFile(store).executor).toEqual(EXECUTOR);

    const agent = { ...EXECUTOR, kind: 'agent', platform: null, device_id: null };
    const result = reopen(store).finalize({ executor: agent });
    expect(result.executor).toEqual(EXECUTOR);
    expect(validate(result)).toBe(true);
  });

  test('a first executor without a scenario gains one from a later finalize, and nothing else', () => {
    const store = newStore();
    const bare = { ...EXECUTOR, kind: 'agent', scenario_path: null, scenario_sha256: null };
    store.finalize({ executor: bare });
    const result = reopen(store).finalize({
      executor: { ...EXECUTOR, kind: 'runner', mode: 'platform-agnostic', scenario_path: 'x.json', scenario_sha256: 'b'.repeat(64) },
    });
    expect(result.executor).toEqual({ ...bare, scenario_path: 'x.json', scenario_sha256: 'b'.repeat(64) });
  });

  test('no executor anywhere: the field is absent', () => {
    const store = newStore();
    expect(store.finalize({})).not.toHaveProperty('executor');
  });
});

describe('recorded() (#275)', () => {
  test('is a snapshot of what the run recorded', () => {
    const store = newStore();
    store.addStep({ step_id: 's1', status: 'pass' });
    store.addAssertion({ step_id: 's1', assertion_id: 'a', type: 'element_exists', pass: true });
    store.finalize({ executor: EXECUTOR });
    const snap = reopen(store).recorded();
    expect(snap.scenario_id).toBe('prov');
    expect(snap.steps.map((s) => s.step_id)).toEqual(['s1']);
    expect(snap.assertions.map((a) => a.assertion_id)).toEqual(['a']);
    expect(snap.executor).toEqual(EXECUTOR);
  });

  test('mutating the snapshot does not touch the store', () => {
    const store = newStore();
    store.addStep({ step_id: 's1', status: 'pass' });
    const snap = store.recorded();
    snap.steps.push({ step_id: 'x' });
    snap.steps[0].step_id = 'changed';
    expect(store.recorded().steps).toEqual([expect.objectContaining({ step_id: 's1' })]);
  });

  test('executor is null before any finalize', () => {
    expect(newStore().recorded().executor).toBeNull();
  });
});
