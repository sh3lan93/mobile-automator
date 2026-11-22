'use strict';

// session-dir (#346): the device session's socket is reachable only through
// directories no other user can enter, and the client trusts a socket only
// when its directory and the socket itself check out. This file pins the
// session's policies (.session/, the fallback socket directory, the socket),
// their wording, and which applies where, one case per rule. The generic
// primitives they are built on (checkDir, safeDir's policy, isOwnLeaf) are
// pinned in tests/unit/workspace/safe-fs-policy.test.js. Real tmp trees and
// real listening sockets, because the guarantees are about what lstat sees;
// only "another owner" is simulated (a wrapped lstatSync), because jest cannot
// chown.
//
// Nothing here touches the real per-user fallback directory: a long root's
// fallback is pointed (an injected tmpdir) at a directory inside the test's
// own temp dir.

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const {
  ensureSessionDir,
  ensureSessionDirs,
  isOwnSocket,
  verifySocket,
  listenOwnerOnly,
} = require('../../../src/device/session-dir');
const paths = require('../../../src/device/session-paths');
const { UnsafePathError } = require('../../../src/workspace/safe-fs');
// The envelope boundary: a refusal reaches the agent through toEnvelope's
// typed-error branch, which maps the error's own kind, message and hint.
const { toEnvelope } = require('../../../src/cli');

const REAL_UID = process.getuid();
// Never ours, whatever uid the tests run as.
const FOREIGN_UID = REAL_UID + 1;
// Root bypasses permission bits and its umask is often 0, so a mode-dependent
// assertion proves nothing there.
const testNotRoot = REAL_UID === 0 ? test.skip : test;

let base;
let servers;

beforeEach(() => {
  // A short prefix: the in-workspace socket path must fit the sockaddr limit
  // under macOS's long os.tmpdir().
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'sd-'));
  servers = [];
});

afterEach(async () => {
  await Promise.all(servers.map((s) => new Promise((resolve) => s.close(() => resolve()))));
  fs.rmSync(base, { recursive: true, force: true });
});

const mode = (p) => fs.lstatSync(p).mode & 0o777;

// A project whose in-workspace socket path fits the limit, so the socket lives
// in .session/.
function shortRoot() {
  const root = path.join(base, 'p');
  fs.mkdirSync(root);
  if (!paths.socketLocation(root, { env: {} }).inWorkspace) {
    throw new Error(`os.tmpdir() is too long for an in-workspace socket fixture: ${root}`);
  }
  return root;
}

// A project too deep for an in-workspace socket, with its fallback directory
// redirected into this test's temp dir. `deps` is what every call must get.
function longRoot() {
  const root = path.join(base, 'd'.repeat(80));
  fs.mkdirSync(root);
  const tmp = path.join(base, 'tmp');
  fs.mkdirSync(tmp, { mode: 0o700 });
  const deps = { tmpdir: () => tmp };
  const fallbackDir = path.join(tmp, `mauto-${REAL_UID}`);
  expect(paths.socketLocation(root, deps)).toEqual({
    file: path.join(fallbackDir, `${paths.workspaceKey(root)}.sock`),
    dir: fallbackDir,
    inWorkspace: false,
  });
  return { root, deps, fallbackDir };
}

function listen(sock) {
  const server = net.createServer();
  servers.push(server);
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(sock, () => resolve(server));
  });
}

// An fs whose lstatSync reports `uid` for the paths `pick` selects.
function foreignLstat(pick, uid = FOREIGN_UID) {
  return {
    ...fs,
    lstatSync: (p, ...rest) => {
      const st = fs.lstatSync(p, ...rest);
      if (pick(path.resolve(p))) st.uid = uid;
      return st;
    },
  };
}

function expectRefusal(fn, reason) {
  let caught;
  try {
    fn();
  } catch (err) {
    caught = err;
  }
  expect(caught).toBeInstanceOf(UnsafePathError);
  expect(caught.reason).toBe(reason);
  return caught;
}

