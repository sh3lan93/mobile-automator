'use strict';

// safe-fs (#345): every workspace read/write refuses a symlinked, foreign,
// world-writable or otherwise planted path. Real tmp trees, because the
// guarantees are about how the kernel resolves (or refuses to resolve) links;
// only "another owner" is simulated (an injected getuid or a wrapped fs),
// because jest cannot chown.
//
// Each fixture has a project root holding `.mobile-automator/` and a sibling
// `outside/` holding a canary file. A refusal must leave `outside/` exactly as
// it was and never put the canary or the outside path in an envelope.

const os = require('os');
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');

const {
  UnsafePathError,
  safeDir,
  readWorkspaceFile,
  readWorkspaceFileOrNull,
  readWorkspaceJsonOrNull,
  openWorkspaceFile,
  createWorkspaceFile,
  removeWorkspaceFile,
  openLeaf,
  openOwnedLeaf,
  inWorkspace,
  safeWorkspaceDest,
  readProjectFile,
  createProjectFile,
  isInside,
} = require('../../../src/workspace/safe-fs');
// The envelope boundary: a refusal reaches the agent through toEnvelope's
// typed-error branch, which maps the error's own kind, message and hint.
const { toEnvelope } = require('../../../src/cli');

const { O_RDONLY, O_WRONLY, O_RDWR, O_CREAT, O_EXCL, O_TRUNC } = fs.constants;
const CANARY = 'SECRET-CANARY';
const REAL_UID = process.getuid();

let base;
let root;
let ws;
let outside;
let canaryFile;

beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-safefs-'));
  root = path.join(base, 'project');
  ws = path.join(root, '.mobile-automator');
  outside = path.join(base, 'outside');
  fs.mkdirSync(ws, { recursive: true });
  fs.mkdirSync(outside);
  canaryFile = path.join(outside, 'secret.txt');
  fs.writeFileSync(canaryFile, CANARY);
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

// A snapshot of every name and byte under outside/, to prove a refusal wrote,
// created and truncated nothing there.
function snapshot(dir) {
  const out = {};
  for (const name of fs.readdirSync(dir).sort()) {
    const p = path.join(dir, name);
    const st = fs.lstatSync(p);
    out[name] = st.isDirectory() ? snapshot(p) : fs.readFileSync(p, 'utf8');
  }
  return out;
}

function expectUnsafe(fn, reason) {
  let caught;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(UnsafePathError);
  expect(caught.code).toBe('EUNSAFEPATH');
  expect(caught.reason).toBe(reason);
  return caught;
}

// An fs whose stat calls report another owner. `which` picks lstat (the dir
// walk), fstat (the leaf) or both.
function foreignFs(which = ['lstatSync', 'fstatSync']) {
  const wrapped = { ...fs };
  for (const name of which) {
    wrapped[name] = (...args) => {
      const st = fs[name](...args);
      st.uid = REAL_UID + 1;
      return st;
    };
  }
  return wrapped;
}

// An fs whose lstat reports another owner for one path only: the walk passes
// every other component, so the refusal (or acceptance) is that path's alone.
function foreignAt(target) {
  return {
    ...fs,
    lstatSync: (p, ...rest) => {
      const st = fs.lstatSync(p, ...rest);
      if (path.resolve(p) === path.resolve(target)) st.uid = REAL_UID + 1;
      return st;
    },
  };
}

function makeFifo(p) {
  try {
    childProcess.execFileSync('mkfifo', [p], { stdio: 'ignore' });
    return true;
  } catch (_) {
    return false; // no mkfifo on this host: nothing to test
  }
}

// A blocking open on a FIFO would freeze the event loop so jest's timeout
// could never fire; run it in a child with a hard timeout instead. `call` is
// the expression to evaluate, with the module bound to `m` and the remaining
// argv strings to `a`; the child prints the refusal reason (or fs code).
function reasonInChild(call, ...args) {
  const modulePath = require.resolve('../../../src/workspace/safe-fs');
  const script = [
    'const [, mod, ...a] = process.argv; const m = require(mod);',
    `try { ${call}; process.stdout.write("null"); }`,
    'catch (e) { process.stdout.write(JSON.stringify(e.reason || e.code)); }',
  ].join('\n');
  return JSON.parse(
    childProcess.execFileSync(process.execPath, ['-e', script, modulePath, ...args], {
      encoding: 'utf8',
      timeout: 3000,
    })
  );
}

function readReasonInChild(projectRoot, file) {
  return reasonInChild('m.readWorkspaceFile(a[0], a[1])', projectRoot, file);
}

