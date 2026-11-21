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
//   - workspace (safeDir, the *WorkspaceFile helpers, safeWorkspaceDest): the
//     path must resolve inside .mobile-automator/;
//   - path (readProjectFile, createProjectFile): it must resolve inside the
//     project root.
//
// Both check every directory below the project root down to the file's own;
// the scope sets the containment bound and words the refusal. A path the user
// chose (--out, a screenshot to /tmp) is confined only when it lands in the
// workspace, and inWorkspace says whether it does: anywhere else it is the
// user's own call.
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

// The 'path' scope's overrides, for a path outside the workspace (a host file
// `mauto init` writes, a file the user named with --out). Only the texts that
// would name the workspace differ; every other reason falls back to the tables
// above, so both scopes read the same there.
const PATH_REASONS = {
  escape: 'it resolves outside the project directory',
};

const PATH_HINTS = {
  symlink: 'mauto never writes through a symbolic link. Replace the link with a real directory or file, then re-run.',
  escape:
    'mauto only writes inside the project directory. Replace any link on the way with a real directory inside the project.',
  foreign_owner:
    'Files mauto writes must belong to the user running mauto. Fix the ownership (chown), or set MAUTO_TRUST_WORKSPACE_OWNER=1 if you trust this checkout (for example a CI container running as root); it skips only the owner check.',
  hardlink:
    'A second hard link would make mauto write to another file by a different name. Delete it and let mauto recreate it.',
  too_large: 'A file this size was not written by mauto. Delete or shrink it.',
};

const PATH_FALLBACK_HINT = 'Inspect the path and replace it with a real file or directory inside the project.';

// The wording of a refusal, per scope: what the refused thing is called, the
// reason and hint texts, and the hint for a reason with none of its own. An
// unknown scope reads as the workspace one.
const SCOPES = {
  workspace: { subject: 'workspace path', reasons: REASONS, hints: HINTS, fallbackHint: FALLBACK_HINT },
  path: {
    subject: 'path',
    reasons: { ...REASONS, ...PATH_REASONS },
    hints: { ...HINTS, ...PATH_HINTS },
    fallbackHint: PATH_FALLBACK_HINT,
  },
};

// A refusal carries its own envelope fields, like the repo's other typed
// errors: `kind` is always environment (the checkout is wrong, not the verb's
// input), `message` and `hint` are the envelope text verbatim. So any boundary
// that maps `err.kind`/`err.hint` (deviceFail, toEnvelope) reports it correctly
// without knowing this class.
//
// `scope` says which rules refused it: 'workspace' (the default) for a path
// under .mobile-automator/, 'path' for any other path mauto writes. It picks
// the wording only (SCOPES); `kind`, `code` and `reason` are the same in both.
class UnsafePathError extends Error {
  // `file` is always the path that was refused, never where a link points: the
  // target is attacker-chosen and must not reach an envelope.
  constructor(file, reason, { scope = 'workspace' } = {}) {
    const s = SCOPES[scope] || SCOPES.workspace;
    const text = s.reasons[reason] || FALLBACK_REASON;
    super(`Refusing to use ${s.subject} ${file}: ${text} (${reason}).`);
    this.name = 'UnsafePathError';
    this.code = 'EUNSAFEPATH';
    this.kind = 'environment';
    this.hint = s.hints[reason] || s.fallbackHint;
    this.path = file;
    this.reason = reason;
    this.scope = scope;
  }
}

function resolveDeps(deps = {}) {
  return {
    fs: deps.fs || nodeFs,
    getuid: deps.getuid || process.getuid,
    env: deps.env || process.env,
  };
}

function checkOwner(p, st, { getuid, env }, scope = 'workspace') {
  if (env.MAUTO_TRUST_WORKSPACE_OWNER === '1') return;
  if (st.uid !== getuid()) throw new UnsafePathError(p, 'foreign_owner', { scope });
}

function checkDirComponent(p, st, d, scope = 'workspace') {
  if (st.isSymbolicLink()) throw new UnsafePathError(p, 'symlink', { scope });
  if (!st.isDirectory()) throw new UnsafePathError(p, 'not_directory', { scope });
  checkOwner(p, st, d, scope);
  if (st.mode & 0o002) throw new UnsafePathError(p, 'world_writable', { scope });
}

