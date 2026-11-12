# Replay R3 — full action coverage and `run.*` config keys (plan)

Issue #279 · PRD #271 (slice R3, gated rc) · branch `replay/279-full-action-coverage` · version **0.40.0-rc.3**
(`main` is at rc.2; R2's review fixes took it.)

## Goal

`mauto run` performs every scenario action the action catalog does not mark `unsupported`, and every
precondition `device_action`, with no agent. The three unsupported actions (`clear_app_data`,
`enable_wifi`, `disable_wifi`) no longer abort the run as a fatal "not supported yet": they are recorded as a
step with `needs_agent: true`, so the run finalizes `incomplete` (exit 7) and says what the agent must do.
`target_pattern` resolves. Timings come from optional `run.*` config keys and a `--timeout-ms` flag.

## Handlers (all `async (step, ctx)`; throw to fail; `FatalStepError` is not retried)

| Action | Module | Behaviour |
|---|---|---|
| `long_press` | `gestures.js` | resolve target → `bridge.longPress({x,y})` (+ `duration` only if the step has `wait_config`-free `value` numeric ms; otherwise omitted) |
| `double_tap` | `gestures.js` | resolve → `bridge.doubleTap` |
| `swipe` | `gestures.js` | `step.value` ∈ up/down/left/right else Fatal → `bridge.swipe({direction})` |
| `press_button` | `gestures.js` | `step.value` required, upper-cased → `bridge.pressButton` |
| `open_url` | `gestures.js` | `step.value` required → `bridge.openUrl` |
| `scroll_to_element` | `scroll.js` | resolve; on `TargetNotFoundError` swipe `step.value` (default `up`) and re-resolve, up to `run.scroll_max_swipes` swipes; then fail with the count |
| `wait_for_element_gone` | `wait.js` | poll until the target no longer resolves; timeout → fail naming what is still on screen |
| `wait_for_loading_complete` | `wait.js` | poll until **two consecutive** looks show no element matching any `run.loading_indicator_labels` entry (also matches `step.wait_config.indicator` aliases when set: spinner / progress_bar / shimmer / skeleton are label words). No labels configured → a recorded `state_context` note and the step passes after the two stable polls (we cannot know what to look for; never a silent pass) |
| `capture_value` | `capture.js` | resolve target → `textOf(element)` → `ctx.variables[capture_to]` and `store.captureVariable`; missing `capture_to` or an undeclared variable → Fatal |
| precondition `install_app` | `preconditions.js` | `bridge.installApp(value)`; no `value` → `needs_agent` (a run has no pre-flight build) |
| precondition `uninstall_app` | `preconditions.js` | `bridge.uninstallApp(target_package ‖ scenario.app_package)` |
| precondition `set_orientation` | `preconditions.js` | `bridge.setOrientation(value)` |
| `clear_app_data`, `enable_wifi`, `disable_wifi` | `needs-agent.js` | throw `NeedsAgentError` → recorded `status: 'skipped', needs_agent: true`, error_message names what to do by hand |

`target_pattern`: `resolveTarget(..., { pattern })` in `src/run/resolve.js` filters `textOf` by regex when `target` is
absent or in addition to it (a target string narrows first, the pattern filters the matches). An invalid regex is
Fatal. The harness copy `sample-app/scripts/lib/resolve.js` is kept byte-identical by
`tests/lint/run-resolve-copy.test.js` until R7 — I update both.

## Config and flags

- `config_schema.json`: optional `run { poll_ms (1500), default_timeout_ms (30000), scroll_max_swipes (10), loading_indicator_labels (stringList) }`,
  integers `minimum` 1 / 0 as appropriate. Not written by the scaffold (optional → old workspaces unaffected);
  `tests/lint/config-schema.test.js` gains a case that a `run` block validates and that the scaffold skeleton still conforms.
- `src/run/settings.js` (new, pure): `runSettings(config, { timeoutMs })` → `{ pollMs, defaultTimeoutMs, scrollMaxSwipes, loadingLabels }`
  with defaults. `poll.js` loses its module constants: `poll` and `timeoutFor` take the settings from `ctx.settings`.
- `--timeout-ms <ms>` on `mauto run`: **caps** every per-step wait (`min(step timeout, flag)`) — a CI budget, not an override that
  could lengthen a step. Invalid (non-positive integer) → `invalid_input` before any device work (in `prepareRun`).
- `handleRun` loads `config.json` once (via `config/manager.load`), builds settings, puts them on the runner ctx.

## Runner changes

- `ctx.variables`: a per-run map; assertions pass it to `evaluator.evaluate(..., { elements, variables })`
  (so `value_matches_variable` can be decided mechanically — today it would always be unset).
- Preconditions run first, before step 1, each recorded as step `precondition_<n>` (1-based index in `device_actions`)
  through the same `runStep` (retry-free). A failed precondition stops the run like a failed step.
  `crossCheck` (`src/result/scenario-check.js`) learns to accept `precondition_<n>` ids, otherwise an agent's
  `result finalize --scenario` on a run with a precondition would be refused.
- `NeedsAgentError` (`src/run/needs-agent.js`): `runStep` records `status: 'skipped', needs_agent: true`, `outcome.pending = true`;
  the runner **stops** there (what follows would run on a state nobody established) and `deriveRunStatus` already yields `incomplete`.
- `ResultStore#addStep` accepts and persists `needs_agent` (schema field exists since R2; no schema change).
- The `action-catalog.js` comment for `composed` is amended: the agent *or `mauto run`* composes it. No resolution change.

## New guard — `tests/lint/run-action-coverage.test.js`

1. Every `ACTION_CATALOG` action whose resolution ≠ `unsupported` has a key in `ACTION_HANDLERS`.
2. Every `unsupported` action maps to the needs-agent handler (so "unsupported" cannot silently become "unknown").
3. Every schema precondition `device_actions` enum value has a key in `PRECONDITION_HANDLERS`.
4. No key in either map that is not a catalog action / precondition enum value.
Derived from the catalog and `scenario_schema.json`, never restated, and no "N actions" prose anywhere (docs-counts).

## Tests (TDD, red first; one `describe` per handler in `tests/unit/run/actions.test.js` on `makeFakeBridge`/`makeFakeClock`)

long_press, double_tap, swipe (bad direction), press_button, open_url, scroll_to_element (found at once / found after k swipes /
exhausts `scroll_max_swipes` / honours the config value), wait_for_element_gone (gone at once / disappears / times out),
wait_for_loading_complete (needs two stable polls; an indicator reappearing resets the count; no labels → note), capture_value
(text → variables + store; label fallback; undeclared variable), preconditions (each + `needs_agent` cases), needs-agent
actions, `target_pattern` (resolve.test.js), settings defaults/overrides, `--timeout-ms` cap and validation
(`prepare.test.js`, `run-verb.test.js` via `buildProgram`), runner (preconditions first, stops at needs_agent, variables reach
`value_matches_variable`), `handle.test.js` (a needs_agent step → exit 7 with its hint), store `addStep` `needs_agent`,
`crossCheck` accepts `precondition_<n>`, config-schema lint cases. The exit criterion gets one runner test over a scenario that
uses **every** supported action end to end on the fake bridge: all steps executed, none `needs_agent` except the unsupported ones.

## Docs / housekeeping

`docs/reference/cli-verbs.md` is untouched (the verb is hidden until G); `CHANGELOG.md` `[Unreleased]` gets the R3 entry;
`package.json` + lockfile → `0.40.0-rc.3`. The setup/config docs mention the optional `run.*` keys (`docs/` config reference),
without any count of actions.

## Decisions to confirm

1. **Unsupported action stops the run** (vs continuing). Recommended: stop — later steps rest on a state nobody established.
2. **`--timeout-ms` is a cap**, not an override.
3. **Preconditions are recorded as `precondition_<n>` steps** and `crossCheck` learns the pattern (alternative: record nothing on
   success, only a failed step — but then a passing run does not show what was set up).
4. **`install_app` without `value` → `needs_agent`**, not a failure (the run has no pre-flight build to fall back on).
5. **`wait_for_loading_complete` with no `loading_indicator_labels` configured passes after two stable polls with a note**
   rather than refusing; the legacy prose key `loading_indicators` is not parsed.

## Verification before PR

`npm test`, `npm run lint`, `npm run lint:guides`, `./scripts/pack-smoke.sh`, output in the PR body. A real-device E2E is not run
by me here; the PR notes it as the remaining check for the emulator workflow.