describe('ensureSessionDirs', () => {
  test('returns the socket path whose directory it prepared, in the workspace or the fallback', () => {
    const root = shortRoot();
    expect(ensureSessionDirs(root)).toBe(paths.workspaceSocketPath(root));
    const deep = longRoot();
    expect(ensureSessionDirs(deep.root, deep.deps)).toBe(path.join(deep.fallbackDir, `${paths.workspaceKey(deep.root)}.sock`));
  });

  test('a short root never creates the fallback directory', () => {
    const root = shortRoot();
    const tmp = path.join(base, 'tmp');
    fs.mkdirSync(tmp);
    ensureSessionDirs(root, { tmpdir: () => tmp });
    expect(fs.readdirSync(tmp)).toEqual([]);
  });

  testNotRoot('a long root also gets its fallback directory, created 0700 under umask 022', () => {
    const { root, deps, fallbackDir } = longRoot();
    const prev = process.umask(0o022);
    try {
      ensureSessionDirs(root, deps);
    } finally {
      process.umask(prev);
    }
    expect(fs.lstatSync(fallbackDir).isDirectory()).toBe(true);
    expect(mode(fallbackDir)).toBe(0o700);
    // The handle and pid file still live in the workspace.
    expect(mode(paths.sessionDir(root))).toBe(0o700);
  });

  test('refuses a pre-existing fallback directory that other users can enter (not_private), leaving it', () => {
    const { root, deps, fallbackDir } = longRoot();
    fs.mkdirSync(fallbackDir);
    fs.chmodSync(fallbackDir, 0o755);
    expectRefusal(() => ensureSessionDirs(root, deps), 'not_private');
    expect(mode(fallbackDir)).toBe(0o755);
  });
});

// The .session/ half alone, for a caller that needs the workspace directory
// whatever becomes of the socket's (the daemon log, session-log.js).
describe('ensureSessionDir', () => {
  testNotRoot('makes .session 0700 and tightens an existing 0755 one', () => {
    const root = shortRoot();
    const prev = process.umask(0o022);
    try {
      ensureSessionDir(root);
      expect(mode(paths.sessionDir(root))).toBe(0o700);
      fs.chmodSync(paths.sessionDir(root), 0o755);
      ensureSessionDir(root);
    } finally {
      process.umask(prev);
    }
    expect(mode(paths.sessionDir(root))).toBe(0o700);
  });

  test('for a deep root, never makes or checks the fallback directory', () => {
    const { root, deps, fallbackDir } = longRoot();
    ensureSessionDir(root, deps);
    expect(fs.existsSync(fallbackDir)).toBe(false);
    // A refused fallback directory does not stop it either.
    fs.mkdirSync(fallbackDir);
    fs.chmodSync(fallbackDir, 0o755);
    expect(() => ensureSessionDir(root, deps)).not.toThrow();
    expect(() => ensureSessionDirs(root, deps)).toThrow(UnsafePathError);
  });

  test('refuses a symlinked .session before any chmod, leaving its target alone', () => {
    const root = shortRoot();
    const target = path.join(base, 'elsewhere');
    fs.mkdirSync(target);
    fs.chmodSync(target, 0o755);
    fs.mkdirSync(path.join(root, '.mobile-automator'));
    fs.symlinkSync(target, paths.sessionDir(root));
    expectRefusal(() => ensureSessionDir(root), 'symlink');
    expect(mode(target)).toBe(0o755);
  });

  test('a swap to a link between the walk and the chmod is refused, never returned', () => {
    const root = shortRoot();
    const dir = paths.sessionDir(root);
    const target = path.join(base, 'elsewhere');
    fs.mkdirSync(target);
    fs.mkdirSync(dir, { recursive: true });
    const swapping = {
      ...fs,
      chmodSync: (p, m) => {
        fs.renameSync(dir, path.join(base, 'moved-session'));
        fs.symlinkSync(target, dir);
        return fs.chmodSync(p, m);
      },
    };
    expectRefusal(() => ensureSessionDir(root, { fs: swapping }), 'symlink');
  });

  // A chmod that changes nothing (a filesystem that ignores modes, or a racing
  // chmod back) must not pass for a private directory. The refusal keeps the
  // workspace wording: .session/ is a workspace directory.
  test('a .session still not 0700 after the chmod is refused (not_private), worded as a workspace path', () => {
    const root = shortRoot();
    const dir = paths.sessionDir(root);
    fs.mkdirSync(dir, { recursive: true });
    fs.chmodSync(dir, 0o755);
    const inert = { ...fs, chmodSync: () => {} };
    const err = expectRefusal(() => ensureSessionDir(root, { fs: inert }), 'not_private');
    expect(err.message).toBe(`Refusing to use workspace path ${dir}: other users can access it (not_private).`);
    expect(err.hint).toContain('chmod 700 <path>');
  });
});

