// tests/lint/required-checks.test.js
//
// #249: the `main-branch` ruleset requires a fixed list of status-check names,
// and the ruleset lives outside git. The list it is applied from lives in
// .github/required-checks.json (JSON, so no comments there — the reasons are
// here). A required name that no job can report blocks every PR forever, and
// nothing on GitHub's side warns about it: the check just sits at "Expected —
// waiting for status". So this guard pins every name to exactly one real job,
// and a renamed job or a changed matrix fails the build instead of the ruleset.
//
// The file's other two keys are the ruleset's, mirrored so the apply recipe in
// CLAUDE.md can read them straight from git: `integration_id` 15368 is the
// GitHub Actions app (read off real check runs) — without it any app or token
// could post a passing status under the same name — and `strict` is
// require-branch-up-to-date.
//
// Name-matching is necessary but not sufficient, because a required check can
// also be satisfied without the work running:
//   - a workflow-level `paths`/`paths-ignore` filter means no check run is
//     ever created on an unrelated PR, so the check stays pending forever —
//     unlike a job-level `if:` skip, which GitHub counts as success;
//   - a job a required job `needs` that fails makes the dependent *skipped*,
//     and skipped satisfies a required check — `Verify version is bumped`
//     needs `Detect CLI code changes`, so that one must be required too;
//   - a job-level `continue-on-error` lets a failure report as success.
// Each is a small pure predicate below, fed both the real workflows and a
// synthetic one that must fail, so the guard is proven to bite.
const fs = require('fs');
const path = require('path');
const { loadWorkflow, asList, expandJobNames, findProducer } = require('./workflow-guard');

const { REPO_ROOT } = require('./docs-corpus');

const REQUIRED_FILE = '.github/required-checks.json';
const GITHUB_ACTIONS_APP_ID = 15368;
const RULESET_ID = '13197042';

const required = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, REQUIRED_FILE), 'utf8'));

const workflowFiles = fs
  .readdirSync(path.join(REPO_ROOT, '.github/workflows'))
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .map((f) => `.github/workflows/${f}`);
const workflows = workflowFiles.map((file) => ({ file, wf: loadWorkflow(file) }));

// --- pure predicates -------------------------------------------------------

/**
 * `on:` may be a bare event name, a list of them, or a map of event → config.
 * Normalise to the map so every caller reads `triggers(wf).pull_request`.
 */
function triggers(wf) {
  const on = wf.on;
  if (typeof on === 'string') return { [on]: null };
  if (Array.isArray(on)) return Object.fromEntries(on.map((e) => [e, null]));
  if (on && typeof on === 'object') return on;
  throw new Error('workflow has no `on:` map (a YAML 1.1 parser would read it as `true`)');
}

/**
 * Why this workflow can fail to report a check on a PR into main. `[]` means
 * it always creates its check runs there.
 */
function prTriggerProblems(wf) {
  const t = triggers(wf);
  if (!('pull_request' in t)) return ['does not trigger on pull_request'];
  const pr = t.pull_request || {};
  const problems = [];
  if (pr.branches && !asList(pr.branches).includes('main')) {
    problems.push('pull_request.branches excludes main');
  }
  if (pr['branches-ignore'] && asList(pr['branches-ignore']).includes('main')) {
    problems.push('pull_request.branches-ignore names main');
  }
  for (const key of ['paths', 'paths-ignore']) {
    if (pr[key]) problems.push(`pull_request has a \`${key}\` filter — no check run on unmatched PRs`);
  }
  return problems;
}

/**
 * The workflows that can report a check run on a PR: those with a
 * `pull_request` trigger. A tag- or push-only workflow cannot satisfy a
 * required check, so its jobs are not searched — and a matrix there that
 * expandJobNames refuses cannot break this guard. Path-filtered PR workflows
 * stay in: a same-named job there could satisfy the check on some PRs.
 */
function prWorkflows(wfs) {
  return wfs.filter(({ wf }) => 'pull_request' in triggers(wf));
}

