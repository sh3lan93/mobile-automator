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
const net = require('net');
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
  privateDir,
  privateWorkspaceDir,
  isOwnSocket,
  PRIVATE_WORKSPACE_DIR,
} = require('../../../src/workspace/safe-fs');
// The envelope boundary: a refusal reaches the agent through toEnvelope's
// typed-error branch, which maps the error's own kind, message and hint.
const { toEnvelope } = require('../../../src/cli');

const { O_RDONLY, O_WRONLY, O_RDWR, O_CREAT, O_TRUNC } = fs.constants;
const CANARY = 'SECRET-CANARY';
const REAL_UID = process.getuid();
// A uid that is never ours, whatever uid the tests run as (a CI runner is
// often 1001, so no fixed number is safe to compare with the real uid).
const FOREIGN_UID = REAL_UID + 1;
// Root bypasses permission bits and its umask is often 0, so a mode-dependent
// assertion proves nothing there.
const itNotRoot = REAL_UID === 0 ? it.skip : it;

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
function foreignFs(which = ['lstatSync', 'fstatSync'], uid = FOREIGN_UID) {
  const wrapped = { ...fs };
  for (const name of which) {
    wrapped[name] = (...args) => {
      const st = fs[name](...args);
      st.uid = uid;
      return st;
    };
  }
  return wrapped;
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
// could never fire; run it in a child with a hard timeout instead.
function readReasonInChild(projectRoot, file) {
  const modulePath = require.resolve('../../../src/workspace/safe-fs');
  const script = [
    'const [, mod, rootDir, file] = process.argv;',
    'try { require(mod).readWorkspaceFile(rootDir, file); process.stdout.write("null"); }',
    'catch (e) { process.stdout.write(JSON.stringify(e.reason || e.code)); }',
  ].join('\n');
  return JSON.parse(
    childProcess.execFileSync(process.execPath, ['-e', script, modulePath, projectRoot, file], {
      encoding: 'utf8',
      timeout: 3000,
    })
  );
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

// #346: `.session/` and the long-path socket fallback hold the device
// session's socket, so no other user may even look inside them: the check is
// 0700-tight (no group or other bit), not just "not world-writable".
describe('safeDir with the PRIVATE_WORKSPACE_DIR policy (#346)', () => {
  let d;
  beforeEach(() => {
    d = path.join(ws, '.session');
    fs.mkdirSync(d);
    fs.chmodSync(d, 0o700);
  });

  it('accepts a 0700 target under a group-writable workspace (only the last component is private)', () => {
    fs.chmodSync(ws, 0o775);
    expect(safeDir(root, d, { policy: PRIVATE_WORKSPACE_DIR })).toBe(fs.realpathSync(d));
  });

  it('the components above it stay workspace directories: a world-writable one is world_writable', () => {
    fs.chmodSync(ws, 0o777);
    expectUnsafe(() => safeDir(root, d, { policy: PRIVATE_WORKSPACE_DIR }), 'world_writable');
  });

  it.each([['0755', 0o755], ['0750', 0o750], ['0705', 0o705], ['0701', 0o701]])('refuses a target at %s (not_private)', (_label, mode) => {
    fs.chmodSync(d, mode);
    const err = expectUnsafe(() => safeDir(root, d, { policy: PRIVATE_WORKSPACE_DIR }), 'not_private');
    expect(err.path).toBe(d);
  });

  it('under the default policy, the same 0755 and g+w targets are still accepted', () => {
    for (const mode of [0o755, 0o775]) {
      fs.chmodSync(d, mode);
      expect(safeDir(root, d)).toBe(fs.realpathSync(d));
    }
  });

  it('still honours MAUTO_TRUST_WORKSPACE_OWNER=1 for a foreign-owned 0700 target (D-d)', () => {
    const deps = { fs: foreignFs(['lstatSync']), env: { MAUTO_TRUST_WORKSPACE_OWNER: '1' } };
    expect(safeDir(root, d, { policy: PRIVATE_WORKSPACE_DIR }, deps)).toBe(fs.realpathSync(d));
    // ...and without the override the same target is foreign.
    expectUnsafe(() => safeDir(root, d, { policy: PRIVATE_WORKSPACE_DIR }, { fs: foreignFs(['lstatSync']) }), 'foreign_owner');
  });

  it('the override never loosens the mode check', () => {
    fs.chmodSync(d, 0o750);
    const deps = { fs: foreignFs(['lstatSync']), env: { MAUTO_TRUST_WORKSPACE_OWNER: '1' } };
    expectUnsafe(() => safeDir(root, d, { policy: PRIVATE_WORKSPACE_DIR }, deps), 'not_private');
  });

  itNotRoot('create + mode 0o700 makes a private target under umask 022', () => {
    const fresh = path.join(ws, 'fresh');
    const umask = process.umask(0o022);
    try {
      safeDir(root, fresh, { create: true, mode: 0o700, policy: PRIVATE_WORKSPACE_DIR });
    } finally {
      process.umask(umask);
    }
    expect(fs.lstatSync(fresh).mode & 0o777).toBe(0o700);
  });
});

// The long-path socket fallback lives OUTSIDE the workspace, in the temp dir or
// the XDG runtime dir, so no workspace walk applies and no override does
// either: it must be a real 0700 directory that we own, always.
describe('privateDir (#346)', () => {
  let dir;
  beforeEach(() => {
    dir = path.join(base, 'sockdir');
  });

  itNotRoot('create: true makes it 0700 even under umask 022', () => {
    const umask = process.umask(0o022);
    try {
      expect(privateDir(dir, { create: true })).toBeUndefined();
    } finally {
      process.umask(umask);
    }
    const st = fs.lstatSync(dir);
    expect(st.isDirectory()).toBe(true);
    expect(st.mode & 0o777).toBe(0o700);
  });

  it('accepts an existing 0700 directory of ours, without create', () => {
    fs.mkdirSync(dir);
    fs.chmodSync(dir, 0o700);
    expect(() => privateDir(dir)).not.toThrow();
  });

  it('without create, a missing dir throws the plain ENOENT error and creates nothing', () => {
    let caught;
    try {
      privateDir(dir);
    } catch (err) {
      caught = err;
    }
    expect(caught).not.toBeInstanceOf(UnsafePathError);
    expect(caught.code).toBe('ENOENT');
    expect(fs.existsSync(dir)).toBe(false);
  });

  it('creates only the last level: a missing parent is not made', () => {
    const deep = path.join(base, 'missing-parent', 'sockdir');
    let caught;
    try {
      privateDir(deep, { create: true });
    } catch (err) {
      caught = err;
    }
    expect(caught.code).toBe('ENOENT');
    expect(fs.existsSync(path.join(base, 'missing-parent'))).toBe(false);
  });

  it('refuses a symlink to a 0700 directory (symlink), creating nothing there', () => {
    fs.chmodSync(outside, 0o700);
    fs.symlinkSync(outside, dir);
    const before = snapshot(outside);
    expectUnsafe(() => privateDir(dir, { create: true }), 'symlink');
    expect(snapshot(outside)).toEqual(before);
  });

  it('refuses a regular file (not_directory)', () => {
    fs.writeFileSync(dir, 'x');
    expectUnsafe(() => privateDir(dir, { create: true }), 'not_directory');
  });

  it('refuses a dir owned by another uid, even with MAUTO_TRUST_WORKSPACE_OWNER=1 (foreign_owner)', () => {
    fs.mkdirSync(dir);
    fs.chmodSync(dir, 0o700);
    const deps = { fs: foreignFs(['lstatSync']), env: { MAUTO_TRUST_WORKSPACE_OWNER: '1' } };
    const err = expectUnsafe(() => privateDir(dir, { create: true }, deps), 'foreign_owner');
    expect(err.message).toContain(`it is owned by uid ${FOREIGN_UID}; you are uid ${REAL_UID}`);
  });

  it.each([['0755', 0o755], ['0750', 0o750], ['0705', 0o705], ['0777', 0o777]])('refuses an existing dir of ours at %s (not_private), leaving its mode', (_label, mode) => {
    fs.mkdirSync(dir);
    fs.chmodSync(dir, mode);
    expectUnsafe(() => privateDir(dir, { create: true }), 'not_private');
    expect(fs.lstatSync(dir).mode & 0o777).toBe(mode);
  });

  it('tolerates a mkdir race (EEXIST) and checks what is there', () => {
    const racing = { ...fs };
    racing.mkdirSync = (p, opts) => {
      fs.mkdirSync(p, opts);
      fs.chmodSync(p, 0o700);
      throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
    };
    expect(() => privateDir(dir, { create: true }, { fs: racing })).not.toThrow();
  });

  it('a mkdir race that plants a symlink is refused', () => {
    const racing = { ...fs };
    racing.mkdirSync = (p) => {
      fs.symlinkSync(outside, p);
      throw Object.assign(new Error('EEXIST'), { code: 'EEXIST' });
    };
    expectUnsafe(() => privateDir(dir, { create: true }, { fs: racing }), 'symlink');
  });
});

// privateDir guards the session socket's directory, outside the workspace, so
// its refusals must not talk about a workspace or offer the owner override
// (D-d: it never applies there). Same class and fields, so every boundary
// still maps it as an environment failure.
// .session/: a workspace directory that must end up 0700, including one an
// older mauto made 0755. Its chmod follows links, so the directory is walked
// again afterwards and only returned once it is proven link-free and private.
describe('privateWorkspaceDir (#346)', () => {
  let d;
  beforeEach(() => {
    d = path.join(ws, '.session');
  });

  itNotRoot('creates it 0700 under umask 022 and returns its realpath', () => {
    const prev = process.umask(0o022);
    try {
      expect(privateWorkspaceDir(root, d)).toBe(fs.realpathSync(d));
    } finally {
      process.umask(prev);
    }
    expect(fs.lstatSync(d).mode & 0o777).toBe(0o700);
  });

  itNotRoot('tightens an existing 0755 one to 0700', () => {
    fs.mkdirSync(d);
    fs.chmodSync(d, 0o755);
    privateWorkspaceDir(root, d);
    expect(fs.lstatSync(d).mode & 0o777).toBe(0o700);
  });

  it('refuses a symlink before any chmod, leaving its target alone', () => {
    fs.chmodSync(outside, 0o755);
    fs.symlinkSync(outside, d);
    expectUnsafe(() => privateWorkspaceDir(root, d), 'symlink');
    expect(fs.lstatSync(outside).mode & 0o777).toBe(0o755);
  });

  it('a swap to a link between the walk and the chmod is refused, never returned', () => {
    fs.mkdirSync(d);
    const swapping = { ...fs };
    swapping.chmodSync = (p, mode) => {
      fs.renameSync(d, path.join(base, 'moved-session'));
      fs.symlinkSync(outside, d);
      return fs.chmodSync(p, mode);
    };
    expectUnsafe(() => privateWorkspaceDir(root, d, { fs: swapping }), 'symlink');
  });

  // A chmod that changes nothing (a filesystem that ignores modes, or a racing
  // chmod back) must not pass for a private directory.
  it('a directory still not 0700 after the chmod is refused (not_private)', () => {
    fs.mkdirSync(d);
    fs.chmodSync(d, 0o755);
    const inert = { ...fs, chmodSync: () => {} };
    expectUnsafe(() => privateWorkspaceDir(root, d, { fs: inert }), 'not_private');
  });
});

// The device session's socket, which open(2) refuses, so it is checked by
// lstat. A predicate: the client never reports a bad socket, it starts its own
// daemon. The owner override never applies to it (D-d).
describe('isOwnSocket (#346)', () => {
  let servers;
  beforeEach(() => {
    servers = [];
  });
  afterEach(async () => {
    await Promise.all(servers.map((srv) => new Promise((resolve) => srv.close(() => resolve()))));
  });

  function listen(sock) {
    const server = net.createServer();
    servers.push(server);
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(sock, () => resolve(server));
    });
  }

  it('true for a real socket of ours', async () => {
    const sock = path.join(base, 's.sock');
    await listen(sock);
    expect(isOwnSocket(sock)).toBe(true);
  });

  it('false for a regular file', () => {
    const sock = path.join(base, 's.sock');
    fs.writeFileSync(sock, 'x');
    expect(isOwnSocket(sock)).toBe(false);
  });

  it('false for a link to a real listening socket of ours', async () => {
    const real = path.join(base, 'real.sock');
    await listen(real);
    const sock = path.join(base, 's.sock');
    fs.symlinkSync(real, sock);
    expect(isOwnSocket(sock)).toBe(false);
  });

  it('false for a socket owned by another uid, even with MAUTO_TRUST_WORKSPACE_OWNER=1', async () => {
    const sock = path.join(base, 's.sock');
    await listen(sock);
    expect(isOwnSocket(sock, { fs: foreignFs(['lstatSync']) })).toBe(false);
    expect(isOwnSocket(sock, { fs: foreignFs(['lstatSync']), env: { MAUTO_TRUST_WORKSPACE_OWNER: '1' } })).toBe(false);
  });

  it('false for a missing socket; any other fs error propagates', () => {
    expect(isOwnSocket(path.join(base, 'nope.sock'))).toBe(false);
    const broken = { ...fs, lstatSync: () => { throw Object.assign(new Error('EIO'), { code: 'EIO' }); } };
    expect(() => isOwnSocket(path.join(base, 's.sock'), { fs: broken })).toThrow('EIO');
  });
});

