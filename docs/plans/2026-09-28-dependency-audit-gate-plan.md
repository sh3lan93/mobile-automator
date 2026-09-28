# Dependency Audit Gate Implementation Plan (#161)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear every high-severity production advisory that can be cleared without moving the mobile-mcp pin. Explicitly accept the rest with a rationale that expires. Make CI and the publish job fail on any new high/critical production advisory, and have Dependabot surface fixes as PRs.

**Architecture:** A dependency-free Node script, `scripts/audit-gate.js`, runs `npm audit --omit=dev --json` and evaluates the report against a checked-in allowlist, `scripts/audit-allowlist.json`. It fails on unaccepted, expired or *stale* entries, the same "fail on drift" idea as the action and capability catalogs. It runs in a new `audit.yml` workflow (PR, push to main, weekly schedule) and in `release.yml`'s `publish-npm` job before `npm publish`, which is the only real gate (the repo has no required status checks). Dependabot is configured `lockfile-only` so its PRs never touch `package.json` and never trip the version-bump gate.

**Tech Stack:** Node ≥20 (CommonJS, `child_process.spawnSync`), jest 29, js-yaml (existing devDependency) for workflow-shape lint, GitHub Actions, Dependabot v2 config.

**Spec:** GitHub issue #161 (acceptance criteria) + gate issue #168. The analysis and split were approved in-session on 2026-09-28: this PR covers the gate, the lockfile refresh and Dependabot. The mobile-mcp 1.x migration goes to a new follow-up issue.

## Global Constraints

- Branch: `fix/161-dependency-audit-gate` (already renamed; do not use the Orca branch name).
- **No change to `package.json`.** This keeps the PR outside the version-bump gate (`src/**`, `bin/**`, `package.json`). The gate is invoked as `node scripts/audit-gate.js`, not through an npm script.
- No new dependencies (prod or dev).
- The `@mobilenext/mobile-mcp` pin stays at `0.0.55` in this PR.
- The audit scope is production deps only: `npm audit --omit=dev`.
- Blocking severities: `high`, `critical`. Moderate/low are reported, never blocking.
- Workflow `node-version` literals must be ≥ the `engines.node` floor (20). Use `'22'`, which `tests/lint/node-version-agreement.test.js` already accepts in `release.yml`.
- `package-lock.json` root must stay in sync with `package.json` (`tests/lint/lockfile-in-sync.test.js`).
- PR body: `Closes #161` on its own line; `Refs #168` (never `Closes` the gate issue).
- Subagents start at the repo root: `cd /Users/mohamedshalan/orca/workspaces/mobile-automator/security-7-high-severity-advisories-in-productio` and verify `git branch --show-current` = `fix/161-dependency-audit-gate` before any commit.

## Current state (measured 2026-09-28)

`npm audit --omit=dev`: 11 vulns (7 high, 3 moderate, 1 low). A dry-run `npm audit fix` clears ws, fast-uri, ip-address, hono, @hono/node-server, qs and body-parser. What remains is one chain:

```
@mobilenext/mobile-mcp@0.0.55 → mobilewright@0.0.37 → @mobilewright/core@0.0.37 → sharp@0.34.5
  GHSA-f88m-g3jw-g9cj  (libvips CVEs)   high
  GHSA-rgj7-g3m4-5g8c  (libheif)        high
```

Every mobile-mcp 0.0.x release is affected; the first fixed release is `1.0.5`. That version changes the `mobile_list_elements_on_screen` default output to `format: "text"`, which breaks `mauto elements`. So the migration is a separate issue.

## Review Focus

1. **`npm audit` cannot reach the registry** (offline runner, registry outage). It prints `{"error":{...}}` or nothing. Expected: the gate exits **2** with a clear message. It must never exit 0.
2. **`npm audit` exits 1 because vulnerabilities exist** (its normal behaviour). Expected: the gate still parses stdout and evaluates it. A non-zero exit is not a crash.
3. **The sharp fix lands and nobody removes the allowlist entry.** Expected: the gate fails and names the stale GHSA, so accepted risk can't outlive its reason.
4. **The allowlist entry passes its `expires` date with the chain still vulnerable.** Expected: the gate fails and names the expired entry, forcing a re-decision.
5. **A malformed allowlist** (missing `reason`, a bad GHSA id, a non-ISO date). Expected: the gate exits 2. It must not silently treat the entry as absent, which would turn an accept into a block with a confusing message, or worse, the other way round.

