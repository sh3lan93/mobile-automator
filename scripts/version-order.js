'use strict';

// The one version comparison in the repo (#369). scripts/version-gate.js
// orders package.json's version against the release tags with it, and
// scripts/sync-branch.js picks its next version with it; both find the highest
// release tag through highestRelease() here, and neither keeps its own.
//
// Precedence is SemVer 2.0's: the numeric core first, then a version with a
// prerelease sorts below the same core without one (0.41.0-rc.1 < 0.41.0), and
// prerelease identifiers compare left to right, numeric ones numerically
// (rc.2 < rc.10), numeric below alphanumeric, alphanumerics in ASCII order, a
// shorter list below a longer one it prefixes.
//
// Build metadata (`+build`) is refused, not ignored: this repo never tags one,
// and SemVer gives it no precedence, so 1.2.3+a and 1.2.3+b would compare
// equal while naming different tags. Leading zeros are accepted, as the old
// sync-branch parser did.

const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/;
const NUMERIC_RE = /^\d+$/;

/**
 * @param {string} version  `X.Y.Z` with an optional `-prerelease`, no `v`
 * @returns {{ core: number[], prerelease: string[] } | null}
 */
function parseVersion(version) {
  if (typeof version !== 'string') return null;
  const m = VERSION_RE.exec(version);
  if (!m) return null;
  return {
    core: [Number(m[1]), Number(m[2]), Number(m[3])],
    prerelease: m[4] === undefined ? [] : m[4].split('.'),
  };
}

/** Compare two `[major, minor, patch]` arrays numerically. */
function compareCores(a, b) {
  for (let i = 0; i < 3; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

function compareIdentifiers(a, b) {
  const an = NUMERIC_RE.test(a);
  const bn = NUMERIC_RE.test(b);
  if (an && bn) {
    // BigInt: an rc counter is never that long, but a lexical fallback would
    // reintroduce the rc.10 < rc.2 bug for long numbers.
    const d = BigInt(a) - BigInt(b);
    if (d === 0n) return 0;
    return d < 0n ? -1 : 1;
  }
  if (an) return -1;
  if (bn) return 1;
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

// An empty list is a release, which sorts above any prerelease of its core.
function comparePrereleases(a, b) {
  if (a.length === 0 || b.length === 0) return b.length - a.length;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    const d = compareIdentifiers(a[i], b[i]);
    if (d !== 0) return d;
  }
  return a.length - b.length;
}

function parseOrThrow(version) {
  const parsed = parseVersion(version);
  if (!parsed) throw new Error(`cannot parse version "${version}"`);
  return parsed;
}

/**
 * Negative when `a` sorts before `b`, positive after, 0 when equal.
 * Throws on a string parseVersion refuses.
 */
function compareVersions(a, b) {
  const pa = parseOrThrow(a);
  const pb = parseOrThrow(b);
  return compareCores(pa.core, pb.core) || comparePrereleases(pa.prerelease, pb.prerelease);
}

/**
 * The highest release tag among `tags`, by compareVersions.
 *
 * @param {string[]} tags  tag names; anything not `v` + a parseable version is ignored
 * @returns {{ tag: string, version: string, parsed: { core: number[], prerelease: string[] } } | null}
 *   `tag` is the name as given (`v0.41.0-rc.1`), `version` the same without
 *   the `v`, `parsed` its parseVersion(); null when no tag is a release.
 */
function highestRelease(tags) {
  let best = null;
  for (const tag of tags) {
    if (typeof tag !== 'string' || !tag.startsWith('v')) continue;
    const version = tag.slice(1);
    const parsed = parseVersion(version);
    if (!parsed) continue;
    if (best === null || compareVersions(version, best.version) > 0) best = { tag, version, parsed };
  }
  return best;
}

module.exports = { parseVersion, compareVersions, compareCores, highestRelease };
