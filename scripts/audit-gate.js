#!/usr/bin/env node
'use strict';

// Production-dependency audit gate (#161).
//
// Runs `npm audit --omit=dev --json` and fails on any high/critical advisory
// that is not explicitly accepted in scripts/audit-allowlist.json. An accepted
// advisory carries a reason, the issue that will remove it, and an expiry, so
// accepted risk cannot quietly become permanent:
//
//   exit 0  clean
//   exit 1  policy failure: unaccepted, expired, or stale allowlist entry
//   exit 2  could not evaluate (registry unreachable, bad JSON, bad allowlist)
//
// Exit 2 exists so the gate fails closed: "could not audit" must never read
// as "nothing to report". A stale entry (its advisory is no longer reported)
// fails for the same reason the action and capability catalogs do — the
// allowlist is a claim about the dependency tree and must stay true.
//
// Note what this does and does not protect: `files` ships no lockfile, so
// users resolve our ranges fresh on install. The lockfile audit is the CI
// proxy; a pinned or capped range is what actually reaches a user's machine.

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BLOCKING = new Set(['high', 'critical']);
const GHSA_RE = /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/;
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_ALLOWLIST = path.join(__dirname, 'audit-allowlist.json');

function ghsaOf(url) {
  const m = GHSA_RE.exec(url || '');
  return m ? m[0] : null;
}

// Registry-failure reasons come from npm in a shape that has moved: real npm
// (10 and 11) puts the reason in the TOP-LEVEL `message` field and leaves
// error.summary/detail blank, while an older/legacy shape carries it under
// error.{code,summary,detail}. Take the first non-empty of those, in that
// order, so neither shape produces the empty `{"summary":"","detail":""}`
// message this used to print.
const TRANSIENT_REGISTRY_RE = /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|EAI_AGAIN|ECONNRESET|request to /;

function auditFailureMessage(report) {
  const e = report.error || {};
  const reason = report.message || e.summary || e.detail || e.code || JSON.stringify(e);
  const hint = TRANSIENT_REGISTRY_RE.test(reason)
    ? ' — this is usually a transient registry failure; re-run the job.'
    : '';
  return `npm audit failed: ${reason}${hint}`;
}

function collectAdvisories(report) {
  if (report && (report.error || report.message)) {
    throw new Error(auditFailureMessage(report));
  }
  if (!report || typeof report.vulnerabilities !== 'object' || report.vulnerabilities === null) {
    throw new Error('npm audit report has no "vulnerabilities" object');
  }
  const byId = new Map();
  for (const [pkg, vuln] of Object.entries(report.vulnerabilities)) {
    for (const via of vuln.via || []) {
      // A string via means "vulnerable because it depends on <via>"; the root
      // advisory is reported as an object under that package instead.
      if (typeof via !== 'object' || via === null) continue;
      const id = ghsaOf(via.url) || `npm-advisory-${via.source}`;
      if (!byId.has(id)) {
        byId.set(id, { id, package: via.name || pkg, severity: via.severity, title: via.title, url: via.url });
      }
    }
  }
  return [...byId.values()];
}

function validateAllowlist(list) {
  if (!Array.isArray(list)) throw new Error('audit allowlist must be a JSON array');
  const seen = new Set();
  list.forEach((e, i) => {
    const where = `audit allowlist entry ${i}`;
    if (!e || typeof e !== 'object') throw new Error(`${where} is not an object`);
    if (typeof e.ghsa !== 'string' || ghsaOf(e.ghsa) !== e.ghsa) throw new Error(`${where}: "ghsa" must be a GHSA id`);
    if (seen.has(e.ghsa)) throw new Error(`${where}: duplicate ghsa ${e.ghsa}`);
    seen.add(e.ghsa);
    for (const key of ['package', 'reason']) {
      if (typeof e[key] !== 'string' || !e[key].trim()) throw new Error(`${where}: "${key}" is required`);
    }
    if (!Number.isInteger(e.issue) || e.issue <= 0) throw new Error(`${where}: "issue" must be an issue number`);
    if (typeof e.expires !== 'string' || !ISO_DATE_RE.test(e.expires)) {
      throw new Error(`${where}: "expires" must be YYYY-MM-DD`);
    }
  });
  return list;
}

function evaluate(report, allowlist, today) {
  const blocking = collectAdvisories(report).filter((a) => BLOCKING.has(a.severity));
  const byGhsa = new Map(allowlist.map((e) => [e.ghsa, e]));
  const unaccepted = [];
  const accepted = [];
  const expired = [];
  for (const a of blocking) {
    const entry = byGhsa.get(a.id);
    if (!entry) unaccepted.push(a);
    // ISO dates compare correctly as strings; the expiry day itself is valid.
    else if (entry.expires < today) expired.push({ ...a, entry });
    else accepted.push({ ...a, entry });
  }
  const reported = new Set(blocking.map((a) => a.id));
  const stale = allowlist.filter((e) => !reported.has(e.ghsa));
  const ok = unaccepted.length === 0 && expired.length === 0 && stale.length === 0;
  return { ok, unaccepted, accepted, expired, stale };
}

function runAudit(spawn = spawnSync) {
  // npm audit exits 1 whenever it finds anything, so the status is ignored and
  // stdout is the only signal.
  const res = spawn('npm', ['audit', '--omit=dev', '--json'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (res.error) throw new Error(`could not run npm audit: ${res.error.message}`);
  const out = (res.stdout || '').trim();
  if (!out) throw new Error(`npm audit produced no output (exit ${res.status}): ${(res.stderr || '').trim()}`);
  try {
    return JSON.parse(out);
  } catch {
    throw new Error(`npm audit output is not JSON: ${out.slice(0, 200)}`);
  }
}

function line(a) {
  return `${a.id} ${a.severity} in ${a.package}: ${a.title}`;
}

function main({
  spawn = spawnSync,
  allowlistPath = DEFAULT_ALLOWLIST,
  today = new Date().toISOString().slice(0, 10),
  log = console.log,
} = {}) {
  let result;
  try {
    const allowlist = validateAllowlist(JSON.parse(fs.readFileSync(allowlistPath, 'utf8')));
    result = evaluate(runAudit(spawn), allowlist, today);
  } catch (err) {
    log(`audit-gate: cannot evaluate — failing closed. ${err.message}`);
    return 2;
  }
  for (const a of result.accepted) {
    log(`accepted  ${line(a)} (until ${a.entry.expires}, #${a.entry.issue})`);
  }
  for (const a of result.unaccepted) log(`BLOCKING  ${line(a)} ${a.url}`);
  for (const a of result.expired) {
    log(`EXPIRED   ${line(a)} — acceptance lapsed ${a.entry.expires}; fix it or re-decide (#${a.entry.issue})`);
  }
  for (const e of result.stale) {
    log(`STALE     ${e.ghsa} (${e.package}) is no longer reported — remove it from scripts/audit-allowlist.json`);
  }
  log(result.ok ? 'audit-gate: ok' : 'audit-gate: FAILED');
  return result.ok ? 0 : 1;
}

if (require.main === module) process.exitCode = main();

module.exports = { ghsaOf, collectAdvisories, validateAllowlist, evaluate, runAudit, main };
