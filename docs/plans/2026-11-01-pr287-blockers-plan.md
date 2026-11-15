# PR #287 Review Blockers Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Clear the five blockers recorded in pr-radar round 1 for PR #287 so `validate`'s referential checks are safe to merge.

**Architecture:** Action classification moves into `action-catalog.js`, and `references.js` derives its sets from it. Variable checks gain type-required cases. Both execute guides validate before any device verb. Docs then state the real compatibility impact.

**Tech Stack:** Node, Jest, Markdown guide content.

**Spec:** The blocker list in pr-radar (PR #287, round 1), summarised per task below. Scope contract: `gh issue view 272`, `docs/plans/2026-10-27-replay-s0a-plan.md`.

## Global Constraints

- Work in `.claude/worktrees/pr287-validate-references` on `replay/272-validate-references`. Subagents must `cd` there and verify before any commit.
- Version stays `0.38.2` unless the user chooses otherwise (see Task 5). `src/` changes need no further bump while that tag does not exist.
- `src/cli.js` must not name a finding code (`replay-warnings-boundary` guard).
- Agnostic guides name no OS and leak no `mobile_*` tool names.
- Scenario schema files do not change: everything stays a `validate` finding, so existing files remain schema-valid.
- Every new guard must be seen red by mutating the code it protects, then restored (`CLAUDE.md` workflow step 8). State the result in the PR.
- Commits end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. The pre-commit hook runs `npm test`.

## Review Focus

- A new step action added to the schema: the build must force a `requiresTarget` decision rather than silently skipping `missing_target`.
- `variable_name` on an assertion type that does not require it: still checked if present, never required (the execute guides' "Variable substitution" paragraph uses it this way).
- Empty-string `variable_name` on a required type: reported, not treated as present.
- A scenario with `fresh_install` and a blocking finding: the emitted guide must reach `mauto validate` before any `mauto uninstall`.
- A code moved from `CODES` into `REFERENCE_CODES` to dodge the marker rule: the coverage guard must fail.

---

### Task 1: Catalog owns target and wait classification (blocker 4)

**Files:**
- Modify: `src/device/action-catalog.js`, `src/scenario/references.js:15-28`
- Test: `tests/lint/action-coverage.test.js`, `tests/unit/scenario/references.test.js:97,255`

**Interfaces:**
- Produces: catalog entry fields `requiresTarget: boolean` (on every step-enum action) and `waitAction: true` (on the three wait actions). New exports `targetActions(): string[]` and `waitActions(): string[]`.

- [ ] **Step 1: Write failing guards in `action-coverage.test.js`**

  - `every step action declares requiresTarget`: for each `definitions.step` action enum value, `typeof ACTION_CATALOG[action].requiresTarget === 'boolean'`.
  - `targetActions() is the pinned set`: sorted equals `capture_value, double_tap, long_press, scroll_to_element, tap, wait_for_element, wait_for_element_gone`.
  - `waitActions() matches the schema`: equals the step enum filtered by inclusion in the `wait_config.description` string.

- [ ] **Step 2: Run** `npx jest tests/lint/action-coverage.test.js`. Expected: FAIL, `requiresTarget` undefined and `targetActions` not a function.

- [ ] **Step 3: Implement.** Add the fields and the two exports, filtering `ACTION_CATALOG`. In `references.js`, replace both literals with `new Set(targetActions())` and `new Set(waitActions())`. Add both fields to the catalog's header comment. Parametrize the two `references.test.js` tables from the exports.

- [ ] **Step 4: Run** `npm test`. Expected: PASS.

- [ ] **Step 5: Mutation check.** Remove `requiresTarget` from `swipe`: guard red. Remove `waitAction` from `wait_for_loading_complete`: guard red. Restore both.

- [ ] **Step 6: Commit** `refactor(validate): action catalog owns target and wait classification (#272)`.

### Task 2: Report a required variable name that is missing (blocker 2)

**Files:**
- Modify: `src/scenario/references.js:49-53,113-117,142-146`, `docs/reference/cli-verbs.md` (the `undeclared_capture_variable` row)
- Test: `tests/unit/scenario/references.test.js`

**Interfaces:**
- Produces: `undeclared_capture_variable` fields `{ field, ref }` where `ref` may be `undefined`, matching `dangling_after_step`.

- [ ] **Step 1: Write failing tests**

  - A `{ type: 'variable_value' }` condition yields one `undeclared_capture_variable` with field `condition.variable_name`, and its message contains `has no`.
  - A `value_matches_variable` assertion with no `variable_name` yields one, path `assertions[0]`, carrying `assertion_id`.
  - The same two with `variable_name: ''` also yield one.
  - An `element_exists` assertion with no `variable_name` yields none.
  - An `element_exists` assertion naming an undeclared variable still yields one.

- [ ] **Step 2: Run** `npx jest tests/unit/scenario/references.test.js`. Expected: the first three FAIL, the last two PASS.

- [ ] **Step 3: Implement.** A name is checked when its type requires it or when it is present; `index.variables.has(undefined)` is already false, so only the guard changes. Requiring types: condition `variable_value`, assertion `value_matches_variable`. For `''`, normalise so `ref` is `undefined` in the message path. Message for no ref: `"${f.field}" is required here but has no variable name`. The clause stays unchanged. Update the docs row to say a required name that is missing is reported too.

- [ ] **Step 4: Run** `npm test`. Expected: PASS, including the 12-scenario corpus.

- [ ] **Step 5: Commit** `fix(validate): report a required variable name that is missing (#272)`.

### Task 3: Both execute guides validate before any device verb (blocker 1)

**Files:**
- Modify: `src/guide/content/execute.agnostic.md:55-65`, `src/guide/content/execute.aware.md:52-67`
- Test: `tests/lint/guide-artifact-reuse.test.js`

**Interfaces:**
- Consumes: that test file's existing Pre-flight slice helper and its way of emitting each guide. Reuse them; add no second emitter.

- [ ] **Step 1: Write a failing guard**

  `validate precedes every device verb`, for both emitted guides: inside the Pre-flight section, the index of `mauto validate` is lower than the first index of each of `mauto devices`, `mauto install` and `mauto uninstall`.

- [ ] **Step 2: Run** `npx jest tests/lint/guide-artifact-reuse.test.js`. Expected: FAIL on both guides.

- [ ] **Step 3: Reorder.**

  - Agnostic order: name the run → read the scenario → schema version → `mauto validate` → devices → app under test. Renumber the list.
  - Aware: move the read, schema-version and validate bullets from `### 2. Load Scenario` into Pre-flight, directly after "Name the run first". `### 2` keeps the `metadata` comparison and is renamed `### 2. Compare Environment`. Check for references to the old title.
  - Both: change "(read it from the scenario file now)" in Fresh install to "(from the scenario you read above)" where present. Change "do not touch the device" to "run no further verbs against the device", since nothing has run yet.
  - Keep `MAUTO_RUN_ID` first: `validate` is itself a verb.

- [ ] **Step 4: Run** `npm test && npm run lint:guides`. Expected: PASS.

- [ ] **Step 5: Mutation check.** Move the agnostic validate step back below app under test: guard red. Restore it.

- [ ] **Step 6: Commit** `fix(guide): validate the scenario before any device verb (#272)`.

### Task 4: Make the severity contract true again (blocker 5)

**Files:**
- Modify: `src/scenario/replayability.js:3-4,35-38`, `src/cli.js:2022` (the `--strict` option text)
- Test: `tests/lint/action-coverage.test.js:130-138`

- [ ] **Step 1: Replace the exemption test with the real rule**

  `CODES is exactly unsupported_action, the catalog markers and the reference codes`: sorted `Object.keys(CODES)` equals that sorted union, and no marker is a key of `REFERENCE_CODES`.

- [ ] **Step 2: Run** `npx jest tests/lint/action-coverage.test.js`. Expected: PASS, as it describes current state. The mutation in Step 4 is the proof.

- [ ] **Step 3: Rewrite the comments and option text.**

  - Header: "reports three kinds of gap".
  - `blocking`: "a blocking finding means the scenario cannot replay unattended as written: a step that cannot run or a broken reference".
  - Remove the sentence claiming advisory codes are catalog markers. The test now states the rule.
  - `--strict` option: `fail (instead of warn) when the scenario cannot replay unattended`.

- [ ] **Step 4: Mutation check.** Move `launch_cold_implicit` into `REFERENCE_CODES`: guard red. Restore it.

- [ ] **Step 5: Run** `npm test`. Expected: PASS.

- [ ] **Step 6: Commit** `docs(validate): state the real severity contract and pin it (#272)`.

### Task 5: State the compatibility impact, verify, ship (blocker 3)

**Files:**
- Modify: `CHANGELOG.md` (`[0.38.2]`), `docs/reference/cli-verbs.md` (only if Task 3 changed what it says about execution)

**Default decision, confirmed with the user before this task:** agents keep refusing scenarios with blocking findings and the release stays `0.38.2`, because the locked ladder made S0a a patch. If the user chooses otherwise, change this task before starting it.

- [ ] **Step 1: Rewrite the changelog claim.** Delete "existing scenarios and pipelines keep working". State:

  - `mauto validate` without `--strict` still exits 0.
  - **`validate --strict` now exits 3 on scenarios that used to pass**, if they have a blocking finding.
  - **The execute guides now stop on a blocking finding even without `--strict`**, including a schema-valid `tap` with no `target`.
  - How to upgrade: run `mauto validate` on existing scenarios and fix what it reports.

- [ ] **Step 2: Run all gates.** `npm test`, `npm run lint`, `npm run lint:guides`, `npm run lint:schema-additive`, `./scripts/pack-smoke.sh`. Expected: all pass. Keep the output.

- [ ] **Step 3: Real-binary check.** A scenario with a `value_matches_variable` assertion and no `variable_name` exits 3 under `validate --strict`. Both `sample-app/scenarios/*.json` exit 0.

- [ ] **Step 4: Commit** `docs(changelog): state what the new blocking findings change (#272)`.

- [ ] **Step 5: Publish.** `git push`. In the PR body: replace the "non-breaking" sentence, refresh the test output, and add the self-check result (reused helpers, guards seen red). Mark b-ids fixed with `mcp__pr-radar__update_blocker`. Wait for all checks, including both Android E2E jobs.
