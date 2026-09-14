'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { handleCrashList, handleCrashGet, buildProgram } = require('../../../src/cli');

const CRASHES = [
  { id: 'r-old', process: 'com.acme.app', timestamp: '2026-09-01T09:00:00.000Z' },
  { id: 'r-new', process: 'com.acme.app', timestamp: '2026-09-05T10:30:00.000Z' },
  { id: 'r-undated', process: 'com.acme.app', timestamp: null },
];

const bridgeReturning = (crashes) => ({ listCrashes: async () => crashes });

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-crash-verb-'));
}

describe('handleCrashList', () => {
  it('reports every crash when no watermark applies', async () => {
    const r = await handleCrashList({ deviceBridge: bridgeReturning(CRASHES), projectRoot: tmpRoot() });
    expect(r.exitKind).toBe('ok');
    expect(r.envelope.ok).toBe(true);
    expect(r.envelope.data.count).toBe(3);
    expect(r.envelope.data.since).toBeNull();
    expect(r.envelope.data.crashes.map((c) => c.id)).toEqual(['r-old', 'r-new', 'r-undated']);
  });

  it('scopes to --since and reports undated reports separately rather than dropping them', async () => {
    const r = await handleCrashList(
      { deviceBridge: bridgeReturning(CRASHES), projectRoot: tmpRoot() },
      { since: '2026-09-05T00:00:00.000Z' }
    );
    expect(r.envelope.data.crashes.map((c) => c.id)).toEqual(['r-new']);
    expect(r.envelope.data.since).toBe('2026-09-05T00:00:00.000Z');
    // Neither claimed as in-window nor silently discarded.
    expect(r.envelope.data.unattributed).toBe(1);
  });

  it('rejects an unparseable --since instead of silently listing everything', async () => {
    const r = await handleCrashList(
      { deviceBridge: bridgeReturning(CRASHES), projectRoot: tmpRoot() },
      { since: 'yesterday' }
    );
    expect(r.exitKind).toBe('invalid_input');
    expect(r.envelope.ok).toBe(false);
    expect(r.envelope.error.message).toMatch(/since/i);
  });

  it('fails loudly when the engine cannot look — never ok:true with an empty list', async () => {
    const bridge = {
      listCrashes: async () => {
        throw new Error('mobilecli is not available or not working properly');
      },
    };
    const r = await handleCrashList({ deviceBridge: bridge, projectRoot: tmpRoot() });
    expect(r.exitKind).toBe('device');
    expect(r.envelope.ok).toBe(false);
    expect(r.envelope.error.kind).toBe('device');
    expect(r.envelope.error.message).toMatch(/mobilecli is not available/);
    expect(r.envelope.hint).toMatch(/mauto devices/);
    // The hint must not teach the engine's vocabulary to the user.
    expect(r.envelope.hint).not.toMatch(/mobile_/);
  });

  it('reports an honest empty list when the device genuinely has none', async () => {
    const r = await handleCrashList({ deviceBridge: bridgeReturning([]), projectRoot: tmpRoot() });
    expect(r.exitKind).toBe('ok');
    expect(r.envelope.data).toEqual({ crashes: [], count: 0, since: null, unattributed: 0 });
  });
});

