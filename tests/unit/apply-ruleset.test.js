const fs = require('fs');
const path = require('path');

const { loadPolicy, buildRuleset, verifyApplied, main } = require('../../scripts/apply-ruleset');

// A trimmed GET of the live main-branch ruleset, taken after #249 applied it.
const LIVE = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'ruleset', 'main-branch.json'), 'utf8'),
);

const CHECKS = ['Test (Node 22)', 'ESLint', 'Verify version is bumped'];

const policy = (over = {}) => ({
  repo: 'sh3lan93/mobile-automator',
  ruleset_id: 13197042,
  integration_id: 15368,
  strict: true,
  required_approving_review_count: 0,
  bypass_actors: [],
  checks: CHECKS,
  ...over,
});

const clone = (o) => JSON.parse(JSON.stringify(o));
const statusRule = (rules) => rules.filter((r) => r.type === 'required_status_checks');
const LIVE_CHECKS = statusRule(LIVE.rules)[0].parameters.required_status_checks.map((c) => c.context);

// What the ruleset looked like before #249: one required approval, an admin
// bypass, and no required_status_checks rule at all.
function preApply() {
  const r = clone(LIVE);
  r.rules = r.rules.filter((x) => x.type !== 'required_status_checks');
  r.rules.find((x) => x.type === 'pull_request').parameters.required_approving_review_count = 1;
  r.bypass_actors = [{ actor_id: 5, actor_type: 'RepositoryRole', bypass_mode: 'always' }];
  return r;
}

describe('loadPolicy', () => {
  test('accepts a well-formed policy and the real file', () => {
    expect(loadPolicy(JSON.stringify(policy()))).toEqual(policy());
    const real = fs.readFileSync(path.join(__dirname, '..', '..', '.github', 'required-checks.json'), 'utf8');
    expect(loadPolicy(real).checks.length).toBeGreaterThan(0);
  });

  test('rejects text that is not JSON', () => {
    expect(() => loadPolicy('{')).toThrow(/not JSON/);
  });

  test.each([
    ['repo not owner/name', { repo: 'mobile-automator' }, /"repo"/],
    ['ruleset_id as a string', { ruleset_id: '13197042' }, /"ruleset_id"/],
    ['integration_id not an integer', { integration_id: 15368.5 }, /"integration_id"/],
    ['strict as a string', { strict: 'true' }, /"strict"/],
    ['negative approvals', { required_approving_review_count: -1 }, /"required_approving_review_count"/],
    ['fractional approvals', { required_approving_review_count: 0.5 }, /"required_approving_review_count"/],
    ['bypass_actors not an array', { bypass_actors: null }, /"bypass_actors"/],
    ['checks empty', { checks: [] }, /"checks"/],
    ['checks with a non-string', { checks: ['ESLint', 1] }, /"checks"/],
    ['checks with an empty name', { checks: ['ESLint', ''] }, /"checks"/],
    ['checks with a duplicate', { checks: ['ESLint', 'ESLint'] }, /duplicate.*"ESLint"/],
    ['a misspelled key', { stict: true }, /unknown key "stict"/],
  ])('rejects %s', (_label, over, message) => {
    expect(() => loadPolicy(JSON.stringify(policy(over)))).toThrow(message);
  });

  test('rejects a missing key', () => {
    const p = policy();
    delete p.strict;
    expect(() => loadPolicy(JSON.stringify(p))).toThrow(/"strict"/);
  });

  test('rejects a top level that is not an object', () => {
    expect(() => loadPolicy('[]')).toThrow(/object/);
  });
});

