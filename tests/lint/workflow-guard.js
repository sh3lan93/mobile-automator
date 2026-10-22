'use strict';

// The shared helpers for every CI-wiring guard that parses a workflow file.
//
// #161 gave supply-chain-gate.test.js a `load()`, a `runs()` and a
// find-the-gate-step; #164 copied them into eslint-gate.test.js under new
// names; #186 was about to copy them a third time into release-gate.test.js.
// Three hand-maintained copies is the exact threshold at which the three doc
// corpora had already diverged before docs-corpus.js (#162) collapsed them —
// a guard's helpers are as much a drift surface as its corpus. The
// workflow-parsing guards (supply-chain, ESLint, release) consume this module;
// a fourth one does not grow another private copy.
//
// Pure functions only, no jest globals in here, so the module stays
// test-runner-agnostic the same way docs-corpus.js is.

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { REPO_ROOT } = require('./docs-corpus');

/**
 * Parse a YAML file at a repo-root-relative path — a workflow, dependabot
 * config, whatever the guards pin.
 *
 * @param {string} rel
 */
function loadWorkflow(rel) {
  return yaml.load(fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8'));
}

/**
 * A list of steps' `run` commands in job order, `''` for steps that have none
 * (`uses:` steps), so indexOf/findIndex reasoning works on a flat array.
 *
 * @param {object[]} steps
 * @returns {string[]}
 */
function runs(steps) {
  return (steps || []).filter(Boolean).map((s) => s.run || '');
}

/**
 * The step that runs exactly this command. Throws rather than returning
 * undefined, so a removed step fails the test with a named cause instead of a
 * TypeError one frame further from the real problem.
 *
 * @param {object[]} steps
 * @param {string} run
 */
function findStep(steps, run) {
  const step = (steps || []).filter(Boolean).find((s) => s.run === run);
  if (!step) throw new Error(`no step with run: "${run}" found`);
  return step;
}

/**
 * The job that owns a step running exactly this command. A job-level
 * `continue-on-error` or `if:` neutralises every step in it without touching
 * the step itself, so both levels must be checked against the same target.
 *
 * @param {object} jobs
 * @param {string} run
 */
function findJobWithRun(jobs, run) {
  const job = Object.values(jobs || {}).find((j) => (j.steps || []).some((s) => s.run === run));
  if (!job) throw new Error(`no job with a step running "${run}" found`);
  return job;
}

/**
 * `needs:` accepts a single job id or a list; normalise to the list.
 *
 * @param {string|string[]} needs
 * @returns {string[]}
 */
function asList(needs) {
  return Array.isArray(needs) ? needs : [needs];
}

module.exports = { loadWorkflow, runs, findStep, findJobWithRun, asList };
