# Replay R2 — result provenance and the `needs_agent` model (plan)

Issue #275 · PRD #271 (slice R2, gated rc) · branch `replay/275-provenance` · version **0.40.0-rc.1**

## Goal

A result file says who decided what, and a run that still needs an agent says so instead of
reading green or red. Assertions the CLI cannot decide are recorded `needs_agent`. The run then
finalizes `incomplete` (exit 7) unless something failed. An agent completes it with one-shot
verbs (`result add-assertion … --judge agent`) and re-finalizes. `result finalize --scenario
<path>` stops a result from being self-attested: the file is hashed into `executor`, and every
recorded id is cross-checked against it.

## Contract changes (all additive; `required` untouched; `schema_version` stays `"2.0"`)

| Where | Change |
|---|---|
| `result_schema.json` `/status` | enum + `incomplete` |
| `assertion_results[]` | `status` enum + `needs_agent`; optional `type`, `step_id`, `mechanical` (bool), `judge {by: mauto\|agent\|none, name?, version?}` |
| `steps_executed[]` | optional `needs_agent` (bool) — schema only in R2 (R3's `unsupported` actions write it); `deriveRunStatus` already honours it |
| root | optional `executor {kind: runner\|agent, mauto_version, engine, platform, device_id, scenario_path, scenario_sha256, mode}`; `kind` + `mauto_version` required inside it, the rest nullable |
| `RUN_STATUSES` (`flags.js`) | + `incomplete` (the guard pins it to the schema enum) → `finalize --status incomplete` is accepted |
| exit codes | `finalize` and `run` exit **7** (`incomplete`, already in `envelope.js`) when the finalized status is `incomplete` |

## Status matrix (`deriveRunStatus`, `src/result/outcome.js` — still the one definition)

errored step → `error` · failed step → `failed` · failed assertion → `failed` · any `needs_agent`
assertion or step → `incomplete` · else `passed`. New predicate `isPendingAssertion`/`isPendingStep`
beside the existing ones.

## File structure

| File | Change |
|---|---|
| `src/schemas/result_schema.json` | the additions above |
| `src/result/outcome.js` | `isPending*`, matrix |
| `src/result/flags.js` | `RUN_STATUSES` + incomplete; `parseVerdict(raw)` → `true\|false\|'pending'` (replaces `parseBool` for `--pass`); `JUDGES = ['agent','none']` + `parseJudge` |
| `src/result/store.js` | `addAssertion({…, type, step_id, mechanical, judge})` persists them (`mechanical` defaults to `MECHANICAL_TYPES.has(type)`); `pass: 'pending'` → `needs_agent`; **upsert**: a verdict for an id whose entry is `needs_agent` replaces it in place; a `pending` for an id already decided throws (never downgrade); decided-over-decided is unchanged (appends). `executor` loaded from disk, kept across `_persistInProgress`, written by `finalize({executor})` |
| `src/result/provenance.js` | **new**, pure: `crossCheck(recorded {scenario_id, steps, assertions}, scenario)` → problems[] (scenario_id mismatch, unknown step id incl. `sub_steps`, unknown assertion id); `buildExecutor({kind, projectRoot, platform, deviceId, scenario})` (version from package.json, engine via `readEngine`, mode from config) |
| `src/scenario/load.js` | `loadScenario` also returns `sha256` of the raw bytes (one hash site) |
| `src/cli.js` | `add-assertion --pass true\|false\|pending`, `--judge <agent\|none>`; `finalize --scenario <path>` (load non-strict → cross-check → `invalid_input` before anything is written); `finalizeRun` accepts `executor`; `incomplete` → `fail('incomplete', …, data)` with a hint naming the pending ids |
| `src/run/judge.js` | **new** — interface `{name, judge(assertion, ctx) → {pass, message, expected?, actual?} \| null}`; `noJudge` (`name: 'none'`, always null) |
| `src/run/assertions.js` | mechanical → `judge {by:'mauto'}`, `mechanical: true`; Tier-2 → `judge.judge()`; `null` → `pass: 'pending'`, `judge {by:'none'}`; a judge verdict → `judge {by: judge.name …}` |
| `src/run/handle.js` | `executor` (`kind: 'runner'`, platform from `bridge.getPlatform()`, the resolved device id, scenario path + sha); `incomplete` → `fail('incomplete', …)`, `data.pending[]` = `{assertion_id, step_id, type}`, hint = the exact `mauto result add-assertion … --judge agent` lines + `mauto result finalize --run-id … --scenario <path>` |
| `src/run/prepare.js` | carries `file` + `sha256` through |
| `src/result/junit.js` | `needs_agent` assertion/step → `<skipped message>`; `skipped` count on suite/suites; an `incomplete` run is not given the synthetic "run status" failure (its pending cases are visible as skipped) |
| `src/result/capability-catalog.js` | `assertion_provenance` (`add-assertion`, `--judge`, `addAssertion`, behavioral) and `executor` (`finalize`, `--scenario`, `finalize`, behavioral) |
| `src/memory/store.js` | no code change: `statusLetter` already maps every non-pass to `F`; test pins `incomplete → F` |
| docs | `docs/reference/result-schema.md` (new fields, status matrix, `needs_agent`, re-finalize recipe), `docs/reference/cli-verbs.md` (`--pass pending`, `--judge`, `--scenario`, exit 7), `docs/concepts/memory.md` (`incomplete` is recorded `F`) |
| `CHANGELOG.md`, `package.json`, lockfile | `0.40.0-rc.1`, entry under `[Unreleased]` |

## Decisions taken in this plan (flag any you disagree with)

1. **The `result` verb additions are not behind `MAUTO_REPLAY`.** They are additive and optional, and
   nothing publishes while `main` carries an rc. Gating flags on existing verbs would scatter gate checks
   through `cli.js`. The gate keeps covering only `run`.
2. **`--judge` accepts `agent | none`; `mauto` is written only in-process.** `--pass pending` implies
   `--judge none` (an explicit `--judge agent` with `pending` is `invalid_input`, and so is
   `--judge none` with a decided verdict). Without `--judge`, a decided verdict records no `judge`, the
   way it does today, so existing callers and the harness are unchanged.
3. **Never downgrade.** `pending` for an id already decided is `invalid_input`. A verdict replaces a
   `needs_agent` entry with the same id in place (keeping its position); decided-over-decided keeps
   today's append behaviour (out of scope).
4. **Re-finalize keeps the first `executor`.** An agent completing a runner's run must not rewrite it
   as `kind: agent`. A later `--scenario` must hash to the recorded `scenario_sha256`, else `invalid_input`
   ("the scenario changed since the run").
5. **`result finalize` never guesses the device.** `kind: agent`, `platform` and `device_id` are `null`
   (no device is connected); `engine`, `mode` and `mauto_version` come from the workspace and package.
6. **JUnit reads `needs_agent` as skipped, not failed.** CI gates on exit 7; the report shows what is pending.

## Tests (TDD, red first)

- **Schema:** 2.0-era fixtures (`tests/fixtures/result_schema_v2.0.json` + `tests/unit/result/fixtures/*`)
  still validate; a result with every new field validates; `result-schema-additive` green.
- **Store:** fields persisted; `mechanical` default; upsert replaces `needs_agent` in place; `pending` over
  decided throws; decided-over-decided appends; `executor` survives add-assertion + re-finalize.
- **Outcome:** full matrix table (error step > failed step > failed assertion > pending > passed), incl.
  pending step.
- **Provenance:** sha256 equals `crypto` over the file bytes; cross-check cases (scenario_id mismatch,
  unknown step, unknown sub-step accepted, unknown assertion, all-good).
- **CLI:** `add-assertion --pass pending` / `--judge` matrix; `finalize --scenario` (good → executor written;
  mismatch → `invalid_input` and the file unchanged; changed scenario on re-finalize → `invalid_input`);
  `incomplete` → exit 7.
- **Runner:** Tier-2 → `needs_agent` + `judge.by: none`; a stub judge's verdict is recorded with its name;
  run → `incomplete` exit 7 with `pending[]` and the hint commands.
- **Exit criterion, end to end on `buildProgram`:** `run` → 7 → `add-assertion --pass true --judge agent`
  per pending id → `finalize --scenario` → `passed`, exit 0, `executor.kind === 'runner'` preserved.
- **Memory:** harvesting an `incomplete` result records `F`.
- **JUnit:** `needs_agent` → `<skipped>`, counts; an incomplete run has no synthetic failure.
- **Guards:** `result-coverage` (two new catalog entries with behavioral write proof), `result-schema-additive`,
  docs guards; each new guard seen red once.

## Verification

`npm test`, `npm run lint`, `npm run lint:guides`, `npm run lint:schema-additive`, `./scripts/pack-smoke.sh`.
Real device: `smoke_nav` still replays identically to the harness (it has no Tier-2 assertion), and a
copy with one Tier-2 assertion exits 7, then completes via one-shot verbs.

## Rollback

Optional fields written during the rc are tolerated by every reader (schema optional, JUnit/memory
tolerant). Reverting the code leaves those files valid.
