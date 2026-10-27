# Hidden workspace directory Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `mauto` creates, discovers and uses `.mobile-automator/` instead of `mobile-automator/`, with the name defined once and a legacy folder detected and explained.

**Architecture:** A leaf module `src/workspace/dirname.js` owns both names. Every path-building site imports it; a lint guard forbids any other literal. Discovery reports a legacy folder it passes on the walk, and `noWorkspaceFailure` / `handleSetup` turn that into an `environment` failure with the fix. Prose, schemas, docs and the release metadata follow.

**Tech Stack:** Node (CommonJS), commander, jest.

**Spec:** `docs/plans/2026-10-26-hidden-workspace-design.md`

## Global Constraints

- New name: `.mobile-automator`. Legacy name: `mobile-automator`. Defined only in `src/workspace/dirname.js`.
- No migration code: nothing reads, moves or writes inside a legacy folder; detection is `existsSync` of `<dir>/mobile-automator/config.json` only.
- Never rewrite URLs (`github.com/sh3lan93/mobile-automator`, `sh3lan93.github.io/mobile-automator/`), the npm/package name, bin alias, `mobile-automator-*` skill names, or MCP server names.
- Never edit history: `CHANGELOG.md` past sections, `docs/changelog.md` past sections, `docs/plans/**` (other than this plan and its design).
- Workspace's own `.gitignore` body (`scaffold.js` `GITIGNORE_BODY`) unchanged; no new ignore entries anywhere.
- Version `0.36.1` → `0.37.0` in `package.json` and `package-lock.json` (root + `packages[""]`); CHANGELOG `## [0.37.0]` on top.
- All work in worktree `/Users/mohamedshalan/orca/workspaces/mobile-automator/making-the-directory-hidden`, branch `sh3lan93/making-the-directory-hidden`. Subagents: `cd` there and verify `git branch --show-current` before any commit.
- Every commit message ends with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Started from a subdirectory of a legacy project** (`<proj>/src/x`, `<proj>/mobile-automator/` exists, a `.git` at `<proj>`) — expect the legacy hint naming `<proj>`, not the plain "no workspace" error. Test in Task 2.
2. **Both folders present** (`.mobile-automator/config.json` and `mobile-automator/config.json`) — the new one wins silently; no legacy hint. Test in Task 2.
3. **Legacy folder without `config.json`** (e.g. this repo's own clone named `mobile-automator` sitting above a project) — not treated as legacy. Test in Task 2.
4. **Legacy folder above the `.git` boundary** — the walk stops at `.git`, so an old folder outside the repo is never reported. Test in Task 2.
5. **`setup` where `.mobile-automator/` already exists alongside a legacy folder** — normal idempotent setup, no refusal (the user has already migrated). Test in Task 2.

---

### Task 1: Single source for the directory name + literal guard

**Files:**
- Create: `src/workspace/dirname.js`
- Create: `tests/lint/workspace-dirname-single-source.test.js`
- Modify: `src/workspace/discover.js:19-28`, `src/config/manager.js:13`, `src/device/session-paths.js:40`, `src/memory/paths.js:30,38`, `src/observe/paths.js:24,29`, `src/observe/failure-capture.js:81`, `src/result/store.js:57`, `src/setup/scaffold.js:34`
- Modify: `sample-app/scripts/lib/executor.js:181,267`, `sample-app/scripts/run-e2e.mjs:103` (path uses only — line 65's `pkgName !== 'mobile-automator'` is the package name and stays)
- Modify (tests asserting the old path): every file from `git grep -ln "mobile-automator" -- tests` whose hit is a workspace path, not a URL/package/skill name. Known set: `tests/unit/{cli,cli-envelope-boundary,cli-host-support,cli-observe-project-root,cli-workspace-discovery}.test.js`, `tests/unit/config/manager.test.js`, `tests/unit/device/*.test.js`, `tests/unit/memory/*.test.js`, `tests/unit/observe/*.test.js`, `tests/unit/setup/scaffold.test.js`, `tests/unit/workspace/discover.test.js`, `tests/unit/e2e-harness/*.test.js`, `tests/integration/{cli-observability,cli-smoke,cli-workspace-discovery,session-end-identity,stdout-purity}.test.js`. Leave `tests/fixtures/*_v2.0.json` (frozen historical schemas) and `tests/fixtures/ruleset/*` / `apply-ruleset.test.js` (repo URLs).

**Interfaces:**
- Produces: `src/workspace/dirname.js` exports `{ WORKSPACE_DIRNAME: '.mobile-automator', LEGACY_WORKSPACE_DIRNAME: 'mobile-automator' }`. It requires nothing. `discover.js` re-exports `WORKSPACE_DIRNAME` (existing export kept).

- [ ] **Step 1: Write the failing guard** `tests/lint/workspace-dirname-single-source.test.js`
  - Scans every tracked `*.js`/`*.mjs` under `src/` and `bin/` (via `git ls-files`, like `docs-corpus.js`).
  - Strips `//` line comments and `/* */` blocks, then flags any match of `/['"`]\.?mobile-automator(?:['"`]|\/)/` outside `src/workspace/dirname.js`.
  - Test 1 `no file other than dirname.js spells the workspace directory name`: expect offenders `[]` (message lists `file:line`).
  - Test 2 `the matcher` (pure, on strings): flags `path.join(root, 'mobile-automator')`, `".mobile-automator"`, `` `mobile-automator/results` ``; does **not** flag `'mobile-automator-execute'`, `'https://github.com/sh3lan93/mobile-automator'`, `// mobile-automator/ tree`, `WORKSPACE_DIRNAME`.
  - Test 3 `dirname.js holds both names`: `require('../../src/workspace/dirname')` deep-equals `{ WORKSPACE_DIRNAME: '.mobile-automator', LEGACY_WORKSPACE_DIRNAME: 'mobile-automator' }`.

- [ ] **Step 2: Run it — expect FAIL**
  Run: `npx jest tests/lint/workspace-dirname-single-source.test.js`
  Expected: Test 1 lists the 10 sites in `discover.js`, `manager.js`, `session-paths.js`, `memory/paths.js` (2), `observe/paths.js` (2), `failure-capture.js`, `store.js`, `scaffold.js`; Test 3 fails on missing module.

- [ ] **Step 3: Create `dirname.js` and route all 10 sites through `WORKSPACE_DIRNAME`.** `discover.js` imports it instead of defining it. Update the `discover.js` marker comment: the config.json marker stays because setup always writes it; the clone-name collision it cited no longer applies to a dotted name.

- [ ] **Step 4: Run the guard — expect PASS.** Then run `npm test` and fix every test that asserted the old path (replace the path segment; build paths from `WORKSPACE_DIRNAME` where the test already builds paths with `path.join`). Also update the sample-app harness sites listed above.
  Run: `npm test && npx jest tests/unit/e2e-harness`
  Expected: all green.

- [ ] **Step 5: Commit** — `refactor: define the workspace directory once, as .mobile-automator`

---

### Task 2: Legacy-folder detection in discovery and setup

**Files:**
- Modify: `src/workspace/discover.js` (`findWorkspaceRoot`, `noWorkspaceFailure`, new `legacyWorkspaceFailure`)
- Modify: `src/cli.js` — `handleSetup` (~line 876) and the `noWorkspaceFailure` call (~line 1830)
- Test: `tests/unit/workspace/discover.test.js`, `tests/unit/cli.test.js` (`describe('handleSetup')`), `tests/integration/cli-workspace-discovery.test.js`

**Interfaces:**
- Consumes: `LEGACY_WORKSPACE_DIRNAME`, `WORKSPACE_DIRNAME` from Task 1.
- Produces:
  - `findWorkspaceRoot(startDir, { fs }) -> { root: string|null, searched: string[], legacy: string|null }` — `legacy` is the nearest searched dir holding `mobile-automator/config.json`, recorded only while walking; returned non-null only when `root` is null.
  - `legacyMarkerPath(dir) -> string` (`<dir>/mobile-automator/config.json`).
  - `noWorkspaceFailure(searched, legacy = null) -> { envelope, exitKind: 'environment' }` — unchanged shape when `legacy` is null; delegates to `legacyWorkspaceFailure(legacy)` otherwise.
  - `legacyWorkspaceFailure(dir) -> { envelope, exitKind: 'environment' }`.

Exact copy (spec §3):
- error: `` found legacy workspace ${dir}/mobile-automator/ — the workspace directory is now .mobile-automator/ ``
- hint: `` In ${dir}: stop any daemon the old version left running (pkill -f mauto-session-daemon), delete .mobile-automator/ if it already exists, then run mv mobile-automator .mobile-automator — before any other mauto verb. ``
- The hint must not contain `mauto session end`.

- [ ] **Step 1: Write failing tests** in `discover.test.js` (`makeLegacy(dir)` helper writes `mobile-automator/config.json`):
  - `reports a legacy workspace in the start directory` → `{ root: null, legacy: root }`.
  - `reports a legacy workspace two levels up` (Review Focus 1) → `legacy === root`, from `root/src/x`.
  - `the new workspace wins when both exist` (RF 2) → `root === root`, `legacy === null`.
  - `a legacy folder without config.json is not legacy` (RF 3) → `legacy === null`.
  - `does not report a legacy folder above the .git boundary` (RF 4) → project with `.git` nested under a dir holding the legacy marker; `legacy === null`.
  - `noWorkspaceFailure with a legacy dir names it and gives the mv fix`: `exitKind 'environment'`; message contains `${dir}/mobile-automator/` and `.mobile-automator/`; hint contains `pkill -f mauto-session-daemon` and `mv mobile-automator .mobile-automator`; hint does not match `/session end/`.
  - Existing `noWorkspaceFailure` test: message now matches `/\.mobile-automator/`.

  In `cli.test.js` `describe('handleSetup')`:
  - `refuses when only a legacy workspace exists in projectRoot` → `exitKind 'environment'`, and `.mobile-automator` was **not** created.
  - `scaffolds normally when both a legacy and a new workspace exist` (RF 5) → `ok: true`.

  In `cli-workspace-discovery.test.js`: one end-to-end run of a `requireWorkspace` verb (e.g. `config get mode`) in a tmp project with only `mobile-automator/config.json` → exit 5, envelope error contains `legacy`.

- [ ] **Step 2: Run — expect FAIL.**
  Run: `npx jest tests/unit/workspace/discover.test.js tests/unit/cli.test.js -t "legacy|handleSetup|noWorkspaceFailure" && npx jest tests/integration/cli-workspace-discovery.test.js`

- [ ] **Step 3: Implement.** `findWorkspaceRoot` checks the legacy marker in the same loop iteration, after the new marker, before the `.git` break. `cli.js` passes `workspace.legacy` to `noWorkspaceFailure`. `handleSetup` checks `existsSync(legacyMarkerPath(projectRoot)) && !existsSync(markerPath(projectRoot))` before `scaffold` and returns `legacyWorkspaceFailure(projectRoot)`.

- [ ] **Step 4: Run — expect PASS**, then `npm test` green.

- [ ] **Step 5: Commit** — `feat: explain a legacy mobile-automator/ workspace instead of ignoring it`

---

### Task 3: Guides, skills and schema descriptions

**Files:**
- Modify: `src/guide/content/{execute,generate,setup}.{aware,agnostic}.md`, any `*.invariants.md` that names the path
- Modify: `src/schemas/config_schema.json:4`, `src/schemas/result_schema.json:208`, `src/schemas/scenario_schema.json:274` (description strings only)
- Modify: `src/cli.js` setup description (~line 2201) and path-describing comments in `src/`, `bin/`
- Test: `tests/unit/guide/{execute,generate}-content.test.js`, `tests/unit/guide/placeholders.test.js`, `tests/unit/init/*.test.js`, `tests/unit/mcp/prompts.test.js`, `tests/lint/config-schema.test.js`

- [ ] **Step 1: Write failing tests** in `execute-content.test.js`:
  - `names the workspace as .mobile-automator/ and never the bare name`: for both modes, emitted guide contains `.mobile-automator/scenarios/` and matches no `/(^|[^.\w])mobile-automator\//m`.
  - `tells the agent to list the scenarios directory directly`: both modes match `/list `?\.mobile-automator\/scenarios\/`? directly/i` and mention `hidden`.
  - Same "never the bare name" test in `generate-content.test.js`.

- [ ] **Step 2: Run — expect FAIL.**
  Run: `npx jest tests/unit/guide`

- [ ] **Step 3: Edit prose.** Replace every workspace path `mobile-automator/…` with `.mobile-automator/…` in guide content and schema descriptions. Next to the "run all → every scenario in `.mobile-automator/scenarios/`" line in both `execute` variants, add one sentence: list that directory directly, because recursive search tools skip hidden directories. Agnostic files must still name no OS. Update the comment and description strings in `src/` / `bin/` that describe the path.

- [ ] **Step 4: Run — expect PASS.**
  Run: `npm test && npm run lint:guides`
  Expected: green, including `guide-agnostic-no-os`, placeholder, skill-invariant and `schemas-valid` guards. Fix any snapshot/content test that asserted the old prose.

- [ ] **Step 5: Commit** — `docs(guide): point agents at .mobile-automator/`

---

### Task 4: User docs, repo config, CLAUDE.md, release metadata

**Files:**
- Modify: `README.md`, `TROUBLESHOOTING.md`, `CONTRIBUTING.md`, `ROADMAP.md`, `sample-app/README.md`, `.github/ISSUE_TEMPLATE/*`, `docs/**/*.md` except `docs/plans/**` and past sections of `docs/changelog.md`
- Modify: `.gitignore:46-47` → `.mobile-automator/.session/`, `.mobile-automator/.logs/`
- Modify: `CLAUDE.md` — file-layout block, Conventions bullet, locked invariant "Preserve the `.mobile-automator/` workspace layout"
- Modify: `package.json`, `package-lock.json` → `0.37.0`; `CHANGELOG.md` only (`docs/changelog.md` stopped at 0.10.0 and is history — do not touch)

- [ ] **Step 1: Edit docs.** Review each hit from `git grep -n "mobile-automator/" -- '*.md' .github .gitignore` by hand; change only workspace paths.

- [ ] **Step 2: Add `## [0.37.0]`** above `## [0.36.1]` with a `### 🔧 Changed` section whose first bullet starts `**Breaking: the workspace directory is now `.mobile-automator/`.**`, explains why (dot-directory convention like `.claude/`, `.github/`), and gives the upgrade block verbatim from spec §7:

  ```bash
  mauto session end                  # with the OLD version, before upgrading
  npm i -g mobile-automator@0.37.0
  mv mobile-automator .mobile-automator
  grep -rl 'mobile-automator/' .mobile-automator/scenarios   # stale stored paths
  ```

  plus the two notes: `pkill -f mauto-session-daemon` if the session was not ended first; stored screenshot paths are not rewritten. A second bullet notes that `mauto` now detects a leftover `mobile-automator/` and prints these steps, and that `mauto setup` refuses to scaffold beside one.

- [ ] **Step 3: Bump version** in `package.json` and both `package-lock.json` root entries to `0.37.0`.

- [ ] **Step 4: Verify.**
  Run: `npm run lint:guides && npx jest tests/lint`
  Expected: green — notably `changelog-structure`, `lockfile-in-sync`, `docs-counts`, `docs-no-stale-extension`, `node-version-agreement`, `host-support-agreement`.
  Then: `git grep -nE "(^|[^.\w/-])mobile-automator/(config|scenarios|screenshots|results|memory|\.session|\.logs)" -- . ':!docs/plans' ':!CHANGELOG.md' ':!docs/changelog.md' ':!tests/fixtures'` → expect no output.

- [ ] **Step 5: Commit** — `docs: move every workspace reference to .mobile-automator/; release 0.37.0`

---

### Task 5: Full verification and draft PR

- [ ] **Step 1:** `npm run test:all && npm run lint && ./scripts/pack-smoke.sh` — show the output; all green.
- [ ] **Step 2: Manual smoke** in a scratch dir with `git init`: `mauto setup` creates `.mobile-automator/`; in a second scratch dir with a hand-made `mobile-automator/config.json`, `mauto config get mode` exits 5 with the legacy message and `mauto setup` refuses. Show the envelopes.
- [ ] **Step 3:** push the branch and open a draft PR: what/why, the upgrade steps, test plan with the outputs above. No `Closes` line unless an issue was opened.
