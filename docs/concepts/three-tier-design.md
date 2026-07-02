---
description: "Deep dive into mobile-automator's layering - the agent (brain), mauto CLI verbs for deterministic actions, and the mobile-mcp engine for device control."
---

# Layered Architecture

A detailed exploration of how mobile-automator separates judgment from mechanics across three layers: the agent (brain), the `mauto` verbs, and the mobile-mcp engine.

## Overview

```
┌─────────────────────────────────────┐
│  Layer 1: Agent (brain)             │
│  Decides what to do, reads guidance │
│  any AI host: Claude, Cursor, …     │
└──────────────┬──────────────────────┘
               │
      Resolves elements, judges
      assertions, assembles scenarios,
      pulls reasoning via mauto guide
               │
┌──────────────▼──────────────────────┐
│  Layer 2: mauto verbs               │
│  Deterministic actions + asserts    │
│  uniform {ok,data,error,hint,…}     │
└──────────────┬──────────────────────┘
               │
      One mechanical action per verb,
      wraps the engine behind a single
      persistent session daemon
               │
┌──────────────▼──────────────────────┐
│  Layer 3: mobile-mcp engine         │
│  Device primitives (internal)       │
│  wrapped by mauto, never agent-faced│
└─────────────────────────────────────┘
               │
      Device control,
      screenshot capture,
      element inspection
```

The contract is always the same: **agent (brain) → `mauto` verbs → mobile-mcp engine → device**. The agent never calls `mobile_*` tools directly; `mauto` is the only surface it drives.

## Layer 1: The Agent (brain)

### Purpose

Own the judgment that genuinely needs an LLM: deciding *what* to do, resolving fuzzy element references, evaluating visual assertions, and assembling scenarios.

### How it pulls reasoning

The agent is not pre-loaded with an always-on skill. It pulls task-specific reasoning on demand:

- `mauto guide generate` — reasoning for converting natural language into scenarios
- `mauto guide execute` — reasoning for running scenarios and collecting results
- `mauto guide setup` — reasoning for workspace setup
- `mauto bootstrap` — the verb map + invariants the agent must honor
- `mauto schema <scenario|result>` — the JSON schemas

`mauto init --agent <host>` installs a thin native Agent Skill per host that knows *when* to pull each guide. In Claude Code these are the hyphen slash-commands `/mobile-automator-generate` and `/mobile-automator-execute`.

### Responsibilities

1. **Element resolution** — turn "the Login button" into a concrete element using `mauto elements`
2. **Visual judgment** — decide whether a screen fulfills its purpose
3. **Scenario assembly** — compose JSON scenarios, then `mauto validate <file>`
4. **Result authoring** — drive `mauto result add-step` / `mauto result finalize`

### Why this layer?

Keeps judgment separate from mechanics. The deterministic verbs never have to "decide" anything — they execute exactly what the agent asks and report a predictable envelope.

## Layer 2: The `mauto` verbs

### Purpose

Provide a deterministic, host-agnostic surface. Each verb performs one mechanical action or assertion and emits the uniform JSON envelope `{ok,data,error,hint,schema_version}` (a `--human` flag is opt-in).

### Verb groups

- **Device actions:** `elements`, `tap`, `type <text>`, `swipe`, `press <button>`, `screenshot <path>`
- **Author & verify:** `validate <file>`, `assert <type>`, `result add-step`, `result finalize`
- **Workspace:** `setup`, `config get <key>`, `config set <key> <value>`
- **Reasoning:** `guide <topic>`, `bootstrap`, `schema <name>`
- **Agent integration:** `init --agent <host>`, `mcp`
- **Device session:** `session start|status|end`; `devices`, `devices use <id>`, `devices clear`

### Why a deterministic CLI?

- **Testable** — each verb is a small unit with a predictable JSON contract
- **Host-agnostic** — any agent drives the same verbs; only the thin Agent Skill differs per host
- **Single device session** — device verbs reuse one persistent mobile-mcp daemon, so state survives across calls

## Layer 3: The mobile-mcp engine

### Purpose

Provide platform-agnostic device automation primitives. This is the **internal engine that `mauto` wraps** — it is not an agent-facing API. The agent never calls these tools; `mauto` translates verbs into mobile-mcp calls (see `src/device/mobile-mcp-client.js`).

### Provided primitives (internal)

**Device Management**: enumerate connected devices and simulators, query screen size, read and set orientation.

