'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { handleMemoryShow } = require('../../../src/cli');
const { MemoryStore } = require('../../../src/memory/store');

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
