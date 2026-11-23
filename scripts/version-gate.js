#!/usr/bin/env node
'use strict';

// The version gate (#369): package.json's version must be greater than every
// release tag, not merely untagged. Checking only "is v<version> tagged?" let
// 0.40.13 merge after v0.40.14 shipped, and npm publish refused it.
//
//   node scripts/version-gate.js <version> --mode pr    version-check.yml, on a PR
//   node scripts/version-gate.js <version> --mode tag   auto-tag.yml, before tagging
//
//   exit 0  pr: ahead of every tag. tag: ahead (exists=false), or already
//           tagged with no shipping path changed since that tag
//           (exists=true: a re-run, or a docs-only merge; nothing to do)
//   exit 1  pr: tagged or behind. tag: behind, or tagged with shipping paths
//           changed since the tag (a stale branch reused a released
//           version), so nothing is tagged
//   exit 2  could not run: bad arguments, unparseable version, git failed
//
// In tag mode `exists=…` is appended to $GITHUB_OUTPUT for the tag step's `if:`;
// with no GITHUB_OUTPUT (a local run) the decision is only printed.
//
// Tag mode re-checks what PR mode already did because a PR's last CI run can
// predate the latest merge to main: a stale branch can merge with a version
// that was ahead when its checks ran. Failing here stops it before a tag is
// pushed, instead of inside npm publish. The same stale branch can also reuse
// a version that has since shipped; skipping it as a re-run would leave its
// code unreleased, so a tagged version only skips when SHIPPING_PATHS are
// unchanged between v<version> and HEAD.
//
// The ordering is scripts/version-order.js, the one comparison in the repo.

const { spawnSync } = require('child_process');
const fs = require('fs');

const { parseVersion, compareVersions } = require('./version-order');

const MODES = ['pr', 'tag'];
const RULE = '────────────────────────────────────────';
const USAGE = 'usage: node scripts/version-gate.js <version> --mode pr|tag';

// What ships: the `cli` paths-filter list in version-check.yml, as git
// pathspecs. tests/lint/version-gate.test.js keeps the two equal.
const SHIPPING_PATHS = ['src', 'bin', 'package.json'];

/**
 * Where `version` stands against the release tags.
 *
 * @param {string} version  a parseable version, no `v`
 * @param {string[]} tags   tag names; anything not `v` + a parseable version is ignored
 * @returns {{ decision: 'tagged'|'behind'|'ahead', highest: string|null }}
 */
function decide(version, tags) {
  const releases = tags.filter((t) => t.startsWith('v') && parseVersion(t.slice(1)));
  const highest = releases.reduce(
    (best, t) => (best === null || compareVersions(t.slice(1), best.slice(1)) > 0 ? t : best),
    null,
  );
  if (releases.includes(`v${version}`)) return { decision: 'tagged', highest };
  if (highest !== null && compareVersions(version, highest.slice(1)) <= 0) return { decision: 'behind', highest };
  return { decision: 'ahead', highest };
}

function parseArgs(argv) {
  if (argv.length !== 3 || argv[1] !== '--mode') throw new Error(USAGE);
  const [version, , mode] = argv;
  if (!MODES.includes(mode)) throw new Error(`unknown mode "${mode}". ${USAGE}`);
  if (!parseVersion(version)) {
    throw new Error(`cannot parse version "${version}" (expected X.Y.Z or X.Y.Z-prerelease, no "v")`);
  }
  return { version, mode };
}

/** Every tag name in the repo at cwd. Throws when git fails. */
function gitTags(cwd = process.cwd()) {
  const res = spawnSync('git', ['tag', '--list', 'v*'], { cwd, encoding: 'utf8' });
  if (res.error) throw new Error(`could not run git: ${res.error.message}`);
  if (res.status !== 0) throw new Error(`git tag --list failed (exit ${res.status}): ${(res.stderr || '').trim()}`);
  return res.stdout.split('\n').map((t) => t.trim()).filter(Boolean);
}

/**
 * Whether any SHIPPING_PATHS differ between `tag` and HEAD in the repo at cwd.
 * Throws when git fails (an unknown tag included).
 */
function gitChangedSinceTag(tag, cwd = process.cwd()) {
  const res = spawnSync('git', ['diff', '--quiet', tag, 'HEAD', '--', ...SHIPPING_PATHS], { cwd, encoding: 'utf8' });
  if (res.error) throw new Error(`could not run git: ${res.error.message}`);
  if (res.status === 0) return false;
  if (res.status === 1) return true;
  throw new Error(`git diff ${tag} HEAD failed (exit ${res.status}): ${(res.stderr || '').trim()}`);
}