**App Control**: launch by package name, install APK/IPA, uninstall, force-stop.

**Screen Interaction**: capture screen, tap at coordinates, double-tap, long-press, type text, swipe, press system buttons (back, home, etc.).

**Element Inspection**: list elements with coordinates, open a URL.

### Why this abstraction?

Instead of `mauto` issuing platform-specific commands (adb for Android, xcrun for iOS) itself, it delegates to the engine. This:

- **Enables cross-platform verbs** — the same verb works on Android and iOS
- **Simplifies platform support** — adding a platform only requires updating mobile-mcp
- **Isolates the engine** — mobile-mcp is pinned in `package.json` and spawned from `node_modules`, never fetched at runtime

## Data Flow Example: Login Test

```
User: "Test the login flow"
        ↓
Layer 1: Agent pulls `mauto guide generate`, `mauto bootstrap`
  - Parse: "login flow"
  - Resolve elements via `mauto elements` (→ mobile-mcp → device)
  - Assemble action sequence:
    * launch_app
    * wait_for_element (login button)
    * tap (email field)
    * type (email)
    * tap (password field)
    * type (password)
    * tap (sign in button)
    * wait_for_element (home screen)
  - Add assertions:
    * home_screen element exists
    * welcome_text matches "Welcome, {username}"
  - `mauto validate` the scenario, then save it
        ↓
Saved to mobile-automator/scenarios/login_flow.json
        ↓
User: "Execute login test"
        ↓
Layer 1: Agent pulls `mauto guide execute`
  - For each action, drive a mauto verb ↓
        ↓
Layer 2: mauto verbs (tap, type, swipe, screenshot, assert…)
  - Each verb emits {ok,data,error,hint,schema_version}
  - Each device verb calls the engine ↓
        ↓
Layer 3: mobile-mcp engine
  - launch_app → adb shell am start / xcrun simctl…
  - take screenshot, detect element
  - convert coordinates to platform-specific command
  - input text via adb/xcrun
  - ... continue ...
        ↓
Layer 1: Agent judges assertions
  - home_screen visible? Visual judgment on the screenshot ✓
  - welcome_text matches? `mauto assert` mechanical check ✓
  - Records steps via `mauto result add-step`
        ↓
mauto result finalize → mobile-automator/results/<run_id>.json
```

## Communication Patterns

### Agent ↔ mauto

**Via**: process invocation of `mauto` verbs

- The agent invokes a verb with arguments
- The verb performs one deterministic action or assertion
- The verb returns the uniform JSON envelope `{ok,data,error,hint,schema_version}`
- The agent reads the envelope and decides the next step

### mauto ↔ mobile-mcp

**Via**: a single persistent mobile-mcp session daemon

- A device verb calls into the engine through `src/device/`
- The daemon executes via adb/xcrun/platform CLI
- The engine returns its result (screenshot bytes, elements list, etc.)
- The verb wraps that result in the JSON envelope for the agent

### State Management

**Config**: stored in `mobile-automator/config.json` during setup
- Read by `mauto` verbs and used to interpolate guide content at emit time
- Includes project knowledge, platform, environments, and the selected `mode`

**Scenarios**: stored as JSON files in `mobile-automator/scenarios/`
- Assembled by the agent (validated with `mauto validate`)
- Replayed step-by-step by the agent during execution

**Results**: stored as JSON files in `mobile-automator/results/`
- Authored via `mauto result add-step` / `mauto result finalize`

## Extensibility

### Adding a Verb or Guide Topic

To extend the CLI:

1. Register the verb handler in `src/cli.js`
2. For a new guide topic, add `src/guide/content/<topic>.aware.md` and `<topic>.agnostic.md`
3. Register the topic in `src/guide/emitter.js`, `src/mcp/prompts.js`, and `src/init/adapters.js`
4. For a topic exposed as a skill, add `src/guide/content/<topic>.invariants.md` and register it in `src/init/skill-meta.js` + `src/init/skill-renderer.js`
5. Extend the lint guards in `tests/lint/`

### Adding a New Engine Primitive

mobile-mcp is pinned outside this project. To pick up a newer engine, bump the `@mobilenext/mobile-mcp` pin in `package.json`; `mauto` verbs resolve it from `node_modules` at runtime.

## Next Steps

- [How Skills Work](skills.md) — Native Agent Skills and guide content
- [Setup Guide](../guides/setup.md) — Walkthrough of the setup workflow
- [Generator Guide](../guides/generate.md) — How test generation works