describe('safeDir', () => {
  it('returns the realpath of an existing workspace subdirectory', () => {
    fs.mkdirSync(path.join(ws, 'memory'));
    expect(safeDir(root, path.join(ws, 'memory'))).toBe(fs.realpathSync(path.join(ws, 'memory')));
  });

  it('accepts the workspace directory itself', () => {
    expect(safeDir(root, ws)).toBe(fs.realpathSync(ws));
  });

  it('refuses an absolute symlinked component (symlink), creating nothing outside', () => {
    fs.symlinkSync(outside, path.join(ws, 'memory'));
    const before = snapshot(outside);
    expectUnsafe(() => safeDir(root, path.join(ws, 'memory', 'deep'), { create: true }), 'symlink');
    expect(snapshot(outside)).toEqual(before);
    expect(fs.existsSync(path.join(outside, 'deep'))).toBe(false);
  });

  it('refuses a relative symlinked component (symlink)', () => {
    fs.symlinkSync(path.join('..', '..', 'outside'), path.join(ws, 'results'));
    const before = snapshot(outside);
    expectUnsafe(() => safeDir(root, path.join(ws, 'results'), { create: true }), 'symlink');
    expect(snapshot(outside)).toEqual(before);
  });

  it('refuses a symlinked .mobile-automator itself (symlink)', () => {
    fs.rmSync(ws, { recursive: true });
    fs.symlinkSync(outside, ws);
    expectUnsafe(() => safeDir(root, ws), 'symlink');
  });

  it('refuses a dir that resolves outside the workspace (escape)', () => {
    const err = expectUnsafe(() => safeDir(root, path.join(ws, '..', '..', 'outside')), 'escape');
    expect(err.path).not.toContain(CANARY);
  });

  it('refuses a regular file where a directory is expected (not_directory)', () => {
    fs.writeFileSync(path.join(ws, 'memory'), 'x');
    expectUnsafe(() => safeDir(root, path.join(ws, 'memory', 'sub'), { create: true }), 'not_directory');
  });

  it('refuses a world-writable component (world_writable)', () => {
    const d = path.join(ws, 'memory');
    fs.mkdirSync(d);
    fs.chmodSync(d, 0o777);
    expectUnsafe(() => safeDir(root, d), 'world_writable');
  });

  it('accepts a group-writable component (Ubuntu umask 002)', () => {
    const d = path.join(ws, 'memory');
    fs.mkdirSync(d);
    fs.chmodSync(d, 0o775);
    fs.chmodSync(ws, 0o775);
    expect(safeDir(root, d)).toBe(fs.realpathSync(d));
  });

  it('refuses a component owned by another uid (foreign_owner)', () => {
    expectUnsafe(() => safeDir(root, ws, {}, { getuid: () => REAL_UID + 1 }), 'foreign_owner');
  });

  it('MAUTO_TRUST_WORKSPACE_OWNER=1 accepts a foreign uid', () => {
    const deps = { getuid: () => REAL_UID + 1, env: { MAUTO_TRUST_WORKSPACE_OWNER: '1' } };
    expect(safeDir(root, ws, {}, deps)).toBe(fs.realpathSync(ws));
  });

  it('MAUTO_TRUST_WORKSPACE_OWNER=1 still refuses a symlink', () => {
    fs.symlinkSync(outside, path.join(ws, 'memory'));
    const deps = { getuid: () => REAL_UID + 1, env: { MAUTO_TRUST_WORKSPACE_OWNER: '1' } };
    expectUnsafe(() => safeDir(root, path.join(ws, 'memory'), {}, deps), 'symlink');
  });

  it('MAUTO_TRUST_WORKSPACE_OWNER=1 still refuses a world-writable dir', () => {
    fs.chmodSync(ws, 0o777);
    const deps = { getuid: () => REAL_UID + 1, env: { MAUTO_TRUST_WORKSPACE_OWNER: '1' } };
    expectUnsafe(() => safeDir(root, ws, {}, deps), 'world_writable');
  });

  it('only the exact value "1" trusts a foreign owner', () => {
    const deps = { getuid: () => REAL_UID + 1, env: { MAUTO_TRUST_WORKSPACE_OWNER: 'true' } };
    expectUnsafe(() => safeDir(root, ws, {}, deps), 'foreign_owner');
  });

  it('accepts a project root reached through a symlinked parent, returning a realpath', () => {
    const linkParent = path.join(base, 'linked');
    fs.symlinkSync(base, linkParent);
    const viaLink = path.join(linkParent, 'project');
    fs.mkdirSync(path.join(ws, 'memory'));
    const got = safeDir(viaLink, path.join(viaLink, '.mobile-automator', 'memory'));
    expect(got).toBe(fs.realpathSync(path.join(ws, 'memory')));
    expect(got).not.toContain(`${path.sep}linked${path.sep}`);
  });

  it('accepts a project root that is itself a symlink', () => {
    const linkRoot = path.join(base, 'root-link');
    fs.symlinkSync(root, linkRoot);
    expect(safeDir(linkRoot, path.join(linkRoot, '.mobile-automator'))).toBe(fs.realpathSync(ws));
  });

  it('create: true makes missing nested dirs with the given mode and returns the realpath', () => {
    const d = path.join(ws, 'results', 'run-1', 'shots');
    const got = safeDir(root, d, { create: true, mode: 0o700 });
    expect(got).toBe(fs.realpathSync(d));
    for (const p of [path.join(ws, 'results'), path.join(ws, 'results', 'run-1'), d]) {
      expect(fs.lstatSync(p).isDirectory()).toBe(true);
      expect(fs.lstatSync(p).mode & 0o777).toBe(0o700);
    }
  });

  it('create: true makes .mobile-automator itself when missing', () => {
    fs.rmSync(ws, { recursive: true });
    expect(safeDir(root, path.join(ws, 'memory'), { create: true })).toBe(fs.realpathSync(path.join(ws, 'memory')));
  });

  it('without create, a missing component throws the plain ENOENT error', () => {
    let caught;
    try {
      safeDir(root, path.join(ws, 'nope', 'deeper'));
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught).not.toBeInstanceOf(UnsafePathError);
    expect(caught.code).toBe('ENOENT');
  });

  it('a newly created dir is re-checked (a world-writable mode is refused)', () => {
    const umask = process.umask(0);
    try {
      expectUnsafe(() => safeDir(root, path.join(ws, 'open'), { create: true, mode: 0o777 }), 'world_writable');
    } finally {
      process.umask(umask);
    }
  });

  it('tolerates a mkdir race (EEXIST) and checks what is there', () => {
    const racing = { ...fs };
    racing.mkdirSync = (p, opts) => {
      fs.mkdirSync(p, opts);
      const e = new Error('EEXIST');
      e.code = 'EEXIST';
      throw e;
    };
    const d = path.join(ws, 'memory');
    expect(safeDir(root, d, { create: true }, { fs: racing })).toBe(fs.realpathSync(d));
  });

  it('a mkdir race that plants a symlink is refused', () => {
    const racing = { ...fs };
    racing.mkdirSync = (p) => {
      fs.symlinkSync(outside, p);
      const e = new Error('EEXIST');
      e.code = 'EEXIST';
      throw e;
    };
    expectUnsafe(() => safeDir(root, path.join(ws, 'memory'), { create: true }, { fs: racing }), 'symlink');
  });
});

describe('readWorkspaceFile', () => {
  it('reads a regular workspace file as utf8', () => {
    fs.writeFileSync(path.join(ws, 'config.json'), '{"mode":"platform-aware"}');
    expect(readWorkspaceFile(root, path.join(ws, 'config.json'))).toBe('{"mode":"platform-aware"}');
  });

  it('returns null for a missing file', () => {
    expect(readWorkspaceFile(root, path.join(ws, 'config.json'))).toBeNull();
  });

  it('returns null for a missing parent dir', () => {
    expect(readWorkspaceFile(root, path.join(ws, 'memory', 'app.json'))).toBeNull();
  });

  it('refuses a leaf symlink (symlink) and never returns its content', () => {
    fs.symlinkSync(canaryFile, path.join(ws, 'config.json'));
    expectUnsafe(() => readWorkspaceFile(root, path.join(ws, 'config.json')), 'symlink');
  });

  it('refuses a file under a symlinked dir (symlink)', () => {
    fs.symlinkSync(outside, path.join(ws, 'memory'));
    expectUnsafe(() => readWorkspaceFile(root, path.join(ws, 'memory', 'secret.txt')), 'symlink');
  });

  it('refuses a directory as the leaf (not_regular)', () => {
    fs.mkdirSync(path.join(ws, 'config.json'));
    expectUnsafe(() => readWorkspaceFile(root, path.join(ws, 'config.json')), 'not_regular');
  });

  it('refuses a FIFO as the leaf (not_regular) without blocking', () => {
    const p = path.join(ws, 'config.json');
    if (!makeFifo(p)) return;
    expect(readReasonInChild(root, p)).toBe('not_regular');
  }, 10000);

  it('refuses a file over maxBytes (too_large)', () => {
    fs.writeFileSync(path.join(ws, 'big.json'), 'x'.repeat(11));
    expectUnsafe(() => readWorkspaceFile(root, path.join(ws, 'big.json'), { maxBytes: 10 }), 'too_large');
  });

  it('reads a file of exactly maxBytes', () => {
    fs.writeFileSync(path.join(ws, 'edge.json'), 'x'.repeat(10));
    expect(readWorkspaceFile(root, path.join(ws, 'edge.json'), { maxBytes: 10 })).toBe('x'.repeat(10));
  });

  it('reads a file larger than one read chunk', () => {
    const body = 'y'.repeat(200 * 1024);
    fs.writeFileSync(path.join(ws, 'big.json'), body);
    expect(readWorkspaceFile(root, path.join(ws, 'big.json'))).toBe(body);
  });

  it('refuses a leaf owned by another uid (foreign_owner)', () => {
    fs.writeFileSync(path.join(ws, 'config.json'), '{}');
    expectUnsafe(
      () => readWorkspaceFile(root, path.join(ws, 'config.json'), {}, { fs: foreignFs(['fstatSync']) }),
      'foreign_owner'
    );
  });

  it('MAUTO_TRUST_WORKSPACE_OWNER=1 reads a foreign-owned leaf', () => {
    fs.writeFileSync(path.join(ws, 'config.json'), '{}');
    const deps = { fs: foreignFs(), env: { MAUTO_TRUST_WORKSPACE_OWNER: '1' } };
    expect(readWorkspaceFile(root, path.join(ws, 'config.json'), {}, deps)).toBe('{}');
  });

  it('closes the fd it opened, on success and on refusal', () => {
    fs.writeFileSync(path.join(ws, 'config.json'), '{}');
    fs.writeFileSync(path.join(ws, 'big.json'), 'x'.repeat(11));
    const opened = [];
    const closed = [];
    const tracking = { ...fs };
    tracking.openSync = (...args) => {
      const fd = fs.openSync(...args);
      opened.push(fd);
      return fd;
    };
    tracking.closeSync = (fd) => {
      closed.push(fd);
      return fs.closeSync(fd);
    };
    readWorkspaceFile(root, path.join(ws, 'config.json'), {}, { fs: tracking });
    expectUnsafe(
      () => readWorkspaceFile(root, path.join(ws, 'big.json'), { maxBytes: 10 }, { fs: tracking }),
      'too_large'
    );
    expect(opened).toHaveLength(2);
    expect(closed.sort()).toEqual(opened.sort());
  });
});