describe('buildRuleset', () => {
  test('the real-shaped pre-#249 ruleset becomes the expected PUT body', () => {
    expect(buildRuleset(preApply(), policy())).toEqual({
      name: 'main-branch',
      target: 'branch',
      enforcement: 'active',
      conditions: { ref_name: { exclude: [], include: ['~DEFAULT_BRANCH'] } },
      bypass_actors: [],
      rules: [
        { type: 'deletion' },
        { type: 'non_fast_forward' },
        {
          type: 'pull_request',
          parameters: {
            required_approving_review_count: 0,
            dismiss_stale_reviews_on_push: true,
            required_reviewers: [],
            require_code_owner_review: false,
            require_last_push_approval: false,
            required_review_thread_resolution: true,
            require_extra_approval_for_unattributed_changes: true,
            allowed_merge_methods: ['merge', 'squash', 'rebase'],
          },
        },
        {
          type: 'required_status_checks',
          parameters: {
            strict_required_status_checks_policy: true,
            do_not_enforce_on_create: false,
            required_status_checks: [
              { context: 'Test (Node 22)', integration_id: 15368 },
              { context: 'ESLint', integration_id: 15368 },
              { context: 'Verify version is bumped', integration_id: 15368 },
            ],
          },
        },
      ],
    });
  });

  test('preserves unrelated rules and their order, and drops read-only GET fields', () => {
    const current = preApply();
    current.rules.splice(1, 0, { type: 'required_linear_history' });
    const body = buildRuleset(current, policy());
    expect(body.rules.map((r) => r.type)).toEqual([
      'deletion',
      'required_linear_history',
      'non_fast_forward',
      'pull_request',
      'required_status_checks',
    ]);
    expect(Object.keys(body)).toEqual(['name', 'target', 'enforcement', 'conditions', 'bypass_actors', 'rules']);
  });

  test('replaces an existing required_status_checks rule rather than duplicating it', () => {
    const body = buildRuleset(LIVE, policy());
    expect(statusRule(body.rules)).toHaveLength(1);
    expect(statusRule(body.rules)[0].parameters.required_status_checks.map((c) => c.context)).toEqual(CHECKS);
  });

  test('sets approvals, strict and bypass_actors from the policy', () => {
    const actors = [{ actor_id: 1, actor_type: 'Integration', bypass_mode: 'pull_request' }];
    const body = buildRuleset(LIVE, policy({ required_approving_review_count: 2, strict: false, bypass_actors: actors }));
    expect(body.rules.find((r) => r.type === 'pull_request').parameters.required_approving_review_count).toBe(2);
    expect(statusRule(body.rules)[0].parameters.strict_required_status_checks_policy).toBe(false);
    expect(body.bypass_actors).toEqual(actors);
  });

  test('throws when there is no pull_request rule', () => {
    const current = clone(LIVE);
    current.rules = current.rules.filter((r) => r.type !== 'pull_request');
    expect(() => buildRuleset(current, policy())).toThrow(/pull_request/);
  });

  test('throws when the ruleset has no rules array', () => {
    expect(() => buildRuleset({ name: 'x' }, policy())).toThrow(/rules/);
  });

  test('does not mutate the fetched ruleset', () => {
    const current = preApply();
    const before = clone(current);
    buildRuleset(current, policy());
    expect(current).toEqual(before);
  });

  test('is idempotent', () => {
    const body = buildRuleset(preApply(), policy());
    expect(buildRuleset(body, policy())).toEqual(body);
  });
});

describe('verifyApplied', () => {
  test('a ruleset the policy was applied to has no mismatches', () => {
    expect(verifyApplied(buildRuleset(preApply(), policy()), policy())).toEqual([]);
  });

  const applied = () => clone(buildRuleset(preApply(), policy()));
  const params = (r) => statusRule(r.rules)[0].parameters;

  test.each([
    ['a bypass actor', (r) => r.bypass_actors.push({ actor_id: 5 }), /bypass_actors/],
    ['missing bypass_actors', (r) => delete r.bypass_actors, /bypass_actors/],
    [
      'an approval count',
      (r) => (r.rules.find((x) => x.type === 'pull_request').parameters.required_approving_review_count = 1),
      /required_approving_review_count/,
    ],
    ['no pull_request rule', (r) => (r.rules = r.rules.filter((x) => x.type !== 'pull_request')), /pull_request/],
    ['no status-check rule', (r) => (r.rules = r.rules.filter((x) => x.type !== 'required_status_checks')), /1 required_status_checks/],
    ['two status-check rules', (r) => r.rules.push(clone(statusRule(r.rules)[0])), /1 required_status_checks/],
    ['strict off', (r) => (params(r).strict_required_status_checks_policy = false), /strict/],
    ['enforce-on-create on', (r) => (params(r).do_not_enforce_on_create = true), /do_not_enforce_on_create/],
    ['a missing check', (r) => params(r).required_status_checks.pop(), /missing.*"Verify version is bumped"/],
    ['an extra check', (r) => params(r).required_status_checks.push({ context: 'Docs', integration_id: 15368 }), /extra.*"Docs"/],
    ['a wrong integration_id', (r) => (params(r).required_status_checks[1].integration_id = 1), /"ESLint".*integration_id 1/],
    ['an absent integration_id', (r) => delete params(r).required_status_checks[1].integration_id, /"ESLint".*integration_id/],
  ])('catches %s', (_label, mutate, message) => {
    const r = applied();
    mutate(r);
    const problems = verifyApplied(r, policy());
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(message);
  });
});

