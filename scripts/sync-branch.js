#!/usr/bin/env node
'use strict';

// Merge the base branch into the current branch and settle the release
// bookkeeping that parallel PRs always collide on: CHANGELOG.md, package.json
// and package-lock.json. The version-bump gate makes every shipping PR claim a
// version and the strict ruleset makes every open PR re-sync after each merge,
// so these three files conflict by construction, not by accident.
//
//   node scripts/sync-branch.js                 merge origin/main, commit locally
//   node scripts/sync-branch.js --base <ref>    merge another ref
//   node scripts/sync-branch.js --no-fetch      use the refs and tags already here
//
//   exit 0  up to date, or merged and committed
//   exit 1  merge left open: real conflicts remain for a human, bookkeeping done
//   exit 2  could not run: bad arguments, dirty tree, wrong branch, git/npm failed
//
// It never pushes. Two decisions are load-bearing:
//
// - The version is decided on every sync, not only on a conflict. Two PRs that
//   bump to the same version merge *cleanly* in package.json, and the branch
//   then silently re-claims a version main already took.
// - CHANGELOG.md is rebuilt from the three real versions of the file by section,
//   never by splicing conflict hunks: entries share lines like `### Changed`,
//   so git interleaves two releases into a shape no hunk rule can untangle.
//
// Anything it cannot decide safely raises HandMerge and stays a normal conflict.

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');

const { parseVersion, compareCores } = require('./version-order');
const { decide, gitTags } = require('./version-gate');

const CHANGELOG = 'CHANGELOG.md';
const PACKAGE = 'package.json';
const LOCK = 'package-lock.json';

class HandMerge extends Error {}

// An unparseable version is left to a human.
function parseOrHandMerge(version) {
  const parsed = parseVersion(version);
  if (!parsed) throw new HandMerge(`cannot parse version "${version}"`);
  return parsed;
}

// The position (0 major, 1 minor, 2 patch) of the first number the branch moved.
function bumpLevel(from, to) {
  const level = from.findIndex((n, i) => n !== to[i]);
  return level === -1 ? 2 : level;
}

function bump(core, level) {
  return core.map((n, i) => {
    if (i < level) return n;
    return i === level ? n + 1 : 0;
  });
}

const LEVELS = ['major', 'minor', 'patch'];

// The version the branch should carry once `theirs` is merged: its own if that
// is still free and ahead, otherwise the same size of bump on top of the base.
// Free is the version gate's rule (#369), decide() over the release `tags`, so
// sync never picks a version the gate would then reject: see sync() below.
//
// The next free version is computed, not probed for. When the base's bump is
// not free, the only bar left is the highest tag, so the answer is the same
// bump on top of it. If that tag is on a newer minor or major than the branch's
// bump size (an rc line, 0.41.0-rc.1, past a patch bump), the bump cannot reach
// it at that size and a human chooses: probing bump after bump never ended.
function nextVersion({ ancestor, ours, theirs, tags }) {
  if (ours === ancestor) return theirs;

  const free = (version) => decide(version, tags).decision === 'ahead';
  const o = parseOrHandMerge(ours);
  const t = parseOrHandMerge(theirs);
  if (compareCores(o.core, t.core) > 0 && free(ours)) return ours;

  if (o.prerelease.length > 0 || t.prerelease.length > 0) {
    throw new HandMerge(`rc version ${ours} needs a number chosen by hand (base is ${theirs})`);
  }

  const level = bumpLevel(parseOrHandMerge(ancestor).core, o.core);
  const candidate = bump(t.core, level);
  if (free(candidate.join('.'))) return candidate.join('.');

  // Not free, so some tag is at or above candidate: highest is never null here.
  const { highest } = decide(candidate.join('.'), tags);
  const h = parseOrHandMerge(highest.slice(1));
  if (h.core.some((n, i) => i < level && n !== candidate[i])) {
    throw new HandMerge(
      `highest release tag ${highest} is past a ${LEVELS[level]} bump on ${theirs}; choose the version by hand`,
    );
  }

  // h.core agrees with candidate above `level` and bumping it at `level` moves
  // past h itself (prerelease or not), so this is above every tag.
  const above = bump(h.core, level);
  if (!free(above.join('.'))) {
    throw new HandMerge(`no free ${LEVELS[level]} bump above ${highest}; choose the version by hand`);
  }
  return above.join('.');
}

