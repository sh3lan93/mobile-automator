---
title: "Reference & Schemas"
description: "Complete reference documentation for mobile-automator schemas, 27 assertion types, 14 action types, and MCP automation tools."
---

# Reference Documentation

Complete reference for all schemas, assertion types, and automation tools used by mobile-automator.

## Quick Navigation

### For Test Creators

**Create test scenarios with:**
- [27 Assertion Types](assertions.md) — Element visibility, text content, visual state, and more
- [14 Action Types](schema.md#action-types-14-total) — Launch app, tap, type, wait, capture values, etc.
- [Schema Documentation](schema.md) — Complete scenario structure and all fields

### For Test Executors

**Run tests with:**
- [20+ MCP Tools](mcp-tools.md) — Device control, screenshots, element inspection
- [Result Schema](result-schema.md) — Understanding test execution results

### For Agent Operators

**Drive and extend mobile-automator:**
- [CLI Verbs](cli-verbs.md) — Every `mauto` verb and its JSON envelope
- [Memory](../concepts/memory.md) — Cross-session learning (run-history, app-knowledge, preferences)

### For Schema Developers

**Extend mobile-automator:**
- [Full Schema](schema.md) — Complete JSON schema definition
- [Assertion Types Reference](assertions.md) — All 27 types with examples
- [MCP Tool Reference](mcp-tools.md) — All automation primitives

---

## Reference Pages

### Assertion Types (27 Total)

mobile-automator supports 27 assertion types organized in 8 categories for comprehensive test verification.

| Category | Types | Examples |
|----------|-------|----------|
| Element State | 4 types | `element_exists`, `element_visible`, `element_state` |
| Text & Content | 7 types | `element_text`, `text_contains`, `pattern_match` |
| Count & Collections | 3 types | `element_count`, `list_item_count`, `list_is_empty` |
| Visual & Layout | 4 types | `screenshot_match`, `visual_state`, `color_style` |
| Navigation & Screen | 5 types | `screen_title`, `alert_present`, `toast_visible` |
| Accessibility | 1 type | `has_accessibility_label` |
| Data & Variables | 1 type | `value_matches_variable` |
| Platform-Specific | 2 types | `permission_dialog_shown`, `dark_mode_active` |

**[View all assertion types →](assertions.md)**

---

### Test Scenario Schema

The default schema for test scenarios. Defines structure for steps, assertions, variables, and execution metadata.

**Schema structure:**
```json
{
  "$schema_version": "2.1",
  "scenario_id": "login_flow",
  "name": "Login Flow",
  "description": "Verify the user can log in and reach the dashboard",
  "platform": "android",
  "app_package": "com.example.app",
  "metadata": { "app_version": "1.0.0", "environment": "staging" },
  "steps": [
    { "id": "tap_login", "action": "tap", "description": "Tap the login button", "target": "Login button" }
  ],
  "assertions": [
    { "id": "logged_in", "after_step": "tap_login", "type": "screen_title", "description": "The dashboard screen is shown", "expected_text": "Dashboard" }
  ]
}
```

**Key features:**
- Named string step IDs (not integer indices)
- 14 action types and 27 assertion types
- Variables and value capture
- Conditional execution and retry policies
- Structured preconditions

**[Schema Reference →](schema.md)**

---

### Test Result Schema

Structure of execution result reports containing test status, step results, observations, and metrics.

**Result structure:**
```json
{
  "run_id": "run_20260227_145230",
  "scenario_id": "login_flow",
  "status": "passed",
  "passed_assertions": 3,
  "failed_assertions": 0,
  "duration_seconds": 12.45,
  "observations": [
    { "type": "flakiness", "message": "Step took longer than expected" }
  ]
}
```

**Key features:**
- Step-by-step execution results
- Assertion pass/fail verdicts
- Intelligent observations (regression, flakiness, state context)
- Captured variables from execution
- Metric tracking (duration, retries, screenshots)

**[Result Schema Reference →](result-schema.md)**

---

### MCP Tool Reference (internal engine)

Low-level device automation primitives for screen interaction, app management, and device control. These `mobile_*` tools are the **internal mobile-mcp engine** that `mauto` verbs wrap — agents drive the device through `mauto` verbs, not by calling these directly.

**Tool categories:**
- **Device Management** — List devices, launch/terminate apps, install/uninstall
- **Screen Capture** — Take screenshots, list UI elements
- **User Interactions** — Tap, swipe, type, press buttons
- **Navigation** — Open URLs, press back/home
- **Device Control** — Orientation, screen size

**`mauto` verbs and the engine primitives they wrap:**
- `mauto launch` → `mobile_launch_app` — Launch app on device
- `mauto tap` → `mobile_click_on_screen_at_coordinates` — Tap at coordinates
- `mauto screenshot` → `mobile_take_screenshot` — Capture screen
- `mauto elements` → `mobile_list_elements_on_screen` — Get UI elements and coordinates
- `mauto type` → `mobile_type_keys` — Type text into focused field
- `mauto swipe` → `mobile_swipe_on_screen` — Scroll or swipe

**[View all engine tools →](mcp-tools.md)**

---

### CLI Verbs

The full `mauto` verb surface — device actions, authoring, workspace, reasoning, agent integration, device session, and memory — each emitting the uniform `{ok, data, error, hint, schema_version}` envelope.

**[CLI Verbs Reference →](cli-verbs.md)**

---

### Memory

How mobile-automator learns across sessions: the auto-harvested `run-history` plus agent-authored `app-knowledge` and `preferences`, stored under `mobile-automator/memory/`.

**[Memory Concept →](../concepts/memory.md)**

---

## Learning Path

### New to mobile-automator?

1. Start with [Schema](schema.md) — Understand test scenario structure
2. Review [Assertion Types](assertions.md) — Learn what you can verify
3. Explore [MCP Tools](mcp-tools.md) — See what device automation is available
4. Check [Result Schema](result-schema.md) — Understand execution output

### Creating test scenarios?

1. [Schema — Step Reference](schema.md#action-types-14-total) — All 14 action types
2. [Assertion Types](assertions.md) — All 27 assertion types with examples
3. [Schema — Complete Example](schema.md#complete-example-login-scenario-with-variables) — Full working scenario

### Executing tests?

1. [MCP Tools Reference](mcp-tools.md) — Available automation primitives
2. [Test Result Schema](result-schema.md) — Understanding results
3. [Result Examples](result-schema.md#examples) — Passed and failed result examples

### Debugging failures?

1. [Assertion Types — Failure Examples](assertions.md#assertion-failure-examples) — Common assertion failures
2. [Result Schema — Observations](result-schema.md#observations-array-items) — Regression, flakiness, state context
3. [MCP Tools — Best Practices](mcp-tools.md#best-practices) — Debugging tips

---

## Summary Tables

### Action Types by Category

**Control Flow:**
- `launch_app` — Start app
- `open_url` — Open URL in browser
- `press_button` — Press device button (BACK, HOME, ENTER)

**Interaction:**
- `tap` — Click/tap element
- `double_tap` — Double-tap element
- `long_press` — Long-press element
- `type` — Type text into focused field
- `swipe` — Scroll or swipe in direction
- `scroll_to_element` — Scroll until element visible

**Wait/Timing:**
- `wait_for_element` — Wait until element appears
- `wait_for_element_gone` — Wait until element disappears
- `wait_for_loading_complete` — Wait until loading indicators gone

**Data Capture:**
- `capture_value` — Extract value from element into variable
- `clear_app_data` — Clear app cache and data (precondition)

### Assertion Types by Purpose

**Is element present?**
- `element_exists` — Element is present
- `element_not_exists` — Element is absent
- `element_visible` — Element is visible to user
- `element_fully_visible` — Element not clipped

**What does it say?**
- `element_text` — Exact text match
- `text_contains` — Substring match
- `text_not_empty` — Has any text
- `element_hint` — Placeholder text
- `pattern_match` — Matches regex pattern
- `text_changed` — Text updated

**How does it look?**
- `screenshot_match` — Semantic visual comparison
- `visual_state` — Element styling (highlighted, faded, etc.)
- `color_style` — Text or element color

**How many?**
- `element_count` — Count matching elements
- `list_item_count` — Count list items
- `list_is_empty` — List has no items

**Where are we?**
- `screen_title` — Current screen name
- `alert_present` — Dialog is showing
- `alert_text` — Dialog content
- `toast_visible` — Notification visible
- `keyboard_visible` — Soft keyboard open

**Special checks:**
- `element_state` — Element enabled/disabled/focused/selected
- `has_accessibility_label` — Accessibility label present
- `content_description` — Accessibility description
- `value_matches_variable` — Compare to captured value
- `permission_dialog_shown` — Permission prompt visible
- `dark_mode_active` — Dark mode enabled

---

## Schema Versioning

Scenario files and result files version themselves independently, with **different field names**:

### Scenario schema — `$schema_version` (note the `$`)

- **Identifier:** `"$schema_version"`, which accepts `"2.0"` or `"2.1"` (default `"2.0"`)
- **2.1 is current** and additive over 2.0 — it adds the `mode` metadata field and four platform-agnostic semantic actions (`press_back`, `dismiss_keyboard`, `grant_permission`, `deny_permission`). Existing `"2.0"` scenarios remain valid; new scenarios should use `"2.1"`.
- **Step IDs:** String snake_case (`tap_login`, `verify_message`)
- **Features:** Variables, retry policies, conditions, sub-steps

### Result schema — `schema_version` (no `$`)

- **Identifier:** `"schema_version"`, which is always `"2.0"` (the only valid value for result files)
- This is intentional — result files stay at `2.0` even when the scenario that produced them uses `$schema_version` `2.1`.

---

## File Locations

All test artifacts are stored under the `mobile-automator/` directory in the project root:

```
mobile-automator/
├── config.json                 # Project configuration
├── index.md                    # Scenario index
├── scenarios/                  # Test scenario JSON files
│   ├── login_flow.json
│   ├── checkout_flow.json
│   └── ...
├── screenshots/                # Reference screenshots
│   ├── login_flow/
│   ├── checkout_flow/
│   └── ...
└── results/                    # Test execution results
    ├── run_20260227_145230.json
    ├── run_20260227_150000.json
    └── ...
```

---

## API Compatibility

All tools are compatible with both:
- **Physical devices** — Real iOS and Android devices
- **Simulators/Emulators** — iOS Simulator and Android Emulator
- **Cloud devices** — AWS Device Farm, BrowserStack, etc.

Platform support is automatically detected and adapted.

---

## Related Documentation

- [Setup Guide](../guides/setup.md) — Configure mobile-automator for your project
- [Generate Guide](../guides/generate.md) — Create test scenarios
- [Execute Guide](../guides/execute.md) — Run tests and view results
- [Architecture Overview](../index.md) — How mobile-automator works

---

[← Back to Home](../index.md)