// The fallback socket directory, outside the workspace: a real 0700 directory
// of ours, whatever MAUTO_TRUST_WORKSPACE_OWNER says (D-d), never chmodded.
describe('the fallback socket directory (ensureSessionDirs, deep root)', () => {
  const OVERRIDE = { MAUTO_TRUST_WORKSPACE_OWNER: '1' };
  let root;
  let deps;
  let fallbackDir;
  beforeEach(() => {
    ({ root, deps, fallbackDir } = longRoot());
  });

  // Each refusal case: plant it, and the deps that make it refused.
  const cases = {
    symlink: () => {
      const target = path.join(base, 'elsewhere');
      fs.mkdirSync(target, { mode: 0o700 });
      fs.symlinkSync(target, fallbackDir);
      return deps;
    },
    not_directory: () => (fs.writeFileSync(fallbackDir, 'x'), deps),
    not_private: () => (fs.mkdirSync(fallbackDir), fs.chmodSync(fallbackDir, 0o750), deps),
    foreign_owner: () => {
      fs.mkdirSync(fallbackDir, { mode: 0o700 });
      return { ...deps, env: OVERRIDE, fs: foreignLstat((p) => p === fallbackDir) };
    },
  };

  test.each(Object.keys(cases))('%s is refused, even with the owner override for foreign_owner', (reason) => {
    expectRefusal(() => ensureSessionDirs(root, cases[reason]()), reason);
  });

  test.each(Object.keys(cases))('%s: worded as the session socket directory, with no workspace advice', (reason) => {
    const err = expectRefusal(() => ensureSessionDirs(root, cases[reason]()), reason);
    expect(err.path).toBe(fallbackDir);
    expect(err.message.startsWith(`Refusing to use session socket directory ${fallbackDir}: `)).toBe(true);
    expect(err.message.endsWith(` (${reason}).`)).toBe(true);
    // The path is under the test's temp dir, which this test does not name.
    for (const text of [err.message.replace(fallbackDir, '<dir>'), err.hint]) {
      expect(text).not.toMatch(/workspace/i);
      expect(text).not.toContain('.mobile-automator');
      expect(text).not.toContain('MAUTO_TRUST_WORKSPACE_OWNER');
    }
    const { envelope, exitKind } = toEnvelope(err);
    expect(exitKind).toBe('environment');
    expect(envelope.error.message).toBe(err.message);
    expect(envelope.hint).toBe(err.hint);
  });

  test('the hints say what to do with that directory', () => {
    const hintFor = (reason) => {
      const err = expectRefusal(() => ensureSessionDirs(root, cases[reason]()), reason);
      fs.rmSync(fallbackDir, { recursive: true, force: true });
      return err;
    };
    const foreign = hintFor('foreign_owner');
    expect(foreign.message).toContain(`it is owned by uid ${FOREIGN_UID}; you are uid ${REAL_UID}`);
    expect(foreign.hint).toMatch(/another user owns it/i);
    expect(foreign.hint).toMatch(/recreates it 0700/);
    expect(hintFor('not_private').hint).toContain('chmod 700 <path>');
    for (const reason of ['symlink', 'not_directory']) {
      expect(hintFor(reason).hint).toMatch(/remove it.*0700/i);
    }
  });

  test('a loose mode is refused, never repaired', () => {
    fs.mkdirSync(fallbackDir);
    fs.chmodSync(fallbackDir, 0o777);
    expectRefusal(() => ensureSessionDirs(root, deps), 'not_private');
    expect(mode(fallbackDir)).toBe(0o777);
  });
});

// The socket leaf: a real socket, not a link, ours, whatever the override says.
describe('isOwnSocket', () => {
  test('true for a real socket of ours', async () => {
    const sock = path.join(base, 's.sock');
    await listen(sock);
    expect(isOwnSocket(sock)).toBe(true);
  });

  test('false for a regular file', () => {
    const sock = path.join(base, 's.sock');
    fs.writeFileSync(sock, 'x');
    expect(isOwnSocket(sock)).toBe(false);
  });

  test('false for a link to a real listening socket of ours', async () => {
    const real = path.join(base, 'real.sock');
    await listen(real);
    const sock = path.join(base, 's.sock');
    fs.symlinkSync(real, sock);
    expect(isOwnSocket(sock)).toBe(false);
  });

  test('false for a socket owned by another uid, even with MAUTO_TRUST_WORKSPACE_OWNER=1', async () => {
    const sock = path.join(base, 's.sock');
    await listen(sock);
    expect(isOwnSocket(sock, { fs: foreignLstat(() => true), env: { MAUTO_TRUST_WORKSPACE_OWNER: '1' } })).toBe(false);
  });

  test('false for a missing socket', () => {
    expect(isOwnSocket(path.join(base, 'nope.sock'))).toBe(false);
  });
});

