'use strict';

// The per-user telemetry consent record (#348, decision D1).
//
// Why per user: the on-switch used to be `telemetry.enabled: true` in
// .mobile-automator/config.json alone. That file lives in the repository and
// is routinely committed, so one developer's opt-in, once committed, turned
// telemetry on for everyone who cloned the repo, none of whom had consented.
// Consent belongs to a person on a machine, not to a checkout, so it is
// recorded here, in the user's own config directory, outside every repository.
//
// Why keyed by the project's realpath: consent is per project as well as per
// user (opting in for one app must not opt in every workspace on the machine),
// and one project is reachable through several paths (macOS's /tmp is
// /private/tmp; a checkout can sit behind a symlink). The realpath is the one
// name they share, so the record is found however the project is reached.
//
// Why no safe-fs: the file is NOT read through src/workspace/safe-fs.js and
// gets no owner or symlink checks. Those checks defend against a hostile
// repository, and a repository can commit .mobile-automator/ but cannot write
// the developer's ~/.config. Where the file lives comes from XDG_CONFIG_HOME,
// else the user's home directory, and the environment is trusted the same way
// MAUTO_TELEMETRY_HOST is: whoever controls it already controls this process.
// The write still goes through atomicOutputWrite, the one atomic writer for a
// path mauto did not put in the workspace (#347 left no unconfined one): out
// here it walks nothing and only creates its own temp file O_NOFOLLOW.
//
// The format is { "projects": { "<realpath>": true } }. Reading fails closed:
// a missing, unreadable, corrupt or oddly shaped file is "no consent", never a
// guess at what someone meant.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { atomicOutputWrite } = require('../util/atomic');
const { isPlainObject } = require('../util/is-plain-object');
const { realOrResolved } = require('../util/real-or-resolved');

const FILE_NAME = 'telemetry-consent.json';

// $XDG_CONFIG_HOME/mauto/telemetry-consent.json, else
// ~/.config/mauto/telemetry-consent.json. The XDG spec says a relative
// XDG_CONFIG_HOME is invalid and must be ignored, so only an absolute one is
// used.
function consentPath({ env = process.env, homedir = os.homedir } = {}) {
  const xdg = env && env.XDG_CONFIG_HOME;
  const base = typeof xdg === 'string' && path.isAbsolute(xdg) ? xdg : path.join(homedir(), '.config');
  return path.join(base, 'mauto', FILE_NAME);
}

// The parsed record, or null when there is no usable one.
function readRecord(file) {
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (isPlainObject(doc) && isPlainObject(doc.projects)) return doc;
  } catch (_) {
    // missing, unreadable or corrupt: no record
  }
  return null;
}

// True only for an own `true` under this project's key. A truthy "true" or 1
// is a hand edit no `mauto telemetry enable` would write, and a consent flag
// does not get to guess. Never throws.
function hasLocalConsent(projectRoot, { env = process.env, homedir = os.homedir } = {}) {
  try {
    const doc = readRecord(consentPath({ env, homedir }));
    if (!doc) return false;
    // The one key a project is recorded under. A root that cannot be resolved
    // (it was deleted, say) falls back to its absolute path, which simply
    // matches no record written while it existed.
    const key = realOrResolved(projectRoot);
    return Object.prototype.hasOwnProperty.call(doc.projects, key) && doc.projects[key] === true;
  } catch (_) {
    return false;
  }
}

// `true` records consent for this project; anything else withdraws it and
// keeps every other project's record. A withdrawal with no file is a no-op:
// no file is created just to say "no". A corrupt or oddly shaped file is
// replaced: that can lose other projects' records, but never invent one.
//
// The mauto dir is made 0700 (only that dir: the user's config dir is theirs
// to set) before the file is written, so the file is never readable by others
// even in the moment before its own chmod to 0600. Write errors propagate: a
// user who ran `mauto telemetry enable` must hear that it did not stick.
function setLocalConsent(projectRoot, value, { env = process.env, homedir = os.homedir } = {}) {
  const file = consentPath({ env, homedir });
  const grant = value === true;
  if (!grant && !fs.existsSync(file)) return;

  const doc = readRecord(file) || { projects: {} };
  const key = realOrResolved(projectRoot);
  if (grant) doc.projects[key] = true;
  else delete doc.projects[key];

  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  atomicOutputWrite(projectRoot, file, `${JSON.stringify(doc, null, 2)}\n`);
  fs.chmodSync(file, 0o600);
}

module.exports = { consentPath, hasLocalConsent, setLocalConsent };
