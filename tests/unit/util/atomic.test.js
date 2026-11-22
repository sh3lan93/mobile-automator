'use strict';

// #345: a write into a checked-in workspace must not follow a committed
// symlink out of it. atomicWorkspaceWrite walks the directory with safe-fs;
// every writer creates the temp file O_EXCL|O_NOFOLLOW under a random name.
// #347: atomicProjectWrite confines a project file the same way, and
// atomicOutputWrite confines a user-chosen path only when it lands in the
// workspace; anywhere else it writes unconfined, by design.

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  atomicWorkspaceWrite,
  atomicProjectWrite,
  atomicOutputWrite,
  tempPathFor,
} = require('../../../src/util/atomic');
const { UnsafePathError } = require('../../../src/workspace/safe-fs');

const ORIGINAL = '# Run History\nSECRET-CANARY\n';

function fixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-atomic-')));
  const outside = path.join(root, 'outside');
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'run-history.md'), ORIGINAL);
  const ws = path.join(root, '.mobile-automator');
  fs.mkdirSync(ws);
  return { root, outside, ws };
}

function thrown(fn) {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return null;
}

describe('atomicWorkspaceWrite (#345)', () => {
  test.each([
    ['an absolute', (outside) => outside],
    ['a relative', () => path.join('..', 'outside')],
  ])('refuses memory/ as %s symlink to an outside dir', (_label, target) => {
    const { root, outside, ws } = fixture();
    fs.symlinkSync(target(outside), path.join(ws, 'memory'));
    const file = path.join(ws, 'memory', 'run-history.md');

    const err = thrown(() => atomicWorkspaceWrite(root, file, 'pwned\n'));

    expect(err).toBeInstanceOf(UnsafePathError);
    expect(err.reason).toBe('symlink');
    expect(fs.readFileSync(path.join(outside, 'run-history.md'), 'utf8')).toBe(ORIGINAL);
    expect(fs.readdirSync(outside)).toEqual(['run-history.md']);
  });

  test('a symlink leaf at the target is replaced by a regular file; its target is unchanged', () => {
    const { root, outside, ws } = fixture();
    fs.mkdirSync(path.join(ws, 'memory'));
    const file = path.join(ws, 'memory', 'run-history.md');
    fs.symlinkSync(path.join(outside, 'run-history.md'), file);

    atomicWorkspaceWrite(root, file, 'fresh\n');

    expect(fs.lstatSync(file).isFile()).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe('fresh\n');
    expect(fs.readFileSync(path.join(outside, 'run-history.md'), 'utf8')).toBe(ORIGINAL);
  });

  test('creates missing workspace directories and leaves no temp file behind', () => {
    const { root, ws } = fixture();
    const file = path.join(ws, 'results', 'r1.json');
    atomicWorkspaceWrite(root, file, '{}\n');
    expect(fs.readFileSync(file, 'utf8')).toBe('{}\n');
    expect(fs.readdirSync(path.join(ws, 'results'))).toEqual(['r1.json']);
  });

  test('refuses a target outside the workspace, writing nothing', () => {
    const { root } = fixture();
    const file = path.join(root, 'elsewhere', 'r1.json');
    const err = thrown(() => atomicWorkspaceWrite(root, file, '{}\n'));
    expect(err).toBeInstanceOf(UnsafePathError);
    expect(err.reason).toBe('escape');
    expect(fs.existsSync(path.join(root, 'elsewhere'))).toBe(false);
  });

  test('without a project root it throws a TypeError and writes nothing', () => {
    const { ws } = fixture();
    const file = path.join(ws, 'results', 'r1.json');
    const err = thrown(() => atomicWorkspaceWrite(file, '{}\n'));
    expect(err).toBeInstanceOf(TypeError);
    expect(fs.existsSync(path.join(ws, 'results'))).toBe(false);
  });
});

// The unconfined write is private: reached only through atomicOutputWrite,
// for a path outside the workspace.
describe('atomicOutputWrite outside the workspace (paths the user chose)', () => {
  test('the unconfined writer is not exported', () => {
    expect(Object.keys(require('../../../src/util/atomic')).sort()).toEqual([
      'atomicOutputWrite', 'atomicProjectWrite', 'atomicUserLeafWrite', 'atomicWorkspaceWrite', 'tempPathFor',
    ]);
  });

  test('writes, creating parent directories, with no temp file left', () => {
    const { root } = fixture();
    const file = path.join(root, 'out', 'deep', 'report.xml');
    atomicOutputWrite(root, file, '<x/>');
    expect(fs.readFileSync(file, 'utf8')).toBe('<x/>');
    expect(fs.readdirSync(path.dirname(file))).toEqual(['report.xml']);
  });

  test('overwrites an existing file', () => {
    const { root } = fixture();
    const file = path.join(root, 'report.xml');
    fs.writeFileSync(file, 'old');
    atomicOutputWrite(root, file, 'new');
    expect(fs.readFileSync(file, 'utf8')).toBe('new');
  });

  test('the temp file name carries a random suffix, so it cannot be pre-planted', () => {
    const { root } = fixture();
    const file = path.join(root, 'report.xml');
    const opened = [];
    const realOpen = fs.openSync;
    const spy = jest.spyOn(fs, 'openSync').mockImplementation((p, ...rest) => {
      opened.push(p);
      return realOpen(p, ...rest);
    });
    try {
      atomicOutputWrite(root, file, 'a');
      atomicOutputWrite(root, file, 'b');
    } finally {
      spy.mockRestore();
    }
    expect(opened).toHaveLength(2);
    expect(opened[0]).not.toBe(opened[1]);
    for (const p of opened) expect(path.basename(p)).toMatch(/^\.report\.xml\.tmp\.\d+\.\d+\.[0-9a-f]{12}$/);
  });
});