describe('openWorkspaceFile', () => {
  it('opens and creates a file under missing dirs when O_CREAT is set', () => {
    const p = path.join(ws, 'results', 'run-1', 'result.json');
    const fd = openWorkspaceFile(root, p, O_WRONLY | O_CREAT | O_TRUNC, 0o600);
    fs.writeSync(fd, 'ok');
    fs.closeSync(fd);
    expect(fs.readFileSync(p, 'utf8')).toBe('ok');
  });

  it('without O_CREAT, a missing parent dir throws ENOENT and creates nothing', () => {
    let caught;
    try {
      openWorkspaceFile(root, path.join(ws, 'results', 'r.json'), O_RDONLY);
    } catch (err) {
      caught = err;
    }
    expect(caught.code).toBe('ENOENT');
    expect(fs.existsSync(path.join(ws, 'results'))).toBe(false);
  });

  it('refuses a dangling leaf symlink on O_WRONLY|O_CREAT (symlink), creating no target', () => {
    const target = path.join(outside, 'planted.txt');
    fs.symlinkSync(target, path.join(ws, 'lock'));
    const before = snapshot(outside);
    expectUnsafe(() => openWorkspaceFile(root, path.join(ws, 'lock'), O_WRONLY | O_CREAT), 'symlink');
    expect(fs.existsSync(target)).toBe(false);
    expect(snapshot(outside)).toEqual(before);
  });

  it('refuses a leaf symlink on a truncating write, leaving the target byte-identical', () => {
    fs.symlinkSync(canaryFile, path.join(ws, 'config.json'));
    expectUnsafe(
      () => openWorkspaceFile(root, path.join(ws, 'config.json'), O_WRONLY | O_CREAT | O_TRUNC),
      'symlink'
    );
    expect(fs.readFileSync(canaryFile, 'utf8')).toBe(CANARY);
  });

  it('refuses a hardlinked leaf for a write (hardlink), leaving it intact', () => {
    const p = path.join(ws, 'config.json');
    fs.linkSync(canaryFile, p);
    expectUnsafe(() => openWorkspaceFile(root, p, O_WRONLY | O_TRUNC), 'hardlink');
    expectUnsafe(() => openWorkspaceFile(root, p, O_RDWR), 'hardlink');
    expect(fs.readFileSync(canaryFile, 'utf8')).toBe(CANARY);
  });

  it('a refused O_TRUNC open of a foreign-owned leaf leaves its content intact', () => {
    const p = path.join(ws, 'config.json');
    fs.writeFileSync(p, 'keep');
    expectUnsafe(
      () => openWorkspaceFile(root, p, O_WRONLY | O_TRUNC, 0o666, { fs: foreignFs(['fstatSync']) }),
      'foreign_owner'
    );
    expect(fs.readFileSync(p, 'utf8')).toBe('keep');
  });

  it('O_TRUNC still truncates an accepted file', () => {
    const p = path.join(ws, 'config.json');
    fs.writeFileSync(p, 'old content');
    const fd = openWorkspaceFile(root, p, O_WRONLY | O_TRUNC);
    fs.writeSync(fd, 'new');
    fs.closeSync(fd);
    expect(fs.readFileSync(p, 'utf8')).toBe('new');
  });

  it('allows a read-only open of a hardlinked leaf', () => {
    const p = path.join(ws, 'config.json');
    fs.linkSync(canaryFile, p);
    const fd = openWorkspaceFile(root, p, O_RDONLY);
    fs.closeSync(fd);
  });

  it('refuses a write to a foreign-owned leaf (foreign_owner) and closes the fd', () => {
    const p = path.join(ws, 'config.json');
    fs.writeFileSync(p, '{}');
    const closed = [];
    const wrapped = foreignFs(['fstatSync']);
    wrapped.closeSync = (fd) => {
      closed.push(fd);
      return fs.closeSync(fd);
    };
    expectUnsafe(() => openWorkspaceFile(root, p, O_WRONLY, 0o666, { fs: wrapped }), 'foreign_owner');
    expect(closed).toHaveLength(1);
  });

  it('refuses a file path that escapes the workspace (escape)', () => {
    expectUnsafe(() => openWorkspaceFile(root, path.join(ws, '..', '..', 'outside', 'secret.txt'), O_RDONLY), 'escape');
  });

  it('refuses the project root itself as a "file" (escape)', () => {
    expectUnsafe(() => openWorkspaceFile(root, path.join(ws, 'x', '..'), O_RDONLY), 'escape');
  });
});

