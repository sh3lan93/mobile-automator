#!/usr/bin/env node
'use strict';

// Apply .github/required-checks.json to the main-branch ruleset (#249).
//
// The ruleset lives outside git, so the JSON is the whole policy — repo,
// ruleset id, enforcement, the GitHub Actions integration_id, strict,
// approvals, bypass actors and the required check names — and this is the one
// thing that writes it. It replaced a jq recipe in CLAUDE.md: the part that actually
// rewrote the live ruleset was the one part nothing tested.
//
//   node scripts/apply-ruleset.js           dry run: GET, print the PUT body
//   node scripts/apply-ruleset.js --apply   PUT it, re-GET, verify (admin)
//
//   exit 0  printed / applied and verified
//   exit 1  applied, but the re-fetched ruleset does not match the policy
//   exit 2  could not run: bad arguments, bad policy, or gh failed
//
// A PUT replaces the whole ruleset, so the body is always built from a fresh
// GET: every rule the policy does not own (deletion, non_fast_forward, the
// pull_request rule's other parameters) is carried over as GitHub has it.
// tests/lint/required-checks.test.js reads the policy through loadPolicy, so
// the guard and the applier share one parser.

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { isDeepStrictEqual } = require('util');

const DEFAULT_POLICY = path.join(__dirname, '..', '.github', 'required-checks.json');
const KEYS = [
  'repo',
  'ruleset_id',
  'enforcement',
  'integration_id',
  'strict',
  'required_approving_review_count',
  'bypass_actors',
  'checks',
];

// The policy owns enforcement rather than carrying the live value over: the
// escape hatch is disabling the ruleset, and copying `disabled` through would
// let `--apply` report "applied and verified" while nothing is enforced.
const ENFORCEMENTS = ['active', 'evaluate', 'disabled'];

// Everything here came from JSON, so a JSON round trip is a full copy. Not
// structuredClone: under jest it returns host-realm arrays, which
// isDeepStrictEqual (prototype-aware) then refuses to equate with `[]`.
const copy = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** Parse and validate the policy file's text. Throws a named error. */
function loadPolicy(text) {
  let p;
  try {
    p = JSON.parse(text);
  } catch (err) {
    throw new Error(`required-checks policy is not JSON: ${err.message}`);
  }
  const fail = (msg) => {
    throw new Error(`required-checks policy: ${msg}`);
  };
  if (!p || typeof p !== 'object' || Array.isArray(p)) fail('must be a JSON object');
  for (const key of Object.keys(p)) {
    if (!KEYS.includes(key)) fail(`unknown key "${key}"`);
  }
  if (typeof p.repo !== 'string' || !/^[\w.-]+\/[\w.-]+$/.test(p.repo)) fail('"repo" must be "owner/name"');
  for (const key of ['ruleset_id', 'integration_id']) {
    if (!Number.isInteger(p[key]) || p[key] <= 0) fail(`"${key}" must be a positive integer`);
  }
  if (!ENFORCEMENTS.includes(p.enforcement)) fail(`"enforcement" must be one of ${ENFORCEMENTS.join(', ')}`);
  if (typeof p.strict !== 'boolean') fail('"strict" must be a boolean');
  const count = p.required_approving_review_count;
  if (!Number.isInteger(count) || count < 0) fail('"required_approving_review_count" must be a non-negative integer');
  if (!Array.isArray(p.bypass_actors)) fail('"bypass_actors" must be an array');
  if (!Array.isArray(p.checks) || p.checks.length === 0) fail('"checks" must be a non-empty array');
  const seen = new Set();
  for (const name of p.checks) {
    if (typeof name !== 'string' || !name.trim()) fail(`"checks" holds a non-name: ${JSON.stringify(name)}`);
    if (seen.has(name)) fail(`"checks" has a duplicate: "${name}"`);
    seen.add(name);
  }
  return p;
}

/**
 * The PUT body: the fetched ruleset's identity and conditions, the policy's
 * enforcement and bypass actors, and its rules with the policy's approvals and one
 * required_status_checks rule (any existing one is replaced, not doubled).
 * Read-only GET fields (id, source, _links, …) are dropped. Idempotent.
 */
function buildRuleset(current, policy) {
  if (!current || !Array.isArray(current.rules)) throw new Error('fetched ruleset has no "rules" array');
  if (!current.rules.some((r) => r.type === 'pull_request')) {
    throw new Error('fetched ruleset has no pull_request rule to set required_approving_review_count on');
  }
  const rules = copy(current.rules)
    .filter((r) => r.type !== 'required_status_checks')
    .map((r) =>
      r.type === 'pull_request'
        ? {
            ...r,
            parameters: {
              ...r.parameters,
              required_approving_review_count: policy.required_approving_review_count,
            },
          }
        : r,
    );
  rules.push({
    type: 'required_status_checks',
    parameters: {
      strict_required_status_checks_policy: policy.strict,
      do_not_enforce_on_create: false,
      required_status_checks: policy.checks.map((context) => ({
        context,
        integration_id: policy.integration_id,
      })),
    },
  });
  return {
    name: current.name,
    target: current.target,
    enforcement: policy.enforcement,
    conditions: copy(current.conditions),
    bypass_actors: copy(policy.bypass_actors),
    rules,
  };
}

