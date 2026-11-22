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
// The rest of a checkout is just as untrusted, and mauto writes there too
// (#347): the host files `mauto init` installs (.claude/skills/...,
// .mcp.json). So the same rules come in two scopes, one directory walk and one
// leaf open between them:
//
//   - 'workspace' (safeDir, the *WorkspaceFile helpers, safeWorkspaceDest):
//     the path must resolve inside .mobile-automator/;
//   - 'path' (readProjectFile, createProjectFile): it must resolve inside the
//     project root.
//
// Both check every directory below the project root down to the file's own;
// the scope (its row of CONFINED_SCOPES) sets the containment bound, and its
// SCOPES entry words the refusal. These two names are the only scope names:
// a target's `scope` and a refusal's `err.scope` use them alike.
//
// A path the user chose (--out, --junit, a screenshot destination) is sorted
// by userPath, on the path inProject re-roots, into one of those two or a
// third, 'outside':
//
//   - 'workspace': inside .mobile-automator/, the workspace rules;
//   - 'path': inside the project root but outside the workspace
//     (`reports/r.xml`, where a cloned repo can commit `reports` as a link to
//     anywhere), the same rules as mauto's own host files there (#362).
//     userFile (result export --out, run --junit, crash get --out) and
//     userDest (mauto screenshot <path>) apply them;
//   - 'outside': anywhere else (an explicit /tmp/x.png), the user's own call.
//
// userDir stays two-way (workspace, or the user's call): its one caller is
// MAUTO_LOG_DIR, which the environment chooses, not the checkout.
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

const { TypedRefusal } = require('../output/typed-refusal');
const { workspaceDir } = require('./layout');

const DEFAULT_MAX_BYTES = 16 * 1024 * 1024;
const READ_CHUNK = 64 * 1024;

// Plain-English reason text: the envelope message says what is wrong with the
// path, the hint (from the policy, below) says what to do about it.
// The owner check always states its own foreign_owner text, naming both uids
// (see checkOwner); the one here is for a refusal built without that detail.
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
  hardlink: 'A second hard link would make mauto write to a file outside the workspace. Delete it and let mauto recreate it.',
  too_large: 'Workspace files are small; a file this size was not written by mauto. Delete or shrink it.',
};

const FALLBACK_REASON = 'it is not safe to use';
const FALLBACK_HINT = 'Inspect the path and replace it with a real file or directory inside .mobile-automator/.';

// A directory policy: everything one directory check needs, and everything a
// refusal under it says, so no check or message reads a field the policy might
// not have. Built only by dirPolicy, which requires every field below:
//   - subject: what a refusal calls the path ("workspace path").
//   - hints: reason -> what to do about it; fallbackHint for any other reason.
//   - trustOverride: whether MAUTO_TRUST_WORKSPACE_OWNER=1 may skip the owner
//     comparison. Right for a checkout someone may own as another uid, wrong
//     for anything only we should be able to use.
//   - forbiddenBits, modeReason: the mode bits that refuse it, and the reason.
// Two optional fields: `reasons`, reason-text overrides laid over REASONS (the
// path scope words an escape differently), and `scope`, the SCOPES name a
// refusal under the policy reports as err.scope (null for a caller's own).
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
  policy.reasons = Object.freeze({ ...REASONS, ...fields.reasons });
  policy.scope = fields.scope === undefined ? null : fields.scope;
  return Object.freeze(policy);
}

// Any directory in .mobile-automator/, and the wording of every refusal that
// is not a directory's (a leaf, an escape): `g+w` is accepted (Ubuntu's umask
// 002), `o+w` is not, and the owner override applies.
const WORKSPACE_DIR = dirPolicy({
  scope: 'workspace',
  subject: 'workspace path',
  hints: HINTS,
  fallbackHint: FALLBACK_HINT,
  trustOverride: true,
  forbiddenBits: 0o002,
  modeReason: 'world_writable',
});