describe('createWorkspaceFile', () => {
  it('creates the file under missing dirs, each one a real directory', () => {
    const p = path.join(ws, '.session', 'locks', 'new.lock');
    const fd = createWorkspaceFile(root, p);
    fs.writeSync(fd, 'ok');
    fs.closeSync(fd);
    expect(fs.readFileSync(p, 'utf8')).toBe('ok');
    expect(fs.lstatSync(path.join(ws, '.session')).isDirectory()).toBe(true);
    expect(fs.lstatSync(path.join(ws, '.session', 'locks')).isDirectory()).toBe(true);
  });

  it('walks the directories through the owner check, creating no file when it refuses', () => {
    const p = path.join(ws, 'memory', 'new.md');
    expectUnsafe(() => createWorkspaceFile(root, p, {}, { fs: foreignFs(['lstatSync']) }), 'foreign_owner');
    expect(fs.existsSync(p)).toBe(false);
  });

  it('fails EEXIST, code intact, when the file already exists, leaving it untouched', () => {
    const p = path.join(ws, 'lock');
    fs.writeFileSync(p, 'held');
    let caught;
    try {
      createWorkspaceFile(root, p);
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeInstanceOf(UnsafePathError);
    expect(caught.code).toBe('EEXIST');
    expect(fs.readFileSync(p, 'utf8')).toBe('held');
  });

  it('refuses a symlinked parent dir (symlink), creating nothing outside', () => {
    fs.symlinkSync(outside, path.join(ws, 'memory'));
    const before = snapshot(outside);
    expectUnsafe(() => createWorkspaceFile(root, path.join(ws, 'memory', 'new.md')), 'symlink');
    expect(snapshot(outside)).toEqual(before);
  });

  it('refuses a dangling leaf symlink, creating no target', () => {
    const target = path.join(outside, 'planted.txt');
    const link = path.join(ws, 'lock');
    fs.symlinkSync(target, link);
    let caught;
    try {
      createWorkspaceFile(root, link);
    } catch (err) {
      caught = err;
    }
    // POSIX: O_CREAT|O_EXCL fails EEXIST on any existing name, a dangling link
    // included, without following it. The lock relies on exactly this code
    // to lstat the entry and unlink the link.
    expect(caught.code).toBe('EEXIST');
    expect(fs.existsSync(target)).toBe(false);
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);
  });

  it('honours mode (0o600 under umask 022)', () => {
    const umask = process.umask(0o022);
    try {
      const p = path.join(ws, '.session', 'salt.tmp');
      fs.closeSync(createWorkspaceFile(root, p, { mode: 0o600 }));
      expect(fs.statSync(p).mode & 0o777).toBe(0o600);
      const q = path.join(ws, 'default.tmp');
      fs.closeSync(createWorkspaceFile(root, q));
      expect(fs.statSync(q).mode & 0o777).toBe(0o644);
    } finally {
      process.umask(umask);
    }
  });
});

describe('removeWorkspaceFile', () => {
  it('removes a regular file and returns true', () => {
    const p = path.join(ws, '.session', 'selection.json');
    fs.mkdirSync(path.dirname(p));
    fs.writeFileSync(p, '{}');
    expect(removeWorkspaceFile(root, p)).toBe(true);
    expect(fs.existsSync(p)).toBe(false);
  });

  it('returns false for an absent leaf', () => {
    fs.mkdirSync(path.join(ws, '.session'));
    expect(removeWorkspaceFile(root, path.join(ws, '.session', 'selection.json'))).toBe(false);
  });

  it('returns false for an absent parent, creating nothing', () => {
    expect(removeWorkspaceFile(root, path.join(ws, '.session', 'selection.json'))).toBe(false);
    expect(fs.existsSync(path.join(ws, '.session'))).toBe(false);
  });

  it('removes a symlink leaf itself, leaving its outside target untouched', () => {
    const link = path.join(ws, 'selection.json');
    fs.symlinkSync(canaryFile, link);
    const before = snapshot(outside);
    expect(removeWorkspaceFile(root, link)).toBe(true);
    expect(() => fs.lstatSync(link)).toThrow(/ENOENT/);
    expect(snapshot(outside)).toEqual(before);
  });

  it('refuses a symlinked parent dir (symlink), deleting nothing outside', () => {
    fs.symlinkSync(outside, path.join(ws, '.session'));
    const before = snapshot(outside);
    expectUnsafe(() => removeWorkspaceFile(root, path.join(ws, '.session', 'secret.txt')), 'symlink');
    expect(fs.readFileSync(canaryFile, 'utf8')).toBe(CANARY);
    expect(snapshot(outside)).toEqual(before);
  });
});

