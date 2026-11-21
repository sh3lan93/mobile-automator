'use strict';

// Safe I/O inside the workspace (#345). `.mobile-automator/` is checked into
// repos and copied between machines, so its contents are untrusted: a cloned
// repo can ship `memory/` as a symlink to ~/.ssh, a config.json that links to a
// secret, or a dangling `lock` that points a write anywhere the user can reach.
// Plain fs calls follow all of those. Every workspace read and write therefore
// goes through here, and refuses rather than follows:
//
//   - every directory from `.mobile-automator` down must be a real directory
//     (lstat, never stat), owned by us, and not world-writable;
//   - the leaf is opened with O_NOFOLLOW (a symlink leaf fails in the kernel,
//     with no check-then-open race) and O_NONBLOCK (a planted FIFO cannot hang
//     the verb), and must then fstat as a regular file;
//   - a write never goes to a leaf with a second hard link, which would be a
//     file outside the workspace by another name.
//
// Components above and including the project root are never checked: a
// project reached through a symlinked parent (macOS /tmp -> /private/tmp, a
// symlinked checkout) is the user's own choice, and containment compares
// realpaths. `g+w` is accepted because Ubuntu's default umask 002 makes every
// directory group-writable; only `o+w` lets a stranger plant a link. Root in a
// CI container over a checkout owned by another uid can set
// MAUTO_TRUST_WORKSPACE_OWNER=1, which skips the owner comparison and nothing
// else, like git's safe.directory.
//
// The device session's directories are stricter (#346): another user who can
// enter `.session/` or the socket fallback directory can reach the daemon's
// socket, and one who can write there can plant or swap it. safeDir's
// `private` option makes the last component 0700-tight (no group or other
// bit), and privateDir checks a directory outside the workspace (the socket
// fallback) the same way, with an owner check no override can skip.
//
// Requires only layout, so device and store modules can import it without a
// cycle. It knows nothing of envelopes: a refusal carries its own kind and
// hint, and cli.js's toEnvelope maps it like any other typed error.

const nodeFs = require('fs');
const path = require('path');

const { workspaceDir } = require('./layout');

const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const READ_CHUNK = 64 * 1024;

// Plain-English reason text: the envelope message says what is wrong with the
// path, the hint says what to do about it.
const REASONS = {
  symlink: 'it is a symbolic link',
  escape: 'it resolves outside the .mobile-automator/ workspace',
  foreign_owner: 'it is owned by another user',
  not_regular: 'it is not a regular file',
  not_directory: 'it is not a directory',
  world_writable: 'it is writable by every user',
  not_private: 'other users can access it',
  hardlink: 'it has more than one hard link',
  too_large: 'it is larger than the size limit',
};

const HINTS = {
  symlink:
    'mauto never follows links inside .mobile-automator/. Replace the link with a real directory or file inside .mobile-automator/.',
  escape:
    'mauto only reads and writes inside .mobile-automator/. Replace any link on the way with a real directory or file inside .mobile-automator/.',
  foreign_owner:
    'Workspace files must belong to the user running mauto. Fix the ownership (chown), or set MAUTO_TRUST_WORKSPACE_OWNER=1 if you trust this checkout (for example a CI container running as root); it skips only the owner check.',
  not_regular: 'Replace it with a regular file, or delete it and let mauto recreate it.',
  not_directory: 'Replace it with a real directory, or delete it and let mauto recreate it.',
  world_writable: 'Any user could plant files there. Remove the world-write bit, for example: chmod o-w <path>.',
  not_private:
    'Only the user running mauto may use it. Run chmod 700 <path>, or delete it and let mauto recreate it.',
  hardlink: 'A second hard link would make mauto write to a file outside the workspace. Delete it and let mauto recreate it.',
  too_large: 'Workspace files are small; a file this size was not written by mauto. Delete or shrink it.',
};

const FALLBACK_REASON = 'it is not safe to use';
const FALLBACK_HINT = 'Inspect the path and replace it with a real file or directory inside .mobile-automator/.';

