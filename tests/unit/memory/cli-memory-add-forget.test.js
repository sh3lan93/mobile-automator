'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { handleMemoryAdd, handleMemoryForget } = require('../../../src/cli');
const { MemoryStore } = require('../../../src/memory/store');
const { memoryFile } = require('../../../src/memory/paths');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-memaf-'));
}
const factory = (args) => new MemoryStore(args);

describe('handleMemoryAdd', () => {
  test('adds an entry and returns ok', () => {
    const root = tmpRoot();
    const r = handleMemoryAdd({ memoryStoreFactory: factory, projectRoot: root }, { kind: 'app-knowledge', text: 'tap Skip first' });
    expect(r.exitKind).toBe('ok');
    expect(r.envelope.ok).toBe(true);
    expect(r.envelope.data).toEqual({ kind: 'app-knowledge', added: true, deduped: false });
    expect(fs.readFileSync(memoryFile(root, 'app-knowledge'), 'utf8')).toContain('tap Skip first');
  });

  test('rejects run-history (not agent-authorable)', () => {
    const root = tmpRoot();
    const r = handleMemoryAdd({ memoryStoreFactory: factory, projectRoot: root }, { kind: 'run-history', text: 'x' });
    expect(r.exitKind).toBe('invalid_input');
    expect(r.envelope.error.kind).toBe('invalid_input');
  });

  test('rejects empty / {{ / too-long text with invalid_input', () => {
    const root = tmpRoot();
    for (const text of ['   ', 'has {{token}}', 'x'.repeat(501)]) {
      const r = handleMemoryAdd({ memoryStoreFactory: factory, projectRoot: root }, { kind: 'preferences', text });
      expect(r.exitKind).toBe('invalid_input');
    }
  });

  test('de-dupe reports ok with a skipped hint', () => {
    const root = tmpRoot();
    handleMemoryAdd({ memoryStoreFactory: factory, projectRoot: root }, { kind: 'preferences', text: 'assert toast' });
    const r = handleMemoryAdd({ memoryStoreFactory: factory, projectRoot: root }, { kind: 'preferences', text: 'assert toast' });
    expect(r.envelope.ok).toBe(true);
    expect(r.envelope.data.deduped).toBe(true);
    expect(r.envelope.hint).toMatch(/already present/);
  });
});

describe('handleMemoryForget', () => {
  test('removes matching entries and reports the count', () => {
    const root = tmpRoot();
    handleMemoryAdd({ memoryStoreFactory: factory, projectRoot: root }, { kind: 'app-knowledge', text: 'search bar wait' });
    const r = handleMemoryForget({ memoryStoreFactory: factory, projectRoot: root }, { kind: 'app-knowledge', match: 'search bar' });
    expect(r.exitKind).toBe('ok');
    expect(r.envelope.data).toEqual({ kind: 'app-knowledge', removed: 1 });
  });

  test('no match is a successful no-op with a hint', () => {
    const root = tmpRoot();
    const r = handleMemoryForget({ memoryStoreFactory: factory, projectRoot: root }, { kind: 'preferences', match: 'nope' });
    expect(r.envelope.ok).toBe(true);
    expect(r.envelope.data.removed).toBe(0);
    expect(r.envelope.hint).toMatch(/no matching entries/);
  });

  test('requires a non-empty --match', () => {
    const root = tmpRoot();
    const r = handleMemoryForget({ memoryStoreFactory: factory, projectRoot: root }, { kind: 'preferences', match: '' });
    expect(r.exitKind).toBe('invalid_input');
  });
});
