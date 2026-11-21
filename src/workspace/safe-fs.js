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
// Requires only envelope and layout, so device and store modules can import it
// without a cycle.

const nodeFs = require('fs');
const path = require('path');

const { fail } = require('../output/envelope');
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
  hardlink: 'A second hard link would make mauto write to a file outside the workspace. Delete it and let mauto recreate it.',
  too_large: 'Workspace files are small; a file this size was not written by mauto. Delete or shrink it.',
};

const FALLBACK_REASON = 'it is not safe to use';
const FALLBACK_HINT = 'Inspect the path and replace it with a real file or directory inside .mobile-automator/.';

// A refusal carries its own envelope fields, like the repo's other typed
// errors: `kind` is always environment (the workspace is wrong, not the verb's
// input), `message` and `hint` are the envelope text verbatim. So any boundary
// that maps `err.kind`/`err.hint` (deviceFail, toEnvelope) reports it correctly
// without knowing this class.
class UnsafePathError extends Error {
  // `file` is always the workspace path that was refused, never where a link
  // points: the target is attacker-chosen and must not reach an envelope.
  constructor(file, reason) {
    super(`Refusing to use workspace path ${file}: ${REASONS[reason] || FALLBACK_REASON} (${reason}).`);
    this.name = 'UnsafePathError';
    this.code = 'EUNSAFEPATH';
    this.kind = 'environment';
    this.hint = HINTS[reason] || FALLBACK_HINT;
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

function checkOwner(p, st, { getuid, env }) {
  if (env.MAUTO_TRUST_WORKSPACE_OWNER === '1') return;
  if (st.uid !== getuid()) throw new UnsafePathError(p, 'foreign_owner');
}

function checkDirComponent(p, st, d) {
  if (st.isSymbolicLink()) throw new UnsafePathError(p, 'symlink');
  if (!st.isDirectory()) throw new UnsafePathError(p, 'not_directory');
  checkOwner(p, st, d);
  if (st.mode & 0o002) throw new UnsafePathError(p, 'world_writable');
}

function isInside(child, parent) {
  return child === parent || child.startsWith(parent + path.sep);
}

// Walk `.mobile-automator` down to `dir`, one lstat per component, creating the
// missing ones when asked. Returns the realpath of `dir`.
function safeDir(projectRoot, dir, { create = false, mode } = {}, deps = {}) {
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
    let st;
    try {
      st = fs.lstatSync(p);
    } catch (err) {
      if (err.code !== 'ENOENT' || !create) throw err;
      try {
        // Non-recursive on purpose: each new level is made under a parent we
        // just checked, then checked itself below.
        fs.mkdirSync(p, { mode });
      } catch (mkErr) {
        if (mkErr.code !== 'EEXIST') throw mkErr;
      }
      st = fs.lstatSync(p);
    }
    checkDirComponent(p, st, d);
  }

  // The lstat walk already proves there is no link below the root; this
  // catches anything it cannot see (a component swapped mid-walk).
  const real = fs.realpathSync(target);
  if (!isInside(real, fs.realpathSync(ws))) throw new UnsafePathError(target, 'escape');
  return real;
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

// The envelope for a refusal: names the path and the reason, never the content
// or a link target (UnsafePathError carries neither).
function unsafePathFailure(err) {
  return { envelope: fail(err.kind, err.message, err.hint), exitKind: err.kind };
}

module.exports = {
  UnsafePathError,
  safeDir,
  openLeaf,
  openWorkspaceFile,
  readWorkspaceFile,
  readWorkspaceFileOrNull,
  readWorkspaceJsonOrNull,
  unsafePathFailure,
};
