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
// The rule for the file: it lives outside every project, so both sides use
// safe-fs's user-leaf rule (the one #359 set for paths outside any project),
// not the workspace walk. The read is readOwnedLeaf, under its default leaf
// rule, STRICT_LEAF (no checkout, so no owner override), and the write is
// atomicUserLeafWrite, whose temp file opens through openUserLeaf: either way
// the leaf is opened O_NOFOLLOW, must be a regular file owned by this user,
// and a write never lands in a file with a second hard link (the rename
// replaces whatever sits at the path, a planted link included, and never
// writes through it). The read is capped too. No project root is involved, so
// the rules do not change with where XDG_CONFIG_HOME happens to point. Where
// the file lives comes from XDG_CONFIG_HOME, else the user's home directory,
// and the environment is trusted the same way MAUTO_TELEMETRY_HOST is:
// whoever controls it already controls this process.
//
// The format is { "projects": { "<realpath>": true } }. Reading fails closed:
// a missing, unreadable, corrupt or oddly shaped file is "no consent", never a
// guess at what someone meant. A refused leaf (a link, another owner's file,
// not a regular file) or one past CONSENT_MAX_BYTES is "no consent" too.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { atomicUserLeafWrite } = require('../util/atomic');
const { isPlainObject } = require('../util/is-plain-object');
const { realOrResolved } = require('../util/real-or-resolved');
const { readOwnedLeaf } = require('../workspace/safe-fs');

const FILE_NAME = 'telemetry-consent.json';

// The most the reader takes in. The record is a map of project paths to
// `true`, ~100 bytes a project, so 64 KiB is hundreds of projects; anything
// larger was not written by mauto, and refusing it must cost nothing.
const CONSENT_MAX_BYTES = 64 * 1024;

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
function readRecord(file, deps) {
  try {
    // A per-user file outside every checkout: readOwnedLeaf's strict default
    // (STRICT_LEAF) is the rule, so MAUTO_TRUST_WORKSPACE_OWNER=1 never
    // applies (#363). No policy is passed on purpose.
    const doc = JSON.parse(readOwnedLeaf(file, { maxBytes: CONSENT_MAX_BYTES }, deps));
    if (isPlainObject(doc) && isPlainObject(doc.projects)) return doc;
  } catch (_) {
    // missing (readOwnedLeaf's null parses to null), refused, too large,
    // unreadable or corrupt: no record
  }
  return null;
}

// True only for an own `true` under this project's key. A truthy "true" or 1
// is a hand edit no `mauto telemetry enable` would write, and a consent flag
// does not get to guess. Never throws.
//
// `getuid` and `fs` are injectable for the leaf rule's tests, as in safe-fs.
function hasLocalConsent(projectRoot, { env = process.env, homedir = os.homedir, getuid, fs: fsDep } = {}) {
  try {
    const doc = readRecord(consentPath({ env, homedir }), { env, getuid, fs: fsDep });
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
// to set), and the file is created 0600 by the atomic write itself (the temp
// file's creation mode, which umask can only narrow), so it is never readable
// by others, at no moment. Write errors propagate: a user who ran
// `mauto telemetry enable` must hear that it did not stick.
function setLocalConsent(projectRoot, value, { env = process.env, homedir = os.homedir, getuid } = {}) {
  const file = consentPath({ env, homedir });
  const grant = value === true;
  if (!grant && !fs.existsSync(file)) return;

  const doc = readRecord(file, { env, getuid }) || { projects: {} };
  const key = realOrResolved(projectRoot);
  if (grant) doc.projects[key] = true;
  else delete doc.projects[key];

  const dir = path.dirname(file);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  fs.chmodSync(dir, 0o700);
  atomicUserLeafWrite(file, `${JSON.stringify(doc, null, 2)}\n`, { mode: 0o600 });
}

module.exports = { CONSENT_MAX_BYTES, consentPath, hasLocalConsent, setLocalConsent };
