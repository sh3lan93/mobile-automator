# 3-Tier Architecture

A detailed exploration of how the three-tier design separates concerns and enables customization.

## Overview

```
┌─────────────────────────────────────┐
│  Tier 1: Extension Commands         │
│  CLI entry points + validation      │
│  setup.toml, generate.toml, etc.    │
└──────────────┬──────────────────────┘
               │
      Validates, detects devices,
      checks configuration
               │
┌──────────────▼──────────────────────┐
│  Tier 2: Workspace Skills           │
│  Project-specific logic             │
│  .gemini/skills/mobile-automator-*  │
└──────────────┬──────────────────────┘
               │
      Generates test scenarios,
      executes tests,
      captures observations
               │
┌──────────────▼──────────────────────┐
│  Tier 3: Automation Engine          │
│  Device primitives                  │
│  mobile-mcp server                  │
└─────────────────────────────────────┘
               │
      Device control,
      screenshot capture,
      element inspection
```

## Tier 1: Extension Commands

### Purpose

Handle pre-flight checks, infrastructure, and validation before delegating to workspace skills.

### Key Files

- `commands/mobile-automator/setup.toml` — 7-section setup workflow
- `commands/mobile-automator/generate.toml` — Test generation entry point
- `commands/mobile-automator/execute.toml` — Test execution entry point
- `commands/mobile-automator/migrate.toml` — Scenario migration tool

### Responsibilities

1. **Device Detection** — `mobile_list_available_devices()`
2. **Config Validation** — Check `mobile-automator/config.json` exists
3. **App Installation** — Verify app is installed, or trigger build/install
4. **Skill Verification** — Ensure `.gemini/skills/mobile-automator-*/SKILL.md` exist
5. **Scenario Selection** — List and filter available scenarios
6. **Error Handling** — Clear, actionable error messages

### Why This Layer?

Keeps infrastructure concerns separate from test logic. The generator and executor skills don't need to worry about:
- Whether a device is connected
- Whether the app is installed
- Whether their configuration is valid

These checks happen in Tier 1, making skills simpler and more testable.

## Tier 2: Workspace Skills

### Purpose

Contain project-specific testing logic, customized with project knowledge gathered during setup.

### Key Files

- `.gemini/skills/mobile-automator-generator/SKILL.md` — Generator skill prompt
- `.gemini/skills/mobile-automator-executor/SKILL.md` — Executor skill prompt
- `.gemini/skills/mobile-automator-generator/references/scenario_schema_v2.json` — Test scenario schema
- `.gemini/skills/mobile-automator-executor/references/result_schema.json` — Result schema

### Generator Skill

**Input**: Natural language description of a test

**Output**: JSON test scenario following Schema v2

**Key Capabilities**:
- Parse user intent
- Generate realistic action sequences
- Add contextual assertions
- Include retry logic for async operations
- Capture values for later verification

**Customization**: The skill is customized with 13 placeholders:
- `{{project_name}}` — App name for context
- `{{architecture}}` — Architecture pattern (MVVM, Clean, BLoC, etc.)
- `{{business_domain}}` — Domain knowledge (e.g., "E-commerce platform")
- `{{loading_indicators}}` — Project-specific loading patterns
- `{{protected_directories}}` — Source code paths to never modify
- ...and 8 more

### Executor Skill

**Input**: JSON test scenario + connected device

**Output**: Test result report with observations

**Key Capabilities**:
- Parse scenario JSON
- Execute actions step by step using mobile-mcp
- Perform AI-powered visual assertions
- Capture observations (flakiness, regressions, context)
- Handle retries and error recovery
- Generate detailed result reports

**Customization**: Same 13 placeholders, plus project-specific knowledge about:
- Build commands for rebuilding if needed
- Environment URLs and credentials (if applicable)
- Custom assertion logic

### Why Skills Are Installed to Workspace

**Benefit 1: Persistence**
Skills remain even when the extension updates. Users get bug fixes via extension updates but keep their customized skills.

**Benefit 2: Customization**
Users can edit skills if they want custom behavior:
- Add project-specific assertion logic
- Modify how observations are captured
- Integrate with custom CI/CD systems

**Benefit 3: Multiple Projects**
Each project can have its own skill versions customized to its platform, architecture, and domain.

## Tier 3: Automation Engine (mobile-mcp)

### Purpose

Provide platform-agnostic device automation primitives.

### Provided Tools

**Device Management**:
- `mobile_list_available_devices()` — Enumerate connected devices and simulators
- `mobile_get_screen_size()` — Get device resolution
- `mobile_get_orientation()` — Current orientation
- `mobile_set_orientation()` — Change orientation