// Split into the text before the first `## [` heading and one entry per section,
// each holding its text through to the next heading (including any `---`).
function parseChangelog(text) {
  const parts = text.split(/^(?=## \[)/m);
  const preamble = parts[0].startsWith('## [') ? '' : parts.shift();
  const sections = parts.map((part) => ({ key: /^## \[([^\]]+)\]/.exec(part)[1], text: part }));
  return { preamble, sections };
}

const byKey = (sections) => new Map(sections.map((s) => [s.key, s.text]));

function renumber(text, from, to) {
  const escaped = from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return text.replace(new RegExp(`(?<![\\d.])${escaped}(?!\\d)`, 'g'), to);
}

function mergeChangelog({ ancestor, ours, theirs, oursVersion, newVersion }) {
  const base = byKey(parseChangelog(ancestor).sections);
  const mine = parseChangelog(ours).sections;
  const mineByKey = byKey(mine);
  const landed = parseChangelog(theirs);
  const landedByKey = byKey(landed.sections);

  const added = [];
  for (const section of mine) {
    if (base.has(section.key)) continue;
    if (section.key === oursVersion && oursVersion !== newVersion) {
      added.push(renumber(section.text, oursVersion, newVersion));
    } else if (!landedByKey.has(section.key)) {
      added.push(section.text);
    } else if (landedByKey.get(section.key) !== section.text) {
      throw new HandMerge(`section [${section.key}] was added differently on both sides`);
    }
  }

  const merged = landed.sections.map(({ key, text }) => {
    if (!base.has(key) || !mineByKey.has(key)) return text;
    const original = base.get(key);
    const mineText = mineByKey.get(key);
    if (text === original) return mineText;
    if (mineText === original || mineText === text) return text;
    throw new HandMerge(`section [${key}] was rewritten on both sides`);
  });

  return [landed.preamble, ...added, ...merged].join('');
}

function withoutVersion(text) {
  const fields = JSON.parse(text);
  delete fields.version;
  return fields;
}

function mergePackageJson({ ancestor, ours, theirs, newVersion }) {
  const base = withoutVersion(ancestor);
  const mine = withoutVersion(ours);
  const landed = withoutVersion(theirs);

  let text;
  if (isDeepStrictEqual(mine, base)) text = theirs;
  else if (isDeepStrictEqual(landed, base) || isDeepStrictEqual(mine, landed)) text = ours;
  else throw new HandMerge(`${PACKAGE} changed beyond its version on both sides`);

  return text.replace(/("version":\s*")[^"]+(")/, `$1${newVersion}$2`);
}

function refreshLockfile({ cwd }) {
  const result = spawnSync(
    'npm',
    ['install', '--package-lock-only', '--ignore-scripts', '--no-audit', '--no-fund'],
    { cwd, encoding: 'utf8' },
  );
  if (result.status !== 0) throw new Error(`npm install failed: ${result.stderr || result.error}`);
}

function gitRunner(cwd) {
  const raw = (...args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
  const run = (...args) => {
    const result = raw(...args);
    if (result.status !== 0) {
      throw new Error(`git ${args.join(' ')} failed: ${result.stderr || result.error}`);
    }
    return result.stdout.trim();
  };
  return { raw, run };
}

function preflight({ raw, run }, base) {
  const branch = run('branch', '--show-current');
  if (!branch || branch === base.split('/').pop()) {
    throw new Error(`run this on a feature branch, not ${branch || 'a detached HEAD'}`);
  }
  if (raw('rev-parse', '-q', '--verify', 'MERGE_HEAD').status === 0) {
    throw new Error('a merge is already in progress; finish or abort it first');
  }
  if (run('status', '--porcelain', '--untracked-files=no')) {
    throw new Error('the tree has uncommitted changes; commit them first');
  }
}

function sync({ cwd, base = 'origin/main', fetch = true, npm = refreshLockfile, log = console.log }) {
  const git = gitRunner(cwd);
  const { raw, run } = git;

  preflight(git, base);
  if (fetch) run('fetch', '-q', '--tags', 'origin');

  if (raw('merge-base', '--is-ancestor', base, 'HEAD').status === 0) {
    log(`already up to date with ${base}`);
    return { status: 'up-to-date' };
  }

  const ancestorRev = run('merge-base', 'HEAD', base);
  // Whole file contents, untrimmed: section comparison is byte-exact.
  const show = (rev, name) => {
    const result = raw('show', `${rev}:${name}`);
    if (result.status !== 0) throw new Error(`cannot read ${rev}:${name}: ${result.stderr}`);
    return result.stdout;
  };
  const blobs = (name) => ({
    ancestor: show(ancestorRev, name),
    ours: show('HEAD', name),
    theirs: show(base, name),
  });
  const file = (name) => path.join(cwd, name);
  const versions = (() => {
    const b = blobs(PACKAGE);
    return {
      ancestor: JSON.parse(b.ancestor).version,
      ours: JSON.parse(b.ours).version,
      theirs: JSON.parse(b.theirs).version,
    };
  })();

  // Free means what the version gate accepts: above every release tag, read
  // once through the gate's own tag reader.
  const tags = gitTags(cwd);

  raw('merge', '--no-commit', '--no-ff', '--no-edit', base);
  if (raw('rev-parse', '-q', '--verify', 'MERGE_HEAD').status !== 0) {
    throw new Error(`git could not start merging ${base}`);
  }

  const conflicted = () => {
    const out = run('diff', '--name-only', '--diff-filter=U');
    return out ? out.split('\n') : [];
  };
  const initial = conflicted();

  const resolve = (name, build) => {
    try {
      fs.writeFileSync(file(name), build());
      run('add', '--', name);
      return true;
    } catch (err) {
      if (!(err instanceof HandMerge)) throw err;
      log(`left for you: ${name} (${err.message})`);
      return false;
    }
  };

  let newVersion;
  try {
    newVersion = nextVersion({ ...versions, tags });
  } catch (err) {
    if (!(err instanceof HandMerge)) throw err;
    log(`left for you: version (${err.message})`);
    const remaining = conflicted();
    return { status: 'conflicts', remaining: remaining.length ? remaining : [PACKAGE] };
  }

  const renumbered = newVersion !== versions.ours;

  if (initial.includes(CHANGELOG) || (renumbered && versions.ours !== versions.ancestor)) {
    resolve(CHANGELOG, () => mergeChangelog({
      ...blobs(CHANGELOG),
      oursVersion: versions.ours,
      newVersion,
    }));
  }

  let packageSettled = true;
  if (initial.includes(PACKAGE) || renumbered) {
    packageSettled = resolve(PACKAGE, () => mergePackageJson({
      ...blobs(PACKAGE),
      newVersion,
    }));
  }

  if (packageSettled && (initial.includes(LOCK) || renumbered)) {
    if (initial.includes(LOCK)) fs.writeFileSync(file(LOCK), show(base, LOCK));
    npm({ cwd });
    run('add', '--', LOCK);
  }

  const remaining = conflicted();
  if (remaining.length) {
    log(`merge left open, version ${newVersion}. Resolve these, then git commit:`);
    remaining.forEach((name) => log(`  ${name}`));
    return { status: 'conflicts', remaining, version: newVersion };
  }

  run('commit', '-q', '--no-edit');
  log(`merged ${base} locally at version ${newVersion}. Review it, then git push.`);
  return { status: 'synced', version: newVersion };
}

function parseArgs(argv) {
  const options = { base: 'origin/main', fetch: true };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--no-fetch') options.fetch = false;
    else if (argv[i] === '--base' && argv[i + 1]) {
      i += 1;
      options.base = argv[i];
    } else throw new Error(`unknown argument: ${argv[i]}`);
  }
  return options;
}

function main(argv, { npm, log = console.log, error = console.error } = {}) {
  try {
    const result = sync({ ...parseArgs(argv), cwd: process.cwd(), npm, log });
    return result.status === 'conflicts' ? 1 : 0;
  } catch (err) {
    error(`sync-branch: ${err.message}`);
    return 2;
  }
}

if (require.main === module) {
  process.exitCode = main(process.argv.slice(2));
}

module.exports = { HandMerge, nextVersion, mergeChangelog, mergePackageJson, sync, main };
