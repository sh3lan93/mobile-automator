'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { handleCrashList, handleCrashGet, buildProgram, toEnvelope } = require('../../../src/cli');
const sessionPaths = require('../../../src/device/session-paths');
const { CANARY, tmpDir, snapshot } = require('../../helpers/workspace-safety');

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

  it('surfaces the bridge hint when an iOS simulator\'s empty list cannot be trusted (mobilecli#539)', async () => {
    const { DeviceBridge } = require('../../../src/device/bridge');
    const deviceBridge = new DeviceBridge({
      device: 'sim-1',
      call: async (tool) =>
        tool === 'mobile_list_crashes'
          ? []
          : { devices: [{ id: 'sim-1', name: 'iPhone 15', platform: 'ios', type: 'simulator', state: 'online' }] },
    });
    const r = await handleCrashList({ deviceBridge, projectRoot: tmpRoot() });
    expect(r.exitKind).toBe('device');
    expect(r.envelope.ok).toBe(false);
    expect(r.envelope.error.kind).toBe('device');
    expect(r.envelope.error.message).toMatch(/iOS simulator/);
    expect(r.envelope.hint).toContain('mobilecli/issues/539');
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
    const root = tmpRoot();
    const dest = path.join(root, 'crash.txt');
    const r = await handleCrashGet({ deviceBridge: bridge, projectRoot: root, cwd: root }, 'r1', { out: dest });
    expect(r.exitKind).toBe('ok');
    expect(r.envelope.data.path).toBe(dest);
    expect(r.envelope.data).not.toHaveProperty('report');
    expect(fs.readFileSync(dest, 'utf8').split('\n')).toHaveLength(300);
  });

  it('reports an unwritable --out as an environment failure, not a device one', async () => {
    const root = tmpRoot();
    const r = await handleCrashGet({ deviceBridge: bridge, projectRoot: root, cwd: root }, 'r1', {
      out: path.join(root, 'no', 'such', 'dir', 'crash.txt'),
    });
    expect(r.exitKind).toBe('environment');
    expect(r.envelope.error.kind).toBe('environment');
    expect(r.envelope.error.message).toMatch(/^could not write the crash report to /);
    expect(r.envelope.hint).toBe('Check the directory exists and is writable.');
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

// #347: --out is a path the user (or an agent) chose, and the checkout is
// untrusted: a cloned repo can commit a link anywhere in it. Outside the
// workspace the report may land only where the engine lets itself write (the
// project, the OS temp directory and, on macOS, /tmp), checked before the
// device is asked; inside it the workspace rules apply. Either way the leaf is
// opened O_NOFOLLOW, a hard link refused, and the truncate deferred until the
// checks pass.
describe('handleCrashGet --out confinement (#347)', () => {
  const REPORT = 'FATAL EXCEPTION: main\n  at com.acme.Boom.run(Boom.java:1)';

  // A project one level below its own temp dir (so `..` stays in a temp dir),
  // an outside dir holding the canary, and the temp and home dirs the handler
  // is told about: four different places.
  function setup() {
    const base = tmpDir('mauto-crash-out-');
    const root = path.join(base, 'project');
    const ws = path.join(root, '.mobile-automator');
    fs.mkdirSync(ws, { recursive: true });
    const outside = tmpDir('mauto-crash-outside-');
    fs.writeFileSync(path.join(outside, 'target.txt'), CANARY);
    const tmp = tmpDir('mauto-crash-tmp-');
    const home = tmpDir('mauto-crash-home-');
    return { base, root, ws, outside, tmp, home };
  }

  async function getWith(
    { root, tmp, home },
    out,
    { cwd = root, platform = 'linux', darwinTmp, homedir = () => home } = {}
  ) {
    const asked = [];
    const deviceBridge = {
      getCrash: async (id) => {
        asked.push(id);
        return REPORT;
      },
    };
    // A refusal is thrown to the envelope boundary, as the verb's wrapper
    // sees it: map it there.
    const r = await handleCrashGet(
      { deviceBridge, projectRoot: root, cwd, tmpdir: () => tmp, platform, darwinTmp, homedir },
      'r1',
      { out }
    ).catch(toEnvelope);
    return { r, asked };
  }

  function expectRefused(r, message) {
    expect(r.exitKind).toBe('environment');
    expect(r.envelope.ok).toBe(false);
    expect(r.envelope.error.kind).toBe('environment');
    expect(r.envelope.error.message).toMatch(message);
    // The refusal's own hint, never the generic filesystem one.
    expect(r.envelope.hint).not.toBe('Check the directory exists and is writable.');
    expect(r.envelope.hint).toEqual(expect.any(String));
    expect(JSON.stringify(r)).not.toContain(CANARY);
  }

  it('--out ../outside.txt outside the project and the temp dir is invalid_input, before the device is asked', async () => {
    const s = setup();
    const before = snapshot(s.base);

    const { r, asked } = await getWith(s, '../outside.txt');

    expect(r.exitKind).toBe('invalid_input');
    expect(r.envelope.error.kind).toBe('invalid_input');
    expect(r.envelope.error.message).toContain(path.join(s.base, 'outside.txt'));
    expect(r.envelope.hint).toContain(s.root);
    expect(r.envelope.hint).toContain(s.tmp);
    expect(asked).toEqual([]);
    expect(fs.existsSync(path.join(s.base, 'outside.txt'))).toBe(false);
    expect(snapshot(s.base)).toEqual(before);
  });

  it('an absolute --out in a third directory is refused the same way', async () => {
    const s = setup();
    const before = snapshot(s.outside);

    const { r, asked } = await getWith(s, path.join(s.outside, 'crash.txt'));

    expect(r.exitKind).toBe('invalid_input');
    expect(asked).toEqual([]);
    expect(snapshot(s.outside)).toEqual(before);
  });

  it('a project directory that links outside both roots is refused: the check compares realpaths', async () => {
    const s = setup();
    fs.symlinkSync(s.outside, path.join(s.root, 'docs'));
    const before = snapshot(s.outside);

    const { r, asked } = await getWith(s, 'docs/crash.txt');

    expect(r.exitKind).toBe('invalid_input');
    // Names the path as resolved, never where the link points.
    expect(r.envelope.error.message).toContain(path.join(s.root, 'docs', 'crash.txt'));
    expect(r.envelope.error.message).not.toContain(s.outside);
    expect(asked).toEqual([]);
    expect(snapshot(s.outside)).toEqual(before);
  });

  it('--out .mobile-automator/crash.txt that links to an outside file is refused, the file unchanged', async () => {
    const s = setup();
    fs.symlinkSync(path.join(s.outside, 'target.txt'), path.join(s.ws, 'crash.txt'));
    const before = snapshot(s.outside);

    const { r } = await getWith(s, '.mobile-automator/crash.txt');

    expectRefused(r, /^Refusing to use workspace path /);
    expect(r.envelope.error.message).toContain(path.join(s.ws, 'crash.txt'));
    expect(snapshot(s.outside)).toEqual(before);
  });

  it('a dangling link in the workspace is refused and its target never created', async () => {
    const s = setup();
    fs.symlinkSync(path.join(s.outside, 'new.txt'), path.join(s.ws, 'crash.txt'));
    const before = snapshot(s.outside);

    const { r } = await getWith(s, '.mobile-automator/crash.txt');

    expectRefused(r, /^Refusing to use workspace path /);
    expect(fs.existsSync(path.join(s.outside, 'new.txt'))).toBe(false);
    expect(snapshot(s.outside)).toEqual(before);
  });

  it('a symlinked workspace directory on the way (.mobile-automator/reports -> outside) is refused', async () => {
    const s = setup();
    fs.symlinkSync(s.outside, path.join(s.ws, 'reports'));
    const before = snapshot(s.outside);

    const { r } = await getWith(s, '.mobile-automator/reports/crash.txt');

    expectRefused(r, /^Refusing to use workspace path /);
    expect(r.envelope.error.message).toContain(path.join(s.ws, 'reports'));
    expect(snapshot(s.outside)).toEqual(before);
  });

  it('a project-root leaf that is a symlink is refused as a path', async () => {
    const s = setup();
    fs.symlinkSync(path.join(s.outside, 'target.txt'), path.join(s.root, 'crash.txt'));
    const before = snapshot(s.outside);

    const { r } = await getWith(s, 'crash.txt');

    expectRefused(r, /^Refusing to use path /);
    expect(r.envelope.error.message).toContain(path.join(s.root, 'crash.txt'));
    expect(snapshot(s.outside)).toEqual(before);
  });

  it('a project-root leaf hard-linked to an outside file is refused, and the outside file is not emptied', async () => {
    const s = setup();
    fs.linkSync(path.join(s.outside, 'target.txt'), path.join(s.root, 'crash.txt'));
    const before = snapshot(s.outside);

    const { r } = await getWith(s, 'crash.txt');

    expectRefused(r, /^Refusing to use path .*\(hardlink\)\.$/);
    expect(fs.readFileSync(path.join(s.outside, 'target.txt'), 'utf8')).toBe(CANARY);
    expect(snapshot(s.outside)).toEqual(before);
  });

  it('a path in the temp dir is written whole; data.path is the --out as given', async () => {
    const s = setup();
    const out = path.join(s.tmp, 'crash.txt');

    const { r, asked } = await getWith(s, out);

    expect(r.exitKind).toBe('ok');
    expect(r.envelope.data).toEqual({ crash_id: 'r1', path: out, truncated: false });
    expect(asked).toEqual(['r1']);
    expect(fs.readFileSync(out, 'utf8')).toBe(REPORT);
  });

  it('an existing regular file is overwritten, not appended to', async () => {
    const s = setup();
    const out = path.join(s.tmp, 'crash.txt');
    fs.writeFileSync(out, 'x'.repeat(REPORT.length * 3));

    const { r } = await getWith(s, out);

    expect(r.exitKind).toBe('ok');
    expect(fs.readFileSync(out, 'utf8')).toBe(REPORT);
  });

  it('a relative --out resolves against cwd, and data.path keeps it as given', async () => {
    const s = setup();
    const sub = path.join(s.root, 'sub');
    fs.mkdirSync(sub);

    const { r } = await getWith(s, 'crash.txt', { cwd: sub });

    expect(r.exitKind).toBe('ok');
    expect(r.envelope.data.path).toBe('crash.txt');
    expect(fs.readFileSync(path.join(sub, 'crash.txt'), 'utf8')).toBe(REPORT);
  });

  it('a clean workspace path is written, its missing directories created', async () => {
    const s = setup();

    const { r } = await getWith(s, '.mobile-automator/crashes/r1.txt');

    expect(r.exitKind).toBe('ok');
    expect(fs.readFileSync(path.join(s.ws, 'crashes', 'r1.txt'), 'utf8')).toBe(REPORT);
  });

  // macOS os.tmpdir() is /var/folders/.../T, not /tmp, and the engine adds /tmp
  // there itself: `mauto crash get <id> --out /tmp/crash.txt` is documented.
  // The stand-in for /tmp is injected so the test never writes to the real one.
  // The engine never takes its cwd as a root when that is the home directory
  // or above it (mobile-mcp's isTooBroadToAllow): it would make nearly every
  // file the user owns writable. `crash get` has no workspace gate, so its
  // project root is the cwd whenever no workspace is found; run from ~, it
  // must not accept `--out ~/.bashrc`.
  describe('a project that is the home directory or above it is no root', () => {
    it('a project root equal to home: a path in it is invalid_input, and the hint does not list it', async () => {
      const s = setup();

      const { r, asked } = await getWith(s, 'crash.txt', { homedir: () => s.root });

      expect(r.exitKind).toBe('invalid_input');
      expect(r.envelope.hint).not.toContain(s.root);
      expect(r.envelope.hint).toContain(s.tmp);
      expect(asked).toEqual([]);
      expect(fs.existsSync(path.join(s.root, 'crash.txt'))).toBe(false);
    });

    it('a project root above home: the same', async () => {
      const s = setup();
      const home = path.join(s.root, 'users', 'me');
      fs.mkdirSync(home, { recursive: true });

      const { r, asked } = await getWith(s, 'crash.txt', { homedir: () => home });

      expect(r.exitKind).toBe('invalid_input');
      expect(r.envelope.hint).not.toContain(s.root);
      expect(asked).toEqual([]);
      expect(fs.existsSync(path.join(s.root, 'crash.txt'))).toBe(false);
    });

    // The filesystem root is above every home, so it is dropped like any
    // other ancestor: the hint says so rather than offering `/` as a root.
    // `outside` is a temp dir the handler is not told about.
    it('a project root of / is above home: dropped, and the hint says so', async () => {
      const s = setup();
      const out = path.join(s.outside, 'crash.txt');

      const { r, asked } = await getWith({ ...s, root: '/' }, out);

      expect(r.exitKind).toBe('invalid_input');
      expect(r.envelope.hint).toContain('The project directory is not allowed');
      expect(asked).toEqual([]);
      expect(fs.existsSync(out)).toBe(false);
    });

    it('home reached through a link is compared by realpath', async () => {
      const s = setup();
      const alias = path.join(tmpDir('mauto-crash-home-alias-'), 'home');
      fs.symlinkSync(s.root, alias);

      const { r } = await getWith(s, 'crash.txt', { homedir: () => alias });

      expect(r.exitKind).toBe('invalid_input');
    });

    it('a project in a subdirectory of home is still a root', async () => {
      const s = setup();

      const { r } = await getWith(s, 'crash.txt', { homedir: () => s.base });

      expect(r.exitKind).toBe('ok');
      expect(fs.readFileSync(path.join(s.root, 'crash.txt'), 'utf8')).toBe(REPORT);
    });

    it('a write inside .mobile-automator/ never reaches the rule', async () => {
      const s = setup();

      const { r } = await getWith(s, '.mobile-automator/crash.txt', { homedir: () => s.root });

      expect(r.exitKind).toBe('ok');
      expect(fs.readFileSync(path.join(s.ws, 'crash.txt'), 'utf8')).toBe(REPORT);
    });

    it('the temp directory stays a root', async () => {
      const s = setup();
      const out = path.join(s.tmp, 'crash.txt');

      const { r } = await getWith(s, out, { homedir: () => s.root });

      expect(r.exitKind).toBe('ok');
      expect(fs.readFileSync(out, 'utf8')).toBe(REPORT);
    });
  });

  describe('/tmp on macOS', () => {
    it('on darwin a path under /tmp is allowed', async () => {
      const s = setup();
      const darwinTmp = tmpDir('mauto-crash-slash-tmp-');
      const out = path.join(darwinTmp, 'crash.txt');

      const { r } = await getWith(s, out, { platform: 'darwin', darwinTmp });

      expect(r.exitKind).toBe('ok');
      expect(fs.readFileSync(out, 'utf8')).toBe(REPORT);
    });

    it('on linux the same path is refused', async () => {
      const s = setup();
      const darwinTmp = tmpDir('mauto-crash-slash-tmp-');
      const out = path.join(darwinTmp, 'crash.txt');

      const { r, asked } = await getWith(s, out, { platform: 'linux', darwinTmp });

      expect(r.exitKind).toBe('invalid_input');
      expect(r.envelope.hint).not.toContain(darwinTmp);
      expect(asked).toEqual([]);
      expect(fs.existsSync(out)).toBe(false);
    });

    it('on darwin the refusal hint names every allowed root, /tmp included', async () => {
      const s = setup();
      const darwinTmp = tmpDir('mauto-crash-slash-tmp-');

      const { r } = await getWith(s, '../outside.txt', { platform: 'darwin', darwinTmp });

      expect(r.exitKind).toBe('invalid_input');
      for (const root of [s.root, s.tmp, darwinTmp]) expect(r.envelope.hint).toContain(root);
    });
  });
});

describe('registration', () => {
  it('registers `crash list` and `crash get`', () => {
    const cmd = buildProgram().commands.find((c) => c.name() === 'crash');
    expect(cmd).toBeDefined();
    expect(cmd.commands.map((c) => c.name()).sort()).toEqual(['get', 'list']);
  });

  it('includes `add-crash` in `result`\'s subcommand list', () => {
    const resultCmd = buildProgram().commands.find((c) => c.name() === 'result');
    expect(resultCmd.commands.map((c) => c.name())).toContain('add-crash');
  });
});

// `crash list`/`crash get` are registered under one commander subcommand, so
// they collapse to the single verb name `crash` — the same mechanism that
// collapses `config get/set` to `config`. That means a failing `crash get`
// goes through connectBridge's post-fn probeCrashes() hook exactly like any
// other device verb, unless `crash` is in PROBE_EXEMPT_VERBS. This exercises
// that through the real program, not just handleCrashGet in isolation —
// handleCrashGet alone can't see connectBridge's probe wiring.
describe('interaction with the failure-path crash probe', () => {
  function writeHandle(root, handle) {
    fs.mkdirSync(sessionPaths.sessionDir(root), { recursive: true });
    fs.writeFileSync(sessionPaths.handlePath(root), JSON.stringify(handle));
  }

  it('does not re-probe crashes on its own failure — no double listCrashes call, no stapled hint', async () => {
    const root = tmpRoot();
    writeHandle(root, { started_at: '2026-09-05T10:00:00.000Z' });
    const listCrashesCalls = [];
    const RECENT_CRASH = { id: 'c1', process: 'com.acme.app', timestamp: '2026-09-05T10:30:00.000Z' };

    const deviceBridgeFactory = async () => ({
      bridge: {
        getCrash: async () => {
          throw new Error('crash report c-bad-id not found');
        },
        listCrashes: async () => {
          listCrashesCalls.push(true);
          return [RECENT_CRASH];
        },
      },
      close: async () => {},
    });
    const emitted = [];

    await buildProgram({
      projectRoot: root,
      deviceBridgeFactory,
      emit: (r) => emitted.push(r),
    }).parseAsync(['node', 'mauto', 'crash', 'get', 'c-bad-id']);

    expect(listCrashesCalls).toHaveLength(0);
    expect(emitted).toHaveLength(1);
    expect(emitted[0].envelope.error.message).toBe('crash report c-bad-id not found');
    expect(emitted[0].envelope.data).toBeUndefined();
    expect(emitted[0].envelope.hint).not.toMatch(/crashed during this session/);
  });
});
