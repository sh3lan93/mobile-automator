'use strict';

// tests/lint/showcase-replay-workflow.test.js
//
// PRD #304, #313: `.github/workflows/showcase-replay.yml` replays every
// shipped showcase scenario with agent-free `mauto run` on an Android emulator
// and an iOS simulator, against the live TMDB API, on a weekly schedule. It is
// also the file people copy into their own app's repo. Nothing runs it on a
// PR, so a broken wiring would sit unnoticed until the next Monday (or, in a
// copy, forever). These rules pin what the workflow promises:
//
//   1. Triggers are exactly `schedule` + `workflow_dispatch`. It talks to a
//      live API with a repository secret, so it must never run on
//      `pull_request` / `pull_request_target` (a fork's PR would either fail
//      without the key or, with `_target`, run untrusted code with it). A
//      `push` trigger is tolerated only as the pre-merge branch-only trigger
//      marked `TEMPORARY(#313)`, because `workflow_dispatch` is offered only
//      for files on the default branch.
//   2. It is never a required check: a TMDB outage must not block merges.
//   3. The TMDB key reaches steps only through `env:` mappings, never
//      interpolated into a `run:` script (where it lands in the script file
//      and in any `set -x` trace), and no `run:` echoes it.
//   4. The `key` job gates everything: without the secret (forks) every other
//      job is skipped and the run stays green; and a failed `tmdb` live-data
//      check skips both device jobs, so an outage never reads as a red replay.
//   5. Both device jobs replay `$SCENARIOS`, a glob that resolves to every
//      scenario in `showcase-app/scenarios/`, so there is no hand list to fall
//      behind when a scenario is added.
//   6. `replay.sh` really runs `mauto run` with `--device` and `--junit`.
//   7. The artifacts upload with `if: always()`: the report matters most when
//      the replay failed, which is when a plain upload step is skipped.
//   8. `tmdb-check.sh` restates FilterState.kt's discover query and
//      KtorTmdbClient.searchMovies's search query in shell (a second copy,
//      decision 4 of the plan), so its parameter names and
//      MIN_VOTES_FOR_RATING must equal the Kotlin ones.
//   9. mauto installs from npm at `MAUTO_VERSION`, never a packed tarball: a
//      copy of this workflow has no mauto source tree to pack.
//  10. Each device job resolves the replay's device id with the generic
//      `ci/device-id.sh <its platform>`, and no workflow script runs jq over
//      `mauto devices` output: that parsing lives in one tested script.
//  11. replay.sh's exit-code case labels for passed, failed and needs_agent
//      equal mauto's own EXIT.OK, EXIT.TEST_FAILED and EXIT.INCOMPLETE
//      (src/output/envelope.js), so a renumbered exit code cannot leave the
//      copyable script classifying by stale numbers.
//  12. No annotation title in the workflow or its ci/ scripts contains a
//      comma: GitHub splits workflow-command properties on `,`, so
//      `::error title=Outage, not mauto::` shows the title "Outage".

const fs = require('fs');
const path = require('path');

const { REPO_ROOT } = require('./docs-corpus');
const { loadWorkflow, asList, executedScripts, isAlways } = require('./workflow-guard');
const { EXIT } = require('../../src/output/envelope');

const WORKFLOW = '.github/workflows/showcase-replay.yml';
const REQUIRED_FILE = '.github/required-checks.json';
const REPLAY_SH = 'showcase-app/ci/replay.sh';
const TMDB_CHECK = 'showcase-app/ci/tmdb-check.sh';
const DEVICE_ID_SH = 'showcase-app/ci/device-id.sh';
const FILTER_STATE =
  'showcase-app/shared/src/commonMain/kotlin/io/github/sh3lan93/mobileautomator/showcase/data/FilterState.kt';
const TMDB_CLIENT =
  'showcase-app/shared/src/commonMain/kotlin/io/github/sh3lan93/mobileautomator/showcase/data/KtorTmdbClient.kt';
