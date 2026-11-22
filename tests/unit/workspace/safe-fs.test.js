'use strict';

// safe-fs (#345): every workspace read/write refuses a symlinked, foreign,
// world-writable or otherwise planted path. The fixture (a project root, its
// .mobile-automator/ and an outside/ canary) is tests/helpers/safe-fs-fixture.js.
// The project-file readers/writers are in safe-fs-project.test.js and the
// user-chosen path entry points in safe-fs-user-path.test.js (#347). The
// primitives a caller drives with its own policy (dirPolicy, checkDir,
// safeDir's last-component policy) are in safe-fs-policy.test.js; the device
// session's policies built on them (#346) in tests/unit/device/session-dir.test.js.

const fs = require('fs');
const path = require('path');

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
  readOwnedLeaf,
  dirPolicy,
  WORKSPACE_DIR,
} = require('../../../src/workspace/safe-fs');
// The envelope boundary: a refusal reaches the agent through toEnvelope's
// typed-error branch, which maps the error's own kind, message and hint.
const { toEnvelope } = require('../../../src/cli');
const {
  makeSafeFsFixture,
  removeSafeFsFixture,
  CANARY,
  REAL_UID,
  snapshot,
  expectUnsafe,
  foreignFs,
  makeFifo,
  reasonInChild,
  readReasonInChild,
} = require('../../helpers/safe-fs-fixture');

const { O_RDONLY, O_WRONLY, O_RDWR, O_CREAT, O_EXCL, O_TRUNC } = fs.constants;

let base;
let root;
let ws;
let outside;
let canaryFile;

beforeEach(() => {
  ({ base, root, ws, outside, canaryFile } = makeSafeFsFixture());
});

