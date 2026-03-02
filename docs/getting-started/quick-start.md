# Quick Start

Get mobile-automator working in 5 minutes with a real test scenario.

## Prerequisites

- Mobile project directory (Android, iOS, Flutter, React Native, KMP, or CMP)
- Connected device or simulator
- Gemini CLI with mobile-automator extension installed

## Step 1: Navigate to Your Mobile Project

```bash
cd /path/to/your/mobile-app
```

## Step 2: Run Setup

```bash
gemini
/mobile-automator:setup
```

The setup wizard will:

1. **Detect your platform** — Identifies Android, iOS, Flutter, React Native, KMP, or CMP
2. **Discover environments** — Finds production, staging, development, etc.
3. **Infer app package** — Extracts Android applicationId and iOS Bundle Identifier
4. **Analyze your project** — Scans codebase for architecture, domain, loading indicators
5. **Install skills** — Creates customized test generation and execution skills
6. **Scaffold directories** — Creates `mobile-automator/`, `scenarios/`, `results/`
7. **Commit to git** — Optionally commits the setup state

**Time**: ~2-3 minutes (mostly for project analysis)

### What Gets Created

After setup completes:

```
mobile-automator/
├── config.json              # Project configuration
├── setup_state.json         # Resume state (if setup interrupted)
├── index.md                 # Setup documentation
├── scenarios/               # Test scenario files
├── screenshots/             # Reference screenshots
└── results/                 # Test execution results

.gemini/
└── skills/
    ├── mobile-automator-generator/SKILL.md
    └── mobile-automator-executor/SKILL.md
```

## Step 3: Generate a Test Scenario

```bash
/mobile-automator:generate
```

This launches the test generation skill. Describe what you want to test:

Example prompt:

> "Test the login flow: 1) Launch the app, 2) Tap the login button, 3) Enter email 'test@example.com', 4) Enter password 'password123', 5) Tap Sign In, 6) Wait for home screen to load, 7) Verify welcome message appears"

The AI will generate a complete test scenario in JSON format following Schema v2, including:
- Step definitions (launch, tap, type, wait, etc.)
- Assertions (element visibility, text content, etc.)
- Capture values for later verification
- Retry logic for flaky operations

A new scenario file is created in `mobile-automator/scenarios/`.

## Step 4: Execute the Test

```bash
/mobile-automator:execute
```

The executor will:

1. List available scenarios
2. Confirm device connection
3. Verify app is installed (or offer to build/install)
4. Execute the scenario step by step
5. Capture observations (flakiness, regressions, state context)
6. Generate a detailed result report

Results are saved to `mobile-automator/results/<run_id>.json`.

## Step 5: Review Results

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

Repeat Step 3 with different user flows:
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

Then run only critical tests:

```bash
/mobile-automator:execute --tag critical
```

### Run Tests in CI/CD

The executor can run without the interactive prompts:

```bash
/mobile-automator:execute --scenario login_flow --headless
```

### Migrate Old Tests (v1 → v2)

If you have legacy v1 scenarios:

```bash
/mobile-automator:migrate login_flow_v1
```

This converts the scenario to the modern v2 format with enhanced assertions and retry logic.

## Troubleshooting

### Setup fails to detect platform

Ensure you're in the root of your mobile project. If detection fails, setup will prompt for manual selection.

### Generate command can't find app package

The app must be:
1. Built successfully in the project
2. Installed on the connected device/simulator

Setup will automatically prompt to build and install if needed.

### Tests fail with "element not found"

Common causes:
1. App is still loading — Use `wait_for_element` in the scenario
2. Element is off-screen — Use `scroll_to_element` before tapping
3. Different environment — Verify you're testing the correct environment (staging vs production)

Check the result observations for hints about what went wrong.

## What's Next?

- **[Core Concepts](../concepts/architecture.md)** — Understand the 3-tier architecture
- **[Guides](../guides/setup.md)** — Deep dive into each command
- **[Reference](../reference/assertions.md)** — Complete list of assertion types
- **[Examples](../examples/android.md)** — Real-world test scenarios

---

**Congratulations!** You've completed your first mobile test. Now explore the full documentation to master advanced features like result observations, custom assertions, and CI/CD integration.