const SCENARIO_DIR = 'showcase-app/scenarios';
const TEMP_BRANCH = 'sample-app/313-ci-workflow';
const TEMP_MARKER = 'TEMPORARY(#313)';
const DEVICE_JOBS = ['android', 'ios'];
const DEVICE_JOB_PLATFORM = { android: 'android', ios: 'ios' };

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

/**
 * Every string leaf of a parsed YAML tree with its key path, so a rule can ask
 * "where does this text occur" without knowing the workflow's shape.
 */
function leaves(node, at = []) {
  if (typeof node === 'string') return [{ path: at, value: node }];
  if (Array.isArray(node)) return node.flatMap((v, i) => leaves(v, [...at, i]));
  if (node && typeof node === 'object') {
    return Object.entries(node).flatMap(([k, v]) => leaves(v, [...at, k]));
  }
  return [];
}

/** Every shell script a job runs (see workflow-guard's executedScripts). */
const scripts = (job) => executedScripts(job.steps);

/** `dir/*.json`-style glob → the file names it matches. Only `*` is supported, loudly. */
function resolveGlob(baseDir, glob) {
  const dir = path.posix.dirname(glob);
  const pattern = path.posix.basename(glob);
  if (/[?[\]{}]/.test(glob) || dir.includes('*')) {
    throw new Error(`unsupported glob "${glob}": only a "*" in the file name is understood here`);
  }
  const re = new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.+^$()|\\]/g, '\\$&')).join('[^/]*')}$`);
  const abs = path.join(REPO_ROOT, baseDir, dir);
  return fs.readdirSync(abs).filter((f) => re.test(f)).map((f) => path.posix.join(baseDir, dir, f)).sort();
}

describe('showcase replay workflow (#313)', () => {
  const raw = read(WORKFLOW);
  const wf = loadWorkflow(WORKFLOW);
  const jobs = wf.jobs || {};
  const env = wf.env || {};

  test('1. triggers are schedule + workflow_dispatch; push only as the marked temporary trigger', () => {
    const on = wf.on;
    expect(on && typeof on === 'object' && !Array.isArray(on)).toBe(true);
    const events = Object.keys(on);
    expect(events).toEqual(expect.arrayContaining(['schedule', 'workflow_dispatch']));
    expect(events).not.toContain('pull_request');
    expect(events).not.toContain('pull_request_target');
    expect(events.filter((e) => !['schedule', 'workflow_dispatch', 'push'].includes(e))).toEqual([]);
    expect(asList(on.schedule).map((s) => s.cron)).toEqual(['23 4 * * 1']);
    if ('push' in on) {
      // The pre-merge trigger: one branch, nothing else, and marked for removal.
      expect(Object.keys(on.push || {})).toEqual(['branches']);
      expect(asList(on.push.branches)).toEqual([TEMP_BRANCH]);
      expect(raw).toContain(TEMP_MARKER);
    }
  });

  test('2. no job of this workflow is a required check', () => {
    const { checks } = JSON.parse(read(REQUIRED_FILE));
    const names = Object.entries(jobs).map(([id, job]) => (job.name == null ? id : String(job.name)));
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((n) => checks.includes(n))).toEqual([]);
  });

  test('3. the TMDB secret reaches steps only through env, and no script prints it', () => {
    const uses = leaves(wf).filter((l) => /secrets\.TMDB_API_KEY\b/.test(l.value));
    expect(uses.length).toBeGreaterThan(0);
    // Every occurrence is the value of an `env:` mapping entry: [..., 'env', NAME].
    const notEnv = uses.filter((l) => l.path[l.path.length - 2] !== 'env').map((l) => l.path.join('.'));
    expect(notEnv).toEqual([]);

    // The env names the secret is bound to, plus its own name.
    const names = new Set(['TMDB_API_KEY', ...uses.map((l) => String(l.path[l.path.length - 1]))]);
    const printed = [];
    for (const [id, job] of Object.entries(jobs)) {
      for (const script of scripts(job)) {
        expect(script).not.toMatch(/secrets\./);
        for (const line of script.split('\n')) {
          for (const name of names) {
            const ref = new RegExp(`\\$\\{?${name}\\b`);
            if (/\b(echo|printf|cat)\b/.test(line) && ref.test(line)) printed.push(`${id}: ${line.trim()}`);
          }
        }
      }
    }
    expect(printed).toEqual([]);
  });

  test('4. the key job gates tmdb and both device jobs; device jobs also need tmdb', () => {
    expect(jobs.key && jobs.key.outputs && jobs.key.outputs.has_key).toBeTruthy();
    for (const id of ['tmdb', ...DEVICE_JOBS]) {
      const job = jobs[id];
      expect(job).toBeDefined();
      expect(asList(job.needs || [])).toContain('key');
      expect(String(job.if || '')).toMatch(/needs\.key\.outputs\.has_key/);
    }
    for (const id of DEVICE_JOBS) expect(asList(jobs[id].needs)).toContain('tmdb');
  });

  test('5. both device jobs replay $SCENARIOS, which resolves to every shipped scenario', () => {
    expect(env.APP_DIR).toBe('showcase-app');
    const shipped = fs
      .readdirSync(path.join(REPO_ROOT, SCENARIO_DIR))
      .filter((f) => f.endsWith('.json'))
      .map((f) => `${SCENARIO_DIR}/${f}`)
      .sort();
    expect(shipped.length).toBeGreaterThanOrEqual(1);
    expect(resolveGlob(env.APP_DIR, String(env.SCENARIOS))).toEqual(shipped);

    for (const id of DEVICE_JOBS) {
      const call = scripts(jobs[id]).find((s) => s.includes('ci/replay.sh'));
      expect(call).toBeDefined();
      // Unquoted, so the shell expands the glob into one argument per scenario.
      expect(call).toMatch(/ci\/replay\.sh\b.*\s\$\{?SCENARIOS\}?(\s|$)/);
    }
  });

  test('6. replay.sh runs mauto run with --device and --junit', () => {
    const sh = read(REPLAY_SH);
    expect(sh).toMatch(/^mauto="\$\{MAUTO:-mauto\}"$/m);
    const run = sh.split('\n').find((l) => /"\$mauto" run\b/.test(l));
    expect(run).toBeDefined();
    expect(run).toMatch(/\s--device\s/);
    expect(run).toMatch(/\s--junit\s/);
  });

  test('7. each device job uploads its artifacts with if: always()', () => {
    for (const id of DEVICE_JOBS) {
      const uploads = (jobs[id].steps || []).filter((s) => /^actions\/upload-artifact@/.test(String(s.uses || '')));
      expect(uploads.length).toBeGreaterThan(0);
      for (const s of uploads) expect(isAlways(s.if)).toBe(true);
    }
  });

  test("8. tmdb-check.sh's discover and search parameters and vote floor equal the Kotlin client's", () => {
    const sh = read(TMDB_CHECK);
    const kt = read(FILTER_STATE);

    const query = /fun toDiscoverQuery\(\)[\s\S]*?\n {4}\}\n/.exec(kt);
    expect(query).not.toBeNull();
    const ktKeys = new Set([...query[0].matchAll(/put\("([^"]+)"/g)].map((m) => m[1]));

    // Each `tmdb discover/movie` call with its backslash-continued "name=value" args.
    const calls = [...sh.matchAll(/^tmdb discover\/movie((?:[^\n]*\\\n)*[^\n]*)$/gm)];
    expect(calls.length).toBeGreaterThan(0);
    const shKeys = new Set(calls.flatMap((c) => [...c[1].matchAll(/"([^"=]+)=/g)].map((m) => m[1])));

    expect(ktKeys.size).toBeGreaterThan(0);
    expect([...shKeys].sort()).toEqual([...ktKeys].sort());

    // search/movie: every call sends exactly the names KtorTmdbClient.searchMovies does.
    const search = /fun searchMovies\([\s\S]*?call\("search\/movie", params = \{([\s\S]*?)\n\s*\}\)/.exec(
      read(TMDB_CLIENT),
    );
    expect(search).not.toBeNull();
    const ktSearch = [...search[1].matchAll(/parameter\("([^"]+)"/g)].map((m) => m[1]).sort();
    expect(ktSearch.length).toBeGreaterThan(0);
    const searchCalls = [...sh.matchAll(/^tmdb search\/movie (.*)$/gm)];
    expect(searchCalls.length).toBeGreaterThan(0);
    for (const c of searchCalls) {
      const names = c[1].trim().split(/\s+/).map((arg) => arg.replace(/^"/, '').split('=')[0]).sort();
      expect(names).toEqual(ktSearch);
    }

    const ktVotes = /const val MIN_VOTES_FOR_RATING = (\d+)/.exec(kt);
    const shVotes = /readonly MIN_VOTES_FOR_RATING=(\d+)/m.exec(sh);
    expect(ktVotes && shVotes).toBeTruthy();
    expect(shVotes[1]).toBe(ktVotes[1]);
  });

  test('9. mauto installs from npm at MAUTO_VERSION, never from a packed tarball', () => {
    expect(env.MAUTO_VERSION).toBeTruthy();
    for (const id of DEVICE_JOBS) {
      const all = scripts(jobs[id]);
      expect(all.some((s) => /npm i(nstall)? -g "?mobile-automator@\$\{?MAUTO_VERSION\}?"?/.test(s))).toBe(true);
      expect(all.filter((s) => /npm pack|\.tgz\b/.test(s))).toEqual([]);
    }
  });

  test('10. each device job resolves its id with ci/device-id.sh, and no script parses mauto devices itself', () => {
    for (const id of DEVICE_JOBS) {
      const platform = DEVICE_JOB_PLATFORM[id];
      const lines = scripts(jobs[id]).flatMap((s) => s.split('\n'));
      expect(lines.some((l) => new RegExp(`\\bci/device-id\\.sh ${platform}\\b`).test(l))).toBe(true);
    }
    const parsing = Object.entries(jobs).flatMap(([id, job]) =>
      scripts(job)
        .filter((s) => /\bmauto devices\b/.test(s) && /\bjq\b/.test(s))
        .map((s) => `${id}: ${s.trim().split('\n')[0]}`),
    );
    expect(parsing).toEqual([]);
  });

  test("11. replay.sh's exit-code labels equal mauto's EXIT codes", () => {
    const sh = read(REPLAY_SH);
    // Each case arm: a numeric label line, then the `class=<name>;` it sets.
    const arms = Object.fromEntries(
      [...sh.matchAll(/^\s*(\d+)\)\s*\n\s*class=(passed|failed|needs_agent);/gm)].map((m) => [m[2], Number(m[1])]),
    );
    expect(arms).toEqual({ passed: EXIT.OK, failed: EXIT.TEST_FAILED, needs_agent: EXIT.INCOMPLETE });
  });

  test('12. no annotation title contains a comma', () => {
    const titles = [];
    for (const file of [WORKFLOW, REPLAY_SH, TMDB_CHECK, DEVICE_ID_SH]) {
      const text = read(file);
      for (const m of text.matchAll(/::(error|warning|notice) title=([^:]*)::/g)) titles.push({ file, title: m[2] });
      // replay.sh builds its annotation from a `title="…"` variable.
      for (const m of text.matchAll(/\btitle="([^"]*)"/g)) titles.push({ file, title: m[1] });
    }
    expect(titles.length).toBeGreaterThan(0);
    expect(titles.some((t) => t.title === '$title')).toBe(true);
    expect(titles.filter((t) => t.title.includes(','))).toEqual([]);
  });
});
