---
description: "How mobile-automator skills work - native Agent Skills installed per host by mauto init, guide content in src/guide/content, and placeholders filled at emit time."
---

# How Skills Work

Understanding skills: how they're installed per host, how guide content is customized, and how the agent uses them during generate and execute.

## What Are Skills?

Skills are **native Agent Skills** that tell an AI host *when* to pull mobile-automator reasoning and how to drive the workflow. They are thin: their job is to invoke `mauto guide <topic>` at the right moment and to drive the device only through `mauto` verbs. The substance — the reasoning prose — lives in the installed package as guide content, not in the skill files.

Two main workflows:
- **Generate** — convert natural language into test scenarios (`mauto guide generate`)
- **Execute** — replay scenarios and report results (`mauto guide execute`)

## Installation

### `mauto init` installs per host

Skills are installed by `mauto init --agent <claude|cursor|gemini|copilot|agents|all>`. This writes the native Agent Skill for each host into that host's conventions (for example `.gemini/skills/` for Gemini CLI), plus slash-commands/rules and an MCP entry for hosts that support it.

In **Claude Code**, init installs the hyphen slash-commands `/mobile-automator-generate` and `/mobile-automator-execute`. Each command simply runs the matching `mauto guide <topic>` and follows it, driving the device through `mauto` verbs.

There is **no template-interpolation-at-setup step** that writes skill bodies, and **no resume-state file**. Setup records project knowledge into `mobile-automator/config.json`; skills are installed by `init` independently.

### Guide content lives in the package

The reasoning prose lives in the installed package under `src/guide/content/`:

```
src/guide/content/
├── generate.aware.md      ├── generate.agnostic.md
├── execute.aware.md       ├── execute.agnostic.md
└── setup.aware.md         └── setup.agnostic.md
```

Each topic has an `.aware.md` (platform-aware) and an `.agnostic.md` (platform-agnostic) variant. A topic exposed as a skill also has a placeholder-free, OS-free `<topic>.invariants.md`.

## Customization via Placeholders

Guide content carries `{{placeholder}}` tokens. These are **filled at emit time** — when the agent runs `mauto guide <topic>`, `src/guide/placeholders.js` interpolates the tokens from `mobile-automator/config.json`. A fallback guarantees no `{{` survives in emitted output, and lint guards enforce that no `mobile_*` tool names leak and that agnostic content names no OS.

### Example: Generate guide content

In the source content:
```markdown
# Generating tests for {{project_name}}

You are testing {{business_domain}}.

Project Architecture: {{architecture}}
App Package: {{app_package}}

Protected source directories (never modify):
{{protected_directories}}

Loading indicators in this project:
{{loading_indicators}}
```

After emit-time interpolation from `config.json`:
```markdown
# Generating tests for My Shopping App

You are testing E-commerce platform for fashion retail.

Project Architecture: MVVM with Clean Architecture
App Package: com.example.shopping

Protected source directories (never modify):
src/, lib/

Loading indicators in this project:
CircularProgressIndicator, Shimmer
```

The agent reads this interpolated guidance, then drives `mauto` verbs to do the work.

## Generate Workflow

### Purpose

Convert natural language descriptions into structured test scenarios (JSON following the scenario schema, v2.1).

### Inputs

- User description: "Test login flow with email and password"
- Device context: a connected device (via `mauto devices`)
- Project knowledge: interpolated into the guide from `config.json`

### Process

The agent, following `mauto guide generate`:

1. Parses user intent
2. Identifies the test flow (sequence of user actions)
3. Resolves elements with `mauto elements` (which wraps mobile-mcp → device)
4. Maps to test actions (tap, type, wait, etc.)
5. Adds contextual assertions
6. Includes retry logic for async operations
7. Validates the JSON with `mauto validate <file>` and saves it

### Output

```json
{
  "scenario_id": "login_flow",
  "schema_version": "2.1",
  "mode": "platform-aware",
  "tags": ["authentication", "critical"],
  "actions": [
    {
      "step_id": "launch_app",
      "action_type": "launch_app",
      "description": "Launch the application"
    },
    {
      "step_id": "wait_for_login_screen",
      "action_type": "wait_for_element",
      "element_description": "Login button",
      "timeout_seconds": 10
    },
    {
      "step_id": "tap_email_field",
      "action_type": "tap",
      "element_description": "Email input field"
    },
    {
      "step_id": "type_email",
      "action_type": "type",
      "text": "test@example.com"
    }
    // ... more actions
  ],
  "assertions": [
    {
      "assertion_id": "home_screen_visible",
      "action_step_id": "wait_for_home",
      "assertion_type": "element_exists",
      "element_description": "Home screen content"
    }
  ]
}
```

### Where Placeholders Help

