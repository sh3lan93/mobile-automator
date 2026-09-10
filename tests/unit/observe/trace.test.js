'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

const { readTrace, deriveRun, pruneRunTraces, KEEP_RUN_TRACES } = require('../../../src/observe/trace');
const { MAX_LOG_BYTES } = require('../../../src/util/log-rotate');

function logsRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-trace-'));
  fs.mkdirSync(path.join(root, 'mobile-automator', '.logs'), { recursive: true });
  return root;
}

function writeTrace(root, runId, events) {
  const file = path.join(root, 'mobile-automator', '.logs', `run-${runId}.ndjson`);
  fs.writeFileSync(file, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return file;
}

const at = (iso, extra = {}) => ({ ts: iso, v: 1, src: 'cli', event: 'verb.end', ok: true, ...extra });

describe('readTrace', () => {
  it('returns null for a run that left no trace', () => {
    expect(readTrace(path.join(logsRoot(), 'nope.ndjson'))).toBeNull();
    expect(readTrace(null)).toBeNull();
  });

  // A trailing partial line is NORMAL, not corruption: a SIGKILLed process can
  // be interrupted mid-append, and the trace of a run that died is the trace
  // most worth reading.
  it('skips unparseable lines rather than failing', () => {
    const root = logsRoot();
    const file = path.join(root, 'mobile-automator', '.logs', 'run-x.ndjson');
    fs.writeFileSync(file, `${JSON.stringify(at('2026-09-05T10:00:00.000Z'))}\n{"ts":"2026-09`);
    const trace = readTrace(file);
    expect(trace.events).toHaveLength(1);
    expect(trace.truncated).toBe(false);
  });

  it('reports a trace that reached its cap', () => {
    const root = logsRoot();
    const file = path.join(root, 'mobile-automator', '.logs', 'run-x.ndjson');
    fs.writeFileSync(file, `${JSON.stringify(at('2026-09-05T10:00:00.000Z'))}\n`.padEnd(MAX_LOG_BYTES, ' '));
    expect(readTrace(file).truncated).toBe(true);
  });
});

describe('deriveRun', () => {
  it('measures the span between the first and last recorded event', () => {
    const root = logsRoot();
    const file = writeTrace(root, 'x', [
      at('2026-09-05T10:00:00.000Z', { verb: 'launch' }),
      at('2026-09-05T10:00:41.500Z', { verb: 'tap' }),
      at('2026-09-05T10:02:20.250Z', { verb: 'result' }),
    ]);
    const d = deriveRun(readTrace(file));
    expect(d.duration_seconds).toBe(140.25);
    expect(d.trace_events).toBe(3);
    expect(d.trace_truncated).toBe(false);
  });

  // Counted from the envelope's own taxonomy, which deviceFail is the only
  // producer of — so this needs no hand-maintained list of device verbs.
  it('counts device and timeout failures and nothing else', () => {
    const root = logsRoot();
    const file = writeTrace(root, 'x', [
      at('2026-09-05T10:00:00.000Z', { verb: 'tap', ok: false, error_kind: 'device' }),
      at('2026-09-05T10:00:05.000Z', { verb: 'type', ok: false, error_kind: 'timeout' }),
      at('2026-09-05T10:00:06.000Z', { verb: 'tap', ok: false, error_kind: 'invalid_input' }),
      at('2026-09-05T10:00:07.000Z', { verb: 'tap', ok: true }),
    ]);
    expect(deriveRun(readTrace(file)).device_failures).toBe(2);
  });

  it('collects the failure screenshots the capture recorded', () => {
    const root = logsRoot();
    const file = writeTrace(root, 'x', [
      at('2026-09-05T10:00:00.000Z'),
      { ts: '2026-09-05T10:00:01.000Z', event: 'screenshot.on_failure', path: '/p/a.png' },
      { ts: '2026-09-05T10:00:02.000Z', event: 'screenshot.capture_failed', message: 'boom' },
      at('2026-09-05T10:00:03.000Z'),
    ]);
    expect(deriveRun(readTrace(file)).failure_screenshots).toEqual(['/p/a.png']);
  });

  // Two stamps or nothing. A single-event trace spans zero time, and reporting
  // 0 as a MEASURED duration would be a confident lie where "we did not
  // measure" is the truth — finalize falls back to the reported value.
  it('refuses to measure a duration from fewer than two stamps', () => {
    const root = logsRoot();
    const file = writeTrace(root, 'x', [at('2026-09-05T10:00:00.000Z')]);
    const d = deriveRun(readTrace(file));
    expect(d.duration_seconds).toBeNull();
    expect(d.trace_events).toBe(1);
  });

  it('ignores events with a missing or unparseable timestamp', () => {
    const root = logsRoot();
    const file = writeTrace(root, 'x', [
      at('2026-09-05T10:00:00.000Z'),
      { event: 'verb.end', ok: true },
      { ts: 'not-a-date', event: 'verb.end', ok: true },
      at('2026-09-05T10:00:10.000Z'),
    ]);
    expect(deriveRun(readTrace(file)).duration_seconds).toBe(10);
  });

  it('returns null for no trace and for an empty one', () => {
    expect(deriveRun(null)).toBeNull();
    expect(deriveRun({ events: [], truncated: false })).toBeNull();
  });
});

describe('pruneRunTraces', () => {
  function seed(root, count) {
    const dir = path.join(root, 'mobile-automator', '.logs');
    for (let i = 0; i < count; i += 1) {
      const file = path.join(dir, `run-old${i}.ndjson`);
      fs.writeFileSync(file, '{}\n');
      // Oldest first, so the sort under test has something to sort.
      fs.utimesSync(file, new Date(1e9 + i * 1000), new Date(1e9 + i * 1000));
    }
  }

  it('keeps the most recent traces and deletes the rest', () => {
    const root = logsRoot();
    seed(root, KEEP_RUN_TRACES + 5);
    const removed = pruneRunTraces(root, { except: 'current', env: {} });
    const left = fs.readdirSync(path.join(root, 'mobile-automator', '.logs')).filter((n) => n.startsWith('run-'));
    expect(removed).toBe(6); // keep-1 slots, because `current` holds one
    expect(left).toHaveLength(KEEP_RUN_TRACES - 1);
    expect(left).toContain(`run-old${KEEP_RUN_TRACES + 4}.ndjson`);
    expect(left).not.toContain('run-old0.ndjson');
  });

  // The trace is the evidence behind every number finalize just wrote.
  it('never deletes the trace of the run being finalized', () => {
    const root = logsRoot();
    seed(root, KEEP_RUN_TRACES + 5);
    writeTrace(root, 'current', [at('2026-09-05T10:00:00.000Z')]);
    pruneRunTraces(root, { except: 'current', env: {} });
    expect(fs.existsSync(path.join(root, 'mobile-automator', '.logs', 'run-current.ndjson'))).toBe(true);
  });

  it('touches nothing that is not a run trace', () => {
    const root = logsRoot();
    const dir = path.join(root, 'mobile-automator', '.logs');
    fs.writeFileSync(path.join(dir, 'mauto.ndjson'), '{}\n');
    fs.writeFileSync(path.join(dir, 'daemon.ndjson'), '{}\n');
    fs.writeFileSync(path.join(dir, 'run-notes.txt'), 'x');
    seed(root, KEEP_RUN_TRACES + 3);

    pruneRunTraces(root, { except: 'current', env: {} });

    expect(fs.existsSync(path.join(dir, 'mauto.ndjson'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'daemon.ndjson'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'run-notes.txt'))).toBe(true);
  });

  it('is never load-bearing — a missing or unreadable logs dir is a no-op', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-trace-bare-'));
    expect(() => pruneRunTraces(bare, { except: 'x', env: {} })).not.toThrow();
    expect(pruneRunTraces(bare, { except: 'x', env: {} })).toBe(0);
  });
});
