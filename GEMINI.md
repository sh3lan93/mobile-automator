# Mobile QA Context

This extension provides mobile app test scenario generation and execution. It bundles the `mobile-mcp` MCP server for device interaction (screenshots, taps, swipes, text input, app management) across iOS and Android — simulators, emulators, and real devices.

## Terminology

- **Test Scenario**: A JSON file describing a sequence of user actions and expected outcomes for a specific mobile app flow.
- **Reference Screenshot**: A baseline screenshot captured during scenario generation that represents the expected visual state at a checkpoint.
- **Test Run**: An execution of one or more test scenarios, producing a results report with pass/fail status per assertion.
- **Config**: The `mobile-automator/config.json` file created during `/mobile:setup` that stores project platform, environments, device, and app information.

## File Resolution Protocol

**PROTOCOL: How to locate test artifacts.**

All test artifacts are stored under the `mobile-automator/` directory in the project root.

**Standard Paths:**
- **QA Config**: `mobile-automator/config.json`
- **QA Index**: `mobile-automator/index.md`
- **Scenarios Directory**: `mobile-automator/scenarios/`
- **Individual Scenario**: `mobile-automator/scenarios/<scenario_id>.json`
- **Reference Screenshots**: `mobile-automator/screenshots/<scenario_id>/`
- **Test Results Directory**: `mobile-automator/results/`
- **Individual Run Result**: `mobile-automator/results/<run_id>.json`
- **Run Screenshots**: `mobile-automator/results/<run_id>/screenshots/`

When resolving a scenario or result file:
1. Check if the path exists on disk.
2. If not, check `mobile-automator/index.md` for a matching entry.
3. If neither exists, inform the user.

## Schemas

Schema definitions are owned by their respective skills:

- **Test Scenario Schema:** `.gemini/skills/mobile-automator-generator/references/scenario_schema.json` — defines the format for generated test scenarios.
- **Test Run Result Schema:** `.gemini/skills/mobile-automator-executor/references/result_schema.json` — defines the format for execution result reports.

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

- The `mobile-automator/config.json` file is the source of truth for project configuration. Commands MUST read this file to populate `metadata` fields automatically.
- Reference screenshots are captured during `/mobile-automator:generate` and stored in `mobile-automator/screenshots/<scenario_id>/step_<step_id>.png`.
- During `/mobile-automator:execute`, current screenshots are saved to `mobile-automator/results/<run_id>/screenshots/step_<step_id>.png` for comparison.
- Screenshot comparison uses visual analysis — describe what should be on screen in `expected_state` so the model can verify semantically, not just pixel-by-pixel.
- All JSON files MUST be valid and parseable.
- Scenario IDs use snake_case (e.g., `login_happy_path`, `checkout_flow`).
- Run IDs use the format `run_YYYYMMDD_HHMMSS`.