# Migration Guide: Schema v1 → v2

Schema v2 is the default for all new scenarios. This guide explains what changed, why it changed, and how to migrate existing v1 scenarios.

**Quick migration:** Run `/mobile-automator:migrate <scenario_id>` for interactive step-by-step migration.

---

## What Changed and Why

| Area | v1 | v2 | Why |
|------|----|----|-----|
| Schema version | No field | `"$schema_version": "2.0"` required | Enables version detection for routing v1/v2 execution |
| Step identifier | `"step_id": 3` (integer) | `"id": "tap_login"` (named string) | Named IDs survive step reordering; screenshots are meaningful (`step_tap_login.png` vs `step_3.png`) |
| Assertion step reference | `"after_step_id": 3` | `"after_step": "tap_login"` | Follows from named step IDs — references stay stable |
| Metadata | Includes `device_model`, `api_level`, `timestamp` | Design-time only: `app_version`, `environment` | Execution-time data belongs in the result JSON, not the scenario |
| Preconditions | `["string", "string"]` | Structured object with `app_state`, `device_actions`, `device_properties` | Enables automated precondition setup (e.g., auto-clear app data) |
| Wait actions | Fixed `wait` with a time value | `wait_for_element`, `wait_for_element_gone`, `wait_for_loading_complete` | Eliminates the #1 source of test flakiness — fixed waits that are either too short or too slow |
| Optional steps | Not supported | `"optional": true` + `"on_failure": "skip"` | Handles dialogs/popups that appear non-deterministically |
| Conditional steps | Not supported | `"condition": { "type": "device_property", ... }` | Handles API-level branching, runtime state checks |
| Retry logic | Not supported | `"on_failure": "retry"` + `"retry_policy"` | Distinguishes real bugs from transient failures |
| Data capture | Not supported | `"capture_to": "variable_name"` | Captures dynamic values for cross-step verification |
| Nested sub-flows | Not supported | `"sub_steps": [...]` | Expresses conditional branching (e.g., "add address if it doesn't exist") |
| New action types | 7 actions | +8 actions (smart waits, scroll, long press, double tap, capture, clear data) | Covers real-world automation patterns |
| New assertion types | 4 types | +5 types (pattern_match, value_matches_variable, element_count, visual_state, text_changed) | Validates dynamic content without hardcoded expected values |

---

## Before and After Examples

### Example 1: Step ID and Assertion Reference

**v1**
```json
{
  "steps": [
    { "step_id": 1, "action": "launch_app", "description": "Open the app" },
    { "step_id": 2, "action": "tap", "description": "Tap Login", "target": "Login button" }
  ],
  "assertions": [
    { "assertion_id": 1, "after_step_id": 2, "type": "element_exists", "element_description": "Login form" }
  ]
}
```

**v2**
```json
{
  "$schema_version": "2.0",
  "steps": [
    { "id": "launch_app", "action": "launch_app", "description": "Open the app" },
    { "id": "tap_login", "action": "tap", "description": "Tap Login", "target": "Login button" }
  ],
  "assertions": [
    { "id": "assert_login_form", "after_step": "tap_login", "type": "element_exists", "element_description": "Login form", "description": "Verify login form appears" }
  ]
}
```

---

### Example 2: Fixed Wait → Smart Wait

**v1** — Flaky. Fails on slow networks, wastes time on fast ones.
```json
{ "step_id": 5, "action": "wait", "description": "Wait for home to load", "value": "3000" }
```

**v2** — Waits exactly as long as needed, up to the timeout.
```json
{
  "id": "wait_for_home",
  "action": "wait_for_loading_complete",
  "description": "Wait for home screen to fully load",
  "target": "Home screen content area",
  "wait_config": {
    "type": "loading_complete",
    "indicator": "shimmer",
    "timeout_ms": 15000
  }
}
```

---

### Example 3: Optional Step (Dialog That May or May Not Appear)

**v1** — No way to express this. Either skip the step (incomplete test) or let it fail.
```json
{ "step_id": 3, "action": "tap", "description": "Dismiss promo dialog", "target": "Close button" }
```

**v2** — Attempt it. If the element isn't there, silently continue.
```json
{
  "id": "dismiss_promo_dialog",
  "action": "tap",
  "description": "Dismiss full-screen promotion if it appears",
  "target": "Close button on the full-screen promotion card",
  "optional": true,
  "on_failure": "skip"
}
```

---

### Example 4: Dynamic Data Capture and Verification

**v1** — Cannot do this. You'd have to hardcode the expected discount amount.