- `{{business_domain}}` — helps the agent understand your business logic
- `{{architecture}}` — helps the agent use the right naming conventions
- `{{business_critical_paths}}` — focuses the agent on important flows
- `{{loading_indicators}}` — helps the agent add correct wait steps
- `{{protected_directories}}` — reminds the agent not to reference source code

## Execute Workflow

### Purpose

Replay test scenarios on a connected device and report detailed results with observations.

### Inputs

- Scenario JSON file
- A connected device
- Project configuration (`mobile-automator/config.json`)
- Reference screenshots (optional)

### Process

The agent, following `mauto guide execute`:

1. Parses the scenario JSON
2. For each action:
   - Drives a `mauto` verb (`tap`, `type`, `swipe`, `screenshot`, …) which wraps mobile-mcp → device
   - Reads the `{ok,data,error,hint,schema_version}` envelope
3. For each assertion:
   - Runs `mauto assert` for mechanical checks, or judges visually for vision assertions
   - Records the result via `mauto result add-step`
4. Calls `mauto result finalize` to write the report

### Output

```json
{
  "run_id": "login_flow_20250227_143022",
  "scenario_id": "login_flow",
  "schema_version": "2.1",
  "status": "passed",
  "duration_seconds": 15.3,
  "steps_executed": [
    {
      "step_id": "launch_app",
      "status": "passed",
      "duration_ms": 2300
    },
    {
      "step_id": "wait_for_login_screen",
      "status": "passed",
      "duration_ms": 450
    }
  ],
  "assertion_results": [
    {
      "assertion_id": "home_screen_visible",
      "status": "passed",
      "duration_ms": 120
    }
  ],
  "observations": [
    {
      "type": "regression",
      "step_id": "tap_email_field",
      "message": "Email field styling differs from reference screenshot"
    },
    {
      "type": "flakiness",
      "step_id": "wait_for_home",
      "message": "Loading indicator still visible after first wait, passed on retry after 2s additional wait"
    }
  ],
  "captured_variables": {
    "username": "John Doe",
    "user_id": "12345"
  }
}
```

### Where Placeholders Help

- `{{app_package}}` — know which app to launch and verify
- `{{build_system}}` — know how to rebuild if needed
- `{{build_command}}` — can rebuild with the correct command
- `{{loading_indicators}}` — know what to wait for
- `{{environments}}` — can switch environments between runs
- `{{business_critical_paths}}` — prioritizes these paths if tests fail

## Skill Lifecycle

### 1. Installation (`mauto init`)

```
User runs mauto init --agent <host>
    ↓
Native Agent Skill written into the host's conventions
    ↓
(Claude Code: /mobile-automator-generate, /mobile-automator-execute)
    ↓
Skill ready: it knows when to pull a guide
```

### 2. Setup (`mauto setup`)

```
User runs mauto setup [--mode agnostic]
    ↓
Project knowledge recorded into mobile-automator/config.json
    ↓
Mode stored (platform-aware default, or platform-agnostic)
```

### 3. Usage (generate / execute)

```
Agent runs mauto guide generate  (or execute)
    ↓
Guide content interpolated from config.json at emit time
    ↓
Agent reads guidance, drives mauto verbs (→ mobile-mcp → device)
    ↓
Scenario validated / result finalized into the workspace
```

### 4. Updates

**CLI updates**: pull the latest source and re-link. The verbs and bundled guide content update together; mobile-mcp updates with its pin in `package.json`.

**Re-install skills**: re-run `mauto init --agent <host>` to refresh the host's native Agent Skills.

**Refresh project knowledge**: re-run `mauto setup`, or edit `mobile-automator/config.json` directly — the next `mauto guide` emit picks up the new values.

## Accessing Project Knowledge

The full project configuration lives in `mobile-automator/config.json`:

```json
{
  "project_name": "My Shopping App",
  "platform": "android",
  "mode": "platform-aware",
  "environments": ["production", "staging", "development"],
  "app_package": "com.example.shopping",
  "architecture": "MVVM with Clean Architecture",
  "business_domain": "E-commerce platform for fashion retail",
  "business_critical_paths": ["onboarding", "login", "checkout", "payment"],
  "loading_indicators": ["CircularProgressIndicator", "Shimmer"],
  "protected_directories": ["src/", "lib/"],
  "build_command": "gradle assembleStaging",
  "platform_details": "Android (minSdk 24, targetSdk 34)",
  "build_system": "Gradle"
}
```

These values are interpolated into guide content at emit time, so the agent's reasoning adapts to your platform, environments, and architecture.

## Modes

The `mode` field in `config.json` selects how gestures are handled. It is set at `mauto setup`:

