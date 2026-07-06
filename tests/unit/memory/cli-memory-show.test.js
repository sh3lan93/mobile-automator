'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { handleMemoryShow, handleResultFinalize } = require('../../../src/cli');
const { MemoryStore } = require('../../../src/memory/store');
const { ResultStore } = require('../../../src/result/store');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-memshow-'));
}

const factory = (args) => new MemoryStore(args);

describe('handleMemoryShow', () => {
  test('emits raw markdown with the memory summary', () => {
    const root = tmpRoot();
    new MemoryStore({ projectRoot: root }).recordRun({ scenario_id: 's', status: 'passed', observations: [] });
    const r = handleMemoryShow({ memoryStoreFactory: factory, projectRoot: root }, {});
    expect(r.exitKind).toBe('ok');
    expect(typeof r.raw).toBe('string');
    expect(r.raw).toContain('# Run History');
    expect(r.raw).toContain('mauto memory ·');
  });

  test('rejects an unknown --kind with an invalid_input envelope', () => {
    const root = tmpRoot();
    const r = handleMemoryShow({ memoryStoreFactory: factory, projectRoot: root }, { kind: 'bogus' });
    expect(r.exitKind).toBe('invalid_input');
    expect(r.envelope.ok).toBe(false);
    expect(r.envelope.error.kind).toBe('invalid_input');
  });

  test('does not throw when --scenario contains a regex metacharacter', () => {
    const root = tmpRoot();
    new MemoryStore({ projectRoot: root }).recordRun({ scenario_id: 's', status: 'passed', observations: [] });
    const r = handleMemoryShow({ memoryStoreFactory: factory, projectRoot: root }, { scenario: 'a(b' });
    expect(r.exitKind).toBe('ok');
    expect(typeof r.raw).toBe('string');
  });
});

describe('result finalize auto-harvest', () => {
  test('result finalize auto-harvests into run-history', () => {
    const root = tmpRoot();
    const resultStoreFactory = (a) => new ResultStore(a);
    const memoryStoreFactory = (a) => new MemoryStore(a);

    // Record a flaky step so finalize carries an observation.
    const rs = resultStoreFactory({ runId: 'run_20260706_090000', scenarioId: 'login', projectRoot: root });
    rs.addStep({ step_id: 'tap_login', status: 'pass', attempts: 2 }); // flakiness observation

    const r = handleResultFinalize(
      { resultStoreFactory, memoryStoreFactory, projectRoot: root },
      { runId: 'run_20260706_090000', scenarioId: 'login', status: 'passed' }
    );
    expect(r.envelope.ok).toBe(true);

    const shown = handleMemoryShow({ memoryStoreFactory, projectRoot: root }, {}).raw;
    expect(shown).toContain('## login  (last 5 runs: P)');
    expect(shown).toContain('flakiness (tap_login)');
  });

  test('a throwing memoryStoreFactory.recordRun does not fail finalize', () => {
    const root = tmpRoot();
    const resultStoreFactory = (a) => new ResultStore(a);
    const memoryStoreFactory = () => ({
      recordRun() {
        throw new Error('boom');
      },
      warnings: [],
    });

    const r = handleResultFinalize(
      { resultStoreFactory, memoryStoreFactory, projectRoot: root },
      { runId: 'run_20260706_090001', scenarioId: 'login', status: 'passed' }
    );

    // (a) finalize still succeeded despite the memory-layer throw.
    expect(r.envelope.ok).toBe(true);

    // (b) the result file was actually written.
    const resultFile = path.join(root, 'mobile-automator', 'results', 'run_20260706_090001.json');
    expect(fs.existsSync(resultFile)).toBe(true);

    // (c) the throw was folded into the envelope hint, not swallowed.
    expect(r.envelope.hint).toMatch(/run-history not updated|boom/);
  });
});
