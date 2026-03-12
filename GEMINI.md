# Mobile QA Context

This extension provides mobile app test scenario generation and execution. It bundles the `mobile-mcp` MCP server for device interaction (screenshots, taps, swipes, text input, app management) across iOS and Android — simulators, emulators, and real devices.

## Terminology

- **Test Scenario**: A JSON file describing a sequence of user actions and expected outcomes for a specific mobile app flow.
- **Reference Screenshot**: A baseline screenshot captured during scenario generation that represents the expected visual state at a checkpoint.
- **Test Run**: An execution of one or more test scenarios, producing a results report with pass/fail status per assertion.
- **Config**: The `mobile-automator/config.json` file created during `/mobile-automator:setup` that stores project platform, environments, device, and app information.

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
- **Aggregated Reports**: `mobile-automator/results/report.json`, `mobile-automator/results/report.html`
- **JUnit XML**: `mobile-automator/results/TEST-mobile-automator.xml`

When resolving a scenario or result file:
1. Check if the path exists on disk.
2. If not, check `mobile-automator/index.md` for a matching entry.
3. If neither exists, inform the user.

## Schemas

Schema definitions are owned by their respective skills:

- **Test Scenario Schema v2 (default):** `.gemini/skills/mobile-automator-generator/references/scenario_schema_v2.json` — current default schema for generated test scenarios. Required field `$schema_version: "2.0"`.
- **Test Scenario Schema v1 (deprecated):** `.gemini/skills/mobile-automator-generator/references/scenario_schema.json` — legacy schema. Identified by the absence of `$schema_version`. Deprecated as of 2026-02. Will hard-fail after 12 months (2027-02).
- **Test Run Result Schema:** `.gemini/skills/mobile-automator-executor/references/result_schema.json` — defines the format for execution result reports. Compatible with both v1 and v2 scenarios.

### TestRail Integration

**MCP Server:**
- `testRailMcpServer`: Provides TestRail API access via `testrail-mcp`
  - `testrail_get_case(case_id, project_id)` — Fetch test case from TestRail
  - `testrail_create_test_run(...)` — Create test run with results

**Configuration:**
- Environment: `TESTRAIL_API_KEY`, `TESTRAIL_DOMAIN` (project-scoped)
- Example: `.env` in mobile project root sets credentials per project

**Scenario Metadata:**
- Optional `testrail` field in scenario JSON (schema v2)
- 1:1 mapping: one scenario per TestRail case
- Executor uses metadata to sync results after test execution

**Version detection:** When reading a scenario JSON file, check for `$schema_version`:
- `"2.0"` → v2 execution path with full v2 feature set.
- Missing or `"1.0"` → v1 execution path (legacy). Show deprecation notice and suggest migration.

## Mobile-MCP Tool Mapping

When executing test scenario steps, map actions to mobile-mcp tools as follows:

**v2 Actions (current):**

| v2 Scenario Action         | Mobile-MCP Tool                              | Notes |
|----------------------------|----------------------------------------------|-------|
| `launch_app`               | `mobile_launch_app`                          | |
| `tap`                      | `mobile_click_on_screen_at_coordinates`      | Use `mobile_list_elements_on_screen` first |
| `long_press`               | `mobile_long_press_on_screen_at_coordinates` | |
| `double_tap`               | `mobile_double_tap_on_screen`                | |
| `type`                     | `mobile_type_keys`                           | |
| `swipe`                    | `mobile_swipe_on_screen`                     | `value` = direction |
| `scroll_to_element`        | `mobile_swipe_on_screen` (repeated)          | Poll until target element visible |
| `press_button`             | `mobile_press_button`                        | `value` = BACK/HOME/ENTER |
| `open_url`                 | `mobile_open_url`                            | |
| `wait_for_element`         | Poll `mobile_list_elements_on_screen`        | Stop when element appears |
| `wait_for_element_gone`    | Poll `mobile_list_elements_on_screen`        | Stop when element absent |
| `wait_for_loading_complete`| Poll `mobile_take_screenshot` + visual check | Stop when loading indicator absent |
| `capture_value`            | `mobile_list_elements_on_screen`             | Extract text, store in `capture_to` variable |
| `clear_app_data`           | `adb shell pm clear <package>` (Android)    | Precondition action |
| (screenshot)               | `mobile_take_screenshot` / `mobile_save_screenshot` | |
| (find element)             | `mobile_list_elements_on_screen`             | |

**v1 Actions (legacy, deprecated):**

| v1 Scenario Action | Mobile-MCP Tool |
|--------------------|-----------------|
| `launch_app`       | `mobile_launch_app` |
| `tap`              | `mobile_click_on_screen_at_coordinates` |
| `type`             | `mobile_type_keys` |
| `swipe`            | `mobile_swipe_on_screen` |
| `press_button`     | `mobile_press_button` |
| `wait`             | (use delay/polling) |
| `open_url`         | `mobile_open_url` |

## Important Conventions

- The `mobile-automator/config.json` file is the source of truth for project configuration. Commands MUST read this file to populate `metadata` fields automatically.
- **v2 Screenshot naming:** Reference screenshots use step string IDs: `mobile-automator/screenshots/<scenario_id>/step_<step_id>.png` (e.g., `step_tap_login.png`). Sub-step screenshots: `step_<parent_id>_<sub_step_id>.png`.
- **v1 Screenshot naming (legacy):** `step_<integer>.png` (e.g., `step_3.png`).
- During `/mobile-automator:execute`, current screenshots are saved to `mobile-automator/results/<run_id>/screenshots/step_<step_id>.png` for comparison.
- Screenshot comparison uses visual analysis — describe what should be on screen in `expected_state` so the model can verify semantically, not just pixel-by-pixel.
- All JSON files MUST be valid and parseable.
- Scenario IDs use snake_case (e.g., `login_happy_path`, `checkout_flow`).
- Step IDs use snake_case strings in v2 (e.g., `tap_login`, `wait_for_home`). They were integers in v1.
- Run IDs use the format `run_YYYYMMDD_HHMMSS`.
- **Schema version identification:** v2 scenarios have `"$schema_version": "2.0"` as the first JSON field. v1 scenarios have no such field.