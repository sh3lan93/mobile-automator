# Replay S0c — JUnit export from result files (plan)

Issue #274 · PRD #271 (slice S0c, ungated) · branch `replay/274-junit-export` · version **0.38.1**

## Goal

`mauto result export --run-id <id> [--run-id <id>…] --format junit [--out <path>]` turns
finalized result files in `.mobile-automator/results/` into one JUnit XML document a CI
test reporter can ingest. The renderer lives in `src/run/report/` so R6's `mauto run --junit`
reuses it unchanged.

## File structure

| File | Change |
|---|---|
| `src/run/report/junit.js` | **new** — pure `toJUnit(results, { executor } = {})` |
| `src/run/report/index.js` | **new** — `REPORT_FORMATS` (`['junit']`) and `renderReport(format, results, opts)`; the one entry point `cli.js` (and later `run`) calls |
| `src/cli.js` | `handleResultExport` + the `result export` subcommand (wrapped in `requireWorkspace`), exported for unit tests |
| `tests/unit/run/report/junit.test.js` | **new** — pure XML tests |
| `tests/unit/run/report/index.test.js` | **new** — format dispatch |
| `tests/unit/run/report/fixtures/*.json` | **new** — hand-written results: passed, failed (assertion + failed step), errored step, `needs_agent` assertion + `incomplete` status, result with `executor`, XML-hostile strings |
| `tests/unit/cli/result-export.test.js` | **new** — handler tests on a temp workspace |
| `tests/helpers/parse-xml.js` | **new** — small hand-rolled XML well-formedness checker (balanced tags, escaped text, attribute extraction); no dependency, jsdom is only transitive |
| `tests/integration/cli-smoke.test.js` | spawn `result export` against a pre-written result file, parse the XML |
| `tests/lint/result-coverage.test.js` | declared read-only exemption for `export` (see Guards) |
| `docs/reference/cli-verbs.md` | `result export` row + a note on the mapping and exit behaviour |
| `docs/faq.md` | replace the `cat …/results/latest.json \| jq` line with a real `mauto result export … --format junit --out …` line |
| `CHANGELOG.md`, `package.json`, `package-lock.json` | 0.38.1 |

No new runtime dependency; no `child_process` under `src/`; `envelope.js` untouched.

## Module interfaces

```js
// src/run/report/junit.js
toJUnit(results, { executor } = {}) -> { xml, suites, tests, failures, skipped }
```

- `<testsuites name="mauto" tests failures skipped errors="0" time>` wrapping one
  `<testsuite>` per result, in input order (`name` = `scenario_id`, `timestamp` =
  `metadata.timestamp`, `time` = `duration_seconds`).
- `<properties>`: `run_id`, `status`, the five `metadata` fields, and `executor.<key>` for
  every scalar key of `result.executor ?? opts.executor` — emitted only when present
  (R2 adds root `executor`; R6 passes it in).
- One `<testcase>` per `assertion_results[]` entry (`name` = `assertion_id`, `classname` =
  `scenario_id`): `passed` → empty, `failed` → `<failure message type>` with expected /
  actual in the body, `needs_agent` → `<skipped message>`. Optional R2 fields (`type`,
  `step_id`, `judge`) are used when present (failure `type`, name prefix), ignored otherwise.
- One `<testcase name="step: <step_id>">` per step whose status is `failed` or `error`
  (`<failure type="step_failed|step_error">` with `error_message`), and per step with
  `needs_agent: true` (`<skipped>`). Passed/skipped steps emit nothing.
- Guard against a green report for a red run: when `status` is `failed`/`error` and no
  failing testcase was produced, one synthetic `<testcase name="run status">` failure is
  added saying so.
- XML 1.0 escaping of `& < > " '` in text and attributes; characters illegal in XML 1.0
  (C0 controls except tab/LF/CR, lone surrogates) are stripped. Deterministic output (no
  clock reads) so fixtures compare exactly.

```js
// src/run/report/index.js
REPORT_FORMATS            // ['junit']
renderReport(format, results, opts) -> { format, content, suites, tests, failures, skipped }
// throws a TypeError naming REPORT_FORMATS on an unknown format
```

```js
// src/cli.js
handleResultExport({ projectRoot, cwd, fsDep = fs }, { runIds, format, out })
  -> { envelope, exitKind }
```

- `--run-id` repeatable (`collect`), at least one; each must match the result schema's
  `^run_\d{8}_\d{6}$` — this also forbids path traversal through the id.
- Reads `<workspace>/results/<id>.json` **directly with `fs.readFileSync`**, not through
  `ResultStore`: the store's constructor renames a corrupt file aside, and a read-only verb
  must never mutate the workspace.
- `invalid_input` for: unknown/missing format (hint lists formats), bad id, missing file,
  unparseable JSON, and a not-yet-finalized file (`_in_progress: true`; hint: run
  `mauto result finalize --run-id <id>` first). One failing id fails the whole export
  (no partial XML).
- `--out` resolved against cwd, parent dir created, written atomically
  (`src/util/atomic.js`); write failure → `environment` (same as `crash get --out`).
- Success: `ok({ format, path, suites, tests, failures, skipped })`; `path` is the absolute
  out path or `null`, and without `--out` the XML is in `data.xml`.
