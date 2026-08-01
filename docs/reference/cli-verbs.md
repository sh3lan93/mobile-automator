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
| `mauto launch <appId>` | Launch an installed app by package/bundle id **(new in 0.21.0)** |
| `mauto install <path>` | Install an app from a local `.apk` / `.app` / `.ipa` **(new in 0.21.0)** |
| `mauto uninstall <appId>` | Uninstall an app by id **(new in 0.21.0)** |
| `mauto open-url <url>` | Open a URL (deep link or web) on the device **(new in 0.21.0)** |
| `mauto orientation <portrait\|landscape>` | Set device orientation **(new in 0.21.0)** |

!!! tip "New in v0.21.0"
    Seven device verbs were added in **v0.21.0**: `long-press`, `double-tap`, `launch`, `install`, `uninstall`, `open-url`, and `orientation`.

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
| `mauto validate <file>` | Validate a scenario JSON file against the [scenario schema](schema.md) |
| `mauto assert <type> [--target --expected --operator --count --pattern --variable --device]` | Evaluate an assertion; mechanical types are decided by the CLI, visual types are deferred to the agent |
| `mauto result add-step --run-id --step-id --status [--scenario-id --attempts]` | Append a step result to a run |
| `mauto result finalize --run-id [--scenario-id --status --duration]` | Assemble the final [result file](result-schema.md) and auto-harvest memory |

!!! note "`result finalize` and memory"
    On finalize, `mauto` auto-harvests typed observations into cross-session memory. This is best-effort: a memory failure never fails an otherwise-successful finalize — it folds into the envelope `hint` instead. See [Cross-Session Memory](../concepts/memory.md).

---

## Workspace verbs

Scaffold and configure the `mobile-automator/` workspace.

| Verb | Description |
|------|-------------|
| `mauto setup [--mode aware\|agnostic]` | Scaffold `mobile-automator/` (subdirs `scenarios/`, `screenshots/`, `results/`, `memory/`) and write `config.json` |
| `mauto config get <key>` | Read a config value by dotted path |
| `mauto config set <key> <value>` | Write a config value by dotted path |

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

All five hosts get native Agent Skills (one per workflow topic: generate / execute / setup). Claude and Cursor additionally get slash-commands / project rules plus a `mauto` MCP server entry (`{ "command": "mauto", "args": ["mcp"] }`). `init --agent all` continues on error and returns one envelope with a per-agent ok/failed map in `data.agents[]`.

---

## Device session verbs

Device verbs are backed by a single persistent mobile-mcp session daemon. These verbs manage that daemon and the device selection.

| Verb | Description |
|------|-------------|
| `mauto session start [--device <id>] [--idle <ms>]` | Start the persistent session daemon (idempotent; returns `already_running: true` if alive) |
| `mauto session status` | Report `{ running: bool }` |
| `mauto session end` | Stop the daemon and remove the socket / pidfile |
| `mauto devices` | List connected devices/simulators (id / name / platform / state) |
| `mauto devices use <id>` | Validate the id against the live list, then persist the selection |
| `mauto devices clear` | Remove the persisted selection |

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