/** Where a fetched ruleset differs from the policy. `[]` means applied. */
function verifyApplied(after, policy) {
  const problems = [];
  const rules = (after && after.rules) || [];
  if (after.enforcement !== policy.enforcement) {
    problems.push(`enforcement is ${after.enforcement}, policy wants ${policy.enforcement}`);
  }
  if (!isDeepStrictEqual(after.bypass_actors, policy.bypass_actors)) {
    problems.push(
      `bypass_actors is ${JSON.stringify(after.bypass_actors)}, policy wants ${JSON.stringify(policy.bypass_actors)}`,
    );
  }

  const pr = rules.find((r) => r.type === 'pull_request');
  if (!pr) problems.push('no pull_request rule');
  else {
    const count = (pr.parameters || {}).required_approving_review_count;
    if (count !== policy.required_approving_review_count) {
      problems.push(
        `required_approving_review_count is ${count}, policy wants ${policy.required_approving_review_count}`,
      );
    }
  }

  const status = rules.filter((r) => r.type === 'required_status_checks');
  if (status.length !== 1) {
    problems.push(`expected 1 required_status_checks rule, found ${status.length}`);
    return problems;
  }
  const params = status[0].parameters || {};
  if (params.strict_required_status_checks_policy !== policy.strict) {
    problems.push(`strict_required_status_checks_policy is ${params.strict_required_status_checks_policy}, policy wants ${policy.strict}`);
  }
  if (params.do_not_enforce_on_create !== false) {
    problems.push(`do_not_enforce_on_create is ${params.do_not_enforce_on_create}, want false`);
  }
  const live = params.required_status_checks || [];
  const contexts = live.map((c) => c.context);
  for (const name of policy.checks) {
    if (!contexts.includes(name)) problems.push(`missing required check "${name}"`);
  }
  for (const c of live) {
    if (!policy.checks.includes(c.context)) problems.push(`extra required check "${c.context}"`);
    else if (c.integration_id !== policy.integration_id) {
      problems.push(`check "${c.context}" has integration_id ${c.integration_id}, policy wants ${policy.integration_id}`);
    }
  }
  if (new Set(contexts).size !== contexts.length) problems.push('a required check is listed twice');
  return problems;
}

/** Run gh with args as an array (never a shell string). Returns stdout. */
function gh(spawn, args, input) {
  const res = spawn('gh', args, {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    ...(input === undefined ? {} : { input }),
  });
  if (res.error) throw new Error(`could not run gh: ${res.error.message}`);
  if (res.status !== 0) {
    throw new Error(`gh ${args.join(' ')} exited ${res.status}: ${(res.stderr || '').trim()}`);
  }
  return res.stdout || '';
}

function getRuleset(spawn, endpoint) {
  const out = gh(spawn, ['api', endpoint]);
  try {
    return JSON.parse(out);
  } catch {
    throw new Error(`gh api ${endpoint} did not return JSON: ${out.slice(0, 200)}`);
  }
}

function main({
  argv = process.argv.slice(2),
  spawn = spawnSync,
  readFile = (p) => fs.readFileSync(p, 'utf8'),
  policyPath = DEFAULT_POLICY,
  log = console.log,
} = {}) {
  const unknown = argv.filter((a) => a !== '--apply');
  if (unknown.length) {
    log(`apply-ruleset: unknown argument ${unknown.join(' ')}; usage: apply-ruleset.js [--apply]`);
    return 2;
  }
  const apply = argv.includes('--apply');
  try {
    const policy = loadPolicy(readFile(policyPath));
    const endpoint = `repos/${policy.repo}/rulesets/${policy.ruleset_id}`;
    const current = getRuleset(spawn, endpoint);
    const body = buildRuleset(current, policy);

    if (!apply) {
      log(JSON.stringify(body, null, 2));
      const drift = verifyApplied(current, policy);
      if (drift.length === 0) log('apply-ruleset: dry run; the live ruleset already matches the policy');
      else {
        for (const d of drift) log(`would change: ${d}`);
        log('apply-ruleset: dry run; pass --apply (needs admin) to PUT the body above');
      }
      return 0;
    }

    gh(spawn, ['api', '--method', 'PUT', endpoint, '--input', '-'], JSON.stringify(body));
    const problems = verifyApplied(getRuleset(spawn, endpoint), policy);
    for (const p of problems) log(`MISMATCH  ${p}`);
    log(problems.length === 0 ? 'apply-ruleset: applied and verified' : 'apply-ruleset: FAILED verification');
    return problems.length === 0 ? 0 : 1;
  } catch (err) {
    log(`apply-ruleset: ${err.message}`);
    return 2;
  }
}

if (require.main === module) process.exitCode = main();

module.exports = { loadPolicy, buildRuleset, verifyApplied, main };