Tests for each are in Task 2.

---

### Task 1: File the mobile-mcp 1.x follow-up issue

The allowlist must cite a real issue number, so this goes first. It's an outward-facing action, authorized by the approved split.

**Files:** none (GitHub only)

**Interfaces:**
- Produces: issue number `<MIGRATION_ISSUE>`, used in Task 2's allowlist, Task 3's dependabot comment and Task 4's docs.

- [ ] **Step 1: Create the issue**

```bash
gh issue create --milestone production-ready --label bug \
  --title "Migrate to @mobilenext/mobile-mcp 1.x (clears sharp advisories accepted in #161)" \
  --body "$(cat <<'EOF'
## Problem

#161 cleared every production advisory reachable without moving the mobile-mcp pin. What remains is one chain, accepted in `scripts/audit-allowlist.json` with an expiry:

```
@mobilenext/mobile-mcp@0.0.55 → mobilewright@0.0.37 → @mobilewright/core@0.0.37 → sharp@0.34.5
  GHSA-f88m-g3jw-g9cj (libvips), GHSA-rgj7-g3m4-5g8c (libheif) — high
```

Every 0.0.x release (0.0.55–0.0.62) is affected. The first clean release is `1.0.5`.

## What changes in 1.0.5 (tarball diff, 2026-09-28)

- ✅ All 16 `mobile_*` tools `src/` calls still exist; parameter changes are additive (`ref`, `format`, `maxSize`, `scale`).
- ✅ The `parseToolResult` sentinel `". Please fix the issue and try again."` is unchanged.
- ✅ `bin` (`mcp-server-mobile → lib/index.js`) and `engines.node >=20` are unchanged.
- ❌ `mobile_list_elements_on_screen` now defaults to `format: "text"`. The elements path must pass `format: "json"`, and the JSON element shape must be re-verified against `ElementModel`.
- ⚠️ The robot layer moved from mobilewright 0.0.37 to 0.0.60 ("legacy robot mode" exists). Only a real device can verify this.

## Fix

- Pin `@mobilenext/mobile-mcp@1.0.5`; pass `format: "json"` on the elements call; re-verify element parsing and error handling.
- Remove both sharp entries from `scripts/audit-allowlist.json`. The audit gate's stale-entry check makes this mandatory.
- Drop the Dependabot `ignore` on mobile-mcp semver-major.

## Acceptance criteria

- [ ] `node scripts/audit-gate.js` passes with an empty allowlist.
- [ ] Real-device path re-verified (see #94).

Refs #161
Refs #168
EOF
)"
```

- [ ] **Step 2: Record the number.** Substitute it for every `<MIGRATION_ISSUE>` below before dispatching Task 2.

---

### Task 2: `audit-gate` script, allowlist, and unit tests (TDD)

**Files:**
- Create: `scripts/audit-gate.js`
- Create: `scripts/audit-allowlist.json`
- Test: `tests/unit/audit-gate.test.js`

**Interfaces:**
- Produces (`module.exports` of `scripts/audit-gate.js`):
  - `ghsaOf(url: string) → string | null`
  - `collectAdvisories(report: object) → Array<{id, package, severity, title, url}>`. Throws if `report.error` is set or `report.vulnerabilities` is not an object.
  - `validateAllowlist(list: unknown) → Array<{ghsa, package, reason, issue, expires}>`. Throws on any invalid entry.
  - `evaluate(report, allowlist, today: 'YYYY-MM-DD') → {ok, unaccepted, accepted, expired, stale}`
  - `runAudit(spawn = spawnSync) → object` (the parsed report). Throws on spawn error, empty stdout or unparseable JSON.
  - `main({ spawn, allowlistPath, today, log }) → exit code 0 | 1 | 2`
- Exit codes: `0` clean, `1` policy failure (unaccepted, expired or stale), `2` could not evaluate (fail closed).

- [ ] **Step 1: Write the failing tests**

```js
// tests/unit/audit-gate.test.js
const {
  ghsaOf, collectAdvisories, validateAllowlist, evaluate, runAudit, main,
} = require('../../scripts/audit-gate');

const SHARP_A = 'GHSA-f88m-g3jw-g9cj';
const SHARP_B = 'GHSA-rgj7-g3m4-5g8c';

function advisory(ghsa, severity, name = 'sharp') {
  return { source: 1, name, dependency: name, title: `${name} vuln`,
    url: `https://github.com/advisories/${ghsa}`, severity };
}