// What a refused path is, for the message's subject and the hint. Every
// refusal is about a workspace path except privateDir's: the device session's
// socket directory, outside the workspace (#346). There the workspace hints
// point the wrong way, and the owner override they offer never applies (D-d).
// The reason texts above fit both and are shared; only the hints that differ
// are listed, the four privateDir can raise.
const SOCKET_DIR_RECREATE = 'Remove it, and mauto recreates the directory 0700.';
const SCOPES = {
  workspace: { subject: 'workspace path', hints: HINTS, fallbackHint: FALLBACK_HINT },
  session_socket_dir: {
    subject: 'session socket directory',
    hints: {
      symlink: `mauto never follows a link for the session socket's directory. ${SOCKET_DIR_RECREATE}`,
      not_directory: SOCKET_DIR_RECREATE,
      foreign_owner:
        'Another user owns it, so mauto will not trust a socket there. Remove it (its owner or root may have to), or set XDG_RUNTIME_DIR to a private directory of your own.',
      not_private:
        "Other users could reach the device session's socket through it. Run chmod 700 <path>, or remove it and let mauto recreate it 0700.",
    },
    fallbackHint: SOCKET_DIR_RECREATE,
  },
};

// A refusal carries its own envelope fields, like the repo's other typed
// errors: `kind` is always environment (the workspace is wrong, not the verb's
// input), `message` and `hint` are the envelope text verbatim. So any boundary
// that maps `err.kind`/`err.hint` (deviceFail, toEnvelope) reports it correctly
// without knowing this class.
class UnsafePathError extends Error {
  // `file` is always the path that was refused, never where a link points:
  // the target is attacker-chosen and must not reach an envelope. `scope`
  // (a SCOPES key, default workspace) says what kind of path it is.
  //
  // `owner` ({ uid, myUid }) is passed by the owner check alone, so a
  // foreign_owner refusal names both uids instead of "another user", and the
  // user knows whom to chown to (or that they are running as the wrong user).
  // A uid is a number from lstat, never file content, so it may reach an
  // envelope.
  constructor(file, reason, { owner, scope } = {}) {
    const s = SCOPES[scope] || SCOPES.workspace;
    const text = owner
      ? `it is owned by uid ${owner.uid}; you are uid ${owner.myUid}`
      : REASONS[reason] || FALLBACK_REASON;
    super(`Refusing to use ${s.subject} ${file}: ${text} (${reason}).`);
    this.name = 'UnsafePathError';
    this.code = 'EUNSAFEPATH';
    this.kind = 'environment';
    this.hint = s.hints[reason] || s.fallbackHint;
    this.path = file;
    this.reason = reason;
    if (owner) this.owner = { uid: owner.uid, myUid: owner.myUid };
  }
}

function resolveDeps(deps = {}) {
  return {
    fs: deps.fs || nodeFs,
    getuid: deps.getuid || process.getuid,
    env: deps.env || process.env,
  };
}

// The one owner comparison. `strict` ignores MAUTO_TRUST_WORKSPACE_OWNER: the
// override is for a checkout someone else owns, never for a directory or
// socket only we should be able to use.
function checkOwner(p, st, { getuid, env }, { strict = false, scope } = {}) {
  if (!strict && env.MAUTO_TRUST_WORKSPACE_OWNER === '1') return;
  const myUid = getuid();
  if (st.uid !== myUid) throw new UnsafePathError(p, 'foreign_owner', { owner: { uid: st.uid, myUid }, scope });
}

// The one directory check. By default a workspace directory may be
// group-writable but not world-writable. `private` forbids every group and
// other bit (0700-tight). `strict` is private plus an owner comparison the
// override cannot skip, for directories outside the workspace. `scope` names
// the kind of path in a refusal (see SCOPES).
function checkDirComponent(p, st, d, { strict = false, private: priv = strict, scope } = {}) {
  if (st.isSymbolicLink()) throw new UnsafePathError(p, 'symlink', { scope });
  if (!st.isDirectory()) throw new UnsafePathError(p, 'not_directory', { scope });
  checkOwner(p, st, d, { strict, scope });
  if (priv) {
    if (st.mode & 0o077) throw new UnsafePathError(p, 'not_private', { scope });
  } else if (st.mode & 0o002) {
    throw new UnsafePathError(p, 'world_writable', { scope });
  }
}

// lstat one directory level, making it first when it is missing and `create`
// is set. Non-recursive on purpose: the caller has already checked the parent,
// and checks what this returns. A mkdir race (EEXIST) is fine: whatever won it
// is what gets checked.
function lstatOrMkdir(fs, p, create, mode) {
  try {
    return fs.lstatSync(p);
  } catch (err) {
    if (err.code !== 'ENOENT' || !create) throw err;
  }
  try {
    fs.mkdirSync(p, { mode });
  } catch (mkErr) {
    if (mkErr.code !== 'EEXIST') throw mkErr;
  }
  return fs.lstatSync(p);
}

function isInside(child, parent) {
  return child === parent || child.startsWith(parent + path.sep);
}

