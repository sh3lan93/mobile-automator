# Replay R1 — tracer bullet: hidden, gated `mauto run` (plan)

Issue #278 · PRD #271 (slice R1, gated) · branch `replay/278-run-tracer` · version **0.40.0-rc.0**

## Goal

`MAUTO_REPLAY=1 mauto run <scenario> [--device <id>] [--run-id <id>]` replays a scenario
in-process against one held-open `DeviceBridge`, records every step and assertion through
`ResultStore`, finalizes, and exits with one envelope: 0 passed, 6 `test_failed`, 3 invalid
scenario, 5 gate/workspace refusal, 2 device. Hidden from help and refused without the gate
until graduation (G). Scope matches the harness executor today: `launch_app`, `tap`, `type`,
the four semantic presses, `wait_for_element`, `retry_policy`, stop at the first failed step,
mechanical assertions only. **Tier-2 assertions are recorded as failed** (R2 turns them into
`needs_agent`).

## File structure

| File | Change |
|---|---|
| `src/run/gate.js` | **new** — `replayEnabled(env = process.env)`: strict `env.MAUTO_REPLAY === '1'`. The one file G deletes |
| `src/run/run-id.js` | **new** — `makeRunId(date)` (`run_YYYYMMDD_HHMMSS`, UTC), lifted from `lib/executor.js` |
| `src/run/resolve.js` | **new** — byte-identical copy of `sample-app/scripts/lib/resolve.js` (`resolveTarget`, `TargetNotFoundError`, `MAX_SEEN`) |
| `src/run/poll.js` | **new** — `poll(timeoutMs, probe, clock)`, `POLL_MS`, `DEFAULT_TIMEOUT_MS`, `timeoutFor(step)` |
| `src/run/actions/{index,launch,gestures,semantic,wait}.js` | **new** — `ACTION_HANDLERS` keyed by schema action: `launch_app` (catalog `stepFlagsFor` → restartApp vs launchApp + zero-elements drift gate, fatal), `tap`, `type`, the 4 semantic presses, `wait_for_element`. Unknown action → fatal step error (R3 fills the rest) |
| `src/run/step.js` | **new** — `runStep(step, ctx)`: attempt loop under `retry_policy` (fatal errors not retried), checkpoint / failure screenshot, `store.addStep` |
| `src/run/assertions.js` | **new** — `runAssertion(assertion, ctx)`: `fields.toEvaluatorInput` → `evaluate`; `needs_agent` → recorded **failed** with a "needs agent judgment" message (R2 changes this line) |
| `src/run/runner.js` | **new** — `runScenario({scenario, bridge, store, evaluator, catalog, projectRoot, runId, clock, log, trace})` → `{status, failures, failedStep}`; steps → `after_step` assertions; no `process`, no `emit`, no `child_process` |
| `src/assertion/fields.js` | **new** — the single scenario↔evaluator↔CLI mapping: `EXPECTED_FIELD`, `toEvaluatorInput(scenarioAssertion)`, `fromCliFlags(flags)`, `toCliFlags(scenarioAssertion)` |
| `src/device/semantic-press/index.js` | add `pressSemantic(bridge, action)` → `{platform, mechanism}`; `handlePress` and the runner both call it |
| `src/cli.js` | `run <scenario>` registered unconditionally with `{hidden: true}`; `handleRun`; extract `loadScenario()` from `handleValidate` and `finalizeRun()` from `handleResultFinalize` (both handlers call the extracted helpers; behaviour unchanged); `handleAssert` → `fields.fromCliFlags` |
| `src/observe/vocab.js` | `'run'` in `VERB_NAMES`; `'run.start'`, `'run.step'` in `EVENT_NAMES` |
| `sample-app/scripts/lib/executor.js`, `run-e2e.mjs` | inject `fields` + `makeRunId` from the install under test (same pattern as `evaluator`/`catalog`), deleting the harness's private `EXPECTED_FIELD`/`assertFlags`/`makeRunId` |
| `tests/helpers/fake-bridge.js` | **new** — scripted `listElements` queue (fixtures from `tests/fixtures/device/sample-app-probe/`), call log, `getPlatform`/`getScreenSize`, `screenshot` writes a stub, fake clock `{now, sleep}` |
| `tests/unit/run/*.test.js` | **new** — see Tests |
| `tests/lint/run-resolve-copy.test.js` | **new, temporary** — `src/run/resolve.js` ≡ `sample-app/scripts/lib/resolve.js` byte-for-byte until R7 deletes the latter |
| `docs/plans/2026-11-10-replay-r1-plan.md` | this file |
| `CHANGELOG.md`, `package.json`, `package-lock.json` | `0.40.0-rc.0`; entry under `## [Unreleased]` only (hidden verb, no user docs) |
| `CLAUDE.md` | replay milestone row: "S0a–S0c done, R1 in review" |

No new dependency; no `child_process` under `src/`; envelope, schemas, guides untouched.

## Module interfaces

```js
// src/run/runner.js
runScenario({ scenario, bridge, store, evaluator, catalog, runId, clock = {now, sleep}, log, trace })
  -> Promise<{ status: 'passed'|'failed', failures: string[], failedStep: string|null }>
```
- `trace(event, fields)` is injected; cli.js binds it to `record({event, src:'cli', verb:'run', run_id, ok, …}, {projectRoot, tracePath})`.
  The runner calls `trace('run.start')` first and `trace('run.step', {ok})` after each recorded step, so
  the run trace has ≥ 2 stamps before finalize and `measureRun` reports `source: 'trace'` (nothing else
  writes stamps during a single-process run — the daemon does not write run traces).