afterEach(() => {
  removeSafeFsFixture(base);
});

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

  // The check-only walk for a directory a later write creates (#347).
  describe('missingOk', () => {
    it('a missing component is nothing to refuse: null, and nothing created', () => {
      expect(safeDir(root, path.join(ws, 'nope', 'deeper'), { missingOk: true })).toBeNull();
      expect(fs.existsSync(path.join(ws, 'nope'))).toBe(false);
    });

    it('a missing workspace directory is nothing to refuse either', () => {
      fs.rmSync(ws, { recursive: true });
      expect(safeDir(root, path.join(ws, 'a'), { missingOk: true })).toBeNull();
      expect(fs.existsSync(ws)).toBe(false);
    });

    it('a link above the missing part is still refused', () => {
      fs.symlinkSync(outside, path.join(ws, 'reports'));
      expectUnsafe(() => safeDir(root, path.join(ws, 'reports', 'new', 'dir'), { missingOk: true }), 'symlink');
      expect(fs.existsSync(path.join(outside, 'new'))).toBe(false);
    });

    it('an existing directory returns its realpath, as without it', () => {
      fs.mkdirSync(path.join(ws, 'memory'));
      expect(safeDir(root, path.join(ws, 'memory'), { missingOk: true })).toBe(fs.realpathSync(path.join(ws, 'memory')));
    });
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

describe('a foreign_owner refusal names both uids (D-c)', () => {
  // Both uids are injected: a fixed "foreign" uid compared with the real one
  // collides on a host whose uid it happens to be (a CI runner's is 1001).
  const deps = (which) => ({ fs: foreignFs(which, 1001), getuid: () => 1000 });

  it('in the message, keeping path and reason', () => {
    const err = expectUnsafe(() => safeDir(root, ws, {}, deps(['lstatSync'])), 'foreign_owner');
    expect(err.path).toBe(ws);
    expect(err.message).toBe(
      `Refusing to use workspace path ${ws}: it is owned by uid 1001; you are uid 1000 (foreign_owner).`
    );
    // Message text only: the uids are not error fields.
    expect(err).not.toHaveProperty('owner');
  });

  it('for a foreign leaf too', () => {
    const p = path.join(ws, 'config.json');
    fs.writeFileSync(p, '{}');
    // The directories read as ours (1000), the leaf as 1001's.
    const leafFs = { ...foreignFs(['lstatSync'], 1000), fstatSync: foreignFs(['fstatSync'], 1001).fstatSync };
    const err = expectUnsafe(() => readWorkspaceFile(root, p, {}, { fs: leafFs, getuid: () => 1000 }), 'foreign_owner');
    expect(err.message).toContain('it is owned by uid 1001; you are uid 1000');
  });

  it('every other reason keeps its message', () => {
    const err = new UnsafePathError('/ws/.mobile-automator/x', 'symlink');
    expect(err.message).toBe('Refusing to use workspace path /ws/.mobile-automator/x: it is a symbolic link (symlink).');
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

  it('refuses a hard-linked leaf for a read too with singleLink (hardlink)', () => {
    const p = path.join(ws, 'a');
    fs.linkSync(canaryFile, p);
    fs.closeSync(openOwnedLeaf(p, O_RDONLY));
    expectUnsafe(() => openOwnedLeaf(p, O_RDONLY, { singleLink: true }), 'hardlink');
  });

  // #361: the session client opens marker.salt relative to a directory it has
  // chdir'd into and checked. Resolving the name against the cwd's NAME would
  // reach whatever directory carries that name now, not the one checked.
  it('opens a relative leaf by the relative name, never a path rebuilt from the cwd', () => {
    const p = path.join(ws, 'a');
    fs.writeFileSync(p, 'abc');
    const opened = [];
    const spy = { ...fs, openSync: (f, ...rest) => (opened.push(f), fs.openSync(f, ...rest)) };
    const prev = process.cwd();
    process.chdir(ws);
    try {
      fs.closeSync(openOwnedLeaf('a', O_RDONLY, {}, { fs: spy }));
      expect(readOwnedLeaf('a', {}, { fs: spy })).toBe('abc');
    } finally {
      process.chdir(prev);
    }
    expect(opened).toEqual(['a', 'a']);
  });

  it('a refusal of a relative leaf still names the absolute path', () => {
    const link = path.join(ws, 'a');
    fs.symlinkSync(canaryFile, link);
    const prev = process.cwd();
    process.chdir(ws);
    let err;
    let absolute;
    try {
      absolute = path.resolve('a');
      err = expectUnsafe(() => openOwnedLeaf('a', O_RDONLY), 'symlink');
    } finally {
      process.chdir(prev);
    }
    expect(err.path).toBe(absolute);
  });

  it('opens a one-link leaf for a read with singleLink', () => {
    const p = path.join(ws, 'a');
    fs.writeFileSync(p, 'x');
    fs.closeSync(openOwnedLeaf(p, O_RDONLY, { singleLink: true }));
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
    ['symlink', (p) => (fs.symlinkSync(canaryFile, p), () => openOwnedLeaf(p, O_RDONLY))],
    ['not_regular', (p) => (fs.mkdirSync(p), () => openOwnedLeaf(p, O_RDONLY))],
    ['hardlink', (p) => (fs.linkSync(canaryFile, p), () => openOwnedLeaf(p, O_WRONLY))],
    [
      'foreign_owner',
      (p) => (
        fs.writeFileSync(p, 'x'),
        () => openOwnedLeaf(p, O_RDONLY, {}, { fs: foreignFs(['fstatSync']) })
      ),
    ],
  ])('a %s refusal is scope-free; inScope re-words it for the path scope, same path and reason', (reason, setup) => {
    const p = path.join(ws, 'a');
    const err = expectUnsafe(setup(p), reason);
    expect(err.scope).toBe('workspace');
    const scoped = err.inScope('path');
    expect(scoped).toBeInstanceOf(UnsafePathError);
    expect(scoped).toMatchObject({ scope: 'path', reason, path: err.path, code: err.code, kind: err.kind });
    expect(scoped.message.startsWith('Refusing to use path ')).toBe(true);
    expect(scoped.hint).toBe(new UnsafePathError(err.path, reason, { scope: 'path' }).hint);
  });

  it('inScope keeps the owner check own detail: both uids still named in the path scope', () => {
    const p = path.join(ws, 'a');
    fs.writeFileSync(p, 'x');
    const err = expectUnsafe(() => openOwnedLeaf(p, O_RDONLY, {}, { fs: foreignFs(['fstatSync']) }), 'foreign_owner');
    const detail = `it is owned by uid ${REAL_UID + 1}; you are uid ${REAL_UID}`;
    expect(err.message).toContain(detail);
    expect(err.inScope('path').message).toBe(`Refusing to use path ${p}: ${detail} (foreign_owner).`);
  });
});

describe('readOwnedLeaf', () => {
  it('returns the content of a leaf', () => {
    const p = path.join(ws, 'a');
    fs.writeFileSync(p, 'hello');
    expect(readOwnedLeaf(p)).toBe('hello');
  });

  it('is null when the leaf is absent', () => {
    expect(readOwnedLeaf(path.join(ws, 'missing'))).toBeNull();
  });

  it('refuses a symlink leaf, never reading its target', () => {
    const p = path.join(ws, 'a');
    fs.symlinkSync(canaryFile, p);
    const err = expectUnsafe(() => readOwnedLeaf(p), 'symlink');
    expect(err.message).not.toContain(CANARY);
  });

  it('refuses a leaf past maxBytes (too_large), reads one at it', () => {
    const p = path.join(ws, 'a');
    fs.writeFileSync(p, '12345');
    expect(readOwnedLeaf(p, { maxBytes: 5 })).toBe('12345');
    expectUnsafe(() => readOwnedLeaf(p, { maxBytes: 4 }), 'too_large');
  });

  it('reads a second link by default, refuses it with singleLink (hardlink)', () => {
    const p = path.join(ws, 'a');
    fs.linkSync(canaryFile, p);
    expect(readOwnedLeaf(p)).toBe(CANARY);
    expectUnsafe(() => readOwnedLeaf(p, { singleLink: true }), 'hardlink');
  });

  it('refuses a leaf of another owner', () => {
    const p = path.join(ws, 'a');
    fs.writeFileSync(p, 'x');
    expectUnsafe(() => readOwnedLeaf(p, {}, { fs: foreignFs(['fstatSync']) }), 'foreign_owner');
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
    expect(envelope.error.message).toContain(`owned by uid ${REAL_UID}; you are uid ${REAL_UID + 1}`);
    expect(envelope.hint).toContain('MAUTO_TRUST_WORKSPACE_OWNER=1');
    expect(envelope.hint).toMatch(/only the owner check/i);
  });

  it.each([
    ['escape', () => safeDir(root, path.join(ws, '..', '..', 'outside'))],
    ['world_writable', () => (fs.chmodSync(ws, 0o777), safeDir(root, ws))],
    [
      'not_private',
      () => (
        fs.chmodSync(ws, 0o755),
        safeDir(root, ws, { policy: dirPolicy({ ...WORKSPACE_DIR, forbiddenBits: 0o077, modeReason: 'not_private' }) })
      ),
    ],
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
