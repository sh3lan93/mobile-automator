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
// Every directory check runs under a policy (dirPolicy, below): the owner rule,
// the forbidden mode bits, and what a refusal says. WORKSPACE_DIR is the
// default, for any directory in `.mobile-automator/`. A caller with stricter
// needs (the device session, src/device/session-dir.js) defines its own policy
// and hands it to safeDir or checkDir; this module holds no caller's policy.
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
// path, the hint (from the policy, below) says what to do about it.
// foreign_owner has no text here: the owner check always states its own,
// naming both uids (see checkOwner).
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
  hardlink: 'A second hard link would make mauto write to a file outside the workspace. Delete it and let mauto recreate it.',
  too_large: 'Workspace files are small; a file this size was not written by mauto. Delete or shrink it.',
};

const FALLBACK_REASON = 'it is not safe to use';
const FALLBACK_HINT = 'Inspect the path and replace it with a real file or directory inside .mobile-automator/.';

// A directory policy: everything one directory check needs, and everything a
// refusal under it says, so no check or message reads a field the policy might
// not have. Built only by dirPolicy, which requires every field:
//   - subject: what a refusal calls the path ("workspace path").
//   - hints: reason -> what to do about it; fallbackHint for any other reason.
//   - trustOverride: whether MAUTO_TRUST_WORKSPACE_OWNER=1 may skip the owner
//     comparison. Right for a checkout someone may own as another uid, wrong
//     for anything only we should be able to use.
//   - forbiddenBits, modeReason: the mode bits that refuse it, and the reason.
const POLICY_FIELDS = ['subject', 'hints', 'fallbackHint', 'trustOverride', 'forbiddenBits', 'modeReason'];

function dirPolicy(fields) {
  const policy = {};
  for (const key of POLICY_FIELDS) {
    if (fields[key] === undefined) throw new TypeError(`dirPolicy: missing ${key}`);
    policy[key] = fields[key];
  }
  if (typeof policy.trustOverride !== 'boolean') throw new TypeError('dirPolicy: trustOverride must be a boolean');
  if (!REASONS[policy.modeReason]) throw new TypeError(`dirPolicy: unknown modeReason ${policy.modeReason}`);
  policy.hints = Object.freeze({ ...policy.hints });
  return Object.freeze(policy);
}

// Any directory in .mobile-automator/, and the wording of every refusal that
// is not a directory's (a leaf, an escape): `g+w` is accepted (Ubuntu's umask
// 002), `o+w` is not, and the owner override applies.
const WORKSPACE_DIR = dirPolicy({
  subject: 'workspace path',
  hints: HINTS,
  fallbackHint: FALLBACK_HINT,
  trustOverride: true,
  forbiddenBits: 0o002,
  modeReason: 'world_writable',
});

