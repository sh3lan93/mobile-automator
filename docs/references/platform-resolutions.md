# Platform Resolutions — Semantic Actions

!!! note "Internal engine — not the agent-facing API"
    The `mobile_*` calls in the table below are the **internal mobile-mcp
    engine** that `mauto` verbs wrap. The agent never calls them directly — it
    emits the semantic action in an agnostic scenario, and `mauto`'s execute
    workflow resolves it to the per-OS engine calls shown here. This page
    documents that internal resolution so contributors can extend it.

This reference defines how the execute workflow resolves semantic actions to
per-OS mobile-mcp engine calls. Scenarios in agnostic mode use only the
semantic action names; the resolver consults this table at runtime to
translate them.

## Resolution rules

- Each row defines ONE semantic action and its resolution per platform.
- The resolver reads the connected device's `platform` field once at startup
  (via `mauto devices`) to pick the column.
- A resolution may be: a single engine call, a sequence, or primary +
  fallback strategy.
- If the platform is neither `android` nor `ios`, the resolver MUST
  report the action as unsupported on this device and halt the step.

## Resolution table

| Semantic Action     | Android                                                                                                                      | iOS                                                                                                                                                                                       |
|---------------------|------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| `press_back`        | `mobile_press_button("BACK")`                                                                                                | 1. `mobile_list_elements_on_screen` → tap element matching role `button` AND text in {"Back", "‹"}.<br>2. Fallback: `mobile_swipe_on_screen(direction="right", origin="left-edge")`.       |
| `dismiss_keyboard`  | `mobile_press_button("BACK")` (system back dismisses keyboard on Android).                                                   | 1. Tap a non-input region of the screen.<br>2. Fallback: send `Done` / `Return` via `mobile_type_keys`.                                                                                    |
| `grant_permission`  | `mobile_list_elements_on_screen` → tap element with text in {"Allow", "While using the app", "Only this time", "Allow only while using the app"}. | `mobile_list_elements_on_screen` → tap element with text in {"Allow", "Allow Once", "Allow While Using App", "OK"}.                                                                        |
| `deny_permission`   | `mobile_list_elements_on_screen` → tap element with text in {"Deny", "Don't allow"}.                                          | `mobile_list_elements_on_screen` → tap element with text in {"Don't Allow", "Cancel"}.                                                                                                     |

## Adding a new semantic action

When the agnostic schema gains a new semantic action that differs by OS:

1. Add a row to the table above with both Android and iOS resolutions filled.
2. Add the action's name to the `action.type` enum in
   `src/schemas/scenario_schema.json`.
3. Add a row to the agnostic generate guide's Step Translation Guide
   (`src/guide/content/generate.agnostic.md`).
4. The lint at `tests/lint/platform-resolutions-coverage.test.js` will
   fail until steps 1 and 2 are in sync — that is intentional.