// Mirrors npm audit v2 JSON: root advisories are objects in `via`;
// packages that merely depend on a vulnerable one carry string `via`s.
function report(...advisories) {
  const vulnerabilities = {};
  for (const a of advisories) {
    const v = vulnerabilities[a.name] ||= { name: a.name, severity: a.severity, via: [] };
    v.via.push(a);
  }
  vulnerabilities['@mobilenext/mobile-mcp'] = { name: '@mobilenext/mobile-mcp', severity: 'high', via: ['mobilewright'] };
  return { auditReportVersion: 2, vulnerabilities };
}

const entry = (ghsa, over = {}) => ({
  ghsa, package: 'sharp', reason: 'processes device-produced screenshots only',
  issue: 999, expires: '2026-12-27', ...over,
});

describe('ghsaOf', () => {
  test('extracts the id from an advisory url', () => {
    expect(ghsaOf(`https://github.com/advisories/${SHARP_A}`)).toBe(SHARP_A);
  });
  test('returns null when there is no GHSA id', () => {
    expect(ghsaOf('https://example.com/x')).toBeNull();
    expect(ghsaOf(undefined)).toBeNull();
  });
});

describe('collectAdvisories', () => {
  test('collects object vias and ignores inherited string vias', () => {
    const ids = collectAdvisories(report(advisory(SHARP_A, 'high'))).map((a) => a.id);
    expect(ids).toEqual([SHARP_A]);
  });
  test('de-duplicates an advisory reported under several packages', () => {
    const r = report(advisory(SHARP_A, 'high'));
    r.vulnerabilities.other = { name: 'other', severity: 'high', via: [advisory(SHARP_A, 'high')] };
    expect(collectAdvisories(r)).toHaveLength(1);
  });
  test('throws on an npm error payload (registry unreachable)', () => {
    expect(() => collectAdvisories({ error: { code: 'ENOTFOUND', summary: 'x' } })).toThrow(/ENOTFOUND|error/i);
  });
  test('throws when vulnerabilities is missing', () => {
    expect(() => collectAdvisories({})).toThrow(/vulnerabilities/);
  });
});

describe('validateAllowlist', () => {
  test('accepts well-formed entries', () => {
    expect(validateAllowlist([entry(SHARP_A)])).toHaveLength(1);
  });
  test.each([
    ['missing reason', entry(SHARP_A, { reason: '' })],
    ['bad ghsa', entry('CVE-2026-1', {})],
    ['non-integer issue', entry(SHARP_A, { issue: '999' })],
    ['non-ISO expiry', entry(SHARP_A, { expires: '12/27/2026' })],
  ])('rejects %s', (_label, bad) => {
    expect(() => validateAllowlist([bad])).toThrow();
  });
  test('rejects a non-array', () => {
    expect(() => validateAllowlist({})).toThrow(/array/);
  });
  test('rejects duplicate ghsa ids', () => {
    expect(() => validateAllowlist([entry(SHARP_A), entry(SHARP_A)])).toThrow(/duplicate/i);
  });
});

describe('evaluate', () => {
  const today = '2026-09-28';

  test('passes when there are no blocking advisories', () => {
    const r = evaluate(report(advisory('GHSA-aaaa-bbbb-cccc', 'moderate', 'qs')), [], today);
    expect(r.ok).toBe(true);
  });
  test('fails on an unaccepted high advisory', () => {
    const r = evaluate(report(advisory('GHSA-aaaa-bbbb-cccc', 'high', 'ws')), [], today);
    expect(r.ok).toBe(false);
    expect(r.unaccepted.map((a) => a.id)).toEqual(['GHSA-aaaa-bbbb-cccc']);
  });
  test('fails on an unaccepted critical advisory', () => {
    expect(evaluate(report(advisory('GHSA-aaaa-bbbb-cccc', 'critical', 'ws')), [], today).ok).toBe(false);
  });
  test('passes when every blocking advisory is accepted and unexpired', () => {
    const r = evaluate(report(advisory(SHARP_A, 'high'), advisory(SHARP_B, 'high')),
      [entry(SHARP_A), entry(SHARP_B)], today);
    expect(r.ok).toBe(true);
    expect(r.accepted).toHaveLength(2);
  });
  test('an entry expiring today is still valid', () => {
    expect(evaluate(report(advisory(SHARP_A, 'high')), [entry(SHARP_A, { expires: today })], today).ok).toBe(true);
  });
  test('fails on an expired acceptance', () => {
    const r = evaluate(report(advisory(SHARP_A, 'high')), [entry(SHARP_A, { expires: '2026-09-27' })], today);
    expect(r.ok).toBe(false);
    expect(r.expired.map((a) => a.id)).toEqual([SHARP_A]);
  });
  test('fails on a stale entry whose advisory is no longer reported', () => {
    const r = evaluate(report(), [entry(SHARP_A)], today);
    expect(r.ok).toBe(false);
    expect(r.stale.map((e) => e.ghsa)).toEqual([SHARP_A]);
  });
  test('an entry whose advisory dropped below high is stale', () => {
    const r = evaluate(report(advisory(SHARP_A, 'moderate')), [entry(SHARP_A)], today);
    expect(r.stale.map((e) => e.ghsa)).toEqual([SHARP_A]);
  });
});