// A refusal carries its own envelope fields, like the repo's other typed
// errors: `kind` is always environment (the workspace is wrong, not the verb's
// input), `message` and `hint` are the envelope text verbatim. So any boundary
// that maps `err.kind`/`err.hint` (deviceFail, toEnvelope) reports it correctly
// without knowing this class.
class UnsafePathError extends Error {
  // `file` is always the path that was refused, never where a link points:
  // the target is attacker-chosen and must not reach an envelope. `policy`
  // (default WORKSPACE_DIR) supplies the subject and the hint. `detail` is the
  // reason text, REASONS[reason] unless the caller states its own (the owner
  // check names both uids). It must never be file content.
  constructor(file, reason, { policy = WORKSPACE_DIR, detail = REASONS[reason] || FALLBACK_REASON } = {}) {
    super(`Refusing to use ${policy.subject} ${file}: ${detail} (${reason}).`);
    this.name = 'UnsafePathError';
    this.code = 'EUNSAFEPATH';
    this.kind = 'environment';
    this.hint = policy.hints[reason] || policy.fallbackHint;
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

// The one owner comparison. `trustOverride` is the policy's (or the leaf
// rule's): whether MAUTO_TRUST_WORKSPACE_OWNER=1 may skip it.
function ownedByUs(st, { getuid, env }, trustOverride) {
  if (trustOverride && env.MAUTO_TRUST_WORKSPACE_OWNER === '1') return true;
  return st.uid === getuid();
}

// A foreign owner is named by uid, both of them, so the user knows whom to
// chown to (or that they are running as the wrong user) (D-c). A uid is a
// number from lstat, never file content, so it may reach an envelope.
function checkOwner(p, st, d, policy) {
  if (ownedByUs(st, d, policy.trustOverride)) return;
  throw new UnsafePathError(p, 'foreign_owner', {
    policy,
    detail: `it is owned by uid ${st.uid}; you are uid ${d.getuid()}`,
  });
}

// The one directory check: a real directory, owned under the policy's rule,
// with none of its forbidden mode bits.
function checkDirComponent(p, st, d, policy) {
  if (st.isSymbolicLink()) throw new UnsafePathError(p, 'symlink', { policy });
  if (!st.isDirectory()) throw new UnsafePathError(p, 'not_directory', { policy });
  checkOwner(p, st, d, policy);
  if (st.mode & policy.forbiddenBits) throw new UnsafePathError(p, policy.modeReason, { policy });
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

// Check ONE directory under a caller-supplied policy, making it first (`mode`,
// subject to the umask) when it is missing and `create` is set. Only this
// level is made: its parent must exist. Never chmodded, so a mode the policy
// forbids is refused rather than repaired. No workspace context: for a
// directory inside the workspace, use safeDir, which also walks the
// components above it. Throws UnsafePathError, or the fs error (ENOENT for a
// missing directory without `create`). Returns nothing.
function checkDir(dir, policy, { create = false, mode } = {}, deps = {}) {
  const d = resolveDeps(deps);
  checkDirComponent(dir, lstatOrMkdir(d.fs, dir, create, mode), d, policy);
}

// Walk `.mobile-automator` down to `dir`, one lstat per component, creating the
// missing ones when asked. Returns the realpath of `dir`. Every component above
// `dir` is checked as a WORKSPACE_DIR; `dir` itself under `policy` (default
// WORKSPACE_DIR), so a caller can hold its own directory to a stricter rule.
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

// The leaf kinds isOwnLeaf can check for.
const LEAF_TYPES = Object.freeze({
  socket: (st) => st.isSocket(),
  file: (st) => st.isFile(),
});

// Is `file` a real `type` (not a link to one) owned by us, under `trustOverride`
// (whether MAUTO_TRUST_WORKSPACE_OWNER=1 may skip the owner comparison)? For a
// leaf that cannot be opened to check (open(2) refuses a socket), so this is an
// lstat. A predicate, not a refusal: false when it is anything else, or when
// nothing is there; any other fs error propagates. Its directory is the
// caller's to check first.
function isOwnLeaf(file, { type, trustOverride }, deps = {}) {
  const isType = LEAF_TYPES[type];
  if (!isType) throw new TypeError(`isOwnLeaf: unknown type ${type}`);
  if (typeof trustOverride !== 'boolean') throw new TypeError('isOwnLeaf: trustOverride must be a boolean');
  const d = resolveDeps(deps);
  let st;
  try {
    st = d.fs.lstatSync(file);
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err;
  }
  // lstat describes a link itself, never its target, so a link is never of
  // `type`: the type check is the link check.
  return isType(st) && ownedByUs(st, d, trustOverride);
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
  // The generic primitives for a caller with its own policy (the device
  // session, session-dir.js): build a policy, check
  // one directory or a workspace walk under it, check a leaf that cannot be
  // opened.
  dirPolicy,
  WORKSPACE_DIR,
  checkDir,
  safeDir,
  isOwnLeaf,
  openLeaf,
  openWorkspaceFile,
  createWorkspaceFile,
  removeWorkspaceFile,
  readWorkspaceFile,
  readWorkspaceFileOrNull,
  readWorkspaceJsonOrNull,
};
