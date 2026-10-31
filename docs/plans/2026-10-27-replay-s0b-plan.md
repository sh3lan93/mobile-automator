# Replay S0b — test-failure exit codes (BREAKING) — implementation plan

Issue: #273 · PRD: #271 (slice S0b) · Branch: `replay/273-test-failure-exit-codes`

## Goal

A failed test must fail the process. Today `mauto result finalize --status failed`
and a failed `mauto assert` both exit 0 (`exitKind: 'ok'`), so a CI step cannot
tell a red run from a green one without parsing JSON. After this slice:

| Outcome | `ok` | `error.kind` | exit | `data` |
|---|---|---|---|---|
| `assert` → `pass:true` | true | — | 0 | verdict |
| `assert` → `needs_agent` (Tier 2) | true | — | 0 | verdict (`pass:null`) |
| `assert` → `pass:false` | **false** | **`test_failed`** | **6** | verdict (same shape) |
| `result finalize` → result `status: passed` | true | — | 0 | full result |
| `result finalize` → result `status: failed` or `error` | **false** | **`test_failed`** | **6** | full result (`data.status` tells them apart) |

`EXIT.INCOMPLETE = 7` / kind `incomplete` is reserved now (envelope + docs), and
produced first by R2 (`finalize` computing `incomplete`) and R1 (`run`).

## Coordinator rulings (2026-10-27)

Approved with: version **0.38.0**; exit 6 keyed on the finalized
`result.status`; status `error` takes the same `test_failed` / exit 6 path with
`data.status === 'error'`; `incomplete` stays R2. Merge order S0a (0.37.1) →
S0b (0.38.0) → S0c (0.38.1).

## Deviations from the PRD — as raised

1. **Version.** The ladder says `0.37.0`, but `0.37.0` is already tagged and
   published (the `.mobile-automator/` rename, PR #270; `npm view` → latest
   `0.37.0`). The version-bump gate rejects an existing tag. A breaking change
   on `0.x` is a minor bump, so I propose **`0.38.0`**. This shifts the ladder:
   S0a's `0.36.2` and S0c's `0.37.1` are also stale — the coordinator should
   re-number the parallel slices (suggest S0a `0.37.1`, S0b `0.38.0`,
   S0c `0.38.1`, merged in that order, or whichever lands later re-bumps).
2. **Trigger is the finalized `result.status`, not the flag.** `ResultStore#finalize`
   derives `failed` when `--status` is omitted and any assertion failed
   (`store.js:334`). Keying exit 6 on the persisted `status === 'failed'` makes
   the exit code agree with the file in both cases; keying on the flag alone
   would leave "omit `--status`, an assertion failed" at exit 0 — the same bug.
3. **`--status error` stays exit 0** (scope says `failed` only). Flagged as an
   open question: a run that errored is also "not a pass" for CI. Recommendation:
   keep it out of S0b (the PRD's status matrix is R2's job) unless you want it in.

## File structure / changes

