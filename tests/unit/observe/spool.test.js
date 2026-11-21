'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const spool = require('../../../src/observe/spool');
const { spoolPath } = require('../../../src/observe/paths');

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-spool-'));
  fs.mkdirSync(path.join(root, '.mobile-automator'), { recursive: true });
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
    expect(spool.readBatch(claimed, { projectRoot: root, env: {} })).toHaveLength(1);

    // A verb that runs during the flush starts a fresh spool.
    spool.write({ level: 'info', src: 'cli', event: 'verb.end', ok: false }, { projectRoot: root, env: {} });
    expect(spool.readBatch(spoolPath(root, {}), { projectRoot: root, env: {} })).toHaveLength(1);
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
    expect(spool.readBatch(first, { projectRoot: root, env: {} })).toHaveLength(1);
    expect(spool.readBatch(second, { projectRoot: root, env: {} })).toHaveLength(1);
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
    // Two catalog-valid events around the bad line: the reader re-applies the
    // field catalog (#348), so an invented event name would be dropped too.
    fs.writeFileSync(f, '{"event":"verb.end"}\nnot json\n\n{"event":"call.end"}\n');
    expect(spool.readBatch(f, { projectRoot: root, env: {} }).map((e) => e.event)).toEqual(['verb.end', 'call.end']);
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

