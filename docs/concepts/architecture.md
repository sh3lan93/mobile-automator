---
description: "Architecture overview of mobile-automator - the agent (brain), the mauto CLI verbs, and the mobile-mcp automation engine it wraps."
---

# Architecture Overview

mobile-automator is a **host-agnostic `mauto` CLI** for AI-driven mobile QA automation. Any AI agent drives a real device or emulator through `mauto` verbs; the agent pulls its reasoning on demand via `mauto guide`. The CLI never reasons for the agent and the agent never touches the device directly — each does what it is best at.

## The contract

```
agent (brain) → mauto verbs → mobile-mcp engine → device
```

- The **agent** decides *what* to do: it resolves "the Login button" to a concrete element, judges visual assertions, assembles scenarios, and reads guidance via `mauto guide <topic>`.
- **`mauto`** does the deterministic work: each verb performs one mechanical action or assertion and emits the uniform JSON envelope `{ok,data,error,hint,schema_version}`.
- **mobile-mcp** is the internal automation engine that `mauto` wraps. The agent never calls `mobile_*` tools directly — `mauto` is the only surface the agent uses, and it translates verbs into mobile-mcp calls behind a single persistent session daemon.

## System Components

### The agent (brain)

Any AI agent (Claude Code, Cursor, Gemini CLI, Copilot, and more) drives the workflow. It pulls reasoning on demand rather than carrying an always-loaded skill:

- `mauto guide <generate|execute|setup>` — task-specific reasoning prose
- `mauto bootstrap` — verb map + invariants
- `mauto schema <scenario|result>` — the JSON schemas

`mauto init --agent <host>` installs native Agent Skills per host so the agent knows when to pull each guide.

### The `mauto` verbs

The deterministic surface the agent drives. Every verb emits `{ok,data,error,hint,schema_version}`; `--human` is an opt-in readable flag.

- **Device actions:** `elements`, `tap`, `type <text>`, `swipe`, `press <button>`, `screenshot <path>`
- **Author & verify:** `validate <file>`, `assert <type>`, `result add-step`, `result finalize`
- **Workspace:** `setup`, `config get <key>`, `config set <key> <value>`
- **Reasoning:** `guide <topic>`, `bootstrap`, `schema <name>`
- **Agent integration:** `init --agent <host>`, `mcp` (MCP prompts server)
- **Device session:** `session start|status|end`; `devices`, `devices use <id>`, `devices clear`

### The mobile-mcp engine

`mobile-mcp` is bundled as a pinned dependency and spawned from `node_modules` — never fetched at runtime. It is the internal engine, not an agent-facing API. It provides the cross-platform device primitives that `mauto` verbs are built on:

- Device enumeration
- App launch and control
- Screen interaction (tap, swipe, type, scroll)
- Screenshot capture
- Element detection and inspection
- Button press (back, home, volume)
- URL opening and orientation control

`src/device/` wraps this engine via one persistent session daemon so device state survives across verb invocations.

## Data Flow

```
User Input (natural language)
        ↓
agent pulls reasoning: mauto guide generate
        ↓
agent drives mauto verbs (elements, tap, type, …)
        ↓   each verb → mobile-mcp engine → device
agent assembles + validates JSON scenario
        ↓
Saved to mobile-automator/scenarios/
        ↓
agent pulls reasoning: mauto guide execute
        ↓
For each step:
  - agent drives the action via a mauto verb (→ mobile-mcp → device)
  - agent judges the assertion (mauto assert for mechanical checks)
  - agent records the step via mauto result add-step
        ↓
mauto result finalize → mobile-automator/results/
```

## File Structure

```
mobile-automator/                          # created in the user's project by mauto setup
├── config.json                            # project knowledge + mode
├── scenarios/                             # test scenario JSON files
│   ├── login_flow.json
│   ├── checkout.json
│   └── ...
├── screenshots/                           # reference screenshots for assertions
│   ├── login_screen.png
│   └── ...
├── results/                               # test execution result reports
│   ├── login_flow_20250227_143022.json
│   └── ...
└── .session/                              # persistent device-session state
```

Guide prose and schemas live in the installed package, not the workspace:

```
src/
├── guide/content/
│   ├── <topic>.aware.md                   # platform-aware guide prose
│   └── <topic>.agnostic.md                # platform-agnostic guide prose
└── schemas/
    ├── scenario_schema.json               # v2.1
    └── result_schema.json
```