// A path outside the workspace (a host file `mauto init` writes, a file the
// user named with --out): the workspace's rules, worded for the project. Only
// the texts that would name the workspace differ; every other reason falls
// back to the workspace ones, so both scopes read the same there.
const PROJECT_PATH = dirPolicy({
  ...WORKSPACE_DIR,
  scope: 'path',
  subject: 'path',
  reasons: { escape: 'it resolves outside the project directory' },
  hints: {
    ...HINTS,
    symlink: 'mauto never writes through a symbolic link. Replace the link with a real directory or file, then re-run.',
    escape:
      'mauto only writes inside the project directory. Replace any link on the way with a real directory inside the project.',
    foreign_owner:
      'Files mauto writes must belong to the user running mauto. Fix the ownership (chown), or set MAUTO_TRUST_WORKSPACE_OWNER=1 if you trust this checkout (for example a CI container running as root); it skips only the owner check.',
    hardlink:
      'A second hard link would make mauto write to another file by a different name. Delete it and let mauto recreate it.',
    too_large: 'A file this size was not written by mauto. Delete or shrink it.',
  },
  fallbackHint: 'Inspect the path and replace it with a real file or directory inside the project.',
});

// The one wording table: a scope name -> its policy. An unknown scope reads as
// the workspace one. A caller's own policy (src/device/session-dir.js) is
// handed to the check as `policy` and never listed here.
const SCOPES = { workspace: WORKSPACE_DIR, path: PROJECT_PATH };

// A refusal carries its own envelope fields, like the repo's other typed
// errors: `kind` is always environment (the checkout is wrong, not the verb's
// input), `message` and `hint` are the envelope text verbatim. So any boundary
// that maps `err.kind`/`err.hint` (deviceFail, toEnvelope) reports it correctly
// without knowing this class.
//
// The wording comes from a policy: `policy` when the check ran under a
// caller's own, else SCOPES[scope] ('workspace', the default, for a path under
// .mobile-automator/; 'path' for any other path mauto writes). `kind`, `code`
// and `reason` are the same whatever the wording. A scoped entry point
// re-words what the checks throw once, through withScope.
class UnsafePathError extends TypedRefusal {
  // `file` is always the path that was refused, never where a link points:
  // the target is attacker-chosen and must not reach an envelope. `detail` is
  // the reason text when the check states its own (the owner check names both
  // uids), else the policy's text for `reason`. It must never be file content.
  constructor(file, reason, { scope = 'workspace', policy = SCOPES[scope] || WORKSPACE_DIR, detail } = {}) {
    super(
      'environment',
      `Refusing to use ${policy.subject} ${file}: ${detail || policy.reasons[reason] || FALLBACK_REASON} (${reason}).`,
      policy.hints[reason] || policy.fallbackHint
    );
    this.code = 'EUNSAFEPATH';
    this.path = file;
    this.reason = reason;
    this.scope = policy.scope;
    this.detail = detail;
  }

  // The same refusal (path, reason, detail, code, kind) worded for `scope`.
  inScope(scope) {
    return new UnsafePathError(this.path, this.reason, { scope, detail: this.detail });
  }
}

