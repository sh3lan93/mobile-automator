'use strict';

// #295: the result WRITE verbs build `results/<runId>.json` (and its lock) from
// --run-id, and atomicWrite creates parent directories, so an id with a path
// separator used to write outside results/ (`../../x`) or into a new
// subdirectory of it (`nightly/42`). The ResultStore constructor is now the one
// gate: it applies the reader's rule (isResultRunId, the gate `result export`
// uses) and throws InvalidRunIdError before touching the disk, which the CLI's
// toEnvelope maps to invalid_input. Each verb is invoked the way withEnvelope
// invokes it: a thrown error goes through toEnvelope.

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  handleResultAddStep,
  handleResultAddAssertion,
  handleResultAddCrash,
  handleResultFinalize,
  toEnvelope,
} = require('../../../src/cli');
const { ResultStore, InvalidRunIdError } = require('../../../src/result/store');
const { workspaceDir } = require('../../../src/workspace/layout');

function tmpRoot() {
  // A nested project root, so a `../../` id would still land inside the temp
  // dir we inspect — never somewhere real on the machine.
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-run-id-'));
  const root = path.join(base, 'a', 'project');
  fs.mkdirSync(path.join(workspaceDir(root), 'results'), { recursive: true });
  return { base, root };
}

// Every file under `dir`, relative to it — directories included, so a stray
// `results/nightly/` shows up even if it ended up empty.
function listTree(dir) {
  const out = [];
  const walk = (d) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      out.push(path.relative(dir, full) + (entry.isDirectory() ? '/' : ''));
      if (entry.isDirectory()) walk(full);
    }
  };
  walk(dir);
  return out.sort();
}

const factory = (args) => new ResultStore(args);

// What withEnvelope does with a handler: a returned result stands, a thrown
// error is classified by toEnvelope.
function invoke(fn) {
  try {
    return fn();
  } catch (err) {
    return toEnvelope(err);
  }
}

const VERBS = {
  'add-step': (root, runId) =>
    handleResultAddStep({ resultStoreFactory: factory, projectRoot: root }, { runId, stepId: 's1', status: 'pass' }),
  'add-assertion': (root, runId) =>
    handleResultAddAssertion(
      { resultStoreFactory: factory, projectRoot: root },
      { runId, stepId: 's1', type: 'element_visible', pass: 'true' }
    ),
  'add-crash': (root, runId) =>
    handleResultAddCrash({ resultStoreFactory: factory, projectRoot: root }, { runId, crashId: 'c1' }),
  finalize: (root, runId) =>
    handleResultFinalize({ resultStoreFactory: factory, memoryStoreFactory: null, projectRoot: root }, { runId, status: 'passed' }),
};

const BAD_IDS = [
  ['../escape', '../escape'],
  ['../../x', '../../x'],
  ['a/b', 'a/b'],
  ['an absolute path', '/tmp/mauto-295-abs'],
  ['an empty id', ''],
  ['a NUL-containing id', 'a\u0000b'],
];

describe.each(Object.keys(VERBS))('mauto result %s --run-id gate (#295)', (verb) => {
  test.each(BAD_IDS)('refuses %s with invalid_input and writes nothing', (_label, runId) => {
    const { base, root } = tmpRoot();
    const before = listTree(base);

    const r = invoke(() => VERBS[verb](root, runId));

    expect(r.exitKind).toBe('invalid_input');
    expect(r.envelope.ok).toBe(false);
    expect(r.envelope.error.kind).toBe('invalid_input');
    expect(listTree(base)).toEqual(before);
  });

  test('a separator-bearing id names the rule in the error and hint', () => {
    const { root } = tmpRoot();
    const r = invoke(() => VERBS[verb](root, 'nightly/42'));
    expect(r.envelope.error.message).toBe('invalid run id "nightly/42"');
    expect(r.envelope.hint).toBe(
      `A run id names a file in ${path.join(workspaceDir(root), 'results')}; it cannot contain a path separator.`
    );
  });

  test('an id outside the run_YYYYMMDD_HHMMSS pattern but with no separator is still accepted', () => {
    const { root } = tmpRoot();
    const r = VERBS[verb](root, 'ci-build-42');
    expect(r.envelope.ok).toBe(true);
    expect(fs.existsSync(path.join(workspaceDir(root), 'results', 'ci-build-42.json'))).toBe(true);
  });
});

describe('ResultStore constructor --run-id gate (#295)', () => {
  test.each(['../escape', 'a/b', '/abs', 'a\u0000b', '', undefined])('refuses %j with InvalidRunIdError', (runId) => {
    const { base, root } = tmpRoot();
    const before = listTree(base);
    let thrown;
    try {
      new ResultStore({ runId, projectRoot: root });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(InvalidRunIdError);
    expect(thrown.kind).toBe('invalid_input');
    expect(thrown.message).toBe(`invalid run id "${runId}"`);
    expect(listTree(base)).toEqual(before);
  });
});

describe('toEnvelope classifies InvalidRunIdError (#295)', () => {
  test('as invalid_input with the store\'s message and hint, not internal', () => {
    const err = new InvalidRunIdError('/proj', 'a/b');
    expect(toEnvelope(err)).toEqual({
      envelope: expect.objectContaining({
        ok: false,
        error: { kind: 'invalid_input', message: 'invalid run id "a/b"' },
        hint: `A run id names a file in ${path.join(workspaceDir('/proj'), 'results')}; it cannot contain a path separator.`,
      }),
      exitKind: 'invalid_input',
    });
  });
});
