---
description: "Run your first mobile test in 5 minutes - from setup to test generation and execution with mobile-automator."
---

# Quick Start

Get mobile-automator working in 5 minutes with a real test scenario.

This quick start uses **Claude Code** as the example agent. For Cursor, swap `--agent claude` → `--agent cursor`. For any other agent, see [Using another agent](#using-another-agent).

## Prerequisites

- `mauto` installed and on your PATH ([installation guide](installation.md))
- Mobile project directory (Android, iOS, Flutter, React Native, KMP, or CMP)
- An AI coding agent (Claude Code, Cursor, Gemini CLI, GitHub Copilot, OpenAI Agents, or any MCP-capable agent)
- Connected device or simulator

## Step 1: Wire mobile-automator into Your Project

```bash
cd /path/to/your/mobile-app
mauto init --agent claude      # or: cursor | gemini | copilot | agents | all
```

`init` installs native Agent Skills into your host's skills directory and writes the agent command files + MCP server entry (`.claude/commands/` + `.mcp.json` for Claude Code; `.cursor/` for Cursor).

## Step 2: Run Setup

```bash
mauto setup                    # add --mode agnostic for cross-platform apps
```

`setup` scaffolds the `mobile-automator/` workspace and writes its config. Add `--mode agnostic` for cross-platform apps (Flutter/RN/KMP/CMP) so one scenario runs on Android and iOS.

### What Gets Created

After setup completes:

```
mobile-automator/
├── config.json              # mode, environments, project config
├── scenarios/               # test scenario files (JSON, schema 2.1)
├── screenshots/             # reference screenshots
└── results/                 # test execution results
```

Read any config value with `mauto config get <key>`.

## Step 3: Check Your Device Is Visible

Before generating a test, confirm `mauto` can see a device:

```bash
mauto devices                 # lists connected devices and emulators/simulators
```

If more than one device is listed, pin the one you want:

```bash
mauto devices use <id>        # pin a specific device (mauto devices clear to unpin)
```

## Step 4: Generate a Test Scenario — From Inside Your Agent

Open your agent in the project. In **Claude Code**, `init` installs slash commands:

```
/mobile-automator-generate
```

This launches the generate workflow. Describe what you want to test:

Example prompt:

> "Test the login flow: 1) Launch the app, 2) Tap the login button, 3) Enter email 'test@example.com', 4) Enter password 'password123', 5) Tap Sign In, 6) Wait for home screen to load, 7) Verify welcome message appears"

The agent drives the app through `mauto` verbs and writes a complete test scenario in JSON, including:

- Step definitions (launch, tap, type, wait, etc.)
- Assertions (element visibility, text content, etc.)
- Capture values for later verification
- Retry logic for flaky operations

A new scenario file is created in `mobile-automator/scenarios/`.

In **Cursor**, `init` installs a project rule instead — just ask the agent in plain language (e.g. *"generate a login test"*). **Any other agent:** run `mauto mcp` (MCP prompts server) or read `mauto bootstrap` + `mauto guide generate`, then call the verbs directly.

## Step 5: Execute the Test

```
/mobile-automator-execute
```

The agent replays the scenario and:

1. Lists available scenarios
2. Confirms device connection
3. Verifies the app is installed (or offers to build/install)
4. Executes the scenario step by step
5. Captures observations (flakiness, regressions, state context)
6. Generates a detailed result report

Results are saved to `mobile-automator/results/<run_id>.json`.

## Step 6: Review Results

Open the result file in your editor:

```bash
cat mobile-automator/results/<run_id>.json
```

The result includes:

```json
{
  "run_id": "login_flow_20250227_143022",
  "scenario_id": "login_flow",
  "status": "passed",
  "steps_executed": [
    {
      "step_id": "launch_app",
      "status": "passed",
      "duration_ms": 2300
    },
    {
      "step_id": "tap_login_button",
      "status": "passed",
      "duration_ms": 450
    }
    // ... more steps
  ],
  "observations": [
    {
      "type": "regression",
      "message": "Login button styling differs from reference screenshot"
    }
  ]
}
```

## Common Next Steps

### Generate More Tests

Repeat Step 4 with different user flows:

- Onboarding flow
- Checkout flow
- User profile editing
- Search functionality
- Data filtering

### Organize Tests with Tags

Add tags to scenarios for easy filtering:

```json
{
  "scenario_id": "login_flow",
  "tags": ["critical", "authentication", "smoke-test"],
  "actions": [ ... ]
}
```

Then ask your agent to execute only the critical-tagged scenarios.

## Troubleshooting

### No device listed by `mauto devices`

Ensure an emulator/simulator is running or a physical device is connected and authorized. See the [installation guide](installation.md) for platform-specific device setup.

### Generate can't find the app package

The app must be:

1. Built successfully in the project
2. Installed on the connected device/simulator

The generate workflow will prompt to build and install if needed.

### Tests fail with "element not found"

Common causes:

1. App is still loading — Use `wait_for_element` in the scenario
2. Element is off-screen — Use `scroll_to_element` before tapping
3. Different environment — Verify you're testing the correct environment (staging vs production)

Check the result observations for hints about what went wrong.

## What's Next?

- **[Core Concepts](../concepts/architecture.md)** — Understand the brain/hands architecture
- **[Guides](../guides/setup.md)** — Deep dive into each command
- **[Reference](../reference/assertions.md)** — Complete list of assertion types
- **[Examples](../examples/android.md)** — Real-world test scenarios

---

**Congratulations!** You've completed your first mobile test. Now explore the full documentation to master advanced features like result observations, custom assertions, and CI/CD integration.