// The leaf rules shared by every leaf mauto opens or hands to a writer: it is
// ours and, when it will be written, has exactly one hard link (a second one
// would be a file elsewhere by another name).
function checkLeafOwnership(p, st, writes, d, scope) {
  checkOwner(p, st, d, scope);
  if (writes && st.nlink !== 1) throw new UnsafePathError(p, 'hardlink', { scope });
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
function walkDirs(projectRoot, within, dir, { create = false, mode, scope = 'workspace' } = {}, d) {
  const { fs } = d;
  const root = path.resolve(projectRoot);
  const bound = path.resolve(within);
  const target = path.resolve(dir);
  if (!isInside(target, bound)) throw new UnsafePathError(target, 'escape', { scope });

  const rel = path.relative(root, target);
  let p = root;
  for (const part of rel ? rel.split(path.sep) : []) {
    p = path.join(p, part);
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
    checkDirComponent(p, st, d, scope);
  }

  // The lstat walk already proves there is no link below the root; this
  // catches anything it cannot see (a component swapped mid-walk).
  const real = fs.realpathSync(target);
  if (!isInside(real, fs.realpathSync(bound))) throw new UnsafePathError(target, 'escape', { scope });
  return real;
}

// A workspace directory: `.mobile-automator` down to `dir`, one lstat per
// component, creating the missing ones when asked. Returns the realpath of
// `dir`.
function safeDir(projectRoot, dir, { create = false, mode } = {}, deps = {}) {
  return walkDirs(projectRoot, workspaceDir(projectRoot), dir, { create, mode }, resolveDeps(deps));
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
// directory walk the rest. `scope` only words a refusal. The caller closes the
// returned fd.
function openLeaf(file, flags, mode = 0o666, deps = {}, scope = 'workspace') {
  const { fs } = resolveDeps(deps);
  const { O_NOFOLLOW, O_NONBLOCK } = nodeFs.constants;
  let fd;
  try {
    fd = fs.openSync(file, flags | O_NOFOLLOW | O_NONBLOCK, mode);
  } catch (err) {
    if (OPEN_SYMLINK_CODES.has(err.code)) throw new UnsafePathError(file, 'symlink', { scope });
    if (OPEN_NOT_REGULAR_CODES.has(err.code)) throw new UnsafePathError(file, 'not_regular', { scope });
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
    throw new UnsafePathError(file, 'not_regular', { scope });
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
function openOwnedLeaf(file, flags, { mode = 0o666, scope = 'workspace' } = {}, deps = {}) {
  const d = resolveDeps(deps);
  const { O_WRONLY, O_RDWR, O_TRUNC } = nodeFs.constants;
  const resolved = path.resolve(file);
  const writes = Boolean(flags & (O_WRONLY | O_RDWR));
  // O_TRUNC acts inside open(), before the owner and hard-link checks could
  // refuse: a hard link to a file outside would already be emptied. Open
  // without it and truncate only once every check has passed.
  const { fd, stat } = openLeaf(resolved, flags & ~O_TRUNC, mode, deps, scope);
  try {
    checkLeafOwnership(resolved, stat, writes, d, scope);
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
  const resolved = path.resolve(file);
  safeDir(projectRoot, path.dirname(resolved), { create: Boolean(flags & nodeFs.constants.O_CREAT) }, deps);
  return openOwnedLeaf(resolved, flags, { mode }, deps);
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
function readCapped(open, file, maxBytes, scope, deps) {
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
    if (total > maxBytes) throw new UnsafePathError(path.resolve(file), 'too_large', { scope });
    return Buffer.concat(chunks, total).toString('utf8');
  } finally {
    closeQuietly(fs, fd);
  }
}

// Read a workspace file as utf8. null when it (or a parent dir) does not exist.
function readWorkspaceFile(projectRoot, file, { maxBytes = DEFAULT_MAX_BYTES } = {}, deps = {}) {
  const open = () => openWorkspaceFile(projectRoot, file, nodeFs.constants.O_RDONLY, 0o666, deps);
  return readCapped(open, file, maxBytes, 'workspace', deps);
}

// A workspace destination another process writes: the engine saves a
// screenshot to a path, so mauto never holds the fd. The directory is walked
// and created like any workspace write; then the leaf is lstat'd (it is never
// opened): absent is fine, anything there must be a regular file of ours with
// one link. The writer's open comes after this check, but every directory on
// the way is ours and not world-writable, so only a process already running
// as the user could swap the leaf in between. Returns the resolved path.
function safeWorkspaceDest(projectRoot, file, deps = {}) {
  const d = resolveDeps(deps);
  const resolved = path.resolve(file);
  safeDir(projectRoot, path.dirname(resolved), { create: true }, deps);
  let st;
  try {
    st = d.fs.lstatSync(resolved);
  } catch (err) {
    if (err.code === 'ENOENT') return resolved;
    throw err;
  }
  if (st.isSymbolicLink()) throw new UnsafePathError(resolved, 'symlink');
  if (!st.isFile()) throw new UnsafePathError(resolved, 'not_regular');
  checkLeafOwnership(resolved, st, true, d, 'workspace');
  return resolved;
}

// Where `file` lands in the workspace: its absolute path under
// workspaceDir(projectRoot), or null when it names a place outside it. For a
// path the user chose (--out, a screenshot destination), which gets the
// workspace rules inside the workspace and is the user's own call anywhere
// else.
//
// Lexical first. A path neither lexically in the workspace nor in the project
// may still reach the project root through a symlinked ancestor (macOS /tmp ->
// /private/tmp; the logical path zsh's `pwd` shows while process.cwd() is
// physical), so its ancestors are realpath'd, and the first one that is the
// project root re-roots the rest of the path under it. Top-down, shallowest
// first, on purpose: a workspace directory planted as a link back to the root
// realpaths to the root too, and matching it would carry the path out of the
// workspace, past the very link the walk must refuse. Ancestors that do not
// resolve are skipped. Lookups only (realpath); never throws for an ordinary
// path.
function inWorkspace(projectRoot, file, deps = {}) {
  const { fs } = resolveDeps(deps);
  const root = path.resolve(projectRoot);
  const ws = path.resolve(workspaceDir(projectRoot));
  const resolved = path.resolve(file);
  if (isInside(resolved, ws)) return resolved;
  if (isInside(resolved, root)) return null;

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
    const rerooted = path.join(root, path.relative(a, resolved));
    return isInside(rerooted, ws) ? rerooted : null;
  }
  return null;
}

// A project file outside the workspace (a host file `mauto init` writes:
// .claude/skills/..., .mcp.json): the same walk, bounded by the project root
// instead of the workspace, then the checked leaf, both in the 'path' scope.
function openProjectFile(projectRoot, file, flags, mode, deps) {
  const resolved = path.resolve(file);
  const create = Boolean(flags & nodeFs.constants.O_CREAT);
  walkDirs(projectRoot, projectRoot, path.dirname(resolved), { create, scope: 'path' }, resolveDeps(deps));
  return openOwnedLeaf(resolved, flags, { mode, scope: 'path' }, deps);
}

// readWorkspaceFile's project-rooted twin: utf8, null when the file or a
// parent dir does not exist, capped at maxBytes. A symlink leaf, dangling or
// not, is refused, never read as absent.
function readProjectFile(projectRoot, file, { maxBytes = DEFAULT_MAX_BYTES } = {}, deps = {}) {
  const open = () => openProjectFile(projectRoot, file, nodeFs.constants.O_RDONLY, 0o666, deps);
  return readCapped(open, file, maxBytes, 'path', deps);
}

// createWorkspaceFile's project-rooted twin: exclusive (O_WRONLY|O_CREAT|
// O_EXCL), missing directories below the project root created by the checked
// walk, an existing leaf failing EEXIST intact. Returns an fd the caller
// closes.
function createProjectFile(projectRoot, file, { mode = 0o666 } = {}, deps = {}) {
  const { O_WRONLY, O_CREAT, O_EXCL } = nodeFs.constants;
  return openProjectFile(projectRoot, file, O_WRONLY | O_CREAT | O_EXCL, mode, deps);
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
  // Exported for the later #345 slices (#346/#347), which walk directories
  // they then list or create into.
  safeDir,
  openLeaf,
  // The checked leaf open, for a caller that walked the directory itself.
  openOwnedLeaf,
  openWorkspaceFile,
  createWorkspaceFile,
  removeWorkspaceFile,
  readWorkspaceFile,
  readWorkspaceFileOrNull,
  readWorkspaceJsonOrNull,
  // A workspace file another process writes (the engine's screenshot).
  safeWorkspaceDest,
  // Whether a path the user chose lands in the workspace.
  inWorkspace,
  // The one containment test (`child` is `parent` or below it), for a caller
  // that bounds a path the user chose by roots of its own (crash get --out).
  isInside,
  // The path scope: project files outside the workspace.
  readProjectFile,
  createProjectFile,
};
