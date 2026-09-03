'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { makeDaemonRecorder, daemonSinks } = require('../../../src/observe/daemon-recorder');

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-daemon-rec-'));
  fs.mkdirSync(path.join(root, 'mobile-automator'), { recursive: true });
  return root;
}

function readLines(file) {
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

describe('makeDaemonRecorder', () => {
  it('stamps src=daemon and the session id on every event', () => {
    const seen = [];
    const observe = makeDaemonRecorder({
      projectRoot: '/x',
      sessionId: '8f2c1a3b4d5e6f70',
      env: {},
      sinks: [{ threshold: 'debug', write: (e) => seen.push(e) }],
    });

    observe({ level: 'info', event: 'daemon.start' });

    expect(seen).toHaveLength(1);
    expect(seen[0].src).toBe('daemon');
    expect(seen[0].session_id).toBe('8f2c1a3b4d5e6f70');
  });

  it('does not let a caller overwrite the identity fields', () => {
    const seen = [];
    const observe = makeDaemonRecorder({
      projectRoot: '/x',
      sessionId: 'real',
      env: {},
      sinks: [{ threshold: 'debug', write: (e) => seen.push(e) }],
    });

    observe({ level: 'info', event: 'daemon.start', src: 'cli', session_id: 'forged' });

    expect(seen[0].src).toBe('daemon');
    expect(seen[0].session_id).toBe('real');
  });

  it('never throws, even when a sink explodes', () => {
    const observe = makeDaemonRecorder({
      projectRoot: '/x',
      sessionId: 'a',
      env: {},
      sinks: [{ threshold: 'debug', write() { throw new Error('sink exploded'); } }],
    });
    expect(() => observe({ level: 'error', event: 'daemon.crash' })).not.toThrow();
  });

  it('applies the resolved thresholds — debug is filtered at the default level', () => {
    const seen = [];
    const sinks = daemonSinks('/x', {}).map((s) => ({ threshold: s.threshold, write: (e) => seen.push(e) }));
    const observe = makeDaemonRecorder({ projectRoot: '/x', sessionId: 'a', env: {}, sinks });

    observe({ level: 'debug', event: 'call.start' });
    expect(seen).toHaveLength(0);

    observe({ level: 'info', event: 'call.end' });
    // The file sink's threshold is `info`, the stderr sink's is `warn`.
    expect(seen).toHaveLength(1);
  });
});

describe('daemonSinks', () => {
  it('writes to daemon.ndjson, never to the CLI log', () => {
    const root = workspace();
    const observe = makeDaemonRecorder({ projectRoot: root, sessionId: 'abc', env: {} });

    observe({ level: 'info', event: 'call.end', tool: 'mobile_press_button', dur_ms: 41 });

    const daemonLog = path.join(root, 'mobile-automator', '.logs', 'daemon.ndjson');
    const cliLog = path.join(root, 'mobile-automator', '.logs', 'mauto.ndjson');
    const events = readLines(daemonLog);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ src: 'daemon', event: 'call.end', tool: 'mobile_press_button' });
    expect(fs.existsSync(cliLog)).toBe(false);
  });

  it('resolves levels ONCE, at construction, not per event', () => {
    // A long-lived detached process cannot have its environment changed from
    // outside, so re-reading it per device call is pure waste. Mutating the env
    // object after construction must therefore have no effect.
    const seen = [];
    const env = { MAUTO_LOG_LEVEL: 'debug' };
    const sinks = daemonSinks('/x', env).map((s) => ({ threshold: s.threshold, write: (e) => seen.push(e) }));
    const observe = makeDaemonRecorder({ projectRoot: '/x', sessionId: 'a', env, sinks });

    env.MAUTO_LOG_LEVEL = 'silent';
    observe({ level: 'debug', event: 'call.start' });

    expect(seen).toHaveLength(2); // both sinks were resolved at 'debug'
  });

  it('holds no file descriptor between events', () => {
    // Rotation renames the file; a held fd would keep writing into the rotated
    // inode. Proven by rotating BETWEEN two events and checking the second
    // landed in the fresh file.
    const root = workspace();
    const dir = path.join(root, 'mobile-automator', '.logs');
    const logPath = path.join(dir, 'daemon.ndjson');
    const observe = makeDaemonRecorder({ projectRoot: root, sessionId: 'abc', env: {} });

    observe({ level: 'info', event: 'daemon.start' });
    fs.renameSync(logPath, `${logPath}.1`);
    observe({ level: 'info', event: 'daemon.stop', stop_reason: 'idle' });

    expect(readLines(logPath)).toHaveLength(1);
    expect(readLines(logPath)[0].event).toBe('daemon.stop');
  });
});