// Run `fn`, re-wording any refusal it throws for `scope`. The one place a
// scope is applied: the checks stay scope-free, and each scoped entry point
// wraps its whole body once.
function withScope(scope, fn) {
  try {
    return fn();
  } catch (err) {
    if (err instanceof UnsafePathError) throw err.inScope(scope);
    throw err;
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

// The leaf rules shared by every leaf mauto opens or hands to a writer: it is
// ours and, when it will be written, has exactly one hard link (a second one
// would be a file elsewhere by another name). The leaf is owned under the same
// rule as the workspace directory it sits in.
function checkLeafOwnership(p, st, writes, d) {
  checkOwner(p, st, d, WORKSPACE_DIR);
  if (writes && st.nlink !== 1) throw new UnsafePathError(p, 'hardlink');
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

// The two scopes a path can be confined to, one row each, keyed by the SCOPES
// name that words their refusals: the bound the directory walk stays within,
// and whether a destination another process writes (the engine's screenshot)
// gets its missing directories made. Every confined open, check-only walk and
// destination check below is one function over this table, so the workspace
// and the project differ only here.
//   - workspace: bounded by .mobile-automator/; a destination's directories
//     are made, like every workspace write.
//   - path: bounded by the project root (#347, #362); a destination's
//     directories are not made, as none are for a path the user chose outside
//     the workspace, so a missing one is reported by the writer as before.
const CONFINED_SCOPES = Object.freeze({
  workspace: Object.freeze({ within: (root) => workspaceDir(root), destCreates: true }),
  path: Object.freeze({ within: (root) => root, destCreates: false }),
});

// The directory walk of `dir` under a confined scope's bound (see walkDirs).
// Its refusals are not re-worded here: an entry point wraps them in withScope.
function walkScope(projectRoot, scope, dir, opts, deps) {
  return walkDirs(projectRoot, CONFINED_SCOPES[scope].within(projectRoot), dir, opts, resolveDeps(deps));
}

// A confined open: the walk of the file's directory (creating the missing
// ones under O_CREAT), then the checked leaf. Returns an fd the caller closes.
function openInScope(projectRoot, scope, file, flags, mode, deps) {
  const resolved = path.resolve(file);
  walkScope(projectRoot, scope, path.dirname(resolved), { create: Boolean(flags & nodeFs.constants.O_CREAT) }, deps);
  return openOwnedLeaf(resolved, flags, { mode }, deps);
}

// A confined destination another process writes: the walk of its directory
// (created or check-only, per the scope's row), then checkDestLeaf. Returns
// `resolved`.
function destInScope(projectRoot, scope, resolved, deps) {
  const dirOpts = CONFINED_SCOPES[scope].destCreates ? { create: true } : { missingOk: true };
  walkScope(projectRoot, scope, path.dirname(resolved), dirOpts, deps);
  return checkDestLeaf(resolved, resolveDeps(deps));
}

// Lexical containment of two resolved paths. The filesystem root is the one
// parent that already ends in a separator; appending another would make it
// `//`, inside which nothing lies.
function isInside(child, parent) {
  const prefix = parent.endsWith(path.sep) ? parent : parent + path.sep;
  return child === parent || child.startsWith(prefix);
}

// The one directory walk. `dir` must lie lexically inside `within` (else
// escape); then every component strictly below the project root, down to and
// including `dir`, is lstat-checked, the missing ones created one level at a
// time when asked. The project root and its ancestors are never checked (see
// the header). Last, realpath(dir) must lie inside realpath(within). Returns
// the realpath of `dir`.
//
// `missingOk` (without `create`) is the check-only walk for a directory a
// later write will create: a missing component is nothing to refuse (nothing
// below it exists, so nothing below it can be a link), so the walk stops there,
// the components above it checked, the deepest existing one realpath-checked
// when it lies within the bound, and returns null. Without it a missing
// component throws ENOENT, as it always has.
//
// Every component above `dir` is checked as a WORKSPACE_DIR; `dir` itself
// under `policy` (default WORKSPACE_DIR), so a caller can hold its own
// directory to a stricter rule (session-dir.js's .session/).
function walkDirs(projectRoot, within, dir, { create = false, mode, missingOk = false, policy = WORKSPACE_DIR } = {}, d) {
  const { fs } = d;
  const root = path.resolve(projectRoot);
  const bound = path.resolve(within);
  const target = path.resolve(dir);
  if (!isInside(target, bound)) throw new UnsafePathError(target, 'escape');

  const rel = path.relative(root, target);
  const parts = rel ? rel.split(path.sep) : [];
  let p = root;
  for (let i = 0; i < parts.length; i++) {
    p = path.join(p, parts[i]);
    let st;
    try {
      st = lstatOrMkdir(fs, p, create, mode);
    } catch (err) {
      if (err.code === 'ENOENT' && !create && missingOk) return checkDeepestExisting(path.dirname(p), bound, fs);
      throw err;
    }
    checkDirComponent(p, st, d, i === parts.length - 1 ? policy : WORKSPACE_DIR);
  }

  // The lstat walk already proves there is no link below the root; this
  // catches anything it cannot see (a component swapped mid-walk).
  const real = fs.realpathSync(target);
  if (!isInside(real, fs.realpathSync(bound))) throw new UnsafePathError(target, 'escape');
  return real;
}

// The end of a missingOk walk that stopped at a missing component: `existing`
// is the deepest directory there. Above the bound (the bound itself is
// missing) there is nothing of the bound's to compare; within it, its realpath
// must stay within the bound's, as a full walk's would.
function checkDeepestExisting(existing, bound, fs) {
  if (isInside(existing, bound) && !isInside(fs.realpathSync(existing), fs.realpathSync(bound))) {
    throw new UnsafePathError(existing, 'escape');
  }
  return null;
}

// A workspace directory: `.mobile-automator` down to `dir`, one lstat per
// component, creating the missing ones when asked. Returns the realpath of
// `dir`; with `missingOk`, null when it does not exist yet (see walkDirs).
// `dir` itself is checked under `policy` (default WORKSPACE_DIR), every
// component above it as a WORKSPACE_DIR.
function safeDir(projectRoot, dir, { create = false, mode, missingOk = false, policy = WORKSPACE_DIR } = {}, deps = {}) {
  return walkScope(projectRoot, 'workspace', dir, { create, mode, missingOk, policy }, deps);
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

// The one O_NOFOLLOW leaf open. No owner, hard-link or directory checks (it
// has no project context); openOwnedLeaf layers the leaf ones on top and the
// directory walk the rest. The caller closes the returned fd.
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

// The checked leaf open, for a leaf whose directory the caller has already
// walked: openLeaf, then the leaf must be ours and, for an open that writes,
// have exactly one hard link. Returns an fd the caller closes; on a refusal
// the fd is closed first.
//
// `singleLink` applies the one-hard-link rule to a read too. A reader that
// uploads and then deletes what it read (the telemetry spool, #348) must not
// read a file elsewhere by another name: its contents would ship as ours.
function openOwnedLeaf(file, flags, { mode = 0o666, singleLink = false } = {}, deps = {}) {
  const d = resolveDeps(deps);
  const { O_WRONLY, O_RDWR, O_TRUNC } = nodeFs.constants;
  const resolved = path.resolve(file);
  const writes = Boolean(flags & (O_WRONLY | O_RDWR));
  // O_TRUNC acts inside open(), before the owner and hard-link checks could
  // refuse: a hard link to a file outside would already be emptied. Open
  // without it and truncate only once every check has passed.
  const { fd, stat } = openLeaf(resolved, flags & ~O_TRUNC, mode, deps);
  try {
    checkLeafOwnership(resolved, stat, writes || singleLink, d);
    if (writes && flags & O_TRUNC) d.fs.ftruncateSync(fd, 0);
  } catch (err) {
    closeQuietly(d.fs, fd);
    throw err;
  }
  return fd;
}

// Open a workspace file: a checked directory walk, then the checked leaf.
// Returns an fd the caller closes. O_CREAT also creates the missing
// directories.
function openWorkspaceFile(projectRoot, file, flags, mode = 0o666, deps = {}) {
  return openInScope(projectRoot, 'workspace', file, flags, mode, deps);
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

// The one capped read: `open()` returns the checked fd. null when the file (or
// a parent dir) does not exist. Reads at most maxBytes + 1 so a planted huge
// file costs nothing.
function readCapped(open, file, maxBytes, deps) {
  const { fs } = resolveDeps(deps);
  let fd;
  try {
    fd = open();
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

// The capped utf8 read of a leaf whose directory the caller has settled
// itself (userDir): openOwnedLeaf read-only, null when it does not exist,
// too_large past maxBytes. `singleLink` as for openOwnedLeaf.
function readOwnedLeaf(file, { maxBytes = DEFAULT_MAX_BYTES, singleLink = false } = {}, deps = {}) {
  return readCapped(() => openOwnedLeaf(file, nodeFs.constants.O_RDONLY, { singleLink }, deps), file, maxBytes, deps);
}

// Read a workspace file as utf8. null when it (or a parent dir) does not exist.
function readWorkspaceFile(projectRoot, file, { maxBytes = DEFAULT_MAX_BYTES } = {}, deps = {}) {
  const open = () => openWorkspaceFile(projectRoot, file, nodeFs.constants.O_RDONLY, 0o666, deps);
  return readCapped(open, file, maxBytes, deps);
}

// A workspace destination another process writes: the engine saves a
// screenshot to a path, so mauto never holds the fd. The directory is walked
// and created like any workspace write; then the leaf is lstat'd (it is never
// opened): absent is fine, anything there must be a regular file of ours with
// one link. The writer's open comes after this check, but every directory on
// the way is ours and not world-writable, so only a process already running
// as the user could swap the leaf in between. Returns the resolved path.
function safeWorkspaceDest(projectRoot, file, deps = {}) {
  return destInScope(projectRoot, 'workspace', path.resolve(file), deps);
}

// The leaf of a destination another process writes, lstat'd, never opened:
// absent is fine, anything there must be a regular file of ours with one
// link. The leaf half of destInScope, for every confined scope. Returns
// `resolved`.
function checkDestLeaf(resolved, d) {
  let st;
  try {
    st = d.fs.lstatSync(resolved);
  } catch (err) {
    if (err.code === 'ENOENT') return resolved;
    throw err;
  }
  if (st.isSymbolicLink()) throw new UnsafePathError(resolved, 'symlink');
  if (!st.isFile()) throw new UnsafePathError(resolved, 'not_regular');
  checkLeafOwnership(resolved, st, true, d);
  return resolved;
}

// Where `file` lands in the project: its absolute path under
// path.resolve(projectRoot), or null when it names a place outside it.
//
// Lexical first. A path not lexically in the project may still reach the
// project root through a symlinked ancestor (macOS /tmp -> /private/tmp; the
// logical path zsh's `pwd` shows while process.cwd() is physical), so its
// ancestors are realpath'd, and the first one that is the project root
// re-roots the rest of the path under it. Top-down, shallowest first, on
// purpose: a workspace directory planted as a link back to the root realpaths
// to the root too, and matching it would carry the path out of the workspace,
// past the very link the walk must refuse. Ancestors that do not resolve are
// skipped. Lookups only (realpath); never throws for an ordinary path.
function inProject(projectRoot, file, deps = {}) {
  const { fs } = resolveDeps(deps);
  const root = path.resolve(projectRoot);
  const resolved = path.resolve(file);
  if (isInside(resolved, root)) return resolved;

  let realRoot;
  try {
    realRoot = fs.realpathSync(root);
  } catch (_) {
    return null;
  }
  const ancestors = [];
  for (let a = path.dirname(resolved); ; a = path.dirname(a)) {
    ancestors.unshift(a);
    if (path.dirname(a) === a) break;
  }
  for (const a of ancestors) {
    let real;
    try {
      real = fs.realpathSync(a);
    } catch (_) {
      continue;
    }
    if (real !== realRoot) continue;
    return path.join(root, path.relative(a, resolved));
  }
  return null;
}

// Where `file` lands in the workspace: its inProject path when userPath puts
// it in the workspace scope, else null. userPath holds the one membership
// rule; this only reads it.
function inWorkspace(projectRoot, file, deps = {}) {
  const { path: p, scope } = userPath(projectRoot, file, deps);
  return scope === 'workspace' ? p : null;
}

// A project file outside the workspace (a host file `mauto init` writes:
// .claude/skills/..., .mcp.json): the same walk, bounded by the project root
// instead of the workspace, then the checked leaf. A refusal from either is
// worded for the 'path' scope (by its callers, which wrap it in withScope).
function openProjectFile(projectRoot, file, flags, mode, deps) {
  return openInScope(projectRoot, 'path', file, flags, mode, deps);
}

// readWorkspaceFile's project-rooted twin: utf8, null when the file or a
// parent dir does not exist, capped at maxBytes. A symlink leaf, dangling or
// not, is refused, never read as absent.
function readProjectFile(projectRoot, file, { maxBytes = DEFAULT_MAX_BYTES } = {}, deps = {}) {
  const open = () => openProjectFile(projectRoot, file, nodeFs.constants.O_RDONLY, 0o666, deps);
  return withScope('path', () => readCapped(open, file, maxBytes, deps));
}

// createWorkspaceFile's project-rooted twin: exclusive (O_WRONLY|O_CREAT|
// O_EXCL), missing directories below the project root created by the checked
// walk, an existing leaf failing EEXIST intact. Returns an fd the caller
// closes.
function createProjectFile(projectRoot, file, { mode = 0o666 } = {}, deps = {}) {
  const { O_WRONLY, O_CREAT, O_EXCL } = nodeFs.constants;
  return withScope('path', () => openProjectFile(projectRoot, file, O_WRONLY | O_CREAT | O_EXCL, mode, deps));
}

// Paths the user chose (--out, --junit, a screenshot destination, a
// MAUTO_LOG_DIR): `{ path, scope }`, scope 'workspace', 'path' (in the project,
// outside the workspace) or 'outside' (see the header). A scope is named as
// SCOPES names its wording, so a target's `scope` is its refusal's
// `err.scope`. In the
// workspace and the project `path` is the one inProject re-roots (through an
// aliased root it differs from the one given, and every check and write must
// use the checked one); outside it is the given path resolved. The entry
// points below make the choice, so no caller tests a scope's bound, swaps
// paths or swaps in its own open; a caller may read `scope` only for a policy
// of its own on top (crash get --out's roots apply outside the workspace).
function userPath(projectRoot, file, deps) {
  const p = inProject(projectRoot, file, deps);
  if (!p) return { path: path.resolve(file), scope: 'outside' };
  return { path: p, scope: isInside(p, path.resolve(workspaceDir(projectRoot))) ? 'workspace' : 'path' };
}

// A directory the user chose: the checked walk when it lands in the
// workspace, else a plain recursive mkdir when `create` (two-way on purpose:
// see the header). Returns the path to use (re-rooted inside the workspace,
// as given anywhere else), not its realpath.
function userDir(projectRoot, dir, { create = false } = {}, deps = {}) {
  const target = userPath(projectRoot, dir, deps);
  if (target.scope === 'workspace') {
    safeDir(projectRoot, target.path, { create }, deps);
    return target.path;
  }
  const given = path.resolve(dir);
  if (create) resolveDeps(deps).fs.mkdirSync(given, { recursive: true });
  return given;
}

// A file another process writes at a path the user chose (the engine's
// screenshot). In the workspace or the project, destInScope under its row of
// CONFINED_SCOPES (#362: in the project the walk creates nothing, then the
// same leaf check), a refusal worded for the scope. Outside, the resolved
// path byte-for-byte. Returns the path to hand over.
function userDest(projectRoot, file, deps = {}) {
  const { path: dest, scope } = userPath(projectRoot, file, deps);
  if (scope === 'outside') return dest;
  return withScope(scope, () => destInScope(projectRoot, scope, dest, deps));
}

// A file mauto writes itself at a path the user chose: userPath's `path`,
// and `scope`, plus
//   - `open(file, flags, mode)` for it or a sibling in the same directory (a
//     temp file). In the workspace or the project (#362), openInScope under
//     its row of CONFINED_SCOPES, a refusal worded for the scope: every
//     directory walked (created under O_CREAT, never through a link), then
//     the checked leaf. Outside, O_CREAT makes the directory with a plain
//     recursive mkdir and the leaf is still opened O_NOFOLLOW, ours and with
//     one link, a refusal worded in the 'path' scope. Returns an fd the
//     caller closes.
//   - `preflight()`: the same directory walk, check-only, creating nothing,
//     for a caller that refuses a bad path before it does other work (run
//     --junit, crash get --out). A missing directory is nothing to refuse. A
//     no-op outside the project.
function userFile(projectRoot, file, deps = {}) {
  const target = userPath(projectRoot, file, deps);
  const { scope } = target;
  if (scope !== 'outside') {
    const dir = path.dirname(target.path);
    return {
      ...target,
      open: (f, flags, mode = 0o666) => withScope(scope, () => openInScope(projectRoot, scope, f, flags, mode, deps)),
      preflight: () => {
        withScope(scope, () => walkScope(projectRoot, scope, dir, { missingOk: true }, deps));
      },
    };
  }
  return {
    ...target,
    open: (f, flags, mode = 0o666) => {
      if (flags & nodeFs.constants.O_CREAT) {
        resolveDeps(deps).fs.mkdirSync(path.dirname(path.resolve(f)), { recursive: true });
      }
      return openUserLeaf(f, flags, mode, deps);
    },
    preflight: () => {},
  };
}

// The leaf open for a path the user chose outside the workspace, whose
// directory the caller has settled itself: openOwnedLeaf (O_NOFOLLOW, ours,
// one link for a write, the truncate deferred), a refusal worded in the 'path'
// scope. Creates no directory. Returns an fd the caller closes.
function openUserLeaf(file, flags, mode = 0o666, deps = {}) {
  return withScope('path', () => openOwnedLeaf(file, flags, { mode }, deps));
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
  // session, session-dir.js): build a policy, then check one directory or a
  // workspace walk under it.
  dirPolicy,
  WORKSPACE_DIR,
  checkDir,
  safeDir,
  openLeaf,
  // The checked leaf open, for a caller that walked the directory itself.
  openOwnedLeaf,
  // Its capped read, for a reader that settled the directory itself (the spool).
  readOwnedLeaf,
  openWorkspaceFile,
  createWorkspaceFile,
  removeWorkspaceFile,
  readWorkspaceFile,
  readWorkspaceFileOrNull,
  readWorkspaceJsonOrNull,
  // A workspace file another process writes (the engine's screenshot).
  safeWorkspaceDest,
  // Where a path lands in the project (re-rooted through an aliased root), or
  // null: the one re-root, which userPath builds on.
  inProject,
  // Where a path the user chose lands in the workspace, read off userPath.
  // Exported for its unit tests only: callers use userDir / userDest /
  // userFile, which apply the scope themselves.
  inWorkspace,
  // Paths the user chose: each entry point classifies the path (userPath,
  // private) and applies its scope's rules.
  userDir,
  userDest,
  userFile,
  openUserLeaf,
  // The one containment test (`child` is `parent` or below it), for a caller
  // that bounds a path the user chose by roots of its own (crash get --out).
  isInside,
  // The path scope: project files outside the workspace.
  readProjectFile,
  createProjectFile,
};