describe('runAudit', () => {
  const spawnReturning = (stdout, extra = {}) => jest.fn(() => ({ status: 1, stdout, stderr: '', ...extra }));

  test('parses stdout even though npm audit exits 1 when vulnerabilities exist', () => {
    const spawn = spawnReturning(JSON.stringify(report()));
    expect(runAudit(spawn).auditReportVersion).toBe(2);
    expect(spawn).toHaveBeenCalledWith('npm', ['audit', '--omit=dev', '--json'], expect.any(Object));
  });
  test('throws when npm could not be spawned', () => {
    expect(() => runAudit(spawnReturning('', { error: new Error('ENOENT') }))).toThrow(/ENOENT/);
  });
  test('throws on empty stdout', () => {
    expect(() => runAudit(spawnReturning(''))).toThrow(/no output/i);
  });
  test('throws on non-JSON stdout', () => {
    expect(() => runAudit(spawnReturning('npm ERR! network'))).toThrow(/JSON/);
  });
});

describe('main', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const writeList = (list) => {
    const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'audit-gate-')), 'allow.json');
    fs.writeFileSync(p, JSON.stringify(list));
    return p;
  };
  const spawnOf = (r) => () => ({ status: 1, stdout: JSON.stringify(r), stderr: '' });
  const log = () => {};

  test('exits 0 when clean', () => {
    expect(main({ spawn: spawnOf(report()), allowlistPath: writeList([]), today: '2026-09-28', log })).toBe(0);
  });
  test('exits 1 on a policy failure', () => {
    const r = report(advisory('GHSA-aaaa-bbbb-cccc', 'high', 'ws'));
    expect(main({ spawn: spawnOf(r), allowlistPath: writeList([]), today: '2026-09-28', log })).toBe(1);
  });
  test('exits 2 (fail closed) when the registry is unreachable', () => {
    const spawn = spawnOf({ error: { code: 'ENOTFOUND', summary: 'getaddrinfo ENOTFOUND' } });
    expect(main({ spawn, allowlistPath: writeList([]), today: '2026-09-28', log })).toBe(2);
  });
  test('exits 2 on a malformed allowlist', () => {
    const p = writeList([{ ghsa: SHARP_A }]);
    expect(main({ spawn: spawnOf(report()), allowlistPath: p, today: '2026-09-28', log })).toBe(2);
  });
});

