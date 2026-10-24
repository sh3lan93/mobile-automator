---
title: "CLI Verbs Reference"
description: "Complete reference for every mauto CLI verb - device actions, authoring, workspace, reasoning, sessions, and memory - with the uniform JSON envelope."
---

# CLI Verbs Reference

`mauto` is a host-agnostic CLI for AI-driven mobile QA automation. Any AI coding agent drives a device through `mauto` verbs; the verbs wrap the internal [mobile-mcp engine](mcp-tools.md), which talks to the real device or emulator. The agent is the brain (it decides *what*); the verbs are the hands (they perform deterministic actions).

This page catalogs every verb, grouped by category.

## The uniform JSON envelope

Every verb emits a single uniform JSON envelope on stdout so any agent can parse the outcome the same way:

- **Success:** `{ "ok": true, "data": …, "schema_version": "2.1" }` (plus an optional `hint`).
- **Failure:** `{ "ok": false, "error": { "kind": …, "message": … }, "hint": …, "schema_version": "2.1" }` (plus an optional `data`).

The canonical shape is `{ok, data, error, hint, schema_version}`. The envelope `schema_version` is currently `2.1`.

!!! note "The `--human` flag"
    Every verb accepts a global `--human` flag (default off). With it, `mauto` renders a compact human-readable line instead of the JSON envelope. Leave it off when an agent is parsing output; turn it on for interactive terminal use.

!!! warning "RAW-output exception"
    Four verbs do **not** wrap their output in the envelope on success. `guide`, `schema`, `bootstrap`, and `memory show` print raw markdown/JSON verbatim, because the agent injects that text straight into its own context. (On failure they still emit the normal error envelope.)

## Error kinds and exit codes

The `error.kind` on a failure envelope maps to a process exit code:

| Result | `error.kind` | Exit code |
|--------|--------------|-----------|
| Success | — | `0` |
| Internal error | `internal` | `1` |
| Partial success | `partial` | `1` |
| Device / engine failure | `device` | `2` |
| Invalid input | `invalid_input` | `3` |
| Target not found | `target_not_found` | `4` |
| Environment problem | `environment` | `5` |
| Cancelled | `cancel` | `130` |

---

## Device action verbs

These verbs drive the screen. Each accepts `--device <id>` to target a specific device.

!!! note "`--device` precedence"
    When resolving which device a verb runs against, the order is: explicit `--device <id>` **>** the persisted selection (`mauto devices use <id>`) **>** `null` (the engine auto-selects when exactly one device is connected).

| Verb | Description |
|------|-------------|
| `mauto elements` | List the platform-agnostic UI elements currently on screen |
| `mauto screenshot <path>` | Save a screenshot to `<path>` |
| `mauto tap --at <x,y>` | Tap at absolute coordinates |
| `mauto type <text>` | Type text into the focused element |
| `mauto swipe --direction <up\|down\|left\|right>` | Swipe in a cardinal direction |
| `mauto press <button>` | Press a hardware button (`BACK`, `HOME`, `ENTER`, …) or a semantic action |
| `mauto long-press --at <x,y> [--duration <ms>]` | Long-press at coordinates **(new in 0.21.0)** |
| `mauto double-tap --at <x,y>` | Double-tap at coordinates **(new in 0.21.0)** |
| `mauto launch <appId> [--resume]` | Launch an installed app by package/bundle id. Restarts the app if it is running, so it opens on its initial screen; `--resume` brings a running app to the front in its current state instead **(new in 0.21.0; cold start by default since 0.34.0)** |
| `mauto terminate <appId>` | Stop a running app by package/bundle id **(new in 0.34.0)** |
| `mauto install <path>` | Install an app from a local `.apk` / `.app` / `.ipa` **(new in 0.21.0)** |
| `mauto uninstall <appId>` | Uninstall an app by id **(new in 0.21.0)** |
| `mauto open-url <url>` | Open a URL on the device — web (`https://…`) or deep link (`myapp://…`). To restore the engine's http(s)-only guard, `export MOBILEMCP_ALLOW_UNSAFE_URLS=0` and run `mauto session end` ([#212](https://github.com/sh3lan93/mobile-automator/issues/212)) **(new in 0.21.0)** |
| `mauto orientation <portrait\|landscape>` | Set device orientation **(new in 0.21.0)** |

!!! tip "New in v0.21.0"
    Seven device verbs were added in **v0.21.0**: `long-press`, `double-tap`, `launch`, `install`, `uninstall`, `open-url`, and `orientation`.

