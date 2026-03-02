# Architecture Overview

mobile-automator is designed as a meta-testing extension that analyzes your mobile project, learns its structure and domain, then generates customized testing skills.

## System Components

### Tier 1: Extension Commands

CLI entry points that perform pre-flight checks and validation:

- **`/mobile-automator:setup`** — 7-section interactive workflow
  - Detects platform
  - Discovers environments
  - Infers app package
  - Analyzes project knowledge
  - Installs customized skills
  - Scaffolds directories
  - Commits to git (optional)

- **`/mobile-automator:generate`** — Test generation wrapper
  - Verifies config exists
  - Detects connected devices
  - Confirms app installation
  - Delegates to generator skill

- **`/mobile-automator:execute`** — Test execution wrapper
  - Verifies config exists
  - Lists available devices
  - Resolves scenarios
  - Delegates to executor skill

- **`/mobile-automator:migrate`** — Scenario migration tool
  - Converts v1 scenarios to v2 format

### Tier 2: Workspace Skills

Project-specific testing logic installed in `.gemini/skills/`:

- **`mobile-automator-generator`** — Converts natural language to test scenarios
  - Takes user description
  - Generates JSON following Schema v2
  - Creates realistic test flows
  - Includes assertions and capture values

- **`mobile-automator-executor`** — Runs tests with AI vision
  - Parses scenario JSON
  - Executes actions step by step
  - Performs AI-powered visual assertions
  - Captures observations and results
  - Handles retries and flakiness

### Tier 3: Automation Engine

The MCP server provides device primitives:

- **`mobile-mcp`** — Mobile automation server
  - Device enumeration
  - App launch and control
  - Screen interaction (tap, swipe, type, scroll)
  - Screenshot capture
  - Element detection and inspection
  - Button press (back, home, volume)
  - URL opening
  - Orientation control

## Data Flow

```
User Input (natural language)
        ↓
/mobile-automator:generate (Tier 1)
        ↓
Pre-flight checks (device, app, config)
        ↓
mobile-automator-generator skill (Tier 2)
        ↓
AI generates JSON scenario
        ↓
Saved to mobile-automator/scenarios/
        ↓
/mobile-automator:execute (Tier 1)
        ↓
Pre-flight checks (scenario selection)
        ↓
mobile-automator-executor skill (Tier 2)
        ↓
For each step:
  - Execute action via mobile-mcp (Tier 3)
  - Perform assertion
  - Capture observations
        ↓
Result report saved to mobile-automator/results/
```

## File Structure

```
mobile-automator/
├── config.json                          # Collected project knowledge
├── setup_state.json                     # Resume state
├── index.md                             # Setup documentation
├── scenarios/                           # Test scenario JSON files
│   ├── login_flow.json
│   ├── checkout.json
│   └── ...
├── screenshots/                         # Reference screenshots for assertions
│   ├── login_screen.png
│   └── ...
└── results/                             # Test execution result reports
    ├── login_flow_20250227_143022.json
    └── ...

.gemini/
└── skills/
    ├── mobile-automator-generator/
    │   ├── SKILL.md                     # Generator prompt template
    │   └── references/
    │       ├── scenario_schema_v2.json  # Latest schema (default)
    │       ├── scenario_schema.json     # Legacy schema (v1)
    │       └── ...
    └── mobile-automator-executor/
        ├── SKILL.md                     # Executor prompt template
        └── references/
            ├── result_schema.json       # Result schema
            └── ...
```

## MCP Server Integration

The extension bundles `mobile-mcp` as the automation engine:

```json
{
  "mcpServers": {
    "mobileMcpServer": {
      "command": "npx",
      "args": ["-y", "@mobilenext/mobile-mcp@latest"]
    }
  }
}
```

This provides 20+ automation primitives that work across all supported platforms.

## Key Design Decisions

### Why 3 Tiers?

**Separation of concerns:**

- **Tier 1** handles infrastructure (device detection, configuration validation, pre-flight checks)
- **Tier 2** contains project-specific logic (test generation, execution, domain knowledge)
- **Tier 3** provides platform-agnostic primitives (device automation)

**Benefits:**
- Each tier to evolve independently
- Easy testing and mocking of individual layers
- Clear responsibility boundaries
- Reusable automation engine across tools

### Why Workspace Skills?

Skills are installed into the user's `.gemini/` workspace directory, not the extension directory. This means:

- **Customization**: Each project gets its own tailored version of the skills
- **Persistence**: Skills don't disappear when extension updates
- **Control**: Users can inspect and modify skills if needed
- **Isolation**: Multiple projects can have different skill versions
- **Version control**: Skills are part of your project's git repository

### Why Schema v2?

Schema v2 is a significant upgrade from v1:

- **14 action types** instead of 8 (added scroll, scroll_to_element, wait_for_loading_complete, capture_value, clear_app_data)
- **27 assertion types** instead of 12 (expanded coverage across text, visibility, collections, visual, navigation)
- **Advanced control** — retry policies, conditions, sub-steps
- **Better debugging** — capture values for later assertion, detailed step context
- **Flakiness handling** — explicit retry policies for async operations
- **String step IDs** instead of integers (more readable: `tap_login` instead of `1`)

### Why Not Modify Your Source Code?

All tests live in `mobile-automator/` directory, completely separate from your source code. This means:

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

2. Tier 1 (Extension):
   - Validates setup complete ✓
   - Checks app installed ✓
   - Detects devices ✓
   - Delegates to generator skill

3. Tier 2 (Generator Skill):
   - Parses natural language
   - Two-pass semantic model:
     * Pass 1: Classify as action or assertion
     * Pass 2: Resolve element references
   - Calls Tier 3 to get UI elements
   - Generates JSON scenario

4. Scenario JSON Created:
   {
     "schema_version": "2.0",
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
   - Tier 1 (Extension): Pre-flight checks, scenario selection
   - Tier 2 (Executor Skill): For each step:
     * Call Tier 3: Get current screen state
     * Call Tier 3: Execute action (tap, type, etc.)
     * Call Tier 3: Capture screenshot
     * Evaluate assertion
     * Detect patterns (flakiness, regressions)

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

7. Optional: Sync to TestRail
   - If configured, executor uploads results
   - Includes duration, status, observations
```

## Next Steps

- [3-Tier Design Deep Dive](three-tier-design.md) — Detailed breakdown of each tier
- [How Skills Work](skills.md) — Understanding skill placeholders and customization
- [Setup Guide](../guides/setup.md) — Walkthrough of the 7-section setup workflow