/** The transitive `needs:` of a job, by id. Throws on a dangling id. */
function needsClosure(jobs, id, seen = new Set()) {
  const job = jobs[id];
  if (!job) throw new Error(`needs names job "${id}", which does not exist`);
  for (const dep of job.needs == null ? [] : asList(job.needs)) {
    if (seen.has(dep)) continue;
    seen.add(dep);
    needsClosure(jobs, dep, seen);
  }
  return seen;
}

/**
 * Names produced by a job's needed jobs that are not themselves required. A
 * failing unrequired dependency skips the dependent, and skipped passes.
 */
function closureProblems(jobs, id, requiredNames) {
  return [...needsClosure(jobs, id)].flatMap((dep) =>
    expandJobNames(jobs[dep], dep)
      .filter((n) => !requiredNames.includes(n))
      .map((n) => `needs "${dep}", whose check "${n}" is not required`),
  );
}

/** Anything but absent/false at job level can turn a failure into success. */
function continueOnErrorProblems(job) {
  const coe = job['continue-on-error'];
  return coe === undefined || coe === false ? [] : [`job-level continue-on-error: ${coe}`];
}

// --- the guard -------------------------------------------------------------

describe(`${REQUIRED_FILE} shape (#249)`, () => {
  test('integration_id is the GitHub Actions app', () => {
    expect(required.integration_id).toBe(GITHUB_ACTIONS_APP_ID);
  });

  test('strict (branch must be up to date) is on', () => {
    expect(required.strict).toBe(true);
  });

  test('checks is a non-empty list of unique names', () => {
    expect(Array.isArray(required.checks)).toBe(true);
    expect(required.checks.length).toBeGreaterThan(0);
    expect(new Set(required.checks).size).toBe(required.checks.length);
  });
});

describe('every required check is reportable on every PR into main (#249)', () => {
  // js-yaml's default schema is YAML 1.2 core, where `on` is a plain string.
  // A YAML 1.1 parser reads it as boolean `true`, and every trigger check
  // below would then pass vacuously over an empty map.
  test.each(workflowFiles)('%s: `on` parses as the key "on"', (file) => {
    const wf = loadWorkflow(file);
    expect(wf).toHaveProperty('on');
    expect(wf).not.toHaveProperty('true');
  });

  describe.each(required.checks)('%s', (name) => {
    // Filtered inside each test, not at load: triggers() throws on a workflow
    // with no `on:` map, and that should fail the test above, not the suite.
    const producer = () => findProducer(prWorkflows(workflows), name);

    // findProducer throws a named error unless exactly one job reports the
    // name, so each test below fails on its own cause rather than a
    // TypeError from destructuring an empty list (#249).
    test('is produced by exactly one job across the PR-triggered workflows', () => {
      expect(producer).not.toThrow();
    });

    test('its workflow runs on every pull_request into main', () => {
      const { wf } = producer();
      expect(prTriggerProblems(wf)).toEqual([]);
    });

    test('every job in its transitive needs is itself required', () => {
      const { wf, id } = producer();
      expect(closureProblems(wf.jobs, id, required.checks)).toEqual([]);
    });

    test('its job has no job-level continue-on-error', () => {
      const { job } = producer();
      expect(continueOnErrorProblems(job)).toEqual([]);
    });
  });

  // The ruleset is outside git; CLAUDE.md is where the `gh api` call that
  // applies this file to it is recorded.
  test('CLAUDE.md records how the list is applied to the ruleset', () => {
    const claude = fs.readFileSync(path.join(REPO_ROOT, 'CLAUDE.md'), 'utf8');
    expect(claude).toContain(REQUIRED_FILE);
    expect(claude).toContain(`rulesets/${RULESET_ID}`);
  });
});