### `src/output/envelope.js`
- `EXIT.TEST_FAILED = 6`, `EXIT.INCOMPLETE = 7` (comment: test outcome, not a
  CLI/device fault; distinct so CI can branch on "the app is broken" vs "the
  tooling is broken").
- `KIND_TO_CODE.test_failed = EXIT.TEST_FAILED`, `KIND_TO_CODE.incomplete = EXIT.INCOMPLETE`.
- `ERROR_KINDS` derives from `KIND_TO_CODE` → telemetry `verb.end.error_kind`
  accepts both with no edit to `src/observe/event.js`.
- `SCHEMA_VERSION` stays `'2.1'`.

### `src/cli.js`
- `handleAssert`: when `!r.needs_agent && r.pass === false` →
  `{ envelope: fail('test_failed', \`assertion failed: ${r.message}\`, hint, verdict), exitKind: 'test_failed' }`.
  `verdict` is the exact object `ok()` carries today, and the "Record it: …
  --pass false" hint is kept, so an agent's next command is unchanged. Comment
  above the function updated ("a failed assertion is a valid RESULT (exit 0)" →
  exit 6 with the verdict in data).
- `handleResultFinalize`: after `store.finalize`, retention and the memory
  harvest run exactly as today (a failed run must still be recorded and
  harvested); then `result.status` is `failed` or `error` →
  `fail('test_failed', \`run ${runId} failed\`, joinedHints || <default hint>, result)`,
  else `ok(result, hint)`. Default hint: points at `steps_executed` /
  `assertion_results` in `data` and at `.mobile-automator/results/<run_id>.json`.
- No change to `withEnvelope`/`emit` — `exitCodeFor` already maps kinds.

### `src/observe/failure-capture.js`, `src/device/failure-probe.js`
`CAPTURED_KINDS` and `PROBE_KINDS` are already allow-lists (`device`, `timeout`),
so neither new kind triggers a screenshot or crash probe. **No code change**;
the comments gain one line each saying why `test_failed`/`incomplete` are
excluded (the device answered; the app, not the tooling, failed — and the
failed-step screenshot is the runner's/agent's job, so a second capture would
duplicate it). Tests pin the exclusion so a future "capture all non-ok" edit fails.

### `sample-app/scripts/lib/mauto.js`
- `run(args, { env, acceptKinds = [] })`: an `ok:false` envelope whose
  `error.kind` is in `acceptKinds` **and** whose exit code is non-zero returns
  `envelope.data` instead of throwing. An accepted kind that exits 0, or carries
  no `data`, still throws (contract bug, same spirit as the existing
  "ok but exited N" check). Header comment updated.

### `sample-app/scripts/lib/executor.js`
- `verb(args, opts)` forwards `acceptKinds`.
- `runAssertion`: `verb(['assert', …], { acceptKinds: ['test_failed'] })` —
  the returned verdict has `pass:false`, so the existing verdict logic is unchanged.
- finalize: `verb(['result','finalize', …], { acceptKinds: ['test_failed'] })`.
  (`incomplete` is added to these lists by R2/R7 when it can occur — the
  harness only decides mechanical assertions and never produces it today.)

## Tests (TDD — each written red first)

- `tests/unit/output/envelope.test.js`: exact `EXIT` equality incl. 6/7;
  `exitCodeFor('test_failed') === 6`, `exitCodeFor('incomplete') === 7`;
  `ERROR_KINDS` contains both.
- `tests/unit/cli.test.js`:
  - `handleAssert` failed mechanical → `ok:false`, kind `test_failed`,
    `exitKind 'test_failed'`, `data` = verdict (`pass:false`, `mechanical:true`),
    hint still the `--pass false` record command.
  - passed → unchanged ok/0; `needs_agent` → still ok/0.
  - `handleResultFinalize` `--status failed` → `ok:false`/`test_failed`, `data`
    = full result (status, steps_executed, result file written); derived-failed
    (no `--status`, failed assertion) → same; passed → ok; memory still
    harvested and retention still runs on the failed path.
- `tests/unit/observe/failure-capture.test.js` / `tests/unit/device/failure-probe.test.js`:
  `test_failed` and `incomplete` envelopes are not capturable / not probed.
- `tests/unit/observe/event.test.js` (or existing telemetry test): a `verb.end`
  with `error_kind: 'test_failed'` validates.
- `tests/integration/…`: spawn `mauto result finalize --run-id x --scenario-id y --status failed`
  in a temp workspace → exit 6, one envelope, `ok:false`, `error.kind test_failed`.
  Plus the same for `--status passed` → exit 0.
- `tests/unit/e2e-harness/mauto.test.js`: accepted kind + non-zero → data;
  unaccepted kind → throws; accepted kind + exit 0 → throws; default (no
  `acceptKinds`) unchanged.
- `tests/unit/e2e-harness/executor.test.js`: fake mauto records `opts`;
  assert and finalize calls carry `acceptKinds: ['test_failed']`; other verbs don't.

## Lint guards / gates touched

- No new guard. Existing guards that must stay green: `vocab-drift`
  (no new verb), `result-coverage`/`capability-catalog` (no new field —
  untouched), `schema-additive` (no schema change), `e2e-agnostic`
  (harness keeps calling only the shipped `mauto`; no own matcher),
  placeholder/guide guards (guide edits add no `{{…}}`, no OS names in
  agnostic), version-bump gate + `lockfile-in-sync` (package.json + lock bumped together).

## Docs

- `docs/reference/cli-verbs.md`: exit table gains `timeout` → `2` (missing today),
  `test_failed` → `6`, `incomplete` → `7` (reserved; produced by `run` /
  `finalize` once replay lands); `assert` and `result finalize` sections state
  the exit-6 behaviour.
- `docs/reference/telemetry.md`: `error_kind` row mentions `test_failed`.
- `src/guide/content/execute.{aware,agnostic}.md` §4: "the CLI returns a JSON
  verdict" → a failed verdict arrives as `ok:false`, `error.kind: test_failed`,
  exit 6, with the verdict in `data` — record it, it is not a tool error; §5
  finalize paragraph: a failed run finalizes with exit 6 and the full result in `data`.
  (Check `execute.invariants.md` for the same sentence.)
- `CHANGELOG.md`: `## [0.38.0]` with a **Breaking** entry (old vs new exit, how
  CI/agents adapt: branch on 6, or read `data`).
- `package.json` + `package-lock.json` → `0.38.0` (pending decision 1).

## Verification

`npm test`, `npm run lint`, `npm run lint:guides`, `./scripts/pack-smoke.sh`,
plus the manual `mauto result finalize --run-id x --scenario-id y --status failed; echo $?` → 6.
The real-device E2E (exit criterion "green on both engines") runs in CI on the
PR via `sample-app-e2e-android.yml` (path-filtered on `sample-app/**`, which this PR touches).

## Commits

1. plan doc · 2. envelope codes · 3. assert → test_failed · 4. finalize → test_failed
5. capture/probe exclusion pins · 6. harness `acceptKinds` + executor · 7. docs + guides
8. version + CHANGELOG.
