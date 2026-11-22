'use strict';

// Where `mauto crash get --out` may write (#347). The report is a path the
// caller chose in an untrusted checkout. Inside .mobile-automator/ (through a
// symlinked alias of the root too) safe-fs's userFile gives it the workspace
// rules. Anywhere else it must land in one of the roots the device engine
// allows for the files it writes itself (mobile-mcp's getAllowedRoots), so a
// crash report goes no further than a screenshot could.
//
// Its own module rather than safe-fs: safe-fs is the generic "never through a
// link" layer, shared by every reader and writer; this is one verb's policy on
// top of it (the engine's roots, the home-directory rule, macOS /tmp), with
// host facts (temp dir, platform, home) injectable for tests. It knows nothing
// of envelopes: a refusal carries its own kind and hint, and toEnvelope maps
// it like any other typed error.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { TypedRefusal } = require('../output/typed-refusal');
const { isInside, openUserLeaf, safeDir, userFile } = require('./safe-fs');
// realpath or null, not realOrResolved: a root with no realpath is skipped,
// since it cannot contain a directory that exists.
const { realpathOrNull } = require('../util/real-or-resolved');

// A path the user chose that the rule refuses: their input is wrong, not the
// checkout, so invalid_input (exit 3), with a hint naming the allowed roots.
class OutputPathRefusal extends TypedRefusal {
  constructor(message, hint) {
    super('invalid_input', message, hint);
  }
}

// The roots, listed as given (for the hint) and compared as realpaths, as the
// engine compares them. The project, unless it is the home directory or above
// it (the engine's isTooBroadToAllow: it would make nearly every file the user
// owns writable, and with no workspace found the project is just the cwd); the
// OS temp directory; and on macOS /tmp too, because os.tmpdir() is
// /var/folders/.../T there and the docs teach `--out /tmp/crash.txt`. A home
// that does not exist protects nothing, so the project stays a root.
//
// `host` holds the host facts (tmpdir(), platform, darwinTmp, homedir()), each
// defaulting to the real one here, read at call time. The crash handler
// passes it through untouched; only tests fill it.
function crashOutRoots(
  projectRoot,
  { tmpdir = os.tmpdir, platform = process.platform, darwinTmp = '/tmp', homedir = os.homedir } = {}
) {
  const home = realpathOrNull(homedir());
  const project = realpathOrNull(projectRoot);
  const projectTooBroad = Boolean(home && project && isInside(home, project));
  const roots = projectTooBroad ? [] : [projectRoot];
  roots.push(tmpdir());
  if (platform === 'darwin') roots.push(darwinTmp);
  return { roots, projectTooBroad };
}

// Where the report for `out` (absolute) goes, `{ path, confined, open }`,
// checked before the device is asked so a bad --out costs no device work, and
// creating nothing: a failed device call leaves no trace.
//
// Inside the workspace its directory is walked check-only, so a planted
// directory link is refused (UnsafePathError) before the device call; a
// directory that does not exist yet is nothing to refuse. The write's open
// (userFile's openWorkspaceFile under O_CREAT) is the one place that creates
// the missing directories, walking again, and checks the leaf, so a link at
// the report itself is refused there, before anything is written.
//
// Outside the workspace its directory must already exist and realpath inside
// one of the roots. Throws OutputPathRefusal when it does not; a directory
// that does not exist (or cannot be realpath'd) throws its own fs error, which
// the caller reports as the write failure it always was. Its open creates no
// directory (the realpath just proved it exists): openUserLeaf, the checked
// leaf alone.
function crashOutTarget(projectRoot, out, host = {}) {
  const target = userFile(projectRoot, out);
  if (target.confined) {
    safeDir(projectRoot, path.dirname(target.path), { missingOk: true });
    return target;
  }

  const { roots, projectTooBroad } = crashOutRoots(projectRoot, host);
  const dir = fs.realpathSync(path.dirname(target.path));
  const holdsDir = (root) => {
    const real = realpathOrNull(root);
    return real !== null && isInside(dir, real);
  };
  if (roots.some(holdsDir)) return { ...target, open: openUserLeaf };
  throw new OutputPathRefusal(
    `--out resolves outside the directories a crash report may be written to: ${target.path}`,
    projectTooBroad
      ? `Pass an --out path inside a temp directory: ${roots.join(', ')}. The project directory is not allowed: it is the home directory or contains it.`
      : `Pass an --out path inside the project or a temp directory: ${roots.join(', ')}.`
  );
}

// The whole report into the target, through its checked open: O_NOFOLLOW (a
// link leaf, dangling or not, is refused), a regular file of ours with one
// hard link, and the truncate only once those checks passed.
function writeCrashReport(target, report) {
  const { O_WRONLY, O_CREAT, O_TRUNC } = fs.constants;
  const fd = target.open(target.path, O_WRONLY | O_CREAT | O_TRUNC);
  try {
    fs.writeFileSync(fd, report);
  } finally {
    fs.closeSync(fd);
  }
}

module.exports = { OutputPathRefusal, crashOutRoots, crashOutTarget, writeCrashReport };