!!! note "`launch` cold-starts by default (0.34.0)"
    `mauto launch <appId>` stops the app, then launches it, so a scenario's `launch_app` step starts on the app's initial screen even when a previous run left the app open ([#255](https://github.com/sh3lan93/mobile-automator/issues/255)). It resets the screen, not app data — use the `app_state: "fresh_install"` precondition for that.

    - Default result: `{"launched": "<appId>", "cold": true}`. An app that is not running is simply started.
    - If the app cannot be stopped, the launch fails with a `device` error whose hint suggests `--resume`; nothing is launched.
    - `--resume` skips the stop and keeps the old behaviour: `{"launched": "<appId>", "cold": false}`. A scenario step asks for it with `"cold": false`.

    `mauto terminate <appId>` stops the app on its own and returns `{"terminated": "<appId>"}`.

### Semantic actions (platform-agnostic mode)

In platform-agnostic mode, `mauto press` also resolves four **semantic actions** to per-platform mechanics at replay time:

- `press_back`
- `dismiss_keyboard`
- `grant_permission`
- `deny_permission`

An unresolvable semantic action fails honestly with a `device` error rather than a silent no-op. Hardware buttons (`BACK` / `HOME` / `ENTER`) keep their passthrough behavior.

---

## Author & verify verbs

Used to author scenario JSON, evaluate assertions, and assemble result files.

| Verb | Description |
|------|-------------|
| `mauto validate <file> [--strict]` | Validate a scenario JSON file against the [scenario schema](schema.md); warns (or, with `--strict`, fails) on actions that cannot replay unattended, and warns on `launch_app` steps that leave `cold` unset |
| `mauto assert <type> [--target --expected --operator --count --pattern --variable --device]` | Evaluate an assertion; mechanical types are decided by the CLI, visual types are deferred to the agent |
| `mauto result add-step --run-id --step-id --status [--scenario-id --attempts --screenshot --error-message --observation <type>:<message> --capture <name>=<value>]` | Append a step result to a run; `--observation` and `--capture` are repeatable |
| `mauto result add-assertion --run-id --step-id --type --pass [--scenario-id --assertion-id --message --expected --actual]` | Record an assertion verdict against a step |
| `mauto result finalize --run-id [--scenario-id --status --duration --app-version --device-model --api-level --environment --summary]` | Assemble the final [result file](result-schema.md) and auto-harvest memory |

!!! note "`validate` and replay warnings"
    Schema-valid is not the same as replayable, so `validate` also reports replay warnings in `data.warnings`, with a summarising `hint`. A scenario with nothing to report gets the bare `{"valid": true}`.

    Every warning has the shape `{code, action, path, message}`, plus `step_id` for steps. `path` is `steps[N]` (nested steps read `steps[N].sub_steps[M]`) or `preconditions.device_actions[N]`. Warnings are listed in document order, and the `hint` counts them per code, for example `N step(s) leave an optional field unset; set it explicitly — see data.warnings`.

    | Code | Severity | Trigger | Under `--strict` |
    |---|---|---|---|
    | `unsupported_action` | blocking | The step or precondition uses an action the action catalog marks `unsupported`: the engine exposes no primitive for it, so no `mauto` verb can run it and it cannot replay unattended. | Fails with `invalid_input` and `data.valid: false` |
    | `launch_cold_implicit` | advisory | A `launch_app` step leaves `cold` unset and is not the scenario's first top-level step (any launch inside `sub_steps` counts). It restarts the app; set `"cold": false` to resume or `"cold": true` to confirm the restart, and the warning goes away. | Never fails |

!!! note "`result finalize` and memory"
    On finalize, `mauto` auto-harvests typed observations into cross-session memory. This is best-effort: a memory failure never fails an otherwise-successful finalize — it folds into the envelope `hint` instead. See [Cross-Session Memory](../concepts/memory.md).

---

## Workspace verbs

Scaffold and configure the `mobile-automator/` workspace.

| Verb | Description |
|------|-------------|
| `mauto setup [--mode aware\|agnostic]` | Scaffold `mobile-automator/` (subdirs `scenarios/`, `screenshots/`, `results/`, `memory/`) and write `config.json` |
| `mauto config get <key>` | Read a config value by dotted path |
| `mauto config set <key> <value>` | Write a config value by dotted path. `config set engine <mobilecli\|legacy>` also clears the pinned device when the engine changes, since device ids differ between engines |

The mode is chosen at setup and stored as `mode` in `config.json`: `--mode aware` → `platform-aware` (single-OS / OS-specific UI tests); `--mode agnostic` → `platform-agnostic` (one scenario runs across platforms such as Flutter / RN / KMP / CMP). Configs predating the field are treated as `platform-aware`.

---

## Reasoning verbs

The agent pulls reasoning on demand. These verbs **print raw content on success** (see the RAW-output exception above), because the agent injects the text into its context.

| Verb | Description |
|------|-------------|
| `mauto guide <topic>` | Print the workflow guide for a topic: `generate`, `execute`, or `setup` |
| `mauto schema <name>` | Print a schema: `scenario`, `result`, or `config` |
| `mauto bootstrap` | Print the verb map and non-negotiable invariants |

---

## Agent integration verbs

Wire `mauto` into a host AI agent.

| Verb | Description |
|------|-------------|
| `mauto init --agent <claude\|cursor\|gemini\|copilot\|agents\|all>` | Install native Agent Skills (and host-specific slash-commands / rules / MCP entries) for the chosen host |
| `mauto mcp` | Run the MCP prompts server (stdio) that exposes the workflows as prompts |
| `mauto doctor` | Report whether this project's agent integration (what `mauto init` installed) is missing or out of date. Always `ok`; `data.hosts[]` carries per-file status, `data.stale[]` names the hosts to refresh, and the hint gives the `mauto init` command to run |

All five hosts get native Agent Skills (one per workflow topic: generate / execute / setup). Claude and Cursor additionally get slash-commands / project rules plus a `mauto` MCP server entry (`{ "command": "mauto", "args": ["mcp"] }`). `init --agent all` continues on error and returns one envelope with a per-agent ok/failed map in `data.agents[]`.

A successful `init` reports the canonical per-file record in `data.changes[]` (or `data.agents[].changes[]` for `--agent all`): one `{ path, status }` entry per owned file in write order, where status is `created`, `updated`, or `unchanged`. When a run refreshes a host that was previously installed, the envelope hint carries `refreshed N stale file(s) for <agent>`; a fresh install gets no hint.

---

## Device session verbs

Device verbs are backed by a single persistent mobile-mcp session daemon. These verbs manage that daemon and the device selection.

| Verb | Description |
|------|-------------|
| `mauto session start [--device <id>] [--idle <ms>]` | Start the persistent session daemon (idempotent; returns `already_running: true` if alive) |
| `mauto session status` | Report `{ running, reason, in_flight, device, log_path, engine, engine_source, resolved_engine, resolved_engine_source }` — `log_path` is reported whether or not a daemon is up; `reason` is `engine_exited` when a reachable daemon's device engine has died (it is shutting down and the next verb starts a fresh one), otherwise `null`. `engine` is the running daemon's device engine (`null` when none is up); `resolved_engine` is what the workspace `engine` key (or an exported `MOBILEMCP_LEGACY_ROBOT`) asks for — when they differ, the next device verb restarts the session on `resolved_engine` |
| `mauto session end` | Stop the daemon and wait until it has exited. A daemon still alive 35s after acknowledging is terminated (`forced: true`). Fails with `kind: device` and the `pid` if the daemon cannot be stopped |
| `mauto devices` | List connected devices/simulators (id / name / platform / state) |
| `mauto devices use <id>` | Validate the id against the live list, then persist the selection |
| `mauto devices clear` | Remove the persisted selection |

---

## Telemetry verbs

Anonymous usage telemetry, off by default. See
[Telemetry & Privacy](telemetry.md) for the exact field list and delivery
mechanics.

| Verb | Description |
|------|-------------|
| `mauto telemetry status` | Report whether telemetry is on, what would be sent, and what is queued |
| `mauto telemetry enable` | Turn on anonymous usage telemetry |
| `mauto telemetry disable` | Turn off anonymous usage telemetry |
| `mauto telemetry flush` | Upload any spooled telemetry now instead of waiting for the daemon |

---

## Memory verbs

Cross-session memory lives in `mobile-automator/memory/`. There are three kinds across three files; only `app-knowledge` and `preferences` are agent-authored. See [Cross-Session Memory](../concepts/memory.md) for the full model.

| Verb | Description |
|------|-------------|
| `mauto memory show [--kind <run-history\|app-knowledge\|preferences>] [--scenario <id>]` | Print memory as raw markdown (RAW-output verb) |
| `mauto memory add <text> --kind <app-knowledge\|preferences>` | Record an agent-authored entry |
| `mauto memory forget --kind <app-knowledge\|preferences> --match <substr>` | Remove agent-authored entries containing `<substr>` |

!!! note "run-history is machine-owned"
    `run-history` is auto-harvested on `result finalize` and is **not** a valid target for `memory add` / `memory forget`. Only `app-knowledge` and `preferences` are agent-authored.

---

## Related references

- [Test Scenario Schema](schema.md) — action and assertion structure that `validate` checks
- [Test Result Schema](result-schema.md) — the file `result finalize` assembles
- [Cross-Session Memory](../concepts/memory.md) — how memory verbs and auto-harvesting work
- [Internal Engine (mobile-mcp)](mcp-tools.md) — the primitives `mauto` verbs wrap

[← Back to Reference Index](index.md)