**v2** — Capture the value at step A, verify it matches at step B.
```json
{
  "variables": {
    "voucher_discount_amount": {
      "type": "string",
      "description": "Discount amount from the redeemed voucher"
    }
  },
  "steps": [
    {
      "id": "capture_voucher_amount",
      "action": "capture_value",
      "description": "Capture the discount amount shown on the first voucher",
      "target": "Discount amount label on the first loyalty voucher",
      "capture_to": "voucher_discount_amount"
    }
  ],
  "assertions": [
    {
      "id": "assert_discount_matches",
      "after_step": "scroll_to_order_summary",
      "type": "value_matches_variable",
      "element_description": "Rewards discount line in the order summary",
      "variable_name": "voucher_discount_amount",
      "pattern": "Rewards discount\\s+-?\\d+(\\.\\d+)?\\s+SAR",
      "description": "Verify the order summary discount matches the redeemed voucher amount"
    }
  ]
}
```

---

### Example 5: Metadata Cleanup

**v1** — Mixed design-time and execution-time data.
```json
"metadata": {
  "app_version": "2.4.1-debug",
  "device_model": "Pixel 8 Pro",
  "api_level": "34",
  "environment": "staging",
  "timestamp": "2026-01-15T10:30:00Z"
}
```

**v2** — Design-time only. Execution data goes in the result JSON.
```json
"metadata": {
  "app_version": "staging-latest",
  "environment": "staging"
}
```

---

### Example 6: Nested Conditional Sub-Flow

**v1** — Not possible. Requires two separate scenario files.

**v2** — The parent step's condition triggers the sub-flow when needed.
```json
{
  "id": "add_address_if_missing",
  "action": "tap",
  "description": "Add address only if it wasn't found in the list",
  "target": "Add a new address button",
  "condition": {
    "type": "previous_step_skipped",
    "step_id": "select_existing_address"
  },
  "optional": true,
  "on_failure": "skip",
  "sub_steps": [
    { "id": "tap_search_bar", "action": "tap", "target": "Search bar", "description": "Tap address search bar" },
    { "id": "type_address", "action": "type", "target": "Search input", "value": "my office", "description": "Search for address" },
    { "id": "select_result", "action": "tap", "target": "First address result", "description": "Select from results" },
    { "id": "submit_address", "action": "tap", "target": "Save address button", "description": "Save the new address" }
  ]
}
```

---

## What the Migration Tool Handles Automatically

When you run `/mobile-automator:migrate <scenario_id>`, the tool automatically converts:

- ✅ Adds `"$schema_version": "2.0"`
- ✅ `step_id` integers → descriptive snake_case string IDs
- ✅ `assertion_id` integers → snake_case string IDs
- ✅ `after_step_id` integer references → string references
- ✅ Removes execution-time fields from `metadata` (`device_model`, `api_level`, `timestamp`)
- ✅ Converts `preconditions` string array → structured object
- ✅ Creates a `.v1.bak` backup before making any changes

## What Requires Manual Review

The migration tool flags these and asks you interactively:

- ⚠️ **Fixed `wait` actions** — the tool can't determine what to wait *for* (element visible, element gone, or loading complete). You'll be asked for each one.

## What You Must Add Manually After Migration

The migration tool converts structure but can't infer intent:

- `optional: true` + `on_failure: "skip"` — you know which steps are sometimes skipped
- `condition` fields — you know which steps are conditional on device state or runtime values
- `capture_to` + `variables` block — you know which values need to be captured for later verification
- `sub_steps` — you know which steps form a conditional sub-flow
- `retry_policy` — you know which steps are prone to transient failures

These are the features that give v2 its power. The migration tool gets you 80% of the way there structurally — the remaining 20% is where you add the intelligence.

---

## Deprecation Timeline

| Phase | Period | Behavior |
|-------|--------|----------|
| Phase 1 | Now → month 6 | Non-blocking warning when generating or executing v1 scenarios |
| Phase 2 | Month 7–11 | New v1 scenario generation blocked. Execution requires acknowledgment. |
| Phase 3 | Month 12+ | Hard fail. v1 scenarios will not execute. |

Run `/mobile-automator:migrate` to upgrade your scenarios before Phase 3.

---

## Reference

- **v2 Schema:** `templates/mobile-automator-generator/references/scenario_schema_v2.json`
- **Prototype examples:** `prototypes/scenario-01-ideal.json`, `prototypes/scenario-02-ideal.json`
- **Pain points this solves:** `scenarios-schema-problems01.md`
- **Design decisions:** `schema-v2-plan.md`

---

## TestRail Integration (v0.2.0+)

New in version 0.2.0: bi-directional TestRail integration.

If your team uses TestRail:
1. Set `TESTRAIL_API_KEY` and `TESTRAIL_DOMAIN` in `.env` for your mobile project
2. When generating tests, provide TestRail case URL instead of manual steps
3. Test results automatically sync back to TestRail after execution

See README.md "Using TestRail" section for detailed guide.

**For existing teams:** Manual test generation continues to work exactly as before. TestRail integration is entirely optional.
