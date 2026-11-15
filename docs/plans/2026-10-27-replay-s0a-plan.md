# Replay S0a — `validate` referential checks (#272) — implementation plan

Slice S0a of PRD #271. Ungated, single-PR graduated release.

## Deviation from the PRD (needs a decision)

**Version.** The ladder says `0.36.2`, but `main` is already `0.37.0` (tagged, and
`npm view mobile-automator dist-tags` → `latest: 0.37.0`; it shipped the hidden
`.mobile-automator/` workspace, #270). Publishing `0.36.2` now would move npm's
`latest` dist-tag backwards (npm tags every publish `latest` by default). Proposed:
**`0.37.1`**, with S0b/S0c each taking the next free patch/minor at merge time.
The ladder's `0.37.0` slot for S0b is already consumed.

## Behaviour

Six new finding codes, all reported in `data.warnings` (non-breaking: `validate`
without `--strict` still exits 0). Each finding keeps today's shape
`{code, action?, path, message, step_id?}`; assertion findings use path
`assertions[N]` and carry `assertion_id` instead of `step_id` (no `action`).

| Code | Severity | Trigger |
|---|---|---|
| `duplicate_step_id` | blocking | a step `id` already used by an earlier step anywhere in the tree (sub_steps included); every repeat after the first is reported, message names the first path |
| `dangling_after_step` | blocking | an assertion's `after_step` names no step in the tree |
| `missing_target` | blocking | `tap`, `long_press`, `double_tap`, `wait_for_element`, `wait_for_element_gone`, `scroll_to_element`, `capture_value` with neither `target` nor `target_pattern` (a `target_pattern`-only step is resolvable, so it is not flagged) |
| `undeclared_capture_variable` | blocking | step `capture_to`, step `condition.variable_name`, or assertion `variable_name` not a key of root `variables` |
| `dangling_condition_step` | blocking | `condition.type: previous_step_skipped` whose `step_id` is missing, unknown, or not a step that precedes it in document order (self / forward references cannot have been skipped yet) |
| `missing_wait_config` | advisory | `wait_for_element`, `wait_for_element_gone`, `wait_for_loading_complete` with no `wait_config` (replay falls back to a default timeout) |

Order: steps depth-first in document order (per step: existing replayability codes,
then reference codes), then precondition device actions, then assertions.

Corpus check (prototyped against `docs/examples/android.md` + `ios.md` JSON blocks
and `sample-app/scenarios/*.json`, 12 scenarios): **zero findings of any of the six
codes**, so `run-e2e.mjs`'s `validate --strict` stays green.

## File structure

- **new `src/scenario/references.js`** — owns the six codes.
  - `REFERENCE_CODES` — `{ [code]: { blocking, clause(n), message(f) } }`, same row
    shape as `replayability.js` `CODES`.
  - `referenceIndex(scenario) → { firstPathById: Map<id, path>, orderById: Map<id, n>, variables: Set }`
    — one pre-pass over the whole step tree (needed because `after_step` and
    duplicate detection look at every step).
  - `stepReferenceFindings(step, path, visitIndex, index) → Finding[]` — called by
    `replayability.js`'s existing `scanSteps` for each step, so findings stay in
    document order with no sorting.
  - `assertionReferenceFindings(scenario, index) → Finding[]` — appended last.
  - Pure, no I/O, tolerant of missing/malformed `steps`/`assertions`/`variables`.
  - Action lists (`TARGET_ACTIONS`, `WAIT_ACTIONS`) live here: they are scenario-shape
    facts, not execution facts, so the action catalog (outside this slice's
    ownership) is untouched.
- **`src/scenario/replayability.js`** — `CODES = { ...own, ...REFERENCE_CODES }`
  (so `summarize`, `isBlocking`, and both lint guards that iterate `CODES` pick the
  new codes up with no guard edits); `findReplayWarnings` merges reference findings.
  Header comment updated. Still names neither `launch_app` nor `cold`.
- **`src/cli.js` untouched** — stays literal-free (guard
  `replay-warnings-boundary.test.js` iterates `CODES`, now 8 codes).
  Known wart: the `--strict` failure `error` string is still
  `scenario uses actions with no execution path` even when the blocker is a
  dangling reference; the `hint` (built by `summarize`) is accurate. Fixing the
  sentence needs a one-line cli.js change — left for a slice that owns cli.js
  (S0b) unless you want it here.

## Tests (TDD, failing first)

- **new `tests/unit/scenario/references.test.js`** — per code: positive, negative,
  inside `sub_steps`; `target_pattern` satisfies `missing_target`; duplicate across
  top level and nested; forward/self/unknown/missing `step_id` for
  `dangling_condition_step`; all three `undeclared_capture_variable` sources;
  `missing_wait_config` advisory (`isBlocking` false) while the other five are
  blocking; tolerance of `{}`, non-array steps, null entries; finding shape/path
  (`assertions[N]`, `assertion_id`).
- **new `tests/unit/scenario/corpus.test.js`** — loads the 12-scenario corpus
  (JSON blocks of the two example docs + sample-app scenarios), asserts each is
  schema-valid and `summarize(findReplayWarnings(s)).blocking` is empty, and pins
  the corpus size at 12 so a lost fixture fails loudly. (The PRD's later
  `tests/unit/run/corpus.test.js` floor test is R1's; this one is validate-only.)
- **`tests/unit/replayability.test.js`** — existing fixtures that use target-less
  `tap`/`long_press` get a `target` so they stay focused on their own code; add a
  merge-order test (step findings interleaved in document order, assertions last)
  and `summarize` hint ordering with new codes.
- **CLI-level** — a `handleValidate`/`buildProgram` unit test (wherever validate is
  tested today) plus a fixture `tests/fixtures/scenarios/dangling-after-step.json`:
  `validate --strict` → `ok:false`, `invalid_input`, exit **3**, `data.warnings`
  carries `dangling_after_step`; without `--strict` → `ok:true` with the warning.
  An integration smoke over the real binary if `cli-smoke` already covers validate.
- Any other existing test whose scenario fixture now produces a new finding gets a
  minimal fixture fix (expected: only target-less taps in unit fixtures).

## Lint guards

- `tests/lint/replay-warnings-boundary.test.js` and
  `tests/lint/docs-replay-warnings.test.js` — **no edits**; they derive from
  `CODES`, which now includes the six codes, so they fail until all four guides and
  `cli-verbs.md` name every code. Optionally add one assertion to the boundary
  guard that `cli.js` does not import `references.js` directly (the replayability
  module stays the single boundary).
- `docs-counts`, `action-coverage`, placeholder/OS guards — unaffected; guide text
  added is placeholder-free and OS-free (agnostic guides).

## Docs / guides

- **`execute.aware.md` / `execute.agnostic.md`** (Pre-flight validate bullet): the
  five blocking reference codes mean the scenario is broken — stop before touching
  the device and report the scenario as invalid (finalize `error`) naming each
  finding's `path`/`message`; do not guess the missing reference.
  `missing_wait_config` is advisory: replay with the default wait and record the
  `message` as a `state_context` observation (mirrors `launch_cold_implicit`).
- **`generate.aware.md` (both validate lines) / `generate.agnostic.md`**: fix each
  code at authoring time — unique ids, `after_step`/`step_id` pointing at an earlier
  real step, add `target`, declare the variable in root `variables`, add
  `wait_config`.
- **`docs/reference/cli-verbs.md`**: verb row wording broadened; warnings table
  gains six rows; shape paragraph adds `assertions[N]` + `assertion_id`.
- Agent Skill `*.invariants.md` — no change (they carry no codes).

## Version / CHANGELOG

- `package.json` + `package-lock.json` (`npm install --package-lock-only`, then
  `npm ci` to prove it) → **0.37.1** (pending decision above).
- `CHANGELOG.md`: new `## [0.37.1]` section, `### ✨ Added` — "`mauto validate`
  checks references", listing the six codes and the `--strict` policy.

## Verification

`npm test`, `npm run lint`, `npm run lint:guides`, `./scripts/pack-smoke.sh`;
tails pasted into the draft PR (`feat(validate): …`, `Closes #272`, `Refs #271`).
Commits per task: plan → references module + tests → replayability merge + corpus
test → CLI exit-3 test → guides + docs → version/CHANGELOG.
