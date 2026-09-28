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

const { findWorkspaceRoot, noWorkspaceFailure } = require('../../../src/workspace/discover');

function tmpProject({ git = 'dir' } = {}) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-discover-')));
  if (git === 'dir') fs.mkdirSync(path.join(root, '.git'));
  if (git === 'file') fs.writeFileSync(path.join(root, '.git'), 'gitdir: /elsewhere/.git/worktrees/x\n');
  return root;
}

function makeWorkspace(dir) {
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
    expect(findWorkspaceRoot(root)).toEqual({ root, searched: [root] });
  });

  test('finds a workspace three levels up', () => {
    const root = tmpProject();
    makeWorkspace(root);
    const deep = mkdirp(root, 'src', 'deep', 'nested');
    const r = findWorkspaceRoot(deep);
    expect(r.root).toBe(root);
    expect(r.searched).toEqual([deep, path.join(root, 'src', 'deep'), path.join(root, 'src'), root]);
  });

  test('finds the workspace when started inside mobile-automator/scenarios/', () => {
    const root = tmpProject();
    makeWorkspace(root);
    const scenarios = mkdirp(root, 'mobile-automator', 'scenarios');
    expect(findWorkspaceRoot(scenarios).root).toBe(root);
  });

  test('stops at a .git directory boundary', () => {
    const outer = tmpProject({ git: 'none' });
    makeWorkspace(outer); // above the boundary: must NOT be found
    const repo = mkdirp(outer, 'repo');
    fs.mkdirSync(path.join(repo, '.git'));
    const sub = mkdirp(repo, 'a');
    const r = findWorkspaceRoot(sub);
    expect(r.root).toBeNull();
    expect(r.searched).toEqual([sub, repo]);
  });

  test('stops at a .git FILE boundary (worktrees, submodules)', () => {
    const outer = tmpProject({ git: 'none' });
    makeWorkspace(outer);
    const repo = mkdirp(outer, 'wt');
    fs.writeFileSync(path.join(repo, '.git'), 'gitdir: /elsewhere\n');
    const sub = mkdirp(repo, 'a');
    const r = findWorkspaceRoot(sub);
    expect(r.root).toBeNull();
    expect(r.searched).toEqual([sub, repo]);
  });

  test('a workspace AT the .git directory is still found (the boundary is inclusive)', () => {
    const root = tmpProject({ git: 'file' });
    makeWorkspace(root);
    const sub = mkdirp(root, 'x');
    expect(findWorkspaceRoot(sub).root).toBe(root);
  });

  test('a bare mobile-automator/ directory without config.json is ignored', () => {
    // The false positive the marker exists to prevent: this repo is itself
    // usually cloned into a folder named `mobile-automator`.
    const root = tmpProject();
    fs.mkdirSync(path.join(root, 'mobile-automator'));
    const sub = mkdirp(root, 'src');
    const r = findWorkspaceRoot(sub);
    expect(r.root).toBeNull();
  });

  test('the nearest of two nested workspaces wins', () => {
    const root = tmpProject();
    makeWorkspace(root);
    const inner = mkdirp(root, 'packages', 'app');
    makeWorkspace(inner);
    const deep = mkdirp(inner, 'lib');
    expect(findWorkspaceRoot(deep).root).toBe(inner);
  });

  test('nothing found -> root:null and the full searched list ending at the .git boundary', () => {
    const root = tmpProject();
    const deep = mkdirp(root, 'a', 'b');
    expect(findWorkspaceRoot(deep)).toEqual({
      root: null,
      searched: [deep, path.join(root, 'a'), root],
    });
  });

  test('stops at the filesystem root when there is no .git anywhere (injected fs)', () => {
    const fakeFs = { existsSync: () => false };
    const start = path.join(path.sep, 'x', 'y');
    const r = findWorkspaceRoot(start, { fs: fakeFs });
    expect(r.root).toBeNull();
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

describe('noWorkspaceFailure', () => {
  test('is an environment failure whose hint names every searched path and `mauto setup`', () => {
    const r = noWorkspaceFailure(['/p/a/b', '/p/a', '/p']);
    expect(r.exitKind).toBe('environment');
    expect(r.envelope.ok).toBe(false);
    expect(r.envelope.error.kind).toBe('environment');
    expect(r.envelope.error.message).toMatch(/mobile-automator/);
    for (const p of ['/p/a/b', '/p/a', '/p']) expect(r.envelope.hint).toContain(p);
    expect(r.envelope.hint).toMatch(/mauto setup/);
  });
});
