'use strict';

// Upward workspace discovery (#188). Real tmp directories rather than an fs
// double: the walk's correctness is about how path.dirname() and existsSync()
// behave on a real tree, which is exactly what a double would paper over.
//
// Every fixture puts a `.git` at its project root so the walk can never escape
// into the real filesystem above os.tmpdir() — a stray config.json there would
// otherwise make these tests depend on the machine they run on. Roots go
// through realpathSync because macOS's /tmp is a symlink to /private/tmp and
// the walk reports the path it was handed, not a canonical one.

const os = require('os');
const fs = require('fs');
const path = require('path');

const { findWorkspaceRoot, noWorkspaceFailure, workspaceFailure } = require('../../../src/workspace/discover');

function tmpProject({ git = 'dir' } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-discover-')));
  if (git === 'dir') fs.mkdirSync(path.join(root, '.git'));
  if (git === 'file') fs.writeFileSync(path.join(root, '.git'), 'gitdir: /elsewhere/.git/worktrees/x\n');
  return root;
}

function makeWorkspace(dir) {
  fs.mkdirSync(path.join(dir, '.mobile-automator'), { recursive: true });
  fs.writeFileSync(path.join(dir, '.mobile-automator', 'config.json'), '{"mode":"platform-aware"}\n');
}

function makeLegacy(dir) {
  fs.mkdirSync(path.join(dir, 'mobile-automator'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'mobile-automator', 'config.json'), '{"mode":"platform-aware"}\n');
}