/** Append one `key=value` line to $GITHUB_OUTPUT; a no-op when it is unset. */
function appendGithubOutput(line, env = process.env) {
  if (!env.GITHUB_OUTPUT) return;
  fs.appendFileSync(env.GITHUB_OUTPUT, `${line}\n`);
}

function box(title, lines) {
  return ['', title, RULE, ...lines.map((l) => (l ? `  ${l}` : '')), RULE].join('\n');
}

function prResult(version, { decision, highest }) {
  const tag = `v${version}`;
  if (decision === 'tagged') {
    return {
      code: 1,
      stream: 'error',
      text: box('❌ Version check failed', [
        `Version ${version} is already released (tag '${tag}' exists).`,
        '',
        'PRs that change CLI code (src/, bin/, package.json) must bump the',
        'version in package.json to a value not yet tagged and greater than',
        `the highest release tag (${highest}).`,
        '',
        'Re-sync with `node scripts/sync-branch.js`; it picks the next free version.',
      ]),
    };
  }
  if (decision === 'behind') {
    return {
      code: 1,
      stream: 'error',
      text: box('❌ Version check failed', [
        `Version ${version} is not greater than the highest release tag ${highest}.`,
        '',
        'Another PR shipped a higher version after this branch picked its own.',
        'Re-sync with `node scripts/sync-branch.js`; it merges origin/main and',
        'picks the next free version.',
      ]),
    };
  }
  return {
    code: 0,
    stream: 'log',
    text: box('✅ Version check passed', [
      `Version ${version} (tag '${tag}') is not yet released and is greater than`,
      `the highest release tag (${highest || 'none yet'}).`,
    ]),
  };
}

function tagResult(version, { decision, highest }, changedSinceTag) {
  const tag = `v${version}`;
  if (decision === 'tagged') {
    if (!changedSinceTag(tag)) {
      return {
        code: 0,
        output: 'exists=true',
        stream: 'log',
        text: `⚠️ Tag ${tag} already exists and no CLI code changed since — skipping tag creation.`,
      };
    }
    return {
      code: 1,
      stream: 'error',
      text: box('❌ Refusing to tag', [
        `Version ${version} is already released (tag '${tag}' exists).`,
        'Nothing was tagged and nothing will be published.',
        '',
        `CLI code changed since ${tag} was released (${SHIPPING_PATHS.join(', ')}),`,
        'but the version was not bumped: a stale branch merged with a version',
        'that shipped before it landed. Fix it on a new PR that bumps the version',
        '(`node scripts/sync-branch.js` picks the next free one).',
      ]),
    };
  }
  if (decision === 'behind') {
    return {
      code: 1,
      stream: 'error',
      text: box('❌ Refusing to tag', [
        `Version ${version} is not greater than the highest release tag ${highest}.`,
        'Nothing was tagged and nothing will be published.',
        '',
        'A stale branch merged: its version was free when its PR checks ran,',
        'but a higher version shipped before it merged. Fix it on a new PR that',
        'bumps the version (`node scripts/sync-branch.js` picks the next free one).',
      ]),
    };
  }
  return {
    code: 0,
    output: 'exists=false',
    stream: 'log',
    text: `✅ Tag ${tag} does not exist and is above ${highest || 'every tag'} — will create it.`,
  };
}

/**
 * @param {string[]} argv  arguments after the script path
 * @param {object} [deps]
 * @returns {number} exit code
 */
function main(
  argv,
  {
    readTags = gitTags,
    changedSinceTag = gitChangedSinceTag,
    log = console.log,
    error = console.error,
    writeOutput = appendGithubOutput,
  } = {},
) {
  let args;
  let result;
  try {
    args = parseArgs(argv);
    const verdict = decide(args.version, readTags());
    result = args.mode === 'pr' ? prResult(args.version, verdict) : tagResult(args.version, verdict, changedSinceTag);
  } catch (err) {
    error(`version-gate: ${err.message}`);
    return 2;
  }
  if (result.output) {
    try {
      writeOutput(result.output);
    } catch (err) {
      error(`version-gate: could not write GITHUB_OUTPUT: ${err.message}`);
      return 2;
    }
  }
  (result.stream === 'error' ? error : log)(result.text);
  return result.code;
}

if (require.main === module) process.exitCode = main(process.argv.slice(2));

module.exports = { decide, main, gitTags, gitChangedSinceTag, appendGithubOutput, SHIPPING_PATHS };
