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
// socket, and one who can write there can plant or swap it. Every directory
// check therefore runs under one of three named policies (WORKSPACE_DIR,
// PRIVATE_WORKSPACE_DIR, PRIVATE_DIR, below), and isOwnSocket checks the
// socket itself with an owner comparison no override can skip.
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
// path, the hint says what to do about it. foreign_owner has no text here:
// the owner check always names both uids instead (see UnsafePathError).
const REASONS = {
  symlink: 'it is a symbolic link',
  escape: 'it resolves outside the .mobile-automator/ workspace',
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

// What a refused path is, for the message's subject and hint. Every refusal is
// about a workspace path except one of the device session's (#346): its socket
// directory outside the workspace (PRIVATE_DIR). There the workspace hints
// point the wrong way, and the owner override they offer never applies (D-d),
// so it has hints of its own; only the ones it can raise are listed. The daemon
// prints a refusal's hint under its message in daemon.log.
const WORKSPACE_PATH = Object.freeze({
  subject: 'workspace path',
  hints: HINTS,
  fallbackHint: FALLBACK_HINT,
});
const SOCKET_DIR_RECREATE = 'Remove it, and mauto recreates the directory 0700.';
const SESSION_SOCKET_DIR = Object.freeze({
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
});

// The three directory policies (#346). Every directory check is exactly one of
// them, so no meaningless combination can be asked for:
//   - trustOverride: whether MAUTO_TRUST_WORKSPACE_OWNER=1 may skip the owner
//     comparison. Only inside a workspace, which someone may have checked out
//     as another uid; never for a directory outside it.
//   - forbiddenBits: the mode bits that refuse it, as modeReason.
//   - wording: what a refusal calls it (see above).
// WORKSPACE_DIR is any directory in .mobile-automator/: `g+w` is accepted
// (Ubuntu's umask 002), `o+w` is not. PRIVATE_WORKSPACE_DIR is `.session/`:
// 0700-tight, the override still applying. PRIVATE_DIR is the socket fallback
// outside the workspace: 0700-tight, always ours.
const WORKSPACE_DIR = Object.freeze({
  trustOverride: true,
  forbiddenBits: 0o002,
  modeReason: 'world_writable',
  wording: WORKSPACE_PATH,
});
const PRIVATE_WORKSPACE_DIR = Object.freeze({
  trustOverride: true,
  forbiddenBits: 0o077,
  modeReason: 'not_private',
  wording: WORKSPACE_PATH,
});
const PRIVATE_DIR = Object.freeze({
  trustOverride: false,
  forbiddenBits: 0o077,
  modeReason: 'not_private',
  wording: SESSION_SOCKET_DIR,
});
// The socket leaf's owner rule: never the override (D-d).
const SOCKET = Object.freeze({ trustOverride: false });

// A refusal carries its own envelope fields, like the repo's other typed
// errors: `kind` is always environment (the workspace is wrong, not the verb's
// input), `message` and `hint` are the envelope text verbatim. So any boundary
// that maps `err.kind`/`err.hint` (deviceFail, toEnvelope) reports it correctly
// without knowing this class.
class UnsafePathError extends Error {
  // `file` is always the path that was refused, never where a link points:
  // the target is attacker-chosen and must not reach an envelope. `wording`
  // (default WORKSPACE_PATH) says what kind of path it is.
  //
  // `ownerUid` and `myUid` are passed by the owner check alone, so a
  // foreign_owner message names both uids instead of "another user", and the
  // user knows whom to chown to (or that they are running as the wrong user)
  // (D-c). A uid is a number from lstat, never file content, so it may reach
  // an envelope. They are message text only, not fields.
  constructor(file, reason, { ownerUid, myUid, wording = WORKSPACE_PATH } = {}) {
    const text =
      ownerUid !== undefined
        ? `it is owned by uid ${ownerUid}; you are uid ${myUid}`
        : REASONS[reason] || FALLBACK_REASON;
    super(`Refusing to use ${wording.subject} ${file}: ${text} (${reason}).`);
    this.name = 'UnsafePathError';
    this.code = 'EUNSAFEPATH';
    this.kind = 'environment';
    this.hint = wording.hints[reason] || wording.fallbackHint;
    this.path = file;
    this.reason = reason;
  }
}

function resolveDeps(deps = {}) {
  return {
    fs: deps.fs || nodeFs,
    getuid: deps.getuid || process.getuid,
    env: deps.env || process.env,
  };
}

// The one owner comparison, under a policy's trustOverride (see the policies
// above): the override is for a checkout someone else owns, never for a
// directory or socket only we should be able to use.
function ownedByUs(st, { getuid, env }, policy) {
  if (policy.trustOverride && env.MAUTO_TRUST_WORKSPACE_OWNER === '1') return true;
  return st.uid === getuid();
}

function checkOwner(p, st, d, policy) {
  if (ownedByUs(st, d, policy)) return;
  throw new UnsafePathError(p, 'foreign_owner', { ownerUid: st.uid, myUid: d.getuid(), wording: policy.wording });
}

// The one directory check: a real directory, owned under the policy's rule,
// with none of its forbidden mode bits.
function checkDirComponent(p, st, d, policy) {
  const { wording } = policy;
  if (st.isSymbolicLink()) throw new UnsafePathError(p, 'symlink', { wording });
  if (!st.isDirectory()) throw new UnsafePathError(p, 'not_directory', { wording });
  checkOwner(p, st, d, policy);
  if (st.mode & policy.forbiddenBits) throw new UnsafePathError(p, policy.modeReason, { wording });
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
// missing ones when asked. Returns the realpath of `dir`. Every component above
// `dir` is checked as a WORKSPACE_DIR; `dir` itself under `policy` (default
// WORKSPACE_DIR; PRIVATE_WORKSPACE_DIR for `.session/`).
function safeDir(projectRoot, dir, { create = false, mode, policy = WORKSPACE_DIR } = {}, deps = {}) {
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
    checkDirComponent(p, lstatOrMkdir(fs, p, create, mode), d, i === parts.length ? policy : WORKSPACE_DIR);
  }

  // The lstat walk already proves there is no link below the root; this
  // catches anything it cannot see (a component swapped mid-walk).
  const real = fs.realpathSync(target);
  if (!isInside(real, fs.realpathSync(ws))) throw new UnsafePathError(target, 'escape');
  return real;
}

// A directory OUTSIDE the workspace that only we may use: the device session's
// long-path socket fallback (session-paths.js privateSocketDir), checked as a
// PRIVATE_DIR: a real directory, owned by us whatever
// MAUTO_TRUST_WORKSPACE_OWNER says, with no group or other bit. Made 0700 when missing and `create` is set (only
// this level; its parent, the temp dir or the XDG runtime dir, must exist).
// Never chmodded: we only ever create it 0700, so a looser mode means someone
// changed it, and that is refused rather than repaired. A refusal names the
// session socket directory, with hints for it, never a workspace path.
// Returns nothing.
function privateDir(dir, { create = false } = {}, deps = {}) {
  const d = resolveDeps(deps);
  checkDirComponent(dir, lstatOrMkdir(d.fs, dir, create, 0o700), d, PRIVATE_DIR);
}

// A workspace directory that must be 0700 (the device session's .session/):
// walked and made 0700 when missing, then chmodded 0700, which tightens one an
// older mauto made 0755. chmod follows links, so a component swapped for a
// link between the walk and the chmod sends the chmod to the link's target
// (one only someone who can write the workspace could plant). The second walk,
// private this time, then refuses the swap, so this only returns once the
// directory is proven link-free and 0700, never on the strength of a chmod
// that went elsewhere or changed nothing. The owner override applies as in any
// workspace walk. Returns the realpath.
function privateWorkspaceDir(projectRoot, dir, deps = {}) {
  const { fs } = resolveDeps(deps);
  safeDir(projectRoot, dir, { create: true, mode: 0o700 }, deps);
  fs.chmodSync(dir, 0o700);
  return safeDir(projectRoot, dir, { policy: PRIVATE_WORKSPACE_DIR }, deps);
}

// May the client connect to the device session's socket? open(2) cannot open a
// socket, so this is the one leaf check that is an lstat: true only for a
// real socket, not a link, owned by us whatever MAUTO_TRUST_WORKSPACE_OWNER
// says (D-d). A predicate, not a refusal: the client never reports a bad
// socket, it just starts its own daemon. Its directory is the caller's to
// check first. False when nothing is there; any other fs error propagates.
function isOwnSocket(file, deps = {}) {
  const d = resolveDeps(deps);
  let st;
  try {
    st = d.fs.lstatSync(file);
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
  return !st.isSymbolicLink() && st.isSocket() && ownedByUs(st, d, SOCKET);
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
    // The leaf is owned under the same rule as the workspace directory it sits in.
    checkOwner(resolved, stat, d, WORKSPACE_DIR);
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
  // safeDir's policy for `.session/` (session-dir.js verifySocket).
  PRIVATE_WORKSPACE_DIR,
  // The device session's own checks (session-dir.js).
  privateDir,
  privateWorkspaceDir,
  isOwnSocket,
  openLeaf,
  openWorkspaceFile,
  createWorkspaceFile,
  removeWorkspaceFile,
  readWorkspaceFile,
  readWorkspaceFileOrNull,
  readWorkspaceJsonOrNull,
};