// Walk `.mobile-automator` down to `dir`, one lstat per component, creating the
// missing ones when asked. Returns the realpath of `dir`. With `private`, `dir`
// itself must also be 0700-tight; the owner override still applies, because
// `dir` is inside a workspace someone may have checked out as another uid.
function safeDir(projectRoot, dir, { create = false, mode, private: priv = false } = {}, deps = {}) {
  const d = resolveDeps(deps);
  const { fs } = d;
  const ws = path.resolve(workspaceDir(projectRoot));
  const target = path.resolve(dir);
  if (!isInside(target, ws)) throw new UnsafePathError(target, 'escape');

  const rel = path.relative(ws, target);
  const parts = rel ? rel.split(path.sep) : [];
  let p = ws;
  for (let i = 0; i <= parts.length; i++) {
    if (i > 0) p = path.join(p, parts[i - 1]);
    checkDirComponent(p, lstatOrMkdir(fs, p, create, mode), d, { private: priv && i === parts.length });
  }

  // The lstat walk already proves there is no link below the root; this
  // catches anything it cannot see (a component swapped mid-walk).
  const real = fs.realpathSync(target);
  if (!isInside(real, fs.realpathSync(ws))) throw new UnsafePathError(target, 'escape');
  return real;
}

// A directory OUTSIDE the workspace that only we may use: the device session's
// long-path socket fallback (session-paths.js privateSocketDir). It must be a
// real directory, owned by us whatever MAUTO_TRUST_WORKSPACE_OWNER says, with
// no group or other bit. Made 0700 when missing and `create` is set (only
// this level; its parent, the temp dir or the XDG runtime dir, must exist).
// Never chmodded: we only ever create it 0700, so a looser mode means someone
// changed it, and that is refused rather than repaired. A refusal names the
// session socket directory, with hints for it, never a workspace path.
// Returns nothing.
function privateDir(dir, { create = false } = {}, deps = {}) {
  const d = resolveDeps(deps);
  checkDirComponent(dir, lstatOrMkdir(d.fs, dir, create, 0o700), d, {
    strict: true,
    scope: 'session_socket_dir',
  });
}

const OPEN_SYMLINK_CODES = new Set([
  'ELOOP', // Linux and macOS: O_NOFOLLOW on a symlink
  'EMLINK', // FreeBSD's spelling of the same refusal
]);
const OPEN_NOT_REGULAR_CODES = new Set([
  'ENXIO', // a FIFO with no reader opened O_WRONLY|O_NONBLOCK, or a socket on Linux
  'EOPNOTSUPP', // a socket on macOS
  'EISDIR', // a directory opened for writing
]);

// The one O_NOFOLLOW leaf open. No owner or workspace checks (it has no
// workspace context); callers that have one layer them on top. The caller
// closes the returned fd.
function openLeaf(file, flags, mode = 0o666, deps = {}) {
  const { fs } = resolveDeps(deps);
  const { O_NOFOLLOW, O_NONBLOCK } = nodeFs.constants;
  let fd;
  try {
    fd = fs.openSync(file, flags | O_NOFOLLOW | O_NONBLOCK, mode);
  } catch (err) {
    if (OPEN_SYMLINK_CODES.has(err.code)) throw new UnsafePathError(file, 'symlink');
    if (OPEN_NOT_REGULAR_CODES.has(err.code)) throw new UnsafePathError(file, 'not_regular');
    throw err;
  }
  let stat;
  try {
    stat = fs.fstatSync(fd);
  } catch (err) {
    closeQuietly(fs, fd);
    throw err;
  }
  if (!stat.isFile()) {
    closeQuietly(fs, fd);
    throw new UnsafePathError(file, 'not_regular');
  }
  return { fd, stat };
}

function closeQuietly(fs, fd) {
  try {
    fs.closeSync(fd);
  } catch (_) {
    // already closed or invalid: nothing to release
  }
}

// Open a workspace file: a checked directory walk, then the leaf. Returns an
// fd the caller closes. O_CREAT also creates the missing directories.
function openWorkspaceFile(projectRoot, file, flags, mode = 0o666, deps = {}) {
  const d = resolveDeps(deps);
  const { O_CREAT, O_WRONLY, O_RDWR, O_TRUNC } = nodeFs.constants;
  const resolved = path.resolve(file);
  const writes = Boolean(flags & (O_WRONLY | O_RDWR));
  safeDir(projectRoot, path.dirname(resolved), { create: Boolean(flags & O_CREAT) }, deps);
  // O_TRUNC acts inside open(), before the owner and hard-link checks could
  // refuse: a hard link to a file outside would already be emptied. Open
  // without it and truncate only once every check has passed.
  const { fd, stat } = openLeaf(resolved, flags & ~O_TRUNC, mode, deps);
  try {
    checkOwner(resolved, stat, d);
    if (writes && stat.nlink !== 1) throw new UnsafePathError(resolved, 'hardlink');
    if (writes && flags & O_TRUNC) d.fs.ftruncateSync(fd, 0);
  } catch (err) {
    closeQuietly(d.fs, fd);
    throw err;
  }
  return fd;
}

// THE way to create a new workspace file (a temp file, a lock, a sidecar).
// Exclusive: O_WRONLY|O_CREAT|O_EXCL, plus the O_NOFOLLOW|O_NONBLOCK every
// leaf open adds, so it never opens anything already there, a planted link
// included. Missing parent directories are created by the same checked walk
// as openWorkspaceFile, because this is openWorkspaceFile. An existing leaf
// fails with its fs code (EEXIST) intact, which the lock's retry relies on.
// `mode` is subject to the umask. Returns an fd the caller closes.
function createWorkspaceFile(projectRoot, file, { mode = 0o666 } = {}, deps = {}) {
  const { O_WRONLY, O_CREAT, O_EXCL } = nodeFs.constants;
  return openWorkspaceFile(projectRoot, file, O_WRONLY | O_CREAT | O_EXCL, mode, deps);
}

// THE way to delete a workspace file. The parent is walked first (no create):
// unlinking through a symlinked parent would delete a file outside the
// workspace, so that throws UnsafePathError instead. unlink(2) removes a
// symlink leaf itself, never its target, so the leaf needs no check. Returns
// true when it removed the file, false when the file or a parent directory
// does not exist. Any other fs error propagates.
function removeWorkspaceFile(projectRoot, file, deps = {}) {
  const { fs } = resolveDeps(deps);
  const resolved = path.resolve(file);
  try {
    safeDir(projectRoot, path.dirname(resolved), {}, deps);
    fs.unlinkSync(resolved);
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
  return true;
}

// Read a workspace file as utf8. null when it (or a parent dir) does not exist.
// Reads at most maxBytes + 1 so a planted huge file costs nothing.
function readWorkspaceFile(projectRoot, file, { maxBytes = DEFAULT_MAX_BYTES } = {}, deps = {}) {
  const { fs } = resolveDeps(deps);
  let fd;
  try {
    fd = openWorkspaceFile(projectRoot, file, nodeFs.constants.O_RDONLY, 0o666, deps);
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw err;
  }
  try {
    const chunks = [];
    let total = 0;
    const limit = maxBytes + 1;
    while (total < limit) {
      const buf = Buffer.alloc(Math.min(READ_CHUNK, limit - total));
      const n = fs.readSync(fd, buf, 0, buf.length, null);
      if (n === 0) break;
      chunks.push(n === buf.length ? buf : buf.subarray(0, n));
      total += n;
    }
    if (total > maxBytes) throw new UnsafePathError(path.resolve(file), 'too_large');
    return Buffer.concat(chunks, total).toString('utf8');
  } finally {
    closeQuietly(fs, fd);
  }
}

// The lenient readers, for state files where absent or garbled is a normal
// state and a refused path never is. Absent, unreadable (EIO, EACCES, ...) or,
// for the JSON reader, unparseable all read as null, so a verb treats it as "no
// selection / no session". An UnsafePathError always propagates: a planted
// link is never quietly read as "nothing there", it fails the verb environment.
function readWorkspaceFileOrNull(projectRoot, file, opts = {}, deps = {}) {
  try {
    return readWorkspaceFile(projectRoot, file, opts, deps);
  } catch (err) {
    if (err instanceof UnsafePathError) throw err;
    return null;
  }
}

function readWorkspaceJsonOrNull(projectRoot, file, opts = {}, deps = {}) {
  const raw = readWorkspaceFileOrNull(projectRoot, file, opts, deps);
  if (raw == null) return null;
  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

module.exports = {
  UnsafePathError,
  // Exported for the later security-hardening gate slices (#346/#347), which
  // walk directories they then list or create into.
  safeDir,
  privateDir,
  // For a check layered on a leaf safe-fs cannot open (a Unix socket, which
  // open(2) refuses): the same deps defaults and the same owner comparison,
  // never a second copy (session-dir.js verifySocket).
  resolveDeps,
  checkOwner,
  openLeaf,
  openWorkspaceFile,
  createWorkspaceFile,
  removeWorkspaceFile,
  readWorkspaceFile,
  readWorkspaceFileOrNull,
  readWorkspaceJsonOrNull,
};