describe('main', () => {
  const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });
  const readFile = () => JSON.stringify(policy());
  const isPut = (args) => args.includes('PUT');

  // A fake gh: GET returns `get` (or each of `gets` in turn), PUT returns `put`.
  function fakeGh({ gets = [preApply()], put = ok('{}') } = {}) {
    const queue = [...gets];
    return jest.fn((cmd, args) => {
      if (isPut(args)) return put;
      return ok(JSON.stringify(queue.length > 1 ? queue.shift() : queue[0]));
    });
  }

  test('a dry run GETs, prints the body it would PUT, and never PUTs', () => {
    const spawn = fakeGh();
    const out = [];
    expect(main({ argv: [], spawn, readFile, log: (l) => out.push(l) })).toBe(0);
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(spawn).toHaveBeenCalledWith('gh', ['api', 'repos/sh3lan93/mobile-automator/rulesets/13197042'], expect.any(Object));
    expect(spawn.mock.calls.some(([, args]) => isPut(args))).toBe(false);
    expect(out.join('\n')).toContain(JSON.stringify(buildRuleset(preApply(), policy()), null, 2));
  });

  test('a dry run reports whether the live ruleset already matches', () => {
    const out = [];
    main({ argv: [], spawn: fakeGh({ gets: [LIVE] }), readFile: () => JSON.stringify(policy({ checks: LIVE_CHECKS })), log: (l) => out.push(l) });
    expect(out.join('\n')).toMatch(/already matches/);
  });

  test('--apply sends PUT with the body on stdin, then re-GETs and verifies', () => {
    const body = buildRuleset(preApply(), policy());
    const spawn = fakeGh({ gets: [preApply(), body] });
    expect(main({ argv: ['--apply'], spawn, readFile, log: () => {} })).toBe(0);
    const calls = spawn.mock.calls.map(([cmd, args]) => [cmd, ...args].join(' '));
    expect(calls).toEqual([
      'gh api repos/sh3lan93/mobile-automator/rulesets/13197042',
      'gh api --method PUT repos/sh3lan93/mobile-automator/rulesets/13197042 --input -',
      'gh api repos/sh3lan93/mobile-automator/rulesets/13197042',
    ]);
    expect(JSON.parse(spawn.mock.calls[1][2].input)).toEqual(body);
  });

  test('--apply returns 1 when the re-fetched ruleset does not match', () => {
    const out = [];
    const spawn = fakeGh({ gets: [preApply(), preApply()] });
    expect(main({ argv: ['--apply'], spawn, readFile, log: (l) => out.push(l) })).toBe(1);
    expect(out.join('\n')).toMatch(/MISMATCH/);
  });

  test('--apply returns 2 and stops when the PUT fails', () => {
    const spawn = fakeGh({ put: { status: 1, stdout: '', stderr: 'HTTP 403: Must have admin rights' } });
    const out = [];
    expect(main({ argv: ['--apply'], spawn, readFile, log: (l) => out.push(l) })).toBe(2);
    expect(spawn).toHaveBeenCalledTimes(2);
    expect(out.join('\n')).toMatch(/403/);
  });

  test('returns 2 when the GET fails or gh cannot be spawned', () => {
    const failing = jest.fn(() => ({ status: 1, stdout: '', stderr: 'HTTP 404' }));
    expect(main({ argv: [], spawn: failing, readFile, log: () => {} })).toBe(2);
    const missing = jest.fn(() => ({ error: new Error('spawn gh ENOENT') }));
    expect(main({ argv: ['--apply'], spawn: missing, readFile, log: () => {} })).toBe(2);
    expect(missing).toHaveBeenCalledTimes(1);
  });

  test('returns 2 on a bad policy or an unknown argument, before calling gh', () => {
    const spawn = fakeGh();
    expect(main({ argv: [], spawn, readFile: () => '{}', log: () => {} })).toBe(2);
    expect(main({ argv: ['--aply'], spawn, readFile, log: () => {} })).toBe(2);
    expect(spawn).not.toHaveBeenCalled();
  });
});
