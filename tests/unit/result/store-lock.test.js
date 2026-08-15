'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

const { ResultStore } = require('../../../src/result/store');
const { acquire, release } = require('../../../src/util/lock');

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-store-lock-'));
}

function resultsDir(projectRoot) {
  return path.join(projectRoot, 'mobile-automator', 'results');
}

function readResult(projectRoot, runId) {
  return JSON.parse(fs.readFileSync(path.join(resultsDir(projectRoot), `${runId}.json`), 'utf8'));
}

// The result store is written by one-shot CLI processes, so two concurrent
// `result add-step` invocations for the same runId are two separate
// ResultStore instances. Each mutator must be a full read-modify-write under a
// per-runId advisory lock — otherwise both instances load the same stale
// snapshot and the last rename wins, silently dropping the other's step.
describe('ResultStore cross-process mutual exclusion (per-runId advisory lock)', () => {
  test('two instances mutating the same run do not lose updates (both steps persist)', () => {
    const projectRoot = tmpRoot();
    const runId = 'run_lock_1';

    // Both eager-load the same empty snapshot, like two concurrent one-shot
    // `result add-step` processes.
    const a = new ResultStore({ runId, projectRoot });
    const b = new ResultStore({ runId, projectRoot });

    a.addStep({ step_id: 's1', status: 'pass' });
    b.addStep({ step_id: 's2', status: 'pass' });

    const onDisk = readResult(projectRoot, runId);
    expect(onDisk.steps_executed.map((s) => s.step_id)).toEqual(['s1', 's2']);
  });

  test('finalize re-reads under the lock, so a racing add-step is not clobbered', () => {
    const projectRoot = tmpRoot();
    const runId = 'run_lock_2';

    const a = new ResultStore({ runId, projectRoot });
    const b = new ResultStore({ runId, projectRoot });

    a.addStep({ step_id: 's1', status: 'pass' });
    b.finalize({ status: 'passed', summary: 'done' });

    const onDisk = readResult(projectRoot, runId);
    expect(onDisk.steps_executed.map((s) => s.step_id)).toEqual(['s1']);
  });

  test('different runIds use independent locks (per-runId, not global)', () => {
    const projectRoot = tmpRoot();
    const a = new ResultStore({ runId: 'r1', projectRoot });
    const b = new ResultStore({ runId: 'r2', projectRoot });

    // Back-to-back mutations in one process: both persist.
    a.addStep({ step_id: 's1', status: 'pass' });
    b.addStep({ step_id: 's2', status: 'pass' });
    expect(readResult(projectRoot, 'r1').steps_executed.map((s) => s.step_id)).toEqual(['s1']);
    expect(readResult(projectRoot, 'r2').steps_executed.map((s) => s.step_id)).toEqual(['s2']);

    // The lock is keyed per runId: acquiring r1's lock must not make r2's
    // lock wait. Injected now/sleep prove no sleep occurred — the virtual
    // clock never advances (mirrors the memory lock tests' injection seams).
    const r1Lock = path.join(resultsDir(projectRoot), 'r1.lock');
    const r2Lock = path.join(resultsDir(projectRoot), 'r2.lock');
    let now = 1000;
    const clock = () => now;
    const sleep = () => {
      now += 100;
    };
    acquire(r1Lock, { now: clock, sleep });
    acquire(r2Lock, { now: clock, sleep });
    expect(now).toBe(1000);
    release(r1Lock);
    release(r2Lock);

    // Store-level proof: while r1's lock is held (a concurrent process
    // mid-write on r1), a mutator on r2 proceeds without blocking.
    acquire(r1Lock);
    try {
      b.addStep({ step_id: 's3', status: 'pass' });
    } finally {
      release(r1Lock);
    }
    expect(readResult(projectRoot, 'r2').steps_executed.map((s) => s.step_id)).toEqual(['s2', 's3']);
  });

  test('releases the lock when a mutator throws after acquire', () => {
    const projectRoot = tmpRoot();
    const runId = 'run_lock_3';
    const store = new ResultStore({ runId, projectRoot });
    const lockFile = path.join(resultsDir(projectRoot), `${runId}.lock`);

    // addObservation validates AFTER the lock is acquired; the throw must not
    // leave the lockfile behind (or the next mutator would deadlock).
    expect(() => store.addObservation({ type: 'typo', message: 'x' })).toThrow(/unknown observation type/);
    expect(fs.existsSync(lockFile)).toBe(false);

    // The store still works afterward — no deadlock.
    store.addStep({ step_id: 's1', status: 'pass' });
    expect(fs.existsSync(lockFile)).toBe(false);
    expect(readResult(projectRoot, runId).steps_executed.map((s) => s.step_id)).toEqual(['s1']);
  });
});

describe('selection.json atomic write', () => {
  test('selection.write persists via atomicWrite (tmp+rename), never a torn file', () => {
    const projectRoot = tmpRoot();
    const selection = require('../../../src/device/selection');

    selection.write(projectRoot, 'emulator-5554');
    expect(JSON.parse(fs.readFileSync(selection.selectionPath(projectRoot), 'utf8'))).toEqual({
      device: 'emulator-5554',
    });

    // atomicWrite's tmp+rename contract: no .tmp residue survives a write.
    const sessionDir = path.join(projectRoot, 'mobile-automator', '.session');
    const entries = fs.readdirSync(sessionDir);
    expect(entries.filter((f) => f.includes('.tmp'))).toEqual([]);
    expect(entries).toEqual(['selection.json']);
  });
});