describe('openLeaf', () => {
  it('opens a regular file and returns its fd and stat', () => {
    const p = path.join(ws, 'a');
    fs.writeFileSync(p, 'abc');
    const { fd, stat } = openLeaf(p, O_RDONLY);
    expect(stat.isFile()).toBe(true);
    expect(stat.size).toBe(3);
    fs.closeSync(fd);
  });

  it('maps a symlink leaf to UnsafePathError symlink, path = the link not its target', () => {
    const link = path.join(ws, 'a');
    fs.symlinkSync(canaryFile, link);
    const err = expectUnsafe(() => openLeaf(link, O_RDONLY), 'symlink');
    expect(err.path).toBe(link);
  });

  it('propagates ENOENT unchanged', () => {
    let caught;
    try {
      openLeaf(path.join(ws, 'missing'), O_RDONLY);
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeInstanceOf(UnsafePathError);
    expect(caught.code).toBe('ENOENT');
  });

  it('closes the fd before refusing a non-regular leaf', () => {
    const closed = [];
    const wrapped = { ...fs, closeSync: (fd) => (closed.push(fd), fs.closeSync(fd)) };
    expectUnsafe(() => openLeaf(ws, O_RDONLY, 0o666, { fs: wrapped }), 'not_regular');
    expect(closed).toHaveLength(1);
  });
});

describe('openOwnedLeaf', () => {
  it('opens a regular file and returns an fd', () => {
    const p = path.join(ws, 'a');
    fs.writeFileSync(p, 'abc');
    const fd = openOwnedLeaf(p, O_RDONLY);
    expect(typeof fd).toBe('number');
    const buf = Buffer.alloc(3);
    fs.readSync(fd, buf, 0, 3, 0);
    fs.closeSync(fd);
    expect(buf.toString()).toBe('abc');
  });

  it('refuses a symlink leaf (symlink), workspace scope by default', () => {
    const link = path.join(ws, 'a');
    fs.symlinkSync(canaryFile, link);
    const err = expectUnsafe(() => openOwnedLeaf(link, O_RDONLY), 'symlink');
    expect(err.scope).toBe('workspace');
    expect(err.path).toBe(link);
  });

  it('refuses a dangling symlink leaf on O_CREAT (symlink), creating no target', () => {
    const target = path.join(outside, 'planted.txt');
    const link = path.join(ws, 'a');
    fs.symlinkSync(target, link);
    expectUnsafe(() => openOwnedLeaf(link, O_WRONLY | O_CREAT), 'symlink');
    expect(fs.existsSync(target)).toBe(false);
  });

  it('refuses a FIFO leaf for a write (not_regular) without blocking', () => {
    const p = path.join(ws, 'fifo');
    if (!makeFifo(p)) return;
    expect(reasonInChild('m.openOwnedLeaf(a[0], require("fs").constants.O_WRONLY)', p)).toBe('not_regular');
    expect(reasonInChild('m.openOwnedLeaf(a[0], require("fs").constants.O_RDONLY)', p)).toBe('not_regular');
  }, 10000);

  it('refuses a hard-linked leaf for a write (hardlink), allows it for a read', () => {
    const p = path.join(ws, 'a');
    fs.linkSync(canaryFile, p);
    expectUnsafe(() => openOwnedLeaf(p, O_WRONLY), 'hardlink');
    expectUnsafe(() => openOwnedLeaf(p, O_RDWR), 'hardlink');
    fs.closeSync(openOwnedLeaf(p, O_RDONLY));
  });

  it('defers O_TRUNC past the checks: a hard-linked outside file is not emptied', () => {
    const p = path.join(ws, 'a');
    fs.linkSync(canaryFile, p);
    expectUnsafe(() => openOwnedLeaf(p, O_WRONLY | O_TRUNC), 'hardlink');
    expect(fs.readFileSync(canaryFile, 'utf8')).toBe(CANARY);
  });

  it('defers O_TRUNC past the owner check: a refused foreign leaf keeps its content', () => {
    const p = path.join(ws, 'a');
    fs.writeFileSync(p, 'keep');
    expectUnsafe(() => openOwnedLeaf(p, O_WRONLY | O_TRUNC, {}, { fs: foreignFs(['fstatSync']) }), 'foreign_owner');
    expect(fs.readFileSync(p, 'utf8')).toBe('keep');
  });

  it('truncates an accepted leaf when O_TRUNC was asked, and only then', () => {
    const p = path.join(ws, 'a');
    fs.writeFileSync(p, 'old content');
    let fd = openOwnedLeaf(p, O_WRONLY);
    fs.closeSync(fd);
    expect(fs.readFileSync(p, 'utf8')).toBe('old content');
    fd = openOwnedLeaf(p, O_WRONLY | O_TRUNC);
    fs.writeSync(fd, 'new');
    fs.closeSync(fd);
    expect(fs.readFileSync(p, 'utf8')).toBe('new');
  });

  it('creates with the given mode', () => {
    const umask = process.umask(0o022);
    try {
      const p = path.join(ws, 'a');
      fs.closeSync(openOwnedLeaf(p, O_WRONLY | O_CREAT | O_EXCL, { mode: 0o600 }));
      expect(fs.statSync(p).mode & 0o777).toBe(0o600);
    } finally {
      process.umask(umask);
    }
  });

  it('closes the fd on a refusal after the open', () => {
    const p = path.join(ws, 'a');
    fs.writeFileSync(p, 'x');
    const closed = [];
    const wrapped = foreignFs(['fstatSync']);
    wrapped.closeSync = (fd) => (closed.push(fd), fs.closeSync(fd));
    expectUnsafe(() => openOwnedLeaf(p, O_WRONLY, {}, { fs: wrapped }), 'foreign_owner');
    expect(closed).toHaveLength(1);
  });

  it.each([
    ['symlink', (p) => (fs.symlinkSync(canaryFile, p), () => openOwnedLeaf(p, O_RDONLY, { scope: 'path' }))],
    ['not_regular', (p) => (fs.mkdirSync(p), () => openOwnedLeaf(p, O_RDONLY, { scope: 'path' }))],
    ['hardlink', (p) => (fs.linkSync(canaryFile, p), () => openOwnedLeaf(p, O_WRONLY, { scope: 'path' }))],
    [
      'foreign_owner',
      (p) => (
        fs.writeFileSync(p, 'x'),
        () => openOwnedLeaf(p, O_RDONLY, { scope: 'path' }, { fs: foreignFs(['fstatSync']) })
      ),
    ],
  ])('a %s refusal carries the path scope it was given', (reason, setup) => {
    const err = expectUnsafe(setup(path.join(ws, 'a')), reason);
    expect(err.scope).toBe('path');
    expect(err.message.startsWith('Refusing to use path ')).toBe(true);
  });
});

// The project root as discover reports it (process.cwd(), physical), and an
// alias for it: the logical path an agent sees after `pwd` in zsh, or macOS's
// /tmp -> /private/tmp.
function aliasedRoot() {
  const realRoot = fs.realpathSync(root);
  const alias = path.join(base, 'alias');
  fs.symlinkSync(realRoot, alias);
  return { realRoot, alias, realWs: path.join(realRoot, '.mobile-automator') };
}

describe('inWorkspace', () => {
  it('returns a path inside the workspace as is', () => {
    const p = path.join(ws, 'screenshots', 'a.png');
    expect(inWorkspace(root, p)).toBe(p);
    expect(inWorkspace(root, ws)).toBe(ws);
  });

  it('is null for a project file outside the workspace', () => {
    expect(inWorkspace(root, path.join(root, 'shots', 'a.png'))).toBeNull();
    expect(inWorkspace(root, path.join(root, '.mobile-automator-old', 'a.png'))).toBeNull();
    expect(inWorkspace(root, root)).toBeNull();
  });

  it('is null for a path outside the project (an explicit /tmp/x.png)', () => {
    const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-elsewhere-'));
    try {
      expect(inWorkspace(root, path.join(elsewhere, 'x.png'))).toBeNull();
      expect(inWorkspace(root, path.join(outside, 'x.png'))).toBeNull();
      expect(inWorkspace(root, path.join(base, 'nope', 'deeper', 'x.png'))).toBeNull();
    } finally {
      fs.rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('maps a workspace path reached through a symlinked parent onto the real root', () => {
    const { realRoot, alias, realWs } = aliasedRoot();
    expect(inWorkspace(realRoot, path.join(alias, '.mobile-automator', 'screenshots', 'a.png'))).toBe(
      path.join(realWs, 'screenshots', 'a.png')
    );
    expect(inWorkspace(realRoot, path.join(alias, '.mobile-automator'))).toBe(realWs);
  });

  it('is null for a project file outside the workspace reached through the alias', () => {
    const { realRoot, alias } = aliasedRoot();
    expect(inWorkspace(realRoot, path.join(alias, 'shots', 'a.png'))).toBeNull();
  });

  it('still maps a symlinked .mobile-automator/screenshots reached through the alias, so a walk refuses it', () => {
    const { realRoot, alias, realWs } = aliasedRoot();
    fs.symlinkSync(outside, path.join(realWs, 'screenshots'));
    const got = inWorkspace(realRoot, path.join(alias, '.mobile-automator', 'screenshots', 'a.png'));
    expect(got).toBe(path.join(realWs, 'screenshots', 'a.png'));
    expectUnsafe(() => safeWorkspaceDest(realRoot, got), 'symlink');
  });

  // A workspace dir linked back at the project root resolves to the root
  // itself: the alias is the root, not that link, so the path stays a
  // workspace path (and a walk refuses the link).
  it('maps through the shallowest ancestor that is the root, not a workspace link back to it', () => {
    const { realRoot, alias, realWs } = aliasedRoot();
    fs.symlinkSync('..', path.join(realWs, 'screenshots'));
    const got = inWorkspace(realRoot, path.join(alias, '.mobile-automator', 'screenshots', 'a.png'));
    expect(got).toBe(path.join(realWs, 'screenshots', 'a.png'));
    expectUnsafe(() => safeWorkspaceDest(realRoot, got), 'symlink');
  });

  it('only looks: no fs call but realpath', () => {
    const { realRoot, alias } = aliasedRoot();
    const lookOnly = { realpathSync: fs.realpathSync };
    const p = path.join(alias, '.mobile-automator', 'screenshots', 'a.png');
    expect(inWorkspace(realRoot, p, { fs: lookOnly })).toBe(path.join(realRoot, '.mobile-automator', 'screenshots', 'a.png'));
    expect(inWorkspace(realRoot, path.join(outside, 'x.png'), { fs: lookOnly })).toBeNull();
  });
});

describe('safeWorkspaceDest', () => {
  it('creates the missing directories, not the leaf, and returns the resolved path', () => {
    const p = path.join(ws, 'screenshots', 'run-1', 'a.png');
    expect(safeWorkspaceDest(root, p)).toBe(p);
    expect(fs.lstatSync(path.join(ws, 'screenshots')).isDirectory()).toBe(true);
    expect(fs.lstatSync(path.join(ws, 'screenshots', 'run-1')).isDirectory()).toBe(true);
    expect(fs.existsSync(p)).toBe(false);
  });

  it('accepts an existing regular leaf', () => {
    const p = path.join(ws, 'a.png');
    fs.writeFileSync(p, 'png');
    expect(safeWorkspaceDest(root, p)).toBe(p);
    expect(fs.readFileSync(p, 'utf8')).toBe('png');
  });

  it('refuses a symlinked parent dir (symlink), creating nothing outside', () => {
    fs.symlinkSync(outside, path.join(ws, 'screenshots'));
    const before = snapshot(outside);
    const err = expectUnsafe(() => safeWorkspaceDest(root, path.join(ws, 'screenshots', 'run-1', 'a.png')), 'symlink');
    expect(err.scope).toBe('workspace');
    expect(snapshot(outside)).toEqual(before);
  });

  it('refuses a symlink leaf (symlink), leaving its target untouched', () => {
    const p = path.join(ws, 'a.png');
    fs.symlinkSync(canaryFile, p);
    expectUnsafe(() => safeWorkspaceDest(root, p), 'symlink');
    expect(fs.readFileSync(canaryFile, 'utf8')).toBe(CANARY);
  });

  it('refuses a dangling symlink leaf (symlink), creating no target', () => {
    const target = path.join(outside, 'planted.png');
    const p = path.join(ws, 'a.png');
    fs.symlinkSync(target, p);
    expectUnsafe(() => safeWorkspaceDest(root, p), 'symlink');
    expect(fs.existsSync(target)).toBe(false);
  });

  it('refuses a directory or a FIFO leaf (not_regular)', () => {
    fs.mkdirSync(path.join(ws, 'a.png'));
    expectUnsafe(() => safeWorkspaceDest(root, path.join(ws, 'a.png')), 'not_regular');
    const fifo = path.join(ws, 'b.png');
    if (makeFifo(fifo)) expectUnsafe(() => safeWorkspaceDest(root, fifo), 'not_regular');
  });

  it('refuses a hard-linked leaf (hardlink), leaving it intact', () => {
    const p = path.join(ws, 'a.png');
    fs.linkSync(canaryFile, p);
    expectUnsafe(() => safeWorkspaceDest(root, p), 'hardlink');
    expect(fs.readFileSync(canaryFile, 'utf8')).toBe(CANARY);
  });

  it('refuses a foreign-owned leaf (foreign_owner), unless MAUTO_TRUST_WORKSPACE_OWNER=1', () => {
    const p = path.join(ws, 'a.png');
    fs.writeFileSync(p, 'png');
    expectUnsafe(() => safeWorkspaceDest(root, p, { fs: foreignAt(p) }), 'foreign_owner');
    expect(safeWorkspaceDest(root, p, { fs: foreignAt(p), env: { MAUTO_TRUST_WORKSPACE_OWNER: '1' } })).toBe(p);
  });

  it('refuses a destination outside the workspace (escape)', () => {
    expectUnsafe(() => safeWorkspaceDest(root, path.join(root, 'shots', 'a.png')), 'escape');
    expect(fs.existsSync(path.join(root, 'shots'))).toBe(false);
  });
});

describe('readProjectFile', () => {
  it('reads a project file below the root and one at the root', () => {
    fs.mkdirSync(path.join(root, '.claude'));
    fs.writeFileSync(path.join(root, '.claude', 'settings.json'), '{"a":1}');
    fs.writeFileSync(path.join(root, '.mcp.json'), '{"b":2}');
    expect(readProjectFile(root, path.join(root, '.claude', 'settings.json'))).toBe('{"a":1}');
    expect(readProjectFile(root, path.join(root, '.mcp.json'))).toBe('{"b":2}');
  });

  it('is null for an absent file and an absent parent dir, creating nothing', () => {
    expect(readProjectFile(root, path.join(root, '.mcp.json'))).toBeNull();
    expect(readProjectFile(root, path.join(root, '.claude', 'skills', 'x', 'SKILL.md'))).toBeNull();
    expect(fs.existsSync(path.join(root, '.claude'))).toBe(false);
  });

  it('refuses a symlinked parent dir (symlink) in the path scope, never reading through it', () => {
    fs.symlinkSync(outside, path.join(root, '.claude'));
    const err = expectUnsafe(() => readProjectFile(root, path.join(root, '.claude', 'secret.txt')), 'symlink');
    expect(err.scope).toBe('path');
    expect(err.message.startsWith('Refusing to use path ')).toBe(true);
    expect(err.message).not.toContain(CANARY);
    expect(err.path).toBe(path.join(root, '.claude'));
  });

  it('refuses a symlinked component deeper down (symlink)', () => {
    fs.mkdirSync(path.join(root, '.claude'));
    fs.symlinkSync(outside, path.join(root, '.claude', 'skills'));
    expectUnsafe(() => readProjectFile(root, path.join(root, '.claude', 'skills', 'secret.txt')), 'symlink');
  });

  it('refuses a symlink leaf (symlink) in the path scope', () => {
    fs.symlinkSync(canaryFile, path.join(root, '.mcp.json'));
    const err = expectUnsafe(() => readProjectFile(root, path.join(root, '.mcp.json')), 'symlink');
    expect(err.scope).toBe('path');
  });

  it('refuses a dangling symlink leaf (symlink), never reading it as absent', () => {
    fs.symlinkSync(path.join(outside, 'gone.json'), path.join(root, '.mcp.json'));
    expectUnsafe(() => readProjectFile(root, path.join(root, '.mcp.json')), 'symlink');
  });

  it('refuses a path outside the project (escape) in the path scope', () => {
    const err = expectUnsafe(() => readProjectFile(root, canaryFile), 'escape');
    expect(err.scope).toBe('path');
    expect(err.message).toMatch(/outside the project directory/);
  });

  it('refuses a file over maxBytes (too_large)', () => {
    fs.writeFileSync(path.join(root, 'big.md'), 'x'.repeat(11));
    expectUnsafe(() => readProjectFile(root, path.join(root, 'big.md'), { maxBytes: 10 }), 'too_large');
    expect(readProjectFile(root, path.join(root, 'big.md'), { maxBytes: 11 })).toBe('x'.repeat(11));
  });

  it('refuses a foreign-owned leaf or component (foreign_owner)', () => {
    fs.mkdirSync(path.join(root, '.claude'));
    fs.writeFileSync(path.join(root, '.claude', 'settings.json'), '{}');
    const file = path.join(root, '.claude', 'settings.json');
    expectUnsafe(() => readProjectFile(root, file, {}, { fs: foreignFs(['fstatSync']) }), 'foreign_owner');
    expectUnsafe(() => readProjectFile(root, file, {}, { fs: foreignAt(path.join(root, '.claude')) }), 'foreign_owner');
  });

  it('accepts a project root reached through a symlinked parent', () => {
    const { alias } = aliasedRoot();
    fs.writeFileSync(path.join(root, '.mcp.json'), '{}');
    fs.mkdirSync(path.join(root, '.claude'));
    fs.writeFileSync(path.join(root, '.claude', 'settings.json'), '{"c":3}');
    expect(readProjectFile(alias, path.join(alias, '.mcp.json'))).toBe('{}');
    expect(readProjectFile(alias, path.join(alias, '.claude', 'settings.json'))).toBe('{"c":3}');
  });

  it('never checks the project root itself or its ancestors', () => {
    fs.writeFileSync(path.join(root, '.mcp.json'), '{}');
    fs.chmodSync(base, 0o777);
    fs.chmodSync(root, 0o777);
    try {
      expect(readProjectFile(root, path.join(root, '.mcp.json'), {}, { fs: foreignAt(root) })).toBe('{}');
    } finally {
      fs.chmodSync(root, 0o755);
      fs.chmodSync(base, 0o700);
    }
  });

  it('closes the fd it opened, on success and on refusal', () => {
    fs.writeFileSync(path.join(root, 'a.md'), 'a');
    fs.writeFileSync(path.join(root, 'big.md'), 'x'.repeat(11));
    const opened = [];
    const closed = [];
    const tracking = { ...fs };
    tracking.openSync = (...args) => {
      const fd = fs.openSync(...args);
      opened.push(fd);
      return fd;
    };
    tracking.closeSync = (fd) => (closed.push(fd), fs.closeSync(fd));
    readProjectFile(root, path.join(root, 'a.md'), {}, { fs: tracking });
    expectUnsafe(() => readProjectFile(root, path.join(root, 'big.md'), { maxBytes: 10 }, { fs: tracking }), 'too_large');
    expect(opened).toHaveLength(2);
    expect(closed.sort()).toEqual(opened.sort());
  });
});

describe('createProjectFile', () => {
  it('creates the file under missing dirs below the root, each one a real directory', () => {
    const p = path.join(root, '.claude', 'skills', 'mobile-automator-execute', 'SKILL.md');
    const fd = createProjectFile(root, p);
    fs.writeSync(fd, 'ok');
    fs.closeSync(fd);
    expect(fs.readFileSync(p, 'utf8')).toBe('ok');
    for (const d of ['.claude', path.join('.claude', 'skills'), path.join('.claude', 'skills', 'mobile-automator-execute')]) {
      expect(fs.lstatSync(path.join(root, d)).isDirectory()).toBe(true);
    }
  });

  it('creates a file at the project root itself', () => {
    const p = path.join(root, '.mcp.json');
    fs.closeSync(createProjectFile(root, p));
    expect(fs.lstatSync(p).isFile()).toBe(true);
  });

  it.each([
    ['the first component', ['.claude']],
    ['a deeper component', ['.claude', 'skills']],
  ])('refuses %s as a symlink (symlink), creating nothing outside', (_label, parts) => {
    if (parts.length > 1) fs.mkdirSync(path.join(root, ...parts.slice(0, -1)), { recursive: true });
    fs.symlinkSync(outside, path.join(root, ...parts));
    const before = snapshot(outside);
    const err = expectUnsafe(() => createProjectFile(root, path.join(root, '.claude', 'skills', 'x', 'SKILL.md')), 'symlink');
    expect(err.scope).toBe('path');
    expect(snapshot(outside)).toEqual(before);
  });

  it('refuses a path outside the project (escape), creating nothing there', () => {
    const before = snapshot(outside);
    expectUnsafe(() => createProjectFile(root, path.join(root, '..', 'outside', 'new', 'x.md')), 'escape');
    expect(snapshot(outside)).toEqual(before);
  });

  it('is exclusive: an existing file or a dangling link fails EEXIST, untouched', () => {
    const p = path.join(root, '.mcp.json');
    fs.writeFileSync(p, 'held');
    let caught;
    try {
      createProjectFile(root, p);
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeInstanceOf(UnsafePathError);
    expect(caught.code).toBe('EEXIST');
    expect(fs.readFileSync(p, 'utf8')).toBe('held');

    const target = path.join(outside, 'planted.md');
    const link = path.join(root, 'AGENTS.md');
    fs.symlinkSync(target, link);
    caught = undefined;
    try {
      createProjectFile(root, link);
    } catch (err) {
      caught = err;
    }
    expect(caught.code).toBe('EEXIST');
    expect(fs.existsSync(target)).toBe(false);
  });

  it('honours mode (0o600 under umask 022)', () => {
    const umask = process.umask(0o022);
    try {
      const p = path.join(root, '.claude', 'x.tmp');
      fs.closeSync(createProjectFile(root, p, { mode: 0o600 }));
      expect(fs.statSync(p).mode & 0o777).toBe(0o600);
    } finally {
      process.umask(umask);
    }
  });

  it('refuses a foreign-owned new leaf in the path scope, with the path hint', () => {
    const p = path.join(root, '.mcp.json');
    const err = expectUnsafe(() => createProjectFile(root, p, {}, { fs: foreignFs(['fstatSync']) }), 'foreign_owner');
    expect(err.scope).toBe('path');
    expect(err.hint).toMatch(/^Files mauto writes must belong/);
  });
});

// Absent or garbled is a normal state; a refused path never is.
describe.each([
  ['readWorkspaceFileOrNull', readWorkspaceFileOrNull],
  ['readWorkspaceJsonOrNull', readWorkspaceJsonOrNull],
])('%s', (_name, read) => {
  // A read error other than a refusal: the leaf open fails EIO.
  function eioFs(file) {
    return {
      ...fs,
      openSync: (p, ...rest) => {
        if (p !== file) return fs.openSync(p, ...rest);
        const e = new Error('EIO: i/o error');
        e.code = 'EIO';
        throw e;
      },
    };
  }

  it('is null for an absent file and an absent parent dir', () => {
    expect(read(root, path.join(ws, 'selection.json'))).toBeNull();
    expect(read(root, path.join(ws, '.session', 'selection.json'))).toBeNull();
  });

  it('is null on a read error that is not a refusal', () => {
    const file = path.join(ws, 'selection.json');
    fs.writeFileSync(file, '{"device":"emulator-5554"}');
    expect(read(root, file, {}, { fs: eioFs(file) })).toBeNull();
  });

  it('throws UnsafePathError on a symlinked leaf, never reading its target', () => {
    const file = path.join(ws, 'selection.json');
    fs.symlinkSync(canaryFile, file);
    expectUnsafe(() => read(root, file), 'symlink');
  });

  it('throws UnsafePathError under a symlinked dir', () => {
    fs.symlinkSync(outside, path.join(ws, '.session'));
    expectUnsafe(() => read(root, path.join(ws, '.session', 'secret.txt')), 'symlink');
  });
});

describe('the lenient readers on content', () => {
  it('readWorkspaceFileOrNull returns the text as is', () => {
    fs.writeFileSync(path.join(ws, 'salt'), 'abc\n');
    expect(readWorkspaceFileOrNull(root, path.join(ws, 'salt'))).toBe('abc\n');
  });

  it('readWorkspaceJsonOrNull parses valid JSON', () => {
    fs.writeFileSync(path.join(ws, 'selection.json'), '{"device":"emulator-5554"}');
    expect(readWorkspaceJsonOrNull(root, path.join(ws, 'selection.json'))).toEqual({ device: 'emulator-5554' });
  });

  it('readWorkspaceJsonOrNull is null for garbled JSON', () => {
    fs.writeFileSync(path.join(ws, 'selection.json'), '{"device":');
    expect(readWorkspaceJsonOrNull(root, path.join(ws, 'selection.json'))).toBeNull();
  });
});

describe('UnsafePathError carries its own envelope fields', () => {
  it('kind is environment, message names the path and reason, hint is the reason hint', () => {
    const err = new UnsafePathError('/ws/.mobile-automator/config.json', 'symlink');
    expect(err.kind).toBe('environment');
    expect(err.message).toBe(
      'Refusing to use workspace path /ws/.mobile-automator/config.json: it is a symbolic link (symlink).'
    );
    expect(err.hint).toMatch(/never follows links/);
  });

  it('an unknown reason still gets a reason text and a hint', () => {
    const err = new UnsafePathError('/ws/.mobile-automator/x', 'mystery');
    expect(err.kind).toBe('environment');
    expect(err.message).toBe('Refusing to use workspace path /ws/.mobile-automator/x: it is not safe to use (mystery).');
    expect(err.hint).toMatch(/inside \.mobile-automator\//);
  });

  it('the scope defaults to workspace, with the workspace wording verbatim', () => {
    const err = new UnsafePathError('/ws/.mobile-automator/memory', 'escape');
    const explicit = new UnsafePathError('/ws/.mobile-automator/memory', 'escape', { scope: 'workspace' });
    expect(err.scope).toBe('workspace');
    expect(err.message).toBe(
      'Refusing to use workspace path /ws/.mobile-automator/memory: it resolves outside the .mobile-automator/ workspace (escape).'
    );
    expect(err.hint).toBe(
      'mauto only reads and writes inside .mobile-automator/. Replace any link on the way with a real directory or file inside .mobile-automator/.'
    );
    expect(explicit.message).toBe(err.message);
    expect(explicit.hint).toBe(err.hint);
  });
});

describe('UnsafePathError in the path scope (a project file, a user-chosen file)', () => {
  const scoped = (reason) => new UnsafePathError('/p/.claude/skills', reason, { scope: 'path' });

  it('escape names the project directory, not the workspace', () => {
    const err = scoped('escape');
    expect(err.scope).toBe('path');
    expect(err.kind).toBe('environment');
    expect(err.code).toBe('EUNSAFEPATH');
    expect(err.message).toBe('Refusing to use path /p/.claude/skills: it resolves outside the project directory (escape).');
    expect(err.hint).toBe(
      'mauto only writes inside the project directory. Replace any link on the way with a real directory inside the project.'
    );
  });

  it('symlink keeps the shared reason text, with a path hint', () => {
    const err = scoped('symlink');
    expect(err.message).toBe('Refusing to use path /p/.claude/skills: it is a symbolic link (symlink).');
    expect(err.hint).toBe(
      'mauto never writes through a symbolic link. Replace the link with a real directory or file, then re-run.'
    );
  });

  it('foreign_owner keeps the escape hatch in a path hint', () => {
    const err = scoped('foreign_owner');
    expect(err.message).toBe('Refusing to use path /p/.claude/skills: it is owned by another user (foreign_owner).');
    expect(err.hint).toBe(
      'Files mauto writes must belong to the user running mauto. Fix the ownership (chown), or set MAUTO_TRUST_WORKSPACE_OWNER=1 if you trust this checkout (for example a CI container running as root); it skips only the owner check.'
    );
  });

  it('a reason with no path override falls back to the shared text and hint', () => {
    const err = scoped('world_writable');
    const shared = new UnsafePathError('/p/.claude/skills', 'world_writable');
    expect(err.message).toBe('Refusing to use path /p/.claude/skills: it is writable by every user (world_writable).');
    expect(err.hint).toBe(shared.hint);
  });

  it.each(['hardlink', 'too_large', 'mystery', 'escape', 'symlink', 'foreign_owner'])(
    'no %s hint in the path scope claims the file is in the workspace',
    (reason) => {
      // The escape hatch's variable name is the one mention allowed.
      const hint = scoped(reason).hint.replace('MAUTO_TRUST_WORKSPACE_OWNER', '');
      expect(hint).not.toMatch(/workspace|\.mobile-automator/i);
    }
  );
});

describe('a refusal through toEnvelope', () => {
  function envelopeFor(fn) {
    let caught;
    try {
      fn();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(UnsafePathError);
    return toEnvelope(caught);
  }

  it('is an environment failure naming the refused path and the reason, never content or target', () => {
    const link = path.join(ws, 'config.json');
    fs.symlinkSync(canaryFile, link);
    const { envelope, exitKind } = envelopeFor(() => readWorkspaceFile(root, link));
    expect(exitKind).toBe('environment');
    expect(envelope.ok).toBe(false);
    expect(envelope.error.kind).toBe('environment');
    const json = JSON.stringify(envelope);
    expect(json).not.toContain(CANARY);
    expect(json).not.toContain(outside);
    expect(json).not.toContain('secret.txt');
    expect(envelope.error.message).toContain(link);
    expect(envelope.error.message).toMatch(/symlink/i);
    expect(envelope.hint).toMatch(/real (directory|file)/i);
    expect(envelope.hint).toContain('.mobile-automator');
  });

  it('a symlinked dir names the workspace path, not the link target', () => {
    const link = path.join(ws, 'memory');
    fs.symlinkSync(outside, link);
    const { envelope } = envelopeFor(() => readWorkspaceFile(root, path.join(link, 'secret.txt')));
    const json = JSON.stringify(envelope);
    expect(json).not.toContain(CANARY);
    expect(json).not.toContain(outside);
    expect(envelope.error.message).toContain(link);
  });

  it('foreign_owner hint names MAUTO_TRUST_WORKSPACE_OWNER=1 and says it skips only the owner check', () => {
    const { envelope } = envelopeFor(() => safeDir(root, ws, {}, { getuid: () => REAL_UID + 1 }));
    expect(envelope.error.message).toContain(ws);
    expect(envelope.error.message).toMatch(/owned by another user/i);
    expect(envelope.hint).toContain('MAUTO_TRUST_WORKSPACE_OWNER=1');
    expect(envelope.hint).toMatch(/only the owner check/i);
  });

  it.each([
    ['escape', () => safeDir(root, path.join(ws, '..', '..', 'outside'))],
    ['world_writable', () => (fs.chmodSync(ws, 0o777), safeDir(root, ws))],
    ['not_directory', () => (fs.writeFileSync(path.join(ws, 'm'), 'x'), safeDir(root, path.join(ws, 'm')))],
    ['too_large', () => (fs.writeFileSync(path.join(ws, 'b'), 'xx'), readWorkspaceFile(root, path.join(ws, 'b'), { maxBytes: 1 }))],
  ])('%s yields an environment envelope with a hint and no canary', (_reason, fn) => {
    const { envelope, exitKind } = envelopeFor(fn);
    expect(exitKind).toBe('environment');
    expect(envelope.error.kind).toBe('environment');
    expect(typeof envelope.hint).toBe('string');
    expect(envelope.hint.length).toBeGreaterThan(0);
    expect(JSON.stringify(envelope)).not.toContain(CANARY);
  });
});

// Containment is lexical on resolved paths. The filesystem root is the one
// parent that already ends in a separator, so `parent + sep` would be `//` and
// nothing would be inside it (#347: the crash --out home rule asks whether a
// project root of `/` contains the home directory).
describe('isInside', () => {
  test.each([
    ['/a/b', '/a', true],
    ['/a', '/a', true],
    ['/ab', '/a', false],
    ['/a', '/a/b', false],
    ['/home/u', '/', true],
    ['/', '/', true],
  ])('isInside(%s, %s) is %s', (child, parent, expected) => {
    expect(isInside(child, parent)).toBe(expected);
  });
});