- **platform-aware** (default) — single-OS or OS-specific UI tests
- **platform-agnostic** (`mauto setup --mode agnostic`) — cross-platform tests (Flutter/RN/KMP/CMP) that map OS gestures to four semantic actions resolved per platform at replay time:
  - `press_back`
  - `dismiss_keyboard`
  - `grant_permission`
  - `deny_permission`

Each guide topic has both an `.aware.md` and an `.agnostic.md` variant in `src/guide/content/`; the mode decides which one is emitted.

## Why Pulled Guides Instead of Code?

Traditional test frameworks require you to write tests in code or DSLs. Pulled-on-demand guidance has significant advantages:

| Aspect | mobile-automator | Traditional Code |
|--------|--------|------------------|
| **Readability** | Plain markdown, AI-readable | Language syntax, IDE-dependent |
| **Customization** | Interpolated with project knowledge at emit time | Hardcoded values, must update manually |
| **Auditability** | Plain text, easy git history | Code review + build process |
| **AI Capability** | The agent understands natural-language intent | Must parse code syntax |
| **Versioning** | Scenarios live in your project git | Code repository complexity |
| **Context cost** | Reasoning pulled only when needed | Always loaded |
| **Maintenance** | Update one guide topic | Update every test file |

## Advanced Features

### Semantic Visual Testing

The agent doesn't use pixel-by-pixel comparison. Instead, it uses AI vision to answer:

> Does this screen fulfill the same purpose as the reference?

This is done by evaluating:
- **Screen Identity** — Is this the intended screen?
- **Key Elements** — Are critical UI elements present?
- **Text Content** — Does content match expectations?
- **Layout Structure** — Are elements arranged correctly?
- **Accessibility** — Can users interact as expected?

**Benefits:**
- Tolerates cosmetic changes (fonts, colors, spacing)
- Catches functional regressions (missing buttons, wrong text)
- More stable than screenshot matching
- Requires fewer reference images

### Flakiness Detection

The agent detects when tests are flaky:

```json
{
  "observations": [{
    "type": "flakiness",
    "message": "Step 4 (wait_for_home) failed initially, passed on retry after 2s additional wait"
  }]
}
```

This helps distinguish between:
- **Real bugs** — Test fails consistently
- **Timing issues** — Test fails then passes on retry (flaky)
- **Device state** — Test fails due to device memory/performance

### Regression Detection

The agent detects visual changes beyond what assertions check:

```json
{
  "observations": [{
    "type": "regression",
    "step_id": "verify_email_field",
    "message": "Email field styling differs from reference (color changed from blue to gray)"
  }]
}
```

This catches:
- UI/UX changes not covered by assertions
- Unintended visual modifications
- Layout regressions

### Value Capture and Variables

Capture values during test execution for later verification:

```json
{
  "steps": {
    "capture_user_id": {
      "type": "capture_value",
      "element": "user_id_display",
      "capture_to": "user_id"
    },
    "verify_balance": {
      "type": "element_text",
      "element": "balance_display",
      "condition": "user_id matches variable user_id"
    }
  }
}
```

This allows:
- Dynamic assertions (compare with captured values)
- Multi-step data validation
- State verification across test steps

### Conditional Execution

Execute steps conditionally based on previous results:

```json
{
  "steps": {
    "attempt_login": { "type": "tap", "element": "login_button" },
    "check_error": {
      "type": "element_exists",
      "element": "error_message",
      "optional": true
    },
    "retry_if_error": {
      "type": "tap",
      "element": "retry_button",
      "condition": "error_message is visible"
    }
  }
}
```

This allows:
- Error recovery logic
- Different paths based on app state
- Graceful handling of edge cases

### Retry Policies

Configure how steps retry on failure:

```json
{
  "steps": {
    "wait_for_data": {
      "type": "wait_for_element",
      "element": "data_list",
      "retry_policy": {
        "max_retries": 3,
        "wait_between_retries_ms": 1000,
        "backoff_factor": 1.5
      }
    }
  }
}
```

This handles:
- Network timeouts
- Slow async operations
- Race conditions

## Inspecting Skills and Config Locally

```bash
# See the interpolated generate guidance the agent will read
mauto guide generate

# Print the verb map + invariants
mauto bootstrap

# Check what project knowledge was recorded
cat mobile-automator/config.json

# Print a schema
mauto schema scenario
```

## Debugging

If the agent isn't behaving as expected:

1. **Check the emitted guide**: run `mauto guide <topic>` and confirm no `{{` remains
2. **Review config.json**: verify project knowledge was recorded correctly
3. **Check schemas**: review with `mauto schema scenario` / `mauto schema result`
4. **Re-install skills**: re-run `mauto init --agent <host>` if a host's skill is stale

## Next Steps

- [Setup Guide](../guides/setup.md) — Deep dive into the setup workflow
- [Generator Guide](../guides/generate.md) — How test generation works
- [Executor Guide](../guides/execute.md) — How test execution works