// `.mobile-automator/` is committed to repos, so a cloned repo can ship a
// spool, a claimed batch or the whole `.logs/` directory, with any content or
// as a link to a file elsewhere (#348). Everything here reads the spool the way
// flush does and proves nothing outside the workspace is read, renamed or
// changed.
describe('the spool is read as untrusted input (#348)', () => {
  const VALID = { event: 'verb.end', verb: 'tap', ok: true };
  const VALID_LINES = `${JSON.stringify(VALID)}\n${JSON.stringify({ ...VALID, ok: false })}\n`;

  const outsideDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-outside-'));
  const logsDirOf = (root) => path.dirname(spoolPath(root, {}));
  const batchPath = (root) => {
    fs.mkdirSync(logsDirOf(root), { recursive: true });
    return path.join(logsDirOf(root), 'telemetry.spool.sending.1.1');
  };
  // A file outside the workspace holding lines that would pass the catalog, so
  // an empty result can only mean it was refused, not that it was filtered.
  const secretFile = (dir = outsideDir()) => {
    const f = path.join(dir, 'SECRET');
    fs.writeFileSync(f, VALID_LINES);
    return f;
  };
  const snapshot = (dir) =>
    Object.fromEntries(
      fs.readdirSync(dir).sort().map((n) => [n, fs.readFileSync(path.join(dir, n), 'utf8')])
    );

  // A real fs whose fstat reports another uid for one file, as a batch planted
  // by another user (or extracted from an archive) would.
  function foreignOwnerFs(target) {
    const fds = new Set();
    return {
      ...fs,
      openSync(p, ...rest) {
        const fd = fs.openSync(p, ...rest);
        if (path.resolve(String(p)) === path.resolve(target)) fds.add(fd);
        return fd;
      },
      fstatSync(fd, ...rest) {
        const st = fs.fstatSync(fd, ...rest);
        if (!fds.has(fd)) return st;
        return Object.assign(Object.create(Object.getPrototypeOf(st)), st, { uid: st.uid + 1 });
      },
      closeSync(fd) {
        fds.delete(fd);
        return fs.closeSync(fd);
      },
    };
  }

  it('reads a regular batch, so every refusal below is a refusal and not a broken reader', () => {
    const root = workspace();
    const batch = batchPath(root);
    fs.writeFileSync(batch, VALID_LINES);
    expect(spool.readBatch(batch, { projectRoot: root, env: {} })).toEqual([VALID, { ...VALID, ok: false }]);
  });

  it('returns nothing for a claimed batch that is a symlink to a file outside the workspace', () => {
    const root = workspace();
    const secret = secretFile();
    const batch = batchPath(root);
    fs.symlinkSync(secret, batch);
    expect(spool.readBatch(batch, { projectRoot: root, env: {} })).toEqual([]);
  });

  it('returns nothing for a batch hard-linked to a file outside the workspace', () => {
    const root = workspace();
    const secret = secretFile();
    const batch = batchPath(root);
    fs.linkSync(secret, batch);
    expect(spool.readBatch(batch, { projectRoot: root, env: {} })).toEqual([]);
  });

  it('returns nothing for a batch owned by another uid', () => {
    const root = workspace();
    const batch = batchPath(root);
    fs.writeFileSync(batch, VALID_LINES);
    expect(spool.readBatch(batch, { projectRoot: root, env: {}, fs: foreignOwnerFs(batch) })).toEqual([]);
  });

  it('returns nothing for a batch larger than SPOOL_READ_MAX_BYTES, which no writer could have produced', () => {
    expect(spool.SPOOL_READ_MAX_BYTES).toBe(1024 * 1024);
    const root = workspace();
    const batch = batchPath(root);
    const line = `${JSON.stringify(VALID)}\n`;
    fs.writeFileSync(batch, line.repeat(Math.ceil((spool.SPOOL_READ_MAX_BYTES + 1) / line.length)));
    expect(fs.statSync(batch).size).toBeGreaterThan(spool.SPOOL_READ_MAX_BYTES);
    expect(spool.readBatch(batch, { projectRoot: root, env: {} })).toEqual([]);
  });

  it('under MAUTO_LOG_DIR, still returns nothing for a symlink leaf', () => {
    const root = workspace();
    const env = { MAUTO_LOG_DIR: outsideDir() };
    const secret = secretFile();
    fs.symlinkSync(secret, spoolPath(root, env));
    expect(spool.readBatch(spoolPath(root, env), { projectRoot: root, env })).toEqual([]);
  });

  it('under MAUTO_LOG_DIR, the spool is the user\'s own path: written, claimed, listed and read with no workspace at all', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-bare-'));
    const env = { MAUTO_LOG_DIR: path.join(outsideDir(), 'nested', 'logs') };
    spool.write(VALID, { projectRoot: bare, env });
    const claimed = spool.claim({ projectRoot: bare, env });
    expect(claimed).not.toBeNull();
    expect(spool.listClaimed({ projectRoot: bare, env })).toEqual([claimed]);
    expect(spool.readBatch(claimed, { projectRoot: bare, env })).toEqual([expect.objectContaining(VALID)]);
  });

  it('drops a field outside the catalog, even though the line came out of the spool', () => {
    const root = workspace();
    const batch = batchPath(root);
    fs.writeFileSync(
      batch,
      '{"event":"verb.end","verb":"tap","ok":true,"cwd":"/home/x","app_id":"com.secret"}\n'
    );
    const [payload, ...rest] = spool.readBatch(batch, { projectRoot: root, env: {} });
    expect(rest).toEqual([]);
    expect(payload).toEqual({ event: 'verb.end', verb: 'tap', ok: true });
    expect(payload).not.toHaveProperty('cwd');
    expect(payload).not.toHaveProperty('app_id');
  });

  it('drops a line with an unknown event and every non-object line, keeping the valid lines around them', () => {
    const root = workspace();
    const batch = batchPath(root);
    fs.writeFileSync(
      batch,
      [
        JSON.stringify(VALID),
        '{"event":"evil","verb":"tap","ok":true}',
        '{"verb":"tap","ok":true}',
        'null',
        '[{"event":"verb.end"}]',
        '42',
        '"verb.end"',
        JSON.stringify({ ...VALID, ok: false }),
      ].join('\n') + '\n'
    );
    let out;
    expect(() => {
      out = spool.readBatch(batch, { projectRoot: root, env: {} });
    }).not.toThrow();
    expect(out).toEqual([VALID, { ...VALID, ok: false }]);
  });

  it('claims and lists nothing through a symlinked .logs/, so flush cannot rename or delete outside the workspace', () => {
    const root = workspace();
    const outside = outsideDir();
    fs.writeFileSync(path.join(outside, 'telemetry.spool'), VALID_LINES);
    fs.writeFileSync(path.join(outside, 'telemetry.spool.sending.1.1'), VALID_LINES);
    secretFile(outside);
    const before = snapshot(outside);
    fs.symlinkSync(outside, logsDirOf(root));

    expect(spool.claim({ projectRoot: root, env: {} })).toBeNull();
    expect(fs.existsSync(path.join(outside, 'telemetry.spool'))).toBe(true);
    expect(spool.listClaimed({ projectRoot: root, env: {} })).toEqual([]);
    expect(snapshot(outside)).toEqual(before);
  });

  it('claims and lists nothing through a .logs/ owned by another uid', () => {
    const root = workspace();
    spool.write(VALID, { projectRoot: root, env: {} });
    fs.writeFileSync(path.join(logsDirOf(root), 'telemetry.spool.sending.1.1'), VALID_LINES);
    const before = snapshot(logsDirOf(root));
    const getuid = () => process.getuid() + 1;

    expect(spool.claim({ projectRoot: root, env: {}, getuid })).toBeNull();
    expect(spool.listClaimed({ projectRoot: root, env: {}, getuid })).toEqual([]);
    expect(snapshot(logsDirOf(root))).toEqual(before);
  });

  it('reports zeros for a spool that is a symlink, rather than the size of whatever it points at', () => {
    const root = workspace();
    const secret = secretFile();
    fs.mkdirSync(logsDirOf(root), { recursive: true });
    fs.symlinkSync(secret, spoolPath(root, {}));
    expect(spool.stats({ projectRoot: root, env: {} }))
      .toEqual({ path: spoolPath(root, {}), bytes: 0, events: 0, pending_batches: 0 });
  });
});