// A directory outside the project, removed after each test.
const made = [];
afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});
function elsewhere() {
  const d = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-atomic-elsewhere-')));
  made.push(d);
  return d;
}

describe('atomicProjectWrite (#347)', () => {
  test('writes a project file, creating the directories below the root, with no temp file left', () => {
    const { root } = fixture();
    const file = path.join(root, '.claude', 'skills', 'mobile-automator-execute', 'SKILL.md');
    atomicProjectWrite(root, file, '---\nname: x\n---\n');
    expect(fs.readFileSync(file, 'utf8')).toBe('---\nname: x\n---\n');
    expect(fs.readdirSync(path.dirname(file))).toEqual(['SKILL.md']);
  });

  test('writes a file at the project root and overwrites an existing one', () => {
    const { root } = fixture();
    const file = path.join(root, '.mcp.json');
    fs.writeFileSync(file, 'old');
    atomicProjectWrite(root, file, '{}\n');
    expect(fs.readFileSync(file, 'utf8')).toBe('{}\n');
  });

  test.each([
    ['.claude', ['.claude']],
    ['.claude/skills', ['.claude', 'skills']],
  ])('refuses %s as a symlink to an outside dir, leaving it untouched', (_label, parts) => {
    const { root } = fixture();
    const out = elsewhere();
    fs.writeFileSync(path.join(out, 'SKILL.md'), ORIGINAL);
    fs.mkdirSync(path.join(root, ...parts.slice(0, -1)), { recursive: true });
    fs.symlinkSync(out, path.join(root, ...parts));
    const file = path.join(root, '.claude', 'skills', 'SKILL.md');

    const err = thrown(() => atomicProjectWrite(root, file, 'pwned\n'));

    expect(err).toBeInstanceOf(UnsafePathError);
    expect(err.reason).toBe('symlink');
    expect(err.scope).toBe('path');
    expect(fs.readdirSync(out)).toEqual(['SKILL.md']);
    expect(fs.readFileSync(path.join(out, 'SKILL.md'), 'utf8')).toBe(ORIGINAL);
  });

  test('a symlink leaf is replaced by a regular file; its target is unchanged', () => {
    const { root } = fixture();
    const out = elsewhere();
    fs.writeFileSync(path.join(out, 'AGENTS.md'), ORIGINAL);
    const file = path.join(root, 'AGENTS.md');
    fs.symlinkSync(path.join(out, 'AGENTS.md'), file);

    atomicProjectWrite(root, file, 'fresh\n');

    expect(fs.lstatSync(file).isFile()).toBe(true);
    expect(fs.readFileSync(file, 'utf8')).toBe('fresh\n');
    expect(fs.readFileSync(path.join(out, 'AGENTS.md'), 'utf8')).toBe(ORIGINAL);
  });

  test('refuses a target outside the project (escape), writing nothing', () => {
    const { root } = fixture();
    const out = elsewhere();
    const err = thrown(() => atomicProjectWrite(root, path.join(out, 'x.md'), 'x'));
    expect(err).toBeInstanceOf(UnsafePathError);
    expect(err.reason).toBe('escape');
    expect(fs.readdirSync(out)).toEqual([]);
  });

  test('without a project root it throws a TypeError and writes nothing', () => {
    const { root } = fixture();
    const file = path.join(root, '.claude', 'x.md');
    const err = thrown(() => atomicProjectWrite(file, 'x'));
    expect(err).toBeInstanceOf(TypeError);
    expect(err.message).toMatch(/^atomicProjectWrite\(projectRoot, file, contents\)/);
    expect(fs.existsSync(path.join(root, '.claude'))).toBe(false);
  });
});

