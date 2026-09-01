'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const stderrSink = require('../../../src/observe/sinks/stderr');
const fileSink = require('../../../src/observe/sinks/file');
const { MAX_LOG_BYTES } = require('../../../src/device/session-log');

function workspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-observe-'));
}

describe('stderr sink', () => {
  it('writes a single readable line to the injected stream', () => {
    const written = [];
    stderrSink.write(
      { ts: '2026-09-01T00:00:00.000Z', level: 'warn', event: 'verb.end', verb: 'tap', ok: false },
      { stream: { write: (s) => written.push(s) } }
    );
    expect(written).toHaveLength(1);
    expect(written[0]).toMatch(/^\[warn\] verb\.end verb=tap ok=false\n$/);
  });

  it('never writes to stdout', () => {
    const spy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
    stderrSink.write({ level: 'error', event: 'x' }, { stream: { write() {} } });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('file sink', () => {
  it('appends one JSON object per line', () => {
    const root = workspace();
    fileSink.write({ level: 'info', event: 'verb.end', verb: 'tap' }, { projectRoot: root, env: {} });
    fileSink.write({ level: 'info', event: 'verb.end', verb: 'swipe' }, { projectRoot: root, env: {} });

    const logPath = path.join(root, 'mobile-automator', '.logs', 'mauto.ndjson');
    const lines = fs.readFileSync(logPath, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).verb).toBe('tap');
    expect(JSON.parse(lines[1]).verb).toBe('swipe');
  });

  it('creates the log directory on demand', () => {
    const root = workspace();
    fileSink.write({ level: 'info', event: 'e' }, { projectRoot: root, env: {} });
    expect(fs.existsSync(path.join(root, 'mobile-automator', '.logs'))).toBe(true);
  });

  it('rotates to .1 at the shared 1 MiB cap, keeping one generation', () => {
    const root = workspace();
    const dir = path.join(root, 'mobile-automator', '.logs');
    const logPath = path.join(dir, 'mauto.ndjson');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(logPath, 'x'.repeat(MAX_LOG_BYTES));

    fileSink.write({ level: 'info', event: 'after-rotate' }, { projectRoot: root, env: {} });

    expect(fs.statSync(`${logPath}.1`).size).toBe(MAX_LOG_BYTES);
    expect(fs.readFileSync(logPath, 'utf8')).toContain('after-rotate');
  });

  it('swallows a write failure instead of throwing', () => {
    const boom = {
      mkdirSync() { throw new Error('EROFS: read-only file system'); },
      statSync() { throw new Error('nope'); },
      appendFileSync() { throw new Error('nope'); },
      renameSync() { throw new Error('nope'); },
    };
    expect(() =>
      fileSink.write({ level: 'info', event: 'e' }, { projectRoot: '/x', env: {}, fs: boom })
    ).not.toThrow();
  });

  it('emits a parseable line for an event containing a quote', () => {
    const line = fileSink.format({ level: 'info', event: 'e', message: 'said "hi"\nnewline' });
    expect(line.endsWith('\n')).toBe(true);
    expect(line.trim().split('\n')).toHaveLength(1);
    expect(JSON.parse(line).message).toBe('said "hi"\nnewline');
  });
});
