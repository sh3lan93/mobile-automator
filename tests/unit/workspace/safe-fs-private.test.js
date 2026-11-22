'use strict';

// safe-fs's checks for the device session (#346): `.session/` and the
// long-path socket fallback hold the daemon's socket, so no other user may
// even look inside them, and the socket itself must be ours. These are the
// lowest-layer tests of those rules; session-dir.test.js covers only how
// ensureSessionDirs and verifySocket wire them up. The fixture is
// tests/helpers/safe-fs-fixture.js.

const fs = require('fs');
const net = require('net');
const path = require('path');

const {
  UnsafePathError,
  safeDir,
  privateDir,
  privateWorkspaceDir,
  isOwnSocket,
  PRIVATE_WORKSPACE_DIR,
} = require('../../../src/workspace/safe-fs');
// The envelope boundary: a refusal reaches the agent through toEnvelope's
// typed-error branch, which maps the error's own kind, message and hint.
const { toEnvelope } = require('../../../src/cli');
const {
  REAL_UID,
  FOREIGN_UID,
  itNotRoot,
  makeFixture,
  snapshot,
  expectUnsafe,
  foreignFs,
} = require('../../helpers/safe-fs-fixture');

let base;
let root;
let ws;
let outside;

beforeEach(() => {
  ({ base, root, ws, outside } = makeFixture());
});

afterEach(() => {
  fs.rmSync(base, { recursive: true, force: true });
});

// `.session/`: 0700-tight (no group or other bit), not just "not
// world-writable".
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

// privateDir guards the session socket's directory, outside the workspace, so
// its refusals must not talk about a workspace or offer the owner override
// (D-d: it never applies there). Same class and fields, so every boundary
// still maps it as an environment failure.
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