- Always exit 0 when the export itself succeeded, whatever the test outcome — export is a
  report, not a gate (S0b owns test-failure exit codes). Documented in `cli-verbs.md`.

## Guards touched

- **`tests/lint/result-coverage.test.js`** — the no-orphan-flags rule would flag
  `export --format` / `--out`. Add, in the test, a declared map
  `READ_ONLY_RESULT_VERBS = { export: '<reason: reads finalized result files and renders a report; writes no result-file fact, so it has no capability to claim>' }`,
  skip only those subcommands in the orphan scan, and add three tests that keep the
  exemption honest: every entry has a non-empty reason and names a registered `result`
  subcommand; no exempt verb is the `verb` of any `RESULT_CAPABILITIES` entry (a writer
  cannot hide behind the exemption); and, behaviourally, running `handleResultExport`
  against a temp workspace leaves the `results/` directory byte-for-byte unchanged.
- **`workspace-dirname-single-source`** — new `src/` code builds paths only from
  `workspaceDir()`; no `.mobile-automator` literal.
- **`vocab` `VERB_NAMES`** — records the top-level command (`result`), already present:
  no change.
- **ESLint type-aware rules** — new code is synchronous; nothing to observe.
- Version-bump gate, lockfile-in-sync — 0.38.1 in both files.

## Tests (written first)

1. `junit.test.js`: well-formed XML for every fixture; root/suite counts; passed assertion
   has no child; failed assertion → `<failure>` with message, expected, actual; failed step
   → testcase + `<failure type="step_failed">`; errored step → `step_error`; `needs_agent`
   assertion → `<skipped>` and counted in `skipped`, not `failures`; `incomplete` result
   suite carries `status=incomplete` property; executor properties from `result.executor`
   and from `opts.executor`, and none when absent; synthetic "run status" failure for a
   `failed` result with no failing entries, and none for a passed one; escaping of
   `& < > " '` and stripping of control chars; multiple results → multiple suites in order;
   output identical across two calls.
2. `index.test.js`: `REPORT_FORMATS` is `['junit']`; `renderReport('junit', …)` equals
   `toJUnit`'s output; unknown format throws naming the formats.
3. `result-export.test.js`: happy path with and without `--out`; two run ids → two suites;
   each `invalid_input` case above; `--out` into a missing directory creates it; corrupt
   file left untouched (no `.corrupt.*` sidecar).
4. `cli-smoke.test.js`: write a result file into a temp workspace, spawn
   `result export --run-id … --format junit`, envelope `ok`, exit 0, `data.xml` parses and
   names the scenario; second case with `--out` writes a parseable file; a bad format exits
   with the `invalid_input` code through the envelope.
5. `result-coverage.test.js`: the three exemption tests above.

## Docs

- `docs/reference/cli-verbs.md`: row
  `mauto result export --run-id <id> [--run-id …] --format junit [--out <path>]` and a note:
  mapping (suite per run, case per assertion and failed step, `needs_agent` → skipped,
  provenance as properties), finalized files only, exit 0 regardless of test outcome.
- `docs/faq.md` CI section: replace
  `cat .mobile-automator/results/latest.json | jq '.status'` (there is no `latest.json`) with
  `mauto result export --run-id "$MAUTO_RUN_ID" --format junit --out reports/mauto-junit.xml`
  and a tip to point the CI JUnit reporter at it.

## Version / CHANGELOG

`package.json` 0.37.0 → **0.38.1**, lockfile regenerated (`npm install --package-lock-only`,
then `npm ci`). `CHANGELOG.md`: new `## [0.38.1]` section, `### ✨ Added` —
"`mauto result export --format junit`" with the mapping in one paragraph.

## Deviations / open points for the coordinator

1. **Version numbering.** `v0.37.0` is already tagged (the hidden-workspace release, PR
   #270), so the ladder's S0b = 0.37.0 is taken. I bump to 0.37.1 as instructed; S0a/S0b
   will collide on `package.json`/`CHANGELOG.md` whichever merges second, and need
   renumbering at rebase time.
2. **Workspace path.** The brief says `mobile-automator/results/`; since 0.37.0 it is
   `.mobile-automator/results/`, built via `workspaceDir()`.
3. **One file outside the listed ownership:** `tests/helpers/parse-xml.js` (new; shared by
   the unit and smoke tests). Also `tests/unit/cli/result-export.test.js` for the handler.
4. **Additions beyond the spec:** step `error` → failure `type="step_error"` (envelope keeps
   exactly `{format, path, suites, tests, failures, skipped}`, no `errors` key); the
   synthetic "run status" failure; refusing un-finalized files.

## Coordinator rulings (2026-10-27)

Approved. Version is **0.38.1** (merge order S0a 0.37.1 → S0b 0.38.0 → S0c 0.38.1; one rebase
expected; nothing here depends on S0b). Path `.mobile-automator/results/` confirmed. Both
extra test files approved, as are the four extras. Tests must not import `jsdom` (not a declared
devDependency): `tests/helpers/parse-xml.js` is a hand-rolled checker instead. A code comment
records why `export` reads result files with `fs` rather than `ResultStore`.
