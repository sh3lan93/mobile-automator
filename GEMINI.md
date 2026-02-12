# Mobile QA Context

This extension provides mobile app test scenario generation and execution. It bundles the `mobile-mcp` MCP server for device interaction (screenshots, taps, swipes, text input, app management) across iOS and Android — simulators, emulators, and real devices.

## Terminology

- **Test Scenario**: A JSON file describing a sequence of user actions and expected outcomes for a specific mobile app flow.
- **Reference Screenshot**: A baseline screenshot captured during scenario generation that represents the expected visual state at a checkpoint.
- **Test Run**: An execution of one or more test scenarios, producing a results report with pass/fail status per assertion.

## File Resolution Protocol

**PROTOCOL: How to locate test artifacts.**

All test artifacts are stored under the `mobile-automator/` directory in the project root.

**Standard Paths:**
- **Scenarios Directory**: `mobile-automator/scenarios/`
- **Individual Scenario**: `mobile-automator/scenarios/<scenario_id>.json`
- **Reference Screenshots**: `mobile-automator/screenshots/<scenario_id>/`
- **Test Results Directory**: `mobile-automator/results/`
- **Individual Run Result**: `mobile-automator/results/<run_id>.json`
- **Run Screenshots**: `mobile-automator/results/<run_id>/screenshots/`
- **QA Index**: `mobile-automator/index.md`

When resolving a scenario or result file:
1. Check if the path exists on disk.
2. If not, check `mobile-automator/index.md` for a matching entry.
3. If neither exists, inform the user.

## Test Scenario JSON Schema

All generated scenarios MUST follow this structure:
```json
{
  "scenario_id": "string (unique, snake_case)",
  "name": "string (human-readable name)",
  "description": "string (what this scenario tests)",
  "platform": "android | ios | cross-platform",
  "app_package": "string (bundle ID or package name)",
  "preconditions": ["string (required state before test)"],
  "tags": ["string (e.g., 'smoke', 'regression', 'login')"],
  "metadata": {
    "app_version": "string (build variant or version, e.g., '2.4.1-debug')",
    "device_model": "string (device name, e.g., 'Pixel 8 Pro', 'iPhone 16')",
    "api_level": "string (Android API level or iOS version, e.g., '34', '18.1')",
    "environment": "string (target environment, e.g., 'production', 'staging', 'development')",
    "timestamp": "string (ISO-8601 datetime, e.g., '2026-02-11T14:30:00Z')"
  },
  "steps": [
    {
      "step_id": "number (sequential)",
      "action": "string (launch_app | tap | type | swipe | press_button | wait | open_url)",
      "description": "string (what this step does in plain language)",
      "target": "string (element description or coordinates)",
      "value": "string | null (input text, swipe direction, button name, etc.)",
      "checkpoint": "boolean (whether to capture a reference screenshot)",
      "expected_state": "string | null (description of expected visual state)"
    }
  ],
  "assertions": [
    {
      "assertion_id": "number",
      "after_step_id": "number (which step to assert after)",
      "type": "screenshot_match | element_exists | element_text | element_not_exists",
      "reference_screenshot": "string | null (relative path to reference image)",
      "element_description": "string | null",
      "expected_value": "string | null",
      "tolerance": "number (0.0 - 1.0, for screenshot comparison)"
    }
  ]
}
```

## Mobile-MCP Tool Mapping

When executing test scenario steps, map actions to mobile-mcp tools as follows:

| Scenario Action   | Mobile-MCP Tool                              |
|-------------------|----------------------------------------------|
| `launch_app`      | `mobile_launch_app`                          |
| `tap`             | `mobile_click_on_screen_at_coordinates`      |
| `type`            | `mobile_type_keys`                           |
| `swipe`           | `mobile_swipe_on_screen`                     |
| `press_button`    | `mobile_press_button`                        |
| `wait`            | (use delay/polling)                          |
| `open_url`        | `mobile_open_url`                            |
| (screenshot)      | `mobile_take_screenshot` / `mobile_save_screenshot` |
| (find element)    | `mobile_list_elements_on_screen`             |

## Important Conventions

- Reference screenshots are captured during `/mobile-automator:generate` and stored in `mobile-automator/screenshots/<scenario_id>/step_<step_id>.png`.
- During `/mobile-automator:execute`, current screenshots are saved to `mobile-automator/results/<run_id>/screenshots/step_<step_id>.png` for comparison.
- Screenshot comparison uses visual analysis — describe what should be on screen in `expected_state` so the model can verify semantically, not just pixel-by-pixel.
- All JSON files MUST be valid and parseable.
- Scenario IDs use snake_case (e.g., `login_happy_path`, `checkout_flow`).