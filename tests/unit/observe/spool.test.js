'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const spool = require('../../../src/observe/spool');
const { spoolPath } = require('../../../src/observe/paths');

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-spool-'));
  fs.mkdirSync(path.join(root, 'mobile-automator'), { recursive: true });
  return root;
}

const readLines = (p) =>
  fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

describe('telemetry spool', () => {
  it('writes the NETWORK payload, not the event — a serial is never in the file that gets uploaded', () => {
    const root = workspace();
    spool.write(
      {
        ts: '2026-09-05T10:00:00.000Z',
        v: 1,
        level: 'info',
        src: 'cli',
        event: 'verb.end',
        verb: 'launch',
        ok: true,
        dur_ms: 41,
        // every one of these is sends:false
        app_id: 'com.acme.unreleased-thing',
        device_id: 'emulator-5554',
        run_id: 'project-phoenix-0031',
        path: '/Users/someone/secret/app.apk',
      },
      { projectRoot: root, env: {} }
    );

    const [line] = readLines(spoolPath(root, {}));
    expect(line.verb).toBe('launch');
    expect(line.dur_ms).toBe(41);
    for (const f of ['app_id', 'device_id', 'run_id', 'path']) {
      expect(line).not.toHaveProperty(f);
    }
  });

  it('stamps a fresh CSPRNG message id on every line', () => {
    const root = workspace();
    for (let i = 0; i < 5; i++) {
      spool.write({ level: 'info', src: 'cli', event: 'verb.end', ok: true }, { projectRoot: root, env: {} });
    }
    const ids = readLines(spoolPath(root, {})).map((l) => l.msg_id);
    expect(ids).toHaveLength(5);
    expect(new Set(ids).size).toBe(5);
    expect(ids.every((id) => /^[0-9a-f]{32}$/.test(id))).toBe(true);
  });

  it('never spools its own telemetry events', () => {
    // Without this an offline machine appends one flush-failure event per
    // flush attempt, forever: the queue that exists to be drained fills itself.
    const root = workspace();
    spool.write({ level: 'debug', src: 'daemon', event: 'telemetry.flush', ok: false }, { projectRoot: root, env: {} });
    spool.write({ level: 'info', src: 'daemon', event: 'telemetry.spool_full' }, { projectRoot: root, env: {} });
    expect(fs.existsSync(spoolPath(root, {}))).toBe(false);
  });

  it('refuses to spool in a directory that never ran `mauto setup`', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-bare-'));
    spool.write({ level: 'info', src: 'cli', event: 'verb.end', ok: true }, { projectRoot: bare, env: {} });
    expect(fs.existsSync(spoolPath(bare, {}))).toBe(false);
  });

  it('drops at the cap instead of rotating — a rotated generation would never be delivered', () => {
    const root = workspace();
    const target = spoolPath(root, {});
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'x'.repeat(spool.SPOOL_MAX_BYTES + 1));

    spool.write({ level: 'info', src: 'cli', event: 'verb.end', ok: true }, { projectRoot: root, env: {} });

    expect(fs.statSync(target).size).toBe(spool.SPOOL_MAX_BYTES + 1);
    expect(fs.existsSync(`${target}.1`)).toBe(false);
  });

  it('never throws, whatever the filesystem does', () => {
    const root = workspace();
    const boom = () => {
      throw Object.assign(new Error('ENOSPC'), { code: 'ENOSPC' });
    };
    expect(() =>
      spool.write(
        { level: 'info', src: 'cli', event: 'verb.end', ok: true },
        { projectRoot: root, env: {}, fs: { ...fs, appendFileSync: boom, statSync: boom, mkdirSync: boom, existsSync: () => true } }
      )
    ).not.toThrow();
  });

  it('claims the spool by rename, so a concurrent writer loses nothing', () => {
    const root = workspace();
    spool.write({ level: 'info', src: 'cli', event: 'verb.end', ok: true }, { projectRoot: root, env: {} });

    const claimed = spool.claim({ projectRoot: root, env: {} });
    expect(claimed).toMatch(/telemetry\.spool\.sending\.\d+\.\d+$/);
    expect(fs.existsSync(spoolPath(root, {}))).toBe(false);
    expect(spool.readBatch(claimed)).toHaveLength(1);

    // A verb that runs during the flush starts a fresh spool.
    spool.write({ level: 'info', src: 'cli', event: 'verb.end', ok: false }, { projectRoot: root, env: {} });
    expect(spool.readBatch(spoolPath(root, {}))).toHaveLength(1);
  });

  it('claims nothing when there is nothing to claim', () => {
    const root = workspace();
    expect(spool.claim({ projectRoot: root, env: {} })).toBeNull();
  });

  it('assigns a distinct claim name to two claims made back-to-back in the same process', () => {
    // Date.now() alone is not unique enough for the claim suffix: two claims
    // in one process (a flush that retries a leftover batch and then claims
    // a fresh one) can land in the same millisecond, and renameSync onto an
    // already-existing target silently REPLACES it on POSIX rather than
    // erroring — destroying whichever claim got there first.
    const root = workspace();
    spool.write({ level: 'info', src: 'cli', event: 'verb.end', ok: true }, { projectRoot: root, env: {} });
    const first = spool.claim({ projectRoot: root, env: {} });

    spool.write({ level: 'info', src: 'cli', event: 'verb.end', ok: false }, { projectRoot: root, env: {} });
    const second = spool.claim({ projectRoot: root, env: {} });

    expect(first).not.toBe(second);
    expect(spool.readBatch(first)).toHaveLength(1);
    expect(spool.readBatch(second)).toHaveLength(1);
  });

  it('lists leftover claimed batches oldest-first so retries stay in order', () => {
    const root = workspace();
    const dir = path.dirname(spoolPath(root, {}));
    fs.mkdirSync(dir, { recursive: true });
    for (const name of ['telemetry.spool.sending.9.300', 'telemetry.spool.sending.9.100', 'telemetry.spool.sending.9.200']) {
      fs.writeFileSync(path.join(dir, name), '{}\n');
    }
    expect(spool.listClaimed({ projectRoot: root, env: {} }).map((f) => path.basename(f))).toEqual([
      'telemetry.spool.sending.9.100',
      'telemetry.spool.sending.9.200',
      'telemetry.spool.sending.9.300',
    ]);
  });

  it('skips an unparseable line rather than discarding the batch around it', () => {
    const root = workspace();
    const dir = path.dirname(spoolPath(root, {}));
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'telemetry.spool.sending.1.1');
    fs.writeFileSync(f, '{"event":"a"}\nnot json\n\n{"event":"b"}\n');
    expect(spool.readBatch(f).map((e) => e.event)).toEqual(['a', 'b']);
  });

  it('reports what a user would want to see before deciding to opt in', () => {
    const root = workspace();
    spool.write({ level: 'info', src: 'cli', event: 'verb.end', ok: true }, { projectRoot: root, env: {} });
    const s = spool.stats({ projectRoot: root, env: {} });
    expect(s.path).toBe(spoolPath(root, {}));
    expect(s.events).toBe(1);
    expect(s.bytes).toBeGreaterThan(0);
    expect(s.pending_batches).toBe(0);
  });

  it('reports zeroes rather than throwing when nothing has been spooled', () => {
    const root = workspace();
    expect(spool.stats({ projectRoot: root, env: {} }))
      .toEqual({ path: spoolPath(root, {}), bytes: 0, events: 0, pending_batches: 0 });
  });
});