describe('verifySocket', () => {
  async function liveShort() {
    const root = shortRoot();
    ensureSessionDirs(root);
    await listen(paths.socketPath(root, { env: {} }));
    return root;
  }

  test('the socket path for a real listener in a 0700 .session', async () => {
    const root = await liveShort();
    expect(verifySocket(root, { env: {} })).toBe(paths.workspaceSocketPath(root));
  });

  test('the socket path for a real listener in a private fallback directory', async () => {
    const { root, deps } = longRoot();
    ensureSessionDirs(root, deps);
    await listen(paths.socketPath(root, deps));
    expect(verifySocket(root, deps)).toBe(paths.socketPath(root, deps));
  });

  test('null for a missing socket', () => {
    const root = shortRoot();
    ensureSessionDirs(root);
    expect(verifySocket(root, { env: {} })).toBeNull();
  });

  test('null when there is no workspace at all, and never throws', () => {
    expect(verifySocket(path.join(base, 'nope'), { env: {} })).toBeNull();
  });

  test('null for a regular file at the socket path', () => {
    const root = shortRoot();
    ensureSessionDirs(root);
    fs.writeFileSync(paths.workspaceSocketPath(root), 'not a socket');
    expect(verifySocket(root, { env: {} })).toBeNull();
  });

  test('null for a regular file at the fallback socket path', () => {
    const { root, deps } = longRoot();
    ensureSessionDirs(root, deps);
    fs.writeFileSync(paths.socketPath(root, deps), 'not a socket');
    expect(verifySocket(root, deps)).toBeNull();
  });

  test('null when .session is 0755, even with a real listener of ours in it', async () => {
    const root = await liveShort();
    fs.chmodSync(paths.sessionDir(root), 0o755);
    expect(verifySocket(root, { env: {} })).toBeNull();
  });

  // D-d: the override skips the owner check on workspace directories, so a
  // CI checkout owned by another uid still works, but the socket itself must
  // always be ours.
  test('MAUTO_TRUST_WORKSPACE_OWNER=1 lets a foreign .session pass, never a foreign socket', async () => {
    const root = await liveShort();
    const sock = paths.workspaceSocketPath(root);
    const env = { MAUTO_TRUST_WORKSPACE_OWNER: '1' };
    const foreignDirs = foreignLstat((p) => p !== sock);
    expect(verifySocket(root, { env: {}, fs: foreignDirs })).toBeNull();
    expect(verifySocket(root, { env, fs: foreignDirs })).toBe(sock);
    expect(verifySocket(root, { env, fs: foreignLstat(() => true) })).toBeNull();
  });

  test('null for a fallback directory other users can enter', async () => {
    const { root, deps, fallbackDir } = longRoot();
    ensureSessionDirs(root, deps);
    await listen(paths.socketPath(root, deps));
    fs.chmodSync(fallbackDir, 0o755);
    expect(verifySocket(root, deps)).toBeNull();
  });
});

// The daemon's bind (#346): the socket is never usable by anyone else, from
// the bind on, and the process-wide umask is always put back.
describe('listenOwnerOnly', () => {
  function sockIn() {
    const root = shortRoot();
    ensureSessionDirs(root);
    return paths.workspaceSocketPath(root);
  }
  function server() {
    const srv = net.createServer();
    servers.push(srv);
    return srv;
  }

  testNotRoot('under umask 022 the socket is 0600, and the umask is restored', async () => {
    const sock = sockIn();
    const prev = process.umask(0o022);
    try {
      await listenOwnerOnly(server(), sock);
      expect(process.umask(0o022)).toBe(0o022);
    } finally {
      process.umask(prev);
    }
    expect(fs.lstatSync(sock).isSocket()).toBe(true);
    expect(mode(sock)).toBe(0o600);
  });

  // Between bind and chmod the socket has whatever mode the umask gave it.
  // With the chmod disabled, the umask alone must already keep others out.
  testNotRoot('the bind itself runs under umask 077, so the socket is private before the chmod', async () => {
    const sock = sockIn();
    const prev = process.umask(0o022);
    const chmod = jest.spyOn(fs, 'chmodSync').mockImplementation(() => {});
    try {
      await listenOwnerOnly(server(), sock);
    } finally {
      chmod.mockRestore();
      process.umask(prev);
    }
    expect(mode(sock) & 0o077).toBe(0);
  });

  test('a listen error rejects, leaves the server not listening and restores the umask', async () => {
    const sock = sockIn();
    await listen(sock);
    const srv = server();
    const prev = process.umask(0o022);
    try {
      await expect(listenOwnerOnly(srv, sock)).rejects.toMatchObject({ code: 'EADDRINUSE' });
      expect(process.umask(0o022)).toBe(0o022);
    } finally {
      process.umask(prev);
    }
    expect(srv.listening).toBe(false);
  });

  test('a failed chmod rejects with the server still listening, for the caller to close', async () => {
    const sock = sockIn();
    const realChmod = fs.chmodSync;
    const chmod = jest.spyOn(fs, 'chmodSync').mockImplementation((p, m) => {
      if (p === sock) throw Object.assign(new Error('EPERM'), { code: 'EPERM' });
      return realChmod(p, m);
    });
    const srv = server();
    try {
      await expect(listenOwnerOnly(srv, sock)).rejects.toMatchObject({ code: 'EPERM' });
    } finally {
      chmod.mockRestore();
    }
    expect(srv.listening).toBe(true);
  });
});