describe('handleCrashGet', () => {
  const REPORT = Array.from({ length: 300 }, (_, i) => `line ${i + 1}`).join('\n');
  const bridge = { getCrash: async () => REPORT };

  it('returns a bounded head by default and says so', async () => {
    const r = await handleCrashGet({ deviceBridge: bridge }, 'r1');
    expect(r.exitKind).toBe('ok');
    expect(r.envelope.data.crash_id).toBe('r1');
    expect(r.envelope.data.truncated).toBe(true);
    expect(r.envelope.data.report.split('\n')).toHaveLength(200);
    expect(r.envelope.data.report.startsWith('line 1')).toBe(true);
  });

  it('honours --full', async () => {
    const r = await handleCrashGet({ deviceBridge: bridge }, 'r1', { full: true });
    expect(r.envelope.data.truncated).toBe(false);
    expect(r.envelope.data.report.split('\n')).toHaveLength(300);
  });

  it('marks a short report untruncated', async () => {
    const r = await handleCrashGet({ deviceBridge: { getCrash: async () => 'boom' } }, 'r1');
    expect(r.envelope.data.truncated).toBe(false);
    expect(r.envelope.data.report).toBe('boom');
  });

  it('--out writes the FULL report to disk and returns the path, not the bytes', async () => {
    const dest = path.join(tmpRoot(), 'crash.txt');
    const r = await handleCrashGet({ deviceBridge: bridge }, 'r1', { out: dest });
    expect(r.exitKind).toBe('ok');
    expect(r.envelope.data.path).toBe(dest);
    expect(r.envelope.data).not.toHaveProperty('report');
    expect(fs.readFileSync(dest, 'utf8').split('\n')).toHaveLength(300);
  });

  it('reports an unwritable --out as an environment failure, not a device one', async () => {
    const r = await handleCrashGet({ deviceBridge: bridge }, 'r1', {
      out: path.join(tmpRoot(), 'no', 'such', 'dir', 'crash.txt'),
    });
    expect(r.exitKind).toBe('environment');
    expect(r.envelope.error.kind).toBe('environment');
  });

  it('propagates an engine failure as a device failure', async () => {
    const failing = {
      getCrash: async () => {
        throw new Error('crash report r1 not found');
      },
    };
    const r = await handleCrashGet({ deviceBridge: failing }, 'r1');
    expect(r.exitKind).toBe('device');
    expect(r.envelope.error.message).toMatch(/not found/);
  });
});

describe('gating', () => {
  const withEnv = (value, fn) => {
    const prev = process.env.MAUTO_OBSERVE;
    if (value === undefined) delete process.env.MAUTO_OBSERVE;
    else process.env.MAUTO_OBSERVE = value;
    try {
      return fn();
    } finally {
      if (prev === undefined) delete process.env.MAUTO_OBSERVE;
      else process.env.MAUTO_OBSERVE = prev;
    }
  };

  const hasCrash = () => Boolean(buildProgram().commands.find((c) => c.name() === 'crash'));

  it('does not register `crash` when the gate is unset', () => {
    expect(withEnv(undefined, hasCrash)).toBe(false);
  });

  it('registers `crash list` and `crash get` when MAUTO_OBSERVE=1', () => {
    withEnv('1', () => {
      const cmd = buildProgram().commands.find((c) => c.name() === 'crash');
      expect(cmd).toBeDefined();
      expect(cmd.commands.map((c) => c.name()).sort()).toEqual(['get', 'list']);
    });
  });

  // NOTE on a plan defect: the slice-4 plan's original version of this test
  // asserted `result add-crash` is registered regardless of the gate — but
  // `add-crash` is a Task 6 deliverable, not Task 4's, and this repo cannot
  // carry a knowingly-red test (a PreToolUse hook runs the full suite before
  // every Bash call, and a red tree would deadlock every task after this one).
  // What Task 4 CAN pin, and must, is the decision the plan was protecting:
  // the gate must never remove anything from `result`'s subcommand list,
  // because tests/lint/result-coverage.test.js:39 calls buildProgram() in a
  // plain (gate-unset) environment. Asserting the list is IDENTICAL whether
  // the gate is set or unset is true today and stays true once Task 6 adds
  // `add-crash` unconditionally. Task 6 should extend this test to also
  // assert the list contains `add-crash` by name.
  it('keeps `result`\'s subcommand list identical regardless of the gate', () => {
    const resultSubcommands = (value) =>
      withEnv(value, () => {
        const resultCmd = buildProgram().commands.find((c) => c.name() === 'result');
        return resultCmd.commands.map((c) => c.name()).sort();
      });
    expect(resultSubcommands('1')).toEqual(resultSubcommands(undefined));
  });
});
