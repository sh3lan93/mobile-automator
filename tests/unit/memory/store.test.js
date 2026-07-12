'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { MemoryStore } = require('../../../src/memory/store');
const { memoryFile } = require('../../../src/memory/paths');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-mem-'));
}

function readHistory(root) {
  return fs.readFileSync(memoryFile(root, 'run-history'), 'utf8');
}

describe('MemoryStore.recordRun', () => {
  test('creates run-history.md and records a pass with observations', () => {
    const root = tmpRoot();
    const store = new MemoryStore({ projectRoot: root });
    store.recordRun({
      scenario_id: 'checkout_flow',
      status: 'passed',
      observations: [
        { type: 'flakiness', step_id: 'tap_pay', message: 'passed only after 2 attempts' },
      ],
    });
    const md = readHistory(root);
    expect(md).toContain('## checkout_flow  (last 5 runs: P)');
    expect(md).toContain('[observed] flakiness (tap_pay): passed only after 2 attempts');
  });

  test('a failed run appends F and accumulates across invocations', () => {
    const root = tmpRoot();
    new MemoryStore({ projectRoot: root }).recordRun({ scenario_id: 's', status: 'passed', observations: [] });
    new MemoryStore({ projectRoot: root }).recordRun({ scenario_id: 's', status: 'failed', observations: [] });
    expect(readHistory(root)).toContain('(last 5 runs: P F)');
  });

  test('missing scenario_id falls back to "unknown"', () => {
    const root = tmpRoot();
    new MemoryStore({ projectRoot: root }).recordRun({ status: 'passed', observations: [] });
    expect(readHistory(root)).toContain('## unknown  (last 5 runs: P)');
  });

  test('a pre-existing hand-edited / junk-laden file is tolerated (no throw) and still records the run', () => {
    const root = tmpRoot();
    const file = memoryFile(root, 'run-history');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      [
        '## broken (last 5 runs: P)',
        'not-a-note-line-but-ok',
        'some hand-typed rambling that is not a heading or a note',
        '',
      ].join('\n')
    );
    const store = new MemoryStore({ projectRoot: root });
    expect(() => store.recordRun({ scenario_id: 'x', status: 'passed', observations: [] })).not.toThrow();
    const md = readHistory(root);
    expect(md).toContain('## x  (last 5 runs: P)');
  });

  test('a non-ENOENT read failure is tolerated: no throw, a warning is recorded', () => {
    const root = tmpRoot();
    const store = new MemoryStore({ projectRoot: root });
    const spy = jest.spyOn(fs, 'readFileSync').mockImplementation(() => {
      const e = new Error('EACCES'); e.code = 'EACCES'; throw e;
    });
    try {
      expect(() => store.recordRun({ scenario_id: 'x', status: 'passed', observations: [] })).not.toThrow();
      expect(store.warnings.length).toBeGreaterThan(0);
      expect(store.warnings.join(' ')).toMatch(/unreadable/);
    } finally {
      spy.mockRestore();
    }
  });
});

describe('MemoryStore.render', () => {
  test('summarizes counts and includes run-history body', () => {
    const root = tmpRoot();
    const store = new MemoryStore({ projectRoot: root });
    store.recordRun({ scenario_id: 'checkout_flow', status: 'passed', observations: [
      { type: 'flakiness', step_id: 'tap_pay', message: 'flaky' },
    ] });
    const md = store.render();
    expect(md).toMatch(/mauto memory · run-history: 1 entrie/);
    expect(md).toContain('## checkout_flow');
    expect(md).toContain('app-knowledge: 0');
    expect(md).toContain('preferences: 0');
  });

  test('kind filter returns only that file', () => {
    const root = tmpRoot();
    const store = new MemoryStore({ projectRoot: root });
    store.recordRun({ scenario_id: 's', status: 'passed', observations: [] });
    const md = store.render({ kind: 'run-history' });
    expect(md).toContain('# Run History');
    expect(md).not.toContain('# App Knowledge');
  });

  test('scenario filter narrows run-history to one section', () => {
    const root = tmpRoot();
    const store = new MemoryStore({ projectRoot: root });
    store.recordRun({ scenario_id: 'a', status: 'passed', observations: [] });
    store.recordRun({ scenario_id: 'b', status: 'failed', observations: [] });
    const md = store.render({ scenario: 'b' });
    expect(md).toContain('## b');
    expect(md).not.toContain('## a');
  });

  test('cap truncates and notes it', () => {
    const root = tmpRoot();
    const store = new MemoryStore({ projectRoot: root });
    store.recordRun({ scenario_id: 's', status: 'passed', observations: [
      { type: 'state_context', message: 'x'.repeat(500) },
    ] });
    const md = store.render({ cap: 120 });
    expect(md.length).toBeLessThan(400);
    expect(md).toContain('… (truncated');
  });
});

describe('MemoryStore.add / forget', () => {
  test('add appends an [asserted] entry and creates the file with a header', () => {
    const root = tmpRoot();
    const store = new MemoryStore({ projectRoot: root });
    const r = store.add('app-knowledge', 'search bar needs ~500ms settle');
    expect(r).toEqual({ kind: 'app-knowledge', added: true, deduped: false });
    const md = fs.readFileSync(memoryFile(root, 'app-knowledge'), 'utf8');
    expect(md).toContain('# App Knowledge');
    expect(md).toMatch(/- \[\d{4}-\d{2}-\d{2}\]\[asserted\] search bar needs ~500ms settle/);
  });

  test('add de-dupes identical text (skips, reports deduped)', () => {
    const root = tmpRoot();
    new MemoryStore({ projectRoot: root }).add('preferences', 'always assert the toast');
    const r = new MemoryStore({ projectRoot: root }).add('preferences', 'always assert the toast');
    expect(r).toEqual({ kind: 'preferences', added: false, deduped: true });
    const md = fs.readFileSync(memoryFile(root, 'preferences'), 'utf8');
    expect(md.match(/always assert the toast/g)).toHaveLength(1);
  });

  test('add accumulates across store instances (one-shot process model)', () => {
    const root = tmpRoot();
    new MemoryStore({ projectRoot: root }).add('app-knowledge', 'fact one');
    new MemoryStore({ projectRoot: root }).add('app-knowledge', 'fact two');
    const md = fs.readFileSync(memoryFile(root, 'app-knowledge'), 'utf8');
    expect(md).toContain('fact one');
    expect(md).toContain('fact two');
  });

  test('forget removes entries whose text contains the substring', () => {
    const root = tmpRoot();
    const s = new MemoryStore({ projectRoot: root });
    s.add('app-knowledge', 'search bar needs a wait');
    s.add('app-knowledge', 'onboarding Skip is top-right');
    const r = new MemoryStore({ projectRoot: root }).forget('app-knowledge', 'search bar');
    expect(r).toEqual({ kind: 'app-knowledge', removed: 1 });
    const md = fs.readFileSync(memoryFile(root, 'app-knowledge'), 'utf8');
    expect(md).not.toContain('search bar');
    expect(md).toContain('onboarding Skip');
  });

  test('forget with no match removes nothing', () => {
    const root = tmpRoot();
    new MemoryStore({ projectRoot: root }).add('preferences', 'assert toast');
    const r = new MemoryStore({ projectRoot: root }).forget('preferences', 'nonexistent');
    expect(r).toEqual({ kind: 'preferences', removed: 0 });
  });
});