function mkdirp(...parts) {
  const d = path.join(...parts);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

describe('findWorkspaceRoot', () => {
  test('finds a workspace in the start directory itself', () => {
    const root = tmpProject();
    makeWorkspace(root);
    expect(findWorkspaceRoot(root)).toEqual({ kind: 'found', root, searched: [root] });
  });

  test('finds a workspace three levels up', () => {
    const root = tmpProject();
    makeWorkspace(root);
    const deep = mkdirp(root, 'src', 'deep', 'nested');
    const r = findWorkspaceRoot(deep);
    expect(r.root).toBe(root);
    expect(r.searched).toEqual([deep, path.join(root, 'src', 'deep'), path.join(root, 'src'), root]);
  });

  test('finds the workspace when started inside .mobile-automator/scenarios/', () => {
    const root = tmpProject();
    makeWorkspace(root);
    const scenarios = mkdirp(root, '.mobile-automator', 'scenarios');
    expect(findWorkspaceRoot(scenarios).root).toBe(root);
  });

  test('stops at a .git directory boundary', () => {
    const outer = tmpProject({ git: 'none' });
    makeWorkspace(outer); // above the boundary: must NOT be found
    const repo = mkdirp(outer, 'repo');
    fs.mkdirSync(path.join(repo, '.git'));
    const sub = mkdirp(repo, 'a');
    const r = findWorkspaceRoot(sub);
    expect(r.kind).toBe('none');
    expect(r.searched).toEqual([sub, repo]);
  });

  test('stops at a .git FILE boundary (worktrees, submodules)', () => {
    const outer = tmpProject({ git: 'none' });
    makeWorkspace(outer);
    const repo = mkdirp(outer, 'wt');
    fs.writeFileSync(path.join(repo, '.git'), 'gitdir: /elsewhere\n');
    const sub = mkdirp(repo, 'a');
    const r = findWorkspaceRoot(sub);
    expect(r.kind).toBe('none');
    expect(r.searched).toEqual([sub, repo]);
  });

  test('a workspace AT the .git directory is still found (the boundary is inclusive)', () => {
    const root = tmpProject({ git: 'file' });
    makeWorkspace(root);
    const sub = mkdirp(root, 'x');
    expect(findWorkspaceRoot(sub).root).toBe(root);
  });

  test('a bare .mobile-automator/ directory without config.json is ignored', () => {
    // The false positive the marker exists to prevent: an unrelated directory
    // that merely shares the workspace's name.
    const root = tmpProject();
    fs.mkdirSync(path.join(root, '.mobile-automator'));
    const sub = mkdirp(root, 'src');
    const r = findWorkspaceRoot(sub);
    expect(r.kind).toBe('none');
  });

  test('the nearest of two nested workspaces wins', () => {
    const root = tmpProject();
    makeWorkspace(root);
    const inner = mkdirp(root, 'packages', 'app');
    makeWorkspace(inner);
    const deep = mkdirp(inner, 'lib');
    expect(findWorkspaceRoot(deep).root).toBe(inner);
  });

  test('nothing found -> kind none and the full searched list ending at the .git boundary', () => {
    const root = tmpProject();
    const deep = mkdirp(root, 'a', 'b');
    expect(findWorkspaceRoot(deep)).toEqual({
      kind: 'none',
      searched: [deep, path.join(root, 'a'), root],
    });
  });

  test('stops at the filesystem root when there is no .git anywhere (injected fs)', () => {
    const fakeFs = { existsSync: () => false };
    const start = path.join(path.sep, 'x', 'y');
    const r = findWorkspaceRoot(start, { fs: fakeFs });
    expect(r.kind).toBe('none');
    expect(r.searched).toEqual([start, path.join(path.sep, 'x'), path.sep]);
  });

  test('resolves a relative start directory', () => {
    const root = tmpProject();
    makeWorkspace(root);
    const original = process.cwd();
    process.chdir(root);
    try {
      expect(findWorkspaceRoot('.').root).toBe(root);
    } finally {
      process.chdir(original);
    }
  });
});

describe('findWorkspaceRoot legacy detection', () => {
  test('reports a legacy workspace in the start directory', () => {
    const root = tmpProject();
    makeLegacy(root);
    expect(findWorkspaceRoot(root)).toEqual({ kind: 'legacy', dir: root, searched: [root] });
  });

  test('reports a legacy workspace two levels up', () => {
    const root = tmpProject();
    makeLegacy(root);
    const deep = mkdirp(root, 'src', 'x');
    const r = findWorkspaceRoot(deep);
    expect(r.kind).toBe('legacy');
    expect(r.dir).toBe(root);
  });

  test('the new workspace wins when both exist', () => {
    const root = tmpProject();
    makeLegacy(root);
    makeWorkspace(root);
    const r = findWorkspaceRoot(root);
    expect(r).toEqual({ kind: 'found', root, searched: [root] });
  });

  test('a nearer legacy workspace shadows a new one in an ancestor', () => {
    const root = tmpProject();
    makeWorkspace(root);
    const app = mkdirp(root, 'app');
    makeLegacy(app);
    expect(findWorkspaceRoot(app)).toEqual({ kind: 'legacy', dir: app, searched: [app] });
  });

  test('a nearer new workspace still wins over a legacy one above it', () => {
    const root = tmpProject();
    makeLegacy(root);
    const app = mkdirp(root, 'app');
    makeWorkspace(app);
    expect(findWorkspaceRoot(app).root).toBe(app);
  });

  test('a legacy folder without config.json is not legacy', () => {
    const root = tmpProject();
    fs.mkdirSync(path.join(root, 'mobile-automator'));
    expect(findWorkspaceRoot(root).kind).toBe('none');
  });

  test('does not report a legacy folder above the .git boundary', () => {
    const outer = tmpProject({ git: 'none' });
    makeLegacy(outer);
    const repo = mkdirp(outer, 'repo');
    fs.mkdirSync(path.join(repo, '.git'));
    const r = findWorkspaceRoot(mkdirp(repo, 'a'));
    expect(r.kind).toBe('none');
  });
});

describe('workspaceFailure', () => {
  test('legacy names the dir and gives the mv fix', () => {
    const r = workspaceFailure({ kind: 'legacy', dir: '/p', searched: ['/p'] });
    expect(r.exitKind).toBe('environment');
    expect(r.envelope.error.message).toContain('/p/mobile-automator/');
    expect(r.envelope.error.message).toContain('.mobile-automator/');
    expect(r.envelope.hint).toContain('pkill -f mauto-session-daemon');
    expect(r.envelope.hint).toContain('mv mobile-automator .mobile-automator');
    expect(r.envelope.hint).not.toMatch(/session end/);
  });

  test('none is the plain no-workspace failure', () => {
    const r = workspaceFailure({ kind: 'none', searched: ['/p/a', '/p'] });
    expect(r.envelope.error.message).toMatch(/\.mobile-automator/);
    expect(r.envelope.error.message).not.toContain('legacy');
    for (const p of ['/p/a', '/p']) expect(r.envelope.hint).toContain(p);
  });

  // A found workspace has nothing to fail, and an unknown kind is a bug: both
  // throw rather than pick a failure that does not fit.
  test.each([
    [{ kind: 'found', root: '/p', searched: ['/p'] }],
    [{ root: null, searched: ['/p'] }],
  ])('throws for %j', (ws) => {
    expect(() => workspaceFailure(ws)).toThrow(/no failure/);
  });
});

describe('noWorkspaceFailure', () => {
  test('has no legacy mode: a second argument changes nothing', () => {
    const r = noWorkspaceFailure(['/p'], '/p');
    expect(r.envelope.error.message).not.toContain('legacy');
  });

  test('is an environment failure whose hint names every searched path and `mauto setup`', () => {
    const r = noWorkspaceFailure(['/p/a/b', '/p/a', '/p']);
    expect(r.exitKind).toBe('environment');
    expect(r.envelope.ok).toBe(false);
    expect(r.envelope.error.kind).toBe('environment');
    expect(r.envelope.error.message).toMatch(/\.mobile-automator/);
    for (const p of ['/p/a/b', '/p/a', '/p']) expect(r.envelope.hint).toContain(p);
    expect(r.envelope.hint).toMatch(/mauto setup/);
  });
});

// #346: discovery vets the workspace it is about to adopt. "Foreign owner" is
// an injected uid because jest cannot chown.
describe('findWorkspaceRoot refuses an unsafe workspace (#346)', () => {
  const MY_UID = process.getuid();
  // Never ours, whatever uid the tests run as (a CI runner's is often 1001).
  const FOREIGN_UID = MY_UID + 1;
  const asUid = (uid, which = ['lstatSync', 'fstatSync']) => {
    const wrapped = { ...fs };
    for (const name of which) {
      wrapped[name] = (...args) => {
        const st = fs[name](...args);
        st.uid = uid;
        return st;
      };
    }
    return wrapped;
  };

  test('a foreign-owned .mobile-automator is refused, naming both uids', () => {
    const root = tmpProject();
    makeWorkspace(root);
    const r = findWorkspaceRoot(root, { fs: asUid(FOREIGN_UID, ['lstatSync']) });
    expect(r.kind).toBe('unsafe');
    expect(r.refusal.reason).toBe('foreign_owner');
    expect(r.refusal.message).toContain(`uid ${FOREIGN_UID}; you are uid ${MY_UID}`);
    expect(Object.keys(r).sort()).toEqual(['kind', 'refusal', 'searched']);
  });

  test('MAUTO_TRUST_WORKSPACE_OWNER=1 adopts the foreign-owned workspace', () => {
    const root = tmpProject();
    makeWorkspace(root);
    const r = findWorkspaceRoot(root, { fs: asUid(FOREIGN_UID), env: { MAUTO_TRUST_WORKSPACE_OWNER: '1' } });
    expect(r).toEqual({ kind: 'found', root, searched: [root] });
  });

  test('a foreign-owned config.json is refused', () => {
    const root = tmpProject();
    makeWorkspace(root);
    const r = findWorkspaceRoot(root, { fs: asUid(FOREIGN_UID, ['fstatSync']) });
    expect(r.kind).toBe('unsafe');
    expect(r.refusal.reason).toBe('foreign_owner');
  });

  test('a symlinked .mobile-automator is refused', () => {
    const root = tmpProject();
    const elsewhere = tmpProject();
    makeWorkspace(elsewhere);
    fs.symlinkSync(path.join(elsewhere, '.mobile-automator'), path.join(root, '.mobile-automator'));
    const r = findWorkspaceRoot(root);
    expect(r.kind).toBe('unsafe');
    expect(r.refusal.reason).toBe('symlink');
    expect(r.refusal.path).toBe(path.join(root, '.mobile-automator'));
  });

  test('a symlinked config.json is refused', () => {
    const root = tmpProject();
    makeWorkspace(root);
    const real = path.join(root, 'real.json');
    fs.renameSync(path.join(root, '.mobile-automator', 'config.json'), real);
    fs.symlinkSync(real, path.join(root, '.mobile-automator', 'config.json'));
    const r = findWorkspaceRoot(root);
    expect(r.kind).toBe('unsafe');
    expect(r.refusal.reason).toBe('symlink');
  });

  test('a world-writable .mobile-automator is refused; group-writable is adopted', () => {
    if (MY_UID === 0) return;
    const root = tmpProject();
    makeWorkspace(root);
    const ws = path.join(root, '.mobile-automator');
    fs.chmodSync(ws, 0o777);
    const bad = findWorkspaceRoot(root);
    expect(bad.kind).toBe('unsafe');
    expect(bad.refusal.reason).toBe('world_writable');
    fs.chmodSync(ws, 0o775);
    expect(findWorkspaceRoot(root).root).toBe(root);
  });

  test('an unsafe nearer workspace does not fall through to a safe ancestor', () => {
    const root = tmpProject({ git: 'none' });
    makeWorkspace(root);
    const child = mkdirp(root, 'pkg');
    makeWorkspace(child);
    const r = findWorkspaceRoot(child, { fs: asUid(FOREIGN_UID, ['lstatSync']) });
    // every directory is foreign under the injected uid; the NEAREST decides
    expect(r.kind).toBe('unsafe');
    expect(r.refusal.path).toBe(path.join(child, '.mobile-automator'));
    expect(r.searched).toEqual([child]);
  });

  // Only a planted path is refused, and only a known fs condition adopts:
  // anything else is not quietly read as "safe" (#346).
  test('an unreadable marker (EACCES) adopts the workspace', () => {
    const root = tmpProject();
    makeWorkspace(root);
    const denied = {
      ...fs,
      openSync: () => {
        throw Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });
      },
    };
    expect(findWorkspaceRoot(root, { fs: denied })).toEqual({ kind: 'found', root, searched: [root] });
  });

  test('a marker that raced away after existsSync (ENOENT) adopts the workspace', () => {
    const root = tmpProject();
    makeWorkspace(root);
    const raced = {
      ...fs,
      openSync: () => {
        throw Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' });
      },
    };
    expect(findWorkspaceRoot(root, { fs: raced }).root).toBe(root);
  });

  test('any other error propagates: a TypeError from an incomplete injected fs', () => {
    const root = tmpProject();
    makeWorkspace(root);
    const incomplete = { existsSync: fs.existsSync };
    expect(() => findWorkspaceRoot(root, { fs: incomplete })).toThrow(TypeError);
  });

  test('so does an unknown fs code (EMFILE)', () => {
    const root = tmpProject();
    makeWorkspace(root);
    const exhausted = {
      ...fs,
      openSync: () => {
        throw Object.assign(new Error('EMFILE: too many open files'), { code: 'EMFILE' });
      },
    };
    expect(() => findWorkspaceRoot(root, { fs: exhausted })).toThrow('EMFILE');
  });

  test('workspaceFailure renders environment with the refusal message and hint', () => {
    const root = tmpProject();
    makeWorkspace(root);
    const ws = findWorkspaceRoot(root, { fs: asUid(FOREIGN_UID, ['lstatSync']) });
    const { envelope, exitKind } = workspaceFailure(ws);
    expect(exitKind).toBe('environment');
    expect(envelope.ok).toBe(false);
    expect(envelope.error.kind).toBe('environment');
    expect(envelope.error.message).toBe(ws.refusal.message);
    expect(envelope.hint).toBe(ws.refusal.hint);
  });
});
