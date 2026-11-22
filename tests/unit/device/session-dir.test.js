'use strict';

// session-dir (#346): the device session's socket is reachable only through
// directories no other user can enter, and the client trusts a socket only
// when its directory and the socket itself check out. Real tmp trees and real
// listening sockets, because the guarantees are about what lstat sees; only
// "another owner" is simulated (a wrapped lstatSync), because jest cannot
// chown.
//
// Nothing here touches the real per-user fallback directory: a long root's
// fallback is pointed at an XDG_RUNTIME_DIR inside the test's own temp dir.

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');

const { ensureSessionDir, ensureSessionDirs, verifySocket, listenOwnerOnly } = require('../../../src/device/session-dir');
const paths = require('../../../src/device/session-paths');
const { UnsafePathError } = require('../../../src/workspace/safe-fs');

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
  const xdg = path.join(base, 'xdg');
  fs.mkdirSync(xdg, { mode: 0o700 });
  const deps = { env: { XDG_RUNTIME_DIR: xdg } };
  expect(paths.socketLocation(root, deps)).toEqual({
    file: path.join(xdg, 'mauto', `${paths.workspaceKey(root)}.sock`),
    dir: path.join(xdg, 'mauto'),
    inWorkspace: false,
  });
  return { root, deps, fallbackDir: path.join(xdg, 'mauto') };
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
  testNotRoot('creates .session 0700 under umask 022', () => {
    const root = shortRoot();
    const prev = process.umask(0o022);
    try {
      ensureSessionDirs(root);
    } finally {
      process.umask(prev);
    }
    expect(fs.lstatSync(paths.sessionDir(root)).isDirectory()).toBe(true);
    expect(mode(paths.sessionDir(root))).toBe(0o700);
  });

  // The upgrade path: an older mauto made .session/ at 0755.
  testNotRoot('tightens an existing 0755 .session to 0700', () => {
    const root = shortRoot();
    fs.mkdirSync(paths.sessionDir(root), { recursive: true });
    fs.chmodSync(paths.sessionDir(root), 0o755);
    ensureSessionDirs(root);
    expect(mode(paths.sessionDir(root))).toBe(0o700);
  });

  test('refuses a symlinked .session and changes nothing where it points', () => {
    const root = shortRoot();
    const outside = path.join(base, 'outside');
    fs.mkdirSync(outside);
    fs.chmodSync(outside, 0o755);
    fs.mkdirSync(path.join(root, '.mobile-automator'));
    fs.symlinkSync(outside, paths.sessionDir(root));
    expectRefusal(() => ensureSessionDirs(root), 'symlink');
    expect(mode(outside)).toBe(0o755);
    expect(fs.readdirSync(outside)).toEqual([]);
  });

  test('a short root never creates the fallback directory', () => {
    const root = shortRoot();
    const xdg = path.join(base, 'xdg');
    fs.mkdirSync(xdg);
    ensureSessionDirs(root, { env: { XDG_RUNTIME_DIR: xdg } });
    expect(fs.existsSync(path.join(xdg, 'mauto'))).toBe(false);
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

  test('refuses a pre-existing fallback directory owned by another uid (foreign_owner)', () => {
    const { root, deps, fallbackDir } = longRoot();
    fs.mkdirSync(fallbackDir, { mode: 0o700 });
    const fsx = foreignLstat((p) => p === fallbackDir);
    const err = expectRefusal(() => ensureSessionDirs(root, { ...deps, fs: fsx }), 'foreign_owner');
    expect(err.path).toBe(fallbackDir);
    expect(err.message).toBe(
      `Refusing to use session socket directory ${fallbackDir}: it is owned by uid ${FOREIGN_UID}; you are uid ${REAL_UID} (foreign_owner).`
    );
    // The override is for workspaces, never for the socket's directory (D-d).
    const env = { ...deps.env, MAUTO_TRUST_WORKSPACE_OWNER: '1' };
    expectRefusal(() => ensureSessionDirs(root, { env, fs: fsx }), 'foreign_owner');
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

  test('refuses a symlinked .session', () => {
    const root = shortRoot();
    const outside = path.join(base, 'outside');
    fs.mkdirSync(outside);
    fs.mkdirSync(path.join(root, '.mobile-automator'));
    fs.symlinkSync(outside, paths.sessionDir(root));
    expectRefusal(() => ensureSessionDir(root), 'symlink');
    expect(fs.readdirSync(outside)).toEqual([]);
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
});

describe('verifySocket', () => {
  async function liveShort() {
    const root = shortRoot();
    ensureSessionDirs(root);
    await listen(paths.socketPath(root, { env: {} }));
    return root;
  }

  test('true for a real listener in a 0700 .session', async () => {
    const root = await liveShort();
    expect(verifySocket(root, { env: {} })).toBe(true);
  });

  test('true for a real listener in a private fallback directory', async () => {
    const { root, deps } = longRoot();
    ensureSessionDirs(root, deps);
    await listen(paths.socketPath(root, deps));
    expect(verifySocket(root, deps)).toBe(true);
  });

  test('false for a missing socket', () => {
    const root = shortRoot();
    ensureSessionDirs(root);
    expect(verifySocket(root, { env: {} })).toBe(false);
  });

  test('false when there is no workspace at all, and never throws', () => {
    expect(verifySocket(path.join(base, 'nope'), { env: {} })).toBe(false);
  });

  test('false for a regular file at the socket path', () => {
    const root = shortRoot();
    ensureSessionDirs(root);
    fs.writeFileSync(paths.workspaceSocketPath(root), 'not a socket');
    expect(verifySocket(root, { env: {} })).toBe(false);
  });

  test('false for a regular file at the fallback socket path', () => {
    const { root, deps } = longRoot();
    ensureSessionDirs(root, deps);
    fs.writeFileSync(paths.socketPath(root, deps), 'not a socket');
    expect(verifySocket(root, deps)).toBe(false);
  });

  test('false for a mauto.sock that is a symlink to a real listening socket elsewhere', async () => {
    const root = shortRoot();
    ensureSessionDirs(root);
    const elsewhere = path.join(base, 'elsewhere.sock');
    await listen(elsewhere);
    fs.symlinkSync(elsewhere, paths.workspaceSocketPath(root));
    expect(verifySocket(root, { env: {} })).toBe(false);
  });

  test('false for a symlinked .session holding a real listener', async () => {
    const root = shortRoot();
    const outside = path.join(base, 'o');
    fs.mkdirSync(outside, { mode: 0o700 });
    fs.mkdirSync(path.join(root, '.mobile-automator'));
    fs.symlinkSync(outside, paths.sessionDir(root));
    await listen(path.join(outside, paths.SOCKET_NAME));
    expect(verifySocket(root, { env: {} })).toBe(false);
  });

  test('false when .session is 0755, even with a real listener of ours in it', async () => {
    const root = await liveShort();
    fs.chmodSync(paths.sessionDir(root), 0o755);
    expect(verifySocket(root, { env: {} })).toBe(false);
  });

  test('false when the socket is owned by another uid', async () => {
    const root = await liveShort();
    const sock = paths.workspaceSocketPath(root);
    expect(verifySocket(root, { env: {}, fs: foreignLstat((p) => p === sock) })).toBe(false);
  });

  // D-d: the override skips the owner check on workspace directories, so a
  // CI checkout owned by another uid still works, but the socket itself must
  // always be ours.
  test('MAUTO_TRUST_WORKSPACE_OWNER=1 lets a foreign .session pass, never a foreign socket', async () => {
    const root = await liveShort();
    const sock = paths.workspaceSocketPath(root);
    const env = { MAUTO_TRUST_WORKSPACE_OWNER: '1' };
    const foreignDirs = foreignLstat((p) => p !== sock);
    expect(verifySocket(root, { env: {}, fs: foreignDirs })).toBe(false);
    expect(verifySocket(root, { env, fs: foreignDirs })).toBe(true);
    expect(verifySocket(root, { env, fs: foreignLstat(() => true) })).toBe(false);
  });

  test('false for a symlinked fallback directory holding a real listener', async () => {
    const { root, deps, fallbackDir } = longRoot();
    const real = path.join(base, 'r');
    fs.mkdirSync(real, { mode: 0o700 });
    fs.symlinkSync(real, fallbackDir);
    await listen(path.join(real, path.basename(paths.socketPath(root, deps))));
    expect(verifySocket(root, deps)).toBe(false);
  });

  test('false for a foreign-owned fallback directory, override or not', async () => {
    const { root, deps, fallbackDir } = longRoot();
    ensureSessionDirs(root, deps);
    await listen(paths.socketPath(root, deps));
    const fsx = foreignLstat((p) => p === fallbackDir);
    expect(verifySocket(root, { ...deps, fs: fsx })).toBe(false);
    expect(verifySocket(root, { env: { ...deps.env, MAUTO_TRUST_WORKSPACE_OWNER: '1' }, fs: fsx })).toBe(false);
  });

  test('false for a fallback directory other users can enter', async () => {
    const { root, deps, fallbackDir } = longRoot();
    ensureSessionDirs(root, deps);
    await listen(paths.socketPath(root, deps));
    fs.chmodSync(fallbackDir, 0o755);
    expect(verifySocket(root, deps)).toBe(false);
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
