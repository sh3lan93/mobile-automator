'use strict';

// Structural guard: CHANGELOG.md is not just prose, it is an input to the
// release pipeline. release.yml cuts each GitHub Release body with
//
//   sed -n "/## \[$VERSION\]/,/## \[/p" CHANGELOG.md
//
// which takes the first `## [$VERSION]` heading through to the next `## [`
// heading, and the gate-then-graduate convention has the graduation PR collapse
// `## [Unreleased]` into the new version section. Both assume one heading per
// release and one `[Unreleased]` on top. #181 is what happens when that slips:
// shipped 0.23.1–0.23.3 entries sat under a second, stale `## [Unreleased]`
// halfway down the file, so "collapse [Unreleased]" had two candidates and a
// release body could silently pick up the wrong block (or none).
//
// Everything is derived from the file itself. `git tag` is deliberately not
// consulted: CI checkouts may be shallow or tagless, and the heading order is
// checkable on its own.

const fs = require('fs');
const path = require('path');

const { REPO_ROOT } = require('./docs-corpus');

const CHANGELOG = path.join(REPO_ROOT, 'CHANGELOG.md');

// `## [0.12.1]`, `## [0.12.1] — 2026-05-23`, `## [0.10.0] - 2026-03-30`, and
// prerelease forms like `## [0.26.0-rc.4]`. Anything after the date is not a
// shape this file has ever used, so it is rejected rather than tolerated.
const VERSION_HEADING = /^## \[(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?\](?:\s+[—-]\s+\d{4}-\d{2}-\d{2})?\s*$/;
const UNRELEASED_HEADING = /^## \[Unreleased\]\s*$/;

/**
 * Every `## [` heading in the changelog, classified.
 *
 * @param {string} text
 * @returns {{line: number, text: string, kind: 'unreleased'|'version'|'unrecognised', version?: object}[]}
 */
function changelogHeadings(text) {
  const headings = [];
  text.split('\n').forEach((raw, i) => {
    const line = raw.replace(/\r$/, '');
    if (!line.startsWith('## [')) return;
    const heading = { line: i + 1, text: line.trim() };
    const v = VERSION_HEADING.exec(line);
    if (UNRELEASED_HEADING.test(line)) {
      heading.kind = 'unreleased';
    } else if (v) {
      heading.kind = 'version';
      heading.version = {
        major: Number(v[1]),
        minor: Number(v[2]),
        patch: Number(v[3]),
        pre: v[4] ? v[4].split('.') : [],
        raw: v[4] ? `${v[1]}.${v[2]}.${v[3]}-${v[4]}` : `${v[1]}.${v[2]}.${v[3]}`,
      };
    } else {
      heading.kind = 'unrecognised';
    }
    headings.push(heading);
  });
  return headings;
}

/**
 * Semver precedence: >0 if a outranks b, <0 if b outranks a, 0 if equal.
 * A prerelease sorts below its release; prerelease identifiers compare
 * numerically when both are numeric, numeric below alphanumeric, else ASCII.
 */
function compareVersions(a, b) {
  for (const k of ['major', 'minor', 'patch']) {
    if (a[k] !== b[k]) return a[k] - b[k];
  }
  if (a.pre.length === 0 || b.pre.length === 0) return b.pre.length - a.pre.length;
  for (let i = 0; i < Math.max(a.pre.length, b.pre.length); i++) {
    if (a.pre[i] === undefined) return -1;
    if (b.pre[i] === undefined) return 1;
    const an = /^\d+$/.test(a.pre[i]);
    const bn = /^\d+$/.test(b.pre[i]);
    if (an && bn) {
      const d = Number(a.pre[i]) - Number(b.pre[i]);
      if (d !== 0) return d;
    } else if (an !== bn) {
      return an ? -1 : 1;
    } else if (a.pre[i] !== b.pre[i]) {
      return a.pre[i] < b.pre[i] ? -1 : 1;
    }
  }
  return 0;
}