describe('the predicates bite (#249)', () => {
  const job = (name, extra = {}) => ({ name, 'runs-on': 'ubuntu-latest', steps: [], ...extra });

  test('triggers() accepts string, list and map forms', () => {
    expect(triggers({ on: 'pull_request' })).toHaveProperty('pull_request');
    expect(triggers({ on: ['push', 'pull_request'] })).toHaveProperty('pull_request');
    expect(triggers({ on: { pull_request: null } })).toHaveProperty('pull_request');
    expect(() => triggers({ true: { pull_request: null } })).toThrow(/no `on:`/);
  });

  test('prTriggerProblems flags a missing pull_request trigger', () => {
    expect(prTriggerProblems({ on: { push: { branches: ['main'] } } })).toEqual([
      'does not trigger on pull_request',
    ]);
  });

  test('prTriggerProblems flags a paths and a paths-ignore filter', () => {
    expect(prTriggerProblems({ on: { pull_request: { paths: ['src/**'] } } })).toHaveLength(1);
    expect(prTriggerProblems({ on: { pull_request: { 'paths-ignore': ['docs/**'] } } })).toHaveLength(1);
  });

  test('prTriggerProblems flags a branch filter that leaves main out', () => {
    expect(prTriggerProblems({ on: { pull_request: { branches: ['develop'] } } })).toHaveLength(1);
    expect(prTriggerProblems({ on: { pull_request: { 'branches-ignore': ['main'] } } })).toHaveLength(1);
  });

  test('prTriggerProblems accepts no filter and a filter naming main', () => {
    expect(prTriggerProblems({ on: 'pull_request' })).toEqual([]);
    expect(prTriggerProblems({ on: { pull_request: { branches: ['main'] } } })).toEqual([]);
  });

  describe('findProducer', () => {
    const wfs = [
      { file: 'a.yml', wf: { jobs: { a: job('Same'), solo: job('Solo') } } },
      { file: 'b.yml', wf: { jobs: { b: job('Same') } } },
    ];

    test('returns the one producer with its already-loaded workflow and job', () => {
      const found = findProducer(wfs, 'Solo');
      expect(found).toEqual({ file: 'a.yml', id: 'solo', wf: wfs[0].wf, job: wfs[0].wf.jobs.solo });
      expect(found.wf).toBe(wfs[0].wf);
    });

    test('throws a named error when no job reports the name', () => {
      expect(() => findProducer(wfs, 'Renamed')).toThrow(/no job .*"Renamed"/);
    });

    test('throws a named error listing every producer when two jobs report it', () => {
      expect(() => findProducer(wfs, 'Same')).toThrow(/2 jobs .*"Same".*a\.yml#a.*b\.yml#b/);
    });
  });

  // A tag-only workflow cannot report a check on a PR, so a matrix there that
  // expandJobNames refuses (release.yml's verify gaining an `include`) must
  // not break the producer search.
  test('prWorkflows drops a non-PR workflow, even one with an unexpandable job', () => {
    const wfs = [
      {
        file: 'release.yml',
        wf: {
          on: { push: { tags: ['v*'] } },
          jobs: { verify: job('V (${{ matrix.v }})', { strategy: { matrix: { v: [1], include: [{ v: 2 }] } } }) },
        },
      },
      { file: 'test.yml', wf: { on: { pull_request: { branches: ['main'] } }, jobs: { t: job('X') } } },
      { file: 'docs.yml', wf: { on: { pull_request: { paths: ['docs/**'] } }, jobs: { d: job('Y') } } },
    ];
    expect(() => findProducer(wfs, 'X')).toThrow(/matrix include/);
    expect(prWorkflows(wfs).map((w) => w.file)).toEqual(['test.yml', 'docs.yml']);
    expect(findProducer(prWorkflows(wfs), 'X')).toMatchObject({ file: 'test.yml', id: 't' });
  });

  test('closureProblems flags an unrequired job anywhere in the transitive needs', () => {
    const jobs = {
      root: job('Root'),
      mid: job('Mid', { needs: 'root' }),
      leaf: job('Leaf', { needs: ['mid'] }),
    };
    expect(closureProblems(jobs, 'leaf', ['Leaf', 'Mid', 'Root'])).toEqual([]);
    expect(closureProblems(jobs, 'leaf', ['Leaf', 'Mid'])).toEqual([
      'needs "root", whose check "Root" is not required',
    ]);
  });

  test('needsClosure throws on a dangling needs id', () => {
    expect(() => needsClosure({ a: job('A', { needs: 'gone' }) }, 'a')).toThrow(/"gone"/);
  });

  test('continueOnErrorProblems flags true and an expression', () => {
    expect(continueOnErrorProblems(job('X', { 'continue-on-error': true }))).toHaveLength(1);
    expect(continueOnErrorProblems(job('X', { 'continue-on-error': '${{ matrix.x }}' }))).toHaveLength(1);
    expect(continueOnErrorProblems(job('X', { 'continue-on-error': false }))).toEqual([]);
    expect(continueOnErrorProblems(job('X'))).toEqual([]);
  });
});

describe('expandJobNames (#249)', () => {
  test('a plain name is the one check-run name', () => {
    expect(expandJobNames({ name: 'ESLint' }, 'lint')).toEqual(['ESLint']);
  });

  test('a job with no name reports under its id', () => {
    expect(expandJobNames({}, 'deploy')).toEqual(['deploy']);
  });

  test('matrix references expand over the cartesian product', () => {
    const job = {
      name: 'T (${{ matrix.os }}, Node ${{matrix.node-version}})',
      strategy: { matrix: { os: ['linux', 'mac'], 'node-version': [22, 24] } },
    };
    expect(expandJobNames(job, 't')).toEqual([
      'T (linux, Node 22)',
      'T (linux, Node 24)',
      'T (mac, Node 22)',
      'T (mac, Node 24)',
    ]);
  });

  test.each(['include', 'exclude'])('a matrix with %s throws', (key) => {
    const job = {
      name: 'T (${{ matrix.v }})',
      strategy: { matrix: { v: [1, 2], [key]: [{ v: 3 }] } },
    };
    expect(() => expandJobNames(job, 't')).toThrow(new RegExp(key));
  });

  test('a referenced matrix key that is absent throws', () => {
    const job = { name: 'T (${{ matrix.v }})', strategy: { matrix: { w: [1] } } };
    expect(() => expandJobNames(job, 't')).toThrow(/matrix\.v/);
    expect(() => expandJobNames({ name: 'T (${{ matrix.v }})' }, 't')).toThrow(/matrix\.v/);
  });

  test('a referenced matrix key that is not a scalar array throws', () => {
    const job = { name: 'T (${{ matrix.v }})', strategy: { matrix: { v: '${{ fromJSON(x) }}' } } };
    expect(() => expandJobNames(job, 't')).toThrow(/matrix\.v/);
    const objs = { name: 'T (${{ matrix.v }})', strategy: { matrix: { v: [{ a: 1 }] } } };
    expect(() => expandJobNames(objs, 't')).toThrow(/matrix\.v/);
  });

  test('a whole-matrix expression throws', () => {
    const job = { name: 'T', strategy: { matrix: '${{ fromJSON(needs.a.outputs.m) }}' } };
    expect(() => expandJobNames(job, 't')).toThrow(/matrix/);
  });

  // GitHub appends the values of unreferenced matrix keys to the name —
  // `T (22)` — which is exactly the kind of name this guard exists to keep
  // spelled out rather than inferred.
  test('a matrix key the name does not reference throws', () => {
    const job = { name: 'T', strategy: { matrix: { v: [1, 2] } } };
    expect(() => expandJobNames(job, 't')).toThrow(/matrix key "v"/);
  });

  test('any other expression in the name throws', () => {
    expect(() => expandJobNames({ name: 'T ${{ github.ref }}' }, 't')).toThrow(/github\.ref/);
    const job = { name: "T ${{ matrix.v || 'x' }}", strategy: { matrix: { v: [1] } } };
    expect(() => expandJobNames(job, 't')).toThrow(/matrix\.v \|\| 'x'/);
  });
});