- Screenshots: `.mobile-automator/screenshots/<scenario_id>/<run_id>/step_<id>[_failure].png`, relative
  path recorded, absolute path written; one `mkdirSync` in `step.js` (same as the harness today).
- Step error = step `failed` with the error message (TargetNotFoundError lists perceivable strings).
  Retried per `retry_policy` unless `fatal` (drift gate, unknown action, `type` without value).

```js
// src/cli.js
handleRun({ bridge, resultStoreFactory, memoryStoreFactory, projectRoot, record }, prepared, opts)
  -> { envelope, exitKind }
```
Registration:
```
program.command('run <scenario>', { hidden: true })
  .option('--device <id>').option('--run-id <id>')
  .action(withEnvelope(requireWorkspace(async (file, opts) => {
     if (!replayEnabled()) -> emit fail('environment', …, 'export MAUTO_REPLAY=1')   // exit 5, no device
     loadScenario(validator, file, { strict: true })  -> invalid_input (3) before any device work
     runId = opts.runId || resolveRunId(env) || makeRunId(now); isResultRunId else invalid_input
     emitters.setRunId(runId)
     return withBridge(opts.device, bridge => handleRun(...))
  })))
```
- `handleRun` → `runScenario` → `finalizeRun()` (shared with `result finalize`: `measureRun`,
  `store.finalize` deriving status, `pruneRunTraces`, memory `recordRun`) →
  `ok(data)` or `fail('test_failed', 'run <id> failed', hint, data)`.
- `data = { run_id, scenario_id, status, result_path, failed_step, failures, measurements }` (R6 freezes it).
- `test_failed` is not in `CAPTURED_KINDS` / `PROBE_KINDS`, so `withBridge` adds no second failure
  screenshot and no crash probe; the runner already captured `step_<id>_failure.png`.

## Decisions taken in this plan (flag any you disagree with)

1. **No separate `docs/plans/2026-10-27-replay-design.md`.** The issue asks for one, but
   `docs/plans/2026-10-27-replay-plan.md` (merged in #285) already is the design (architecture, interfaces,
   risk register). A second document would be the "second copy" CLAUDE.md#8 warns about. This R1 plan
   carries the slice detail.
2. **Device faults mid-run are step failures** (harness semantics), so the run exits 6, not 2. Only a
   connect failure (no bridge) exits 2. Revisit in R6 if it reads wrong.
3. **The harness shares `fields.js` and `makeRunId` now** rather than at R7 (both injected from the
   install under test, like `evaluator`). Only `resolve.js` stays duplicated, under the temporary lint the PRD names.
4. **No corpus floor test in R1.** It needs R3's handlers to replay the 12-scenario corpus; it lands in R3.

## Tests (TDD, red first)

- `tests/unit/run/runner.test.js` — the 19 cases of `tests/unit/e2e-harness/executor.test.js` ported onto
  the fake bridge (launch + drift gate + not retried; tap resolves via the CLI matcher; missing target lists
  the screen; wait polls / times out on the fake clock; type + semantic; unknown action fails loudly;
  retry/backoff + attempts; stop at first failed step + finalize failed; checkpoint path; assertions after
  their step; failed assertion fails without stopping; Tier-2 recorded failed; run trace stamped). The
  three subprocess-only cases (MAUTO_RUN_ID env, `acceptKinds`, verdict-through-accepted-path) become
  their in-process equivalents (`trace` called with the run id; store holds the verdict; `--pass false`).
- `tests/unit/run/{resolve,poll,gate,run-id}.test.js`, `tests/unit/run/actions.test.js`.
- `tests/unit/assertion/fields.test.js` — every mechanical type round-trips scenario → evaluator input and
  CLI flags → evaluator input identically.
- `tests/unit/cli/run-verb.test.js` via `buildProgram`: gate unset → exit 5 and the bridge factory is never
  called; invalid scenario → 3; strict-blocking finding → 3; bad `--run-id` → 3; pass → ok, result file
  written, `measurements.source === 'trace'`; failing assertion → 6 with data; `handleAssert` and
  `handlePress` regression tests stay green.
- `tests/integration/cli-smoke.test.js` — real binary: gate refusal (5) and no-workspace refusal (5);
  `run` absent from `--help`.
- Guards: `telemetry-vocab-drift` (`run`, `run.start`, `run.step`), `run-resolve-copy` (seen red by editing
  one copy), version-bump, lockfile-in-sync, `e2e-agnostic` unchanged.

## Verification

`npm test`, `npm run lint`, `npm run lint:guides`, `./scripts/pack-smoke.sh` — output in the PR.
Exit criterion: `MAUTO_REPLAY=1 mauto run sample-app/scenarios/smoke_nav.json` on a local emulator
normalizes (`normalize-result.js`) equal to the harness's result — run if an emulator is available,
otherwise stated as not run in the PR.

## Rollback

Revert removes `src/run/`, the verb, the vocab entries and `fields.js`; the extracted
`loadScenario`/`finalizeRun`/`pressSemantic` helpers are behaviour-preserving and can stay.