describe('atomicOutputWrite (#347: a path the user chose)', () => {
  test('a workspace path under a symlinked results/ is refused, the outside untouched', () => {
    const { root, ws } = fixture();
    const out = elsewhere();
    fs.symlinkSync(out, path.join(ws, 'results'));
    const err = thrown(() => atomicOutputWrite(root, path.join(ws, 'results', 'junit.xml'), '<x/>'));
    expect(err).toBeInstanceOf(UnsafePathError);
    expect(err.reason).toBe('symlink');
    expect(err.scope).toBe('workspace');
    expect(fs.readdirSync(out)).toEqual([]);
  });

  test('a clean workspace path is written, its directories created', () => {
    const { root, ws } = fixture();
    const file = path.join(ws, 'results', 'junit.xml');
    atomicOutputWrite(root, file, '<x/>');
    expect(fs.readFileSync(file, 'utf8')).toBe('<x/>');
  });

  test('a path outside the workspace is written unconfined (outside the project too)', () => {
    const { root } = fixture();
    const out = elsewhere();
    atomicOutputWrite(root, path.join(out, 'deep', 'junit.xml'), '<x/>');
    expect(fs.readFileSync(path.join(out, 'deep', 'junit.xml'), 'utf8')).toBe('<x/>');
    atomicOutputWrite(root, path.join(root, 'reports', 'junit.xml'), '<y/>');
    expect(fs.readFileSync(path.join(root, 'reports', 'junit.xml'), 'utf8')).toBe('<y/>');
  });

  test('a workspace path reached through an aliased root is confined', () => {
    const { root, ws } = fixture();
    const out = elsewhere();
    const alias = path.join(elsewhere(), 'alias');
    fs.symlinkSync(root, alias);
    fs.symlinkSync(out, path.join(ws, 'results'));
    const err = thrown(() =>
      atomicOutputWrite(root, path.join(alias, '.mobile-automator', 'results', 'junit.xml'), '<x/>')
    );
    expect(err).toBeInstanceOf(UnsafePathError);
    expect(err.reason).toBe('symlink');
    expect(fs.readdirSync(out)).toEqual([]);
  });

  test('a clean workspace path through the aliased root lands in the real workspace', () => {
    const { root, ws } = fixture();
    const alias = path.join(elsewhere(), 'alias');
    fs.symlinkSync(root, alias);
    atomicOutputWrite(root, path.join(alias, '.mobile-automator', 'results', 'junit.xml'), '<x/>');
    expect(fs.readFileSync(path.join(ws, 'results', 'junit.xml'), 'utf8')).toBe('<x/>');
  });

  test('without a project root it throws a TypeError and writes nothing', () => {
    const out = elsewhere();
    const err = thrown(() => atomicOutputWrite(path.join(out, 'junit.xml'), '<x/>'));
    expect(err).toBeInstanceOf(TypeError);
    expect(err.message).toMatch(/^atomicOutputWrite\(projectRoot, file, contents\)/);
    expect(fs.readdirSync(out)).toEqual([]);
  });
});

describe('tempPathFor', () => {
  test('names a hidden sibling of the file, carrying its basename and the pid, unique per call', () => {
    const file = path.join('/ws', '.mobile-automator', '.session', 'marker.salt');
    const a = tempPathFor(file);
    const b = tempPathFor(file);
    expect(path.dirname(a)).toBe(path.dirname(file));
    expect(path.basename(a).startsWith('.marker.salt.tmp.')).toBe(true);
    expect(path.basename(a)).toContain(`.${process.pid}.`);
    expect(a).not.toBe(b);
  });
});

// #348: mauto's own file outside every project (the per-user consent record),
// in a directory the caller settled: no project root, the temp file opened
// through openUserLeaf.
describe('atomicUserLeafWrite', () => {
  const { atomicUserLeafWrite } = require('../../../src/util/atomic');

  test('writes with the given mode, overwriting, with no temp file left', () => {
    const dir = elsewhere();
    const file = path.join(dir, 'record.json');
    fs.writeFileSync(file, 'old');
    fs.chmodSync(file, 0o644);
    atomicUserLeafWrite(file, 'new', { mode: 0o600 });
    expect(fs.readFileSync(file, 'utf8')).toBe('new');
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.readdirSync(dir)).toEqual(['record.json']);
  });

  test('replaces a planted symlink leaf, never writing through it', () => {
    const dir = elsewhere();
    const outside = path.join(elsewhere(), 'secret.txt');
    fs.writeFileSync(outside, ORIGINAL);
    const file = path.join(dir, 'record.json');
    fs.symlinkSync(outside, file);
    atomicUserLeafWrite(file, 'new', { mode: 0o600 });
    expect(fs.lstatSync(file).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(file, 'utf8')).toBe('new');
    expect(fs.readFileSync(outside, 'utf8')).toBe(ORIGINAL);
  });

  test('opens the temp file through the user-leaf rule (O_NOFOLLOW, refusal in the path scope)', () => {
    const dir = elsewhere();
    const file = path.join(dir, 'record.json');
    const spy = jest.spyOn(fs, 'fstatSync').mockImplementation(() => ({ isFile: () => true, uid: process.getuid() + 1, nlink: 1 }));
    let err;
    try {
      err = thrown(() => atomicUserLeafWrite(file, 'x', { mode: 0o600 }));
    } finally {
      spy.mockRestore();
    }
    expect(err).toBeInstanceOf(UnsafePathError);
    expect(err.reason).toBe('foreign_owner');
    expect(err.scope).toBe('path');
    // Nothing is renamed into place.
    expect(fs.existsSync(file)).toBe(false);
  });

  test('refuses a call without contents', () => {
    expect(() => atomicUserLeafWrite('/tmp/x')).toThrow(TypeError);
  });
});