describe('the checked-in allowlist', () => {
  test('is valid', () => {
    expect(() => validateAllowlist(require('../../scripts/audit-allowlist.json'))).not.toThrow();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/unit/audit-gate.test.js`
Expected: FAIL with `Cannot find module '../../scripts/audit-gate'`

- [ ] **Step 3: Write the implementation**

```js
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

function collectAdvisories(report) {
  if (report && report.error) {
    const e = report.error;
    throw new Error(`npm audit failed: ${e.code || ''} ${e.summary || JSON.stringify(e)}`.trim());
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
```

`scripts/audit-allowlist.json` (substitute the Task 1 issue number):

```json
[
  {
    "ghsa": "GHSA-f88m-g3jw-g9cj",
    "package": "sharp",
    "reason": "sharp@0.34.5 (libvips CVEs) arrives only via @mobilenext/mobile-mcp@0.0.55 -> mobilewright -> @mobilewright/core; every 0.0.x mobile-mcp is affected and 1.0.5 changes the elements output format. sharp decodes screenshots produced by the user's own device, not untrusted network input.",
    "issue": <MIGRATION_ISSUE>,
    "expires": "2026-12-27"
  },
  {
    "ghsa": "GHSA-rgj7-g3m4-5g8c",
    "package": "sharp",
    "reason": "sharp@0.34.5 (libheif) — same path and exposure as GHSA-f88m-g3jw-g9cj.",
    "issue": <MIGRATION_ISSUE>,
    "expires": "2026-12-27"
  }
]
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/unit/audit-gate.test.js`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
chmod +x scripts/audit-gate.js
git add scripts/audit-gate.js scripts/audit-allowlist.json tests/unit/audit-gate.test.js
git commit -m "feat(ci): production-dependency audit gate with expiring allowlist (#161)"
```

---

### Task 3: Refresh the lockfile and prove the gate passes on the real tree

**Files:**
- Modify: `package-lock.json`

**Interfaces:**
- Consumes: `node scripts/audit-gate.js` from Task 2.

- [ ] **Step 1: Show the gate failing on the current lockfile**

Run: `node scripts/audit-gate.js; echo "exit=$?"`
Expected: `BLOCKING` lines for ws, fast-uri and ip-address GHSAs, `accepted` for the two sharp GHSAs, `exit=1`.

- [ ] **Step 2: Apply the non-breaking fixes (production tree only, lockfile only)**

Run: `npm audit fix --omit=dev --package-lock-only`
Then: `git diff --stat package-lock.json`. Expect only transitive bumps (ws, fast-uri, ip-address, hono, @hono/node-server, qs, body-parser) and no change to the root `packages[""]` entry. Stop and report if `@mobilenext/mobile-mcp` changes version.

- [ ] **Step 3: Reinstall from the lockfile and run the full suite**

Run: `npm ci && npm test`
Expected: all suites pass, including `tests/lint/lockfile-in-sync.test.js`.

- [ ] **Step 4: Show the gate passing**

Run: `node scripts/audit-gate.js; echo "exit=$?"`
Expected: two `accepted` sharp lines, `audit-gate: ok`, `exit=0`.

- [ ] **Step 5: Commit**

```bash
git add package-lock.json
git commit -m "fix(deps): clear ws, fast-uri and ip-address advisories via lockfile refresh (#161)"
```

---

### Task 4: Wire the gate into CI and publish, configure Dependabot, guard the wiring

**Files:**
- Create: `.github/workflows/audit.yml`
- Modify: `.github/workflows/release.yml` (the `publish-npm` job, between `npm ci` and `npm test`)
- Create: `.github/dependabot.yml`
- Test: `tests/lint/supply-chain-gate.test.js`

**Interfaces:**
- Consumes: `scripts/audit-gate.js` (invoked as `node scripts/audit-gate.js`).

- [ ] **Step 1: Write the failing lint test**

```js
// tests/lint/supply-chain-gate.test.js
//
// #161: the audit gate and Dependabot are only worth anything while they stay
// wired in. This guard fails the build if either is quietly removed.
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const root = path.join(__dirname, '..', '..');
const load = (rel) => yaml.load(fs.readFileSync(path.join(root, rel), 'utf8'));
const GATE = 'node scripts/audit-gate.js';
const runs = (steps) => steps.map((s) => s.run || '');

describe('supply-chain gate wiring (#161)', () => {
  test('audit.yml runs the gate on PRs, pushes to main, and a schedule', () => {
    const wf = load('.github/workflows/audit.yml');
    // js-yaml parses the bare `on` key as boolean true.
    const on = wf.on || wf[true];
    expect(on).toHaveProperty('pull_request');
    expect(on).toHaveProperty('push');
    expect(on).toHaveProperty('schedule');
    const steps = Object.values(wf.jobs).flatMap((j) => j.steps);
    expect(runs(steps)).toContain(GATE);
  });

  test('publish-npm runs the gate before npm publish', () => {
    const steps = load('.github/workflows/release.yml').jobs['publish-npm'].steps;
    const r = runs(steps);
    const gate = r.indexOf(GATE);
    const publish = r.findIndex((cmd) => cmd.startsWith('npm publish'));
    expect(gate).toBeGreaterThan(-1);
    expect(publish).toBeGreaterThan(gate);
  });

  test('dependabot covers npm (lockfile-only) and github-actions', () => {
    const { updates } = load('.github/dependabot.yml');
    const npm = updates.find((u) => u['package-ecosystem'] === 'npm');
    expect(npm).toBeDefined();
    expect(npm.directory).toBe('/');
    // lockfile-only keeps Dependabot PRs out of the version-bump gate, which
    // fails any PR touching package.json without a version bump.
    expect(npm['versioning-strategy']).toBe('lockfile-only');
    expect(updates.some((u) => u['package-ecosystem'] === 'github-actions')).toBe(true);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx jest tests/lint/supply-chain-gate.test.js`
Expected: FAIL with `ENOENT ... audit.yml`

- [ ] **Step 3: Create `.github/workflows/audit.yml`**

```yaml
name: Dependency Audit

# #161: fail on any high/critical advisory in production dependencies that is
# not explicitly accepted in scripts/audit-allowlist.json. The schedule is the
# point — advisories are published against code that has not changed, so a
# PR-only trigger would never see them. This workflow is a signal, not a gate
# (the repo has no required status checks); the gate is the same script in
# release.yml's publish-npm job.

on:
  pull_request:
    branches: [main]
  push:
    branches: [main]
  schedule:
    - cron: '0 6 * * 1'
  workflow_dispatch:

permissions:
  contents: read

jobs:
  audit:
    name: Production dependency audit
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '22'
      # npm audit reads the lockfile; no install is needed.
      - run: node scripts/audit-gate.js
```

- [ ] **Step 4: Add the gate to `publish-npm` in `.github/workflows/release.yml`**

Insert between `- run: npm ci` and `- run: npm test`:

```yaml
      - run: npm ci
      # #161: refuse to publish over an unaccepted high/critical production
      # advisory. This is the only enforcing run of the audit gate — the
      # Dependency Audit workflow is a PR signal, and nothing requires it.
      - run: node scripts/audit-gate.js
      - run: npm test
```

- [ ] **Step 5: Create `.github/dependabot.yml`** (substitute the Task 1 issue number)

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    # Lockfile-only: Dependabot PRs never touch package.json, so they stay out
    # of the version-bump gate. Nothing is lost for users — the lockfile is not
    # published, and our caret ranges already resolve fresh on install.
    versioning-strategy: lockfile-only
    open-pull-requests-limit: 5
    groups:
      production:
        dependency-type: production
        update-types: [minor, patch]
      development:
        dependency-type: development
    ignore:
      # 1.x changes the mobile_list_elements_on_screen default format and
      # needs a real-device re-verification — tracked in #<MIGRATION_ISSUE>.
      - dependency-name: '@mobilenext/mobile-mcp'
        update-types: ['version-update:semver-major']

  - package-ecosystem: github-actions
    directory: /
    schedule:
      interval: weekly
```

- [ ] **Step 6: Run the new guard and the whole lint suite**

Run: `npx jest tests/lint/supply-chain-gate.test.js && npm run lint:guides`
Expected: PASS, including `node-version-agreement.test.js` (new literal `'22'` ≥ floor 20).

- [ ] **Step 7: Commit**

```bash
git add .github/workflows/audit.yml .github/workflows/release.yml .github/dependabot.yml tests/lint/supply-chain-gate.test.js
git commit -m "ci: run the audit gate on PRs, weekly and before publish; add Dependabot (#161)"
```

---

### Task 5: Docs — CHANGELOG and CLAUDE.md

**Files:**
- Modify: `CHANGELOG.md` (under `## [Unreleased]`)
- Modify: `CLAUDE.md` (the "Drift guards" section; the "Known rough edges" list)

- [ ] **Step 1: CHANGELOG.** Add a section under `## [Unreleased]`, after the existing subsections:

```markdown
### 🔒 Security

- Cleared the `ws`, `fast-uri` and `ip-address` high-severity advisories (and
  the moderate `hono`, `@hono/node-server`, `qs`, `body-parser` ones) in
  production dependencies with a lockfile refresh (#161).
- New production-dependency audit gate, `scripts/audit-gate.js`: fails on any
  high/critical advisory not accepted in `scripts/audit-allowlist.json`, on an
  expired acceptance, and on a stale one. It runs on every PR, weekly, and in
  `publish-npm` before `npm publish`. It fails closed when `npm audit` cannot
  reach the registry.
- Accepted until 2026-12-27: two `sharp` advisories reachable only through the
  `@mobilenext/mobile-mcp@0.0.55` pin; removal tracked in #<MIGRATION_ISSUE>.
- Dependabot now opens weekly lockfile-only npm PRs and GitHub Actions PRs.
```

- [ ] **Step 2: CLAUDE.md drift guards.** Add this paragraph after the `package-lock.json` paragraph:

```markdown
**Production-dependency advisories** (#161) are gated by `scripts/audit-gate.js`, which runs `npm audit --omit=dev` and fails on any high/critical advisory not listed in `scripts/audit-allowlist.json`. Every allowlist entry carries a reason, the issue that removes it, and an `expires` date. An expired entry fails, and so does a *stale* one (its advisory is no longer reported), so accepted risk can't outlive its reason. It runs in `audit.yml` (PR, main, weekly — a signal) and in `release.yml`'s `publish-npm` before `npm publish` (the actual gate). Wiring guard: `tests/lint/supply-chain-gate.test.js`. Dependabot is `lockfile-only` on purpose: a `package.json` change would trip the version-bump gate, and users resolve our ranges fresh anyway.
```

- [ ] **Step 3: CLAUDE.md rough edges.** Delete the line `- Production dependencies carry high-severity advisories; no audit gate, no Dependabot — #161.`

- [ ] **Step 4: Run the doc guards**

Run: `npm run lint:guides`
Expected: PASS (`docs-counts`, `docs-no-stale-extension`, `node-version-agreement` scan CLAUDE.md).

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md CLAUDE.md
git commit -m "docs: document the audit gate and the accepted sharp advisories (#161)"
```

---

### Task 6: Verify, push, open the draft PR

- [ ] **Step 1: Full verification (show the output)**

```bash
npm ci && npm test && npm run lint:guides && ./scripts/pack-smoke.sh && node scripts/audit-gate.js
```

Expected: all green, and the gate prints `audit-gate: ok` with exactly two `accepted` sharp lines.

- [ ] **Step 2: Confirm the PR stays outside the version gate**

Run: `git diff --name-only main... | grep -E '^(src/|bin/|package\.json$)' || echo "outside version gate"`
Expected: `outside version gate`

- [ ] **Step 3: Push and open the draft PR**

```bash
git push -u origin fix/161-dependency-audit-gate
gh pr create --draft --base main --title "fix(deps): production audit gate, lockfile refresh, Dependabot (#161)" --body "$(cat <<'EOF'
## What

- Lockfile refresh clears 5 of the 7 high advisories (`ws`, `fast-uri`, `ip-address`) plus the moderate/low ones.
- `scripts/audit-gate.js` + `scripts/audit-allowlist.json`: fails on any unaccepted, expired or stale high/critical production advisory; fails closed when `npm audit` can't run.
- Wired into a new `audit.yml` (PR, main, weekly) and into `publish-npm` before `npm publish`.
- `.github/dependabot.yml`: npm (lockfile-only) + github-actions, weekly.
- Lint guard `tests/lint/supply-chain-gate.test.js` keeps the wiring from being quietly removed.

## Why

The remaining 2 highs are `sharp`, reachable only through `@mobilenext/mobile-mcp@0.0.55`. Every 0.0.x release is affected, and 1.0.5 changes the elements output format, so they are accepted with a rationale and an expiry (2026-12-27). The migration is tracked in #<MIGRATION_ISSUE>.

Two design notes:
- **The lockfile is not published.** Users resolve our ranges fresh, so the lockfile audit is a CI proxy. That is also why Dependabot is lockfile-only: a `package.json` change would trip the version-bump gate without shipping anything different to users.
- **`audit.yml` is a signal, not a gate.** The repo has no required status checks, so the enforcing run is the one in `publish-npm`.

No `src/`, `bin/` or `package.json` change, so no version bump.

## Test plan

- [x] `tests/unit/audit-gate.test.js`: severity filtering, dedup, allowlist validation, expiry, stale entries, fail-closed on registry error / empty / non-JSON output.
- [x] `tests/lint/supply-chain-gate.test.js`: workflow + Dependabot wiring.
- [x] `npm test`, `npm run lint:guides`, `./scripts/pack-smoke.sh`, `node scripts/audit-gate.js` all green locally.
- [ ] `Dependency Audit` workflow green on this PR.
- [ ] After merge: Dependabot opens its first PRs.

Closes #161
Refs #168

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Out of scope

- The mobile-mcp 1.x migration (Task 1 files it).
- Turning on required status checks (a separate repo-settings decision; see the CI-gates note on #186).
- Auditing dev dependencies. They never reach users, and Dependabot's grouped dev PRs cover them.