describe('CHANGELOG.md — structural agreement with the release pipeline', () => {
  const headings = changelogHeadings(fs.readFileSync(CHANGELOG, 'utf8'));
  const versions = headings.filter((h) => h.kind === 'version');
  const unreleased = headings.filter((h) => h.kind === 'unreleased');

  describe('semver precedence', () => {
    const v = (s) => changelogHeadings(`## [${s}]`)[0].version;
    test.each([
      ['0.24.0', '0.23.9'],
      ['0.10.0', '0.9.0'],
      ['1.0.0', '1.0.0-rc.1'],
      ['1.0.0-rc.10', '1.0.0-rc.2'],
      ['1.0.0-rc.1', '1.0.0-rc'],
      ['1.0.0-rc.1', '1.0.0-1'],
    ])('%s outranks %s', (hi, lo) => {
      expect(compareVersions(v(hi), v(lo))).toBeGreaterThan(0);
      expect(compareVersions(v(lo), v(hi))).toBeLessThan(0);
    });
  });

  test('the file yields version headings, so a broken pattern cannot pass vacuously', () => {
    expect(versions.length).toBeGreaterThan(0);
  });

  test('every "## [" heading is [Unreleased] or a parseable version', () => {
    // release.yml's sed range ends at the next `## [`, so an unrecognised
    // bracket heading still truncates a release body — it must be one of the
    // two shapes this guard can reason about.
    const violations = headings
      .filter((h) => h.kind === 'unrecognised')
      .map(
        (h) =>
          `CHANGELOG.md:${h.line}: unrecognised heading ${JSON.stringify(h.text)} — ` +
          'expected "## [Unreleased]" or "## [X.Y.Z]" (optionally " — YYYY-MM-DD")'
      );
    expect(violations).toEqual([]);
  });

  test('there is at most one [Unreleased] heading', () => {
    const violations =
      unreleased.length > 1
        ? [
            `CHANGELOG.md has ${unreleased.length} "## [Unreleased]" headings, at lines ` +
              `${unreleased.map((h) => h.line).join(', ')}. Only the top one may stay: a block ` +
              'below it holds entries that already shipped, so rename that heading to the ' +
              'release it went out in (e.g. "## [X.Y.Z]") — the single-PR bugfix rule ' +
              '"rename [Unreleased] to the release" that was skipped when it shipped.',
          ]
        : [];
    expect(violations).toEqual([]);
  });

  test('[Unreleased], if present, is the first "## [" heading', () => {
    const violations = [];
    if (unreleased.length > 0 && headings[0].kind !== 'unreleased') {
      violations.push(
        `CHANGELOG.md:${unreleased[0].line}: "## [Unreleased]" must be the first "## [" heading, ` +
          `but ${JSON.stringify(headings[0].text)} (line ${headings[0].line}) precedes it`
      );
    }
    expect(violations).toEqual([]);
  });

  test('every version heading is unique', () => {
    const seen = new Map();
    const violations = [];
    for (const h of versions) {
      const first = seen.get(h.version.raw);
      if (first) {
        violations.push(
          `CHANGELOG.md:${h.line}: duplicate heading for ${h.version.raw} ` +
            `(first at line ${first.line}) — release.yml's sed would only ever see the first`
        );
      } else {
        seen.set(h.version.raw, h);
      }
    }
    expect(violations).toEqual([]);
  });

  test('version headings are in strictly descending semver order', () => {
    const violations = [];
    for (let i = 1; i < versions.length; i++) {
      const prev = versions[i - 1];
      const cur = versions[i];
      // Equal versions are the uniqueness test's to report, not this one's.
      if (compareVersions(prev.version, cur.version) < 0) {
        violations.push(
          `CHANGELOG.md:${cur.line}: ${cur.version.raw} is newer than ${prev.version.raw} ` +
            `(line ${prev.line}) above it — newest release goes first`
        );
      }
    }
    expect(violations).toEqual([]);
  });
});