**App Control**:
- `mobile_launch_app()` — Launch app by package name
- `mobile_install_app()` — Install APK/IPA
- `mobile_uninstall_app()` — Uninstall app
- `mobile_terminate_app()` — Force stop

**Screen Interaction**:
- `mobile_take_screenshot()` — Capture screen
- `mobile_click_on_screen_at_coordinates()` — Tap at x,y
- `mobile_double_tap_on_screen()` — Double tap
- `mobile_long_press_on_screen_at_coordinates()` — Long press
- `mobile_type_keys()` — Type text
- `mobile_swipe_on_screen()` — Swipe in direction
- `mobile_press_button()` — Press system button (back, home, etc.)

**Element Inspection**:
- `mobile_list_elements_on_screen()` — Get all elements with coordinates
- `mobile_open_url()` — Open URL in browser

### Why This Abstraction?

Instead of Tier 2 calling platform-specific commands (adb for Android, xcrun for iOS), it calls these MCP tools. This:

- **Enables cross-platform skills** — Same skill code works on Android and iOS
- **Simplifies platform support** — Adding new platforms only requires updating mobile-mcp
- **Allows offline testing** — Skills can be tested/mocked without real devices

## Data Flow Example: Login Test

```
User: "Test the login flow"
        ↓
Tier 1: /mobile-automator:generate
  - Check device connected ✓
  - Check app installed ✓
  - Load config.json ✓
  - Pass to skill ↓
        ↓
Tier 2: mobile-automator-generator skill
  - Parse: "login flow"
  - Generate action sequence:
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
  - Output: scenario JSON
        ↓
Tier 1: Save to mobile-automator/scenarios/login_flow.json
        ↓
User: "Execute login test"
        ↓
Tier 1: /mobile-automator:execute
  - Check device connected ✓
  - Check config exists ✓
  - Load scenario ✓
  - Pass to skill ↓
        ↓
Tier 2: mobile-automator-executor skill
  - For each action:
    * Call mobile-mcp ↓
        ↓
Tier 3: mobile-mcp
  - launch_app → adb shell am start / xcrun simctl...
  - wait_for_element → take screenshot, OCR/detect element
  - tap → convert coordinates to platform-specific command
  - type → input text via adb/xcrun
  - ... continue ...
        ↓
Tier 3: Returns success/failure
        ↓
Tier 2: Perform assertions
  - home_screen visible? Take screenshot, check with AI vision ✓
  - welcome_text matches? Extract text, compare ✓
  - Capture observations: no flakiness, no regressions
        ↓
Tier 1: Save result to mobile-automator/results/<run_id>.json
```

## Communication Patterns

### Tier 1 ↔ Tier 2

**Via**: Gemini CLI skill invocation

- Tier 1 loads config, performs validation
- Tier 1 invokes skill with parameters
- Skill returns structured result (scenario JSON or result JSON)
- Tier 1 saves results to workspace

### Tier 2 ↔ Tier 3

**Via**: MCP tool calls

- Skill calls `mobile_take_screenshot()`
- mobile-mcp server receives tool call
- Server executes via adb/xcrun/platform CLI
- Server returns result (screenshot bytes, elements list, etc.)
- Skill continues processing

### State Management

**Config**: Stored in `mobile-automator/config.json` during setup
- Accessed by both Tier 1 (validation) and Tier 2 (skill customization)
- Includes project knowledge, platforms, environments, etc.

**Scenarios**: Stored as JSON files in `mobile-automator/scenarios/`
- Created by generator skill (Tier 2)
- Executed by executor skill (Tier 2)
- Listed by Tier 1 for user selection

**Results**: Stored as JSON files in `mobile-automator/results/`
- Created by executor skill (Tier 2)
- Listed by Tier 1 for user review

## Extensibility

### Adding a New Skill

To add a third tier-2 skill (e.g., `mobile-automator-debugger`):

1. Create template: `templates/mobile-automator-debugger/SKILL.md`
2. Include schema if needed: `templates/mobile-automator-debugger/references/debug_schema.json`
3. Update setup.toml to install the new skill
4. Create command wrapper (optional): `commands/mobile-automator/debug.toml`

### Adding a New MCP Tool

To add a new mobile-mcp capability:

1. Implement in mobile-mcp (outside this project)
2. Skills automatically can call it
3. No changes needed to mobile-automator extension

## Next Steps

- [How Skills Work](skills.md) — Understanding skill placeholders and customization
- [Setup Guide](../guides/setup.md) — Walkthrough of the 7-section setup workflow
- [Generator Guide](../guides/generate.md) — How test generation works