describe('a privateDir refusal names the session socket directory (#346)', () => {
  let dir;
  beforeEach(() => {
    dir = path.join(base, 'sockdir');
  });

  const cases = {
    symlink: () => fs.symlinkSync(outside, dir),
    not_directory: () => fs.writeFileSync(dir, 'x'),
    not_private: () => (fs.mkdirSync(dir), fs.chmodSync(dir, 0o755)),
    foreign_owner: () => (fs.mkdirSync(dir), fs.chmodSync(dir, 0o700)),
  };
  const depsFor = (reason) =>
    reason === 'foreign_owner' ? { fs: foreignFs(['lstatSync']), env: { MAUTO_TRUST_WORKSPACE_OWNER: '1' } } : {};

  it.each(Object.keys(cases))('%s: no workspace wording and no owner override, same fields', (reason) => {
    cases[reason]();
    const err = expectUnsafe(() => privateDir(dir, { create: true }, depsFor(reason)), reason);
    expect(err.kind).toBe('environment');
    expect(err.path).toBe(dir);
    expect(err.message.startsWith(`Refusing to use session socket directory ${dir}: `)).toBe(true);
    expect(err.message.endsWith(` (${reason}).`)).toBe(true);
    // The path is the host's temp dir, which this test does not choose.
    for (const text of [err.message.replace(dir, '<dir>'), err.hint]) {
      expect(text).not.toMatch(/workspace/i);
      expect(text).not.toContain('.mobile-automator');
      expect(text).not.toContain('MAUTO_TRUST_WORKSPACE_OWNER');
    }
    const { envelope, exitKind } = toEnvelope(err);
    expect(exitKind).toBe('environment');
    expect(envelope.error.message).toBe(err.message);
    expect(envelope.hint).toBe(err.hint);
  });

  it('the hints say what to do with that directory', () => {
    const hintFor = (reason) => {
      cases[reason]();
      const err = expectUnsafe(() => privateDir(dir, { create: true }, depsFor(reason)), reason);
      fs.rmSync(dir, { recursive: true, force: true });
      return err;
    };
    const foreign = hintFor('foreign_owner');
    expect(foreign.message).toContain(`it is owned by uid ${FOREIGN_UID}; you are uid ${REAL_UID}`);
    expect(foreign.hint).toMatch(/another user owns it/i);
    expect(foreign.hint).toContain('XDG_RUNTIME_DIR');
    expect(hintFor('not_private').hint).toContain('chmod 700 <path>');
    for (const reason of ['symlink', 'not_directory']) {
      expect(hintFor(reason).hint).toMatch(/remove it.*0700/i);
    }
  });

  it('a workspace refusal keeps its workspace wording and hints', () => {
    const err = expectUnsafe(() => safeDir(root, ws, {}, { getuid: () => REAL_UID + 1 }), 'foreign_owner');
    expect(err.message.startsWith(`Refusing to use workspace path ${ws}: `)).toBe(true);
    expect(err.hint).toContain('MAUTO_TRUST_WORKSPACE_OWNER=1');
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
    ['not_private', () => (fs.chmodSync(ws, 0o755), safeDir(root, ws, { policy: PRIVATE_WORKSPACE_DIR }))],
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