## mobile-mcp Integration

`mobile-mcp` is pinned in `package.json` (`@mobilenext/mobile-mcp`) and resolved from `node_modules` at runtime (see `src/device/mobile-mcp-client.js`). It is spawned as a single persistent session daemon and never fetched ad hoc. This provides 20+ automation primitives that work across all supported platforms — but they are an implementation detail of `mauto`, not something the agent calls.

## Key Design Decisions

### Why the brain/hands split?

**Separation of concerns:**

- The **agent (brain)** owns judgment — resolving element references, evaluating visual assertions, and assembling scenarios. This is the part that genuinely needs an LLM.
- **`mauto`** owns determinism — each verb is a small, testable action that emits a predictable JSON envelope.
- **mobile-mcp** owns the platform mechanics — translating a tap into the right adb/xcrun call.

**Benefits:**
- Each layer evolves independently
- Deterministic verbs are easy to test and mock
- Clear responsibility boundaries
- One reusable automation engine across hosts
- The agent stays host-agnostic — only the thin Agent Skill installed by `mauto init` differs per host

### Why pull reasoning on demand?

Reasoning is delivered via `mauto guide <topic>` at explicit invocation, never as an ambient always-loaded skill. This keeps the agent's context lean and lets each host install only a thin skill that knows *when* to pull the relevant guide.

### Why This Schema Design?

The test scenario schema provides rich, expressive capabilities:

- **14 action types** — scroll, scroll_to_element, wait_for_loading_complete, capture_value, clear_app_data, and more
- **27 assertion types** — comprehensive coverage across text, visibility, collections, visual, navigation
- **Advanced control** — retry policies, conditions, sub-steps
- **Better debugging** — capture values for later assertion, detailed step context
- **Flakiness handling** — explicit retry policies for async operations
- **String step IDs** — readable names (`tap_login` instead of `1`)

### Why Not Modify Your Source Code?

All tests live in the `mobile-automator/` directory, completely separate from your source code. This means:

- Source code remains untouched and pristine
- Tests don't interfere with builds or deployments
- Different projects can have different test suites
- Easy to delete or regenerate tests without impacting code
- Clear separation between app and test infrastructure

## Architecture in Practice

### Example: Complete Login Flow

Here's exactly what happens when you generate and execute a login test:

```
1. User Input
   "Tap login button, enter email user@example.com, wait for spinner,
    verify success message"

2. Agent pulls reasoning:
   - mauto guide generate
   - mauto bootstrap (verb map + invariants)

3. Agent generates the scenario (brain):
   - Parses natural language
   - Two-pass semantic model:
     * Pass 1: classify each step as action or assertion
     * Pass 2: resolve element references (mauto elements → mobile-mcp → device)
   - Assembles JSON, then mauto validate <file>

4. Scenario JSON Created:
   {
     "schema_version": "2.1",
     "mode": "platform-aware",
     "steps": {
       "tap_login": {
         "type": "tap",
         "element": "login_button"
       },
       "enter_email": {
         "type": "type",
         "element": "email_field",
         "text": "user@example.com"
       },
       "wait_spinner": {
         "type": "wait_for_loading_complete"
       },
       "verify_success": {
         "type": "element_text",
         "element": "success_message",
         "expected_exact": "Success"
       }
     }
   }

5. Execution Phase:
   - Agent pulls reasoning: mauto guide execute
   - For each step (agent drives verbs):
     * mauto elements / screenshot → mobile-mcp → device (read state)
     * mauto tap / type / swipe → mobile-mcp → device (act)
     * mauto assert (mechanical) or agent vision judgment (visual)
     * mauto result add-step (record)
   - mauto result finalize

6. Result JSON:
   {
     "run_id": "run_2026-02-27_145230",
     "status": "passed",
     "steps_executed": [
       {"step_id": "tap_login", "status": "passed", "duration_ms": 245},
       {"step_id": "enter_email", "status": "passed", "duration_ms": 320},
       {"step_id": "wait_spinner", "status": "passed", "duration_ms": 1200},
       {"step_id": "verify_success", "status": "passed", "duration_ms": 150}
     ],
     "observations": []
   }
```

## Next Steps

- [Brain/Hands Layering Deep Dive](three-tier-design.md) — Detailed breakdown of each layer
- [How Skills Work](skills.md) — How native Agent Skills and guide content fit together
- [Setup Guide](../guides/setup.md) — Walkthrough of the setup workflow
