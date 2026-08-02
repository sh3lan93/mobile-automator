---
description: "Execute test scenarios on real devices and simulators with AI vision assertions, flakiness detection, and detailed result reports."
---

# Execute Command Guide

The **Execute Command** runs your test scenarios on a real device or simulator, evaluates assertions, captures screenshots, and generates detailed result reports with intelligent observations about flakiness, regressions, and device context.

**Key benefit**: You get comprehensive test data — not just pass/fail, but detailed insights about why tests failed and how to fix them.

## Quick Start

In Claude Code, run the slash-command:

```
/mobile-automator-execute
```

With any other agent, have it read the guide and drive the device through `mauto` verbs:

```bash
mauto guide execute
# the agent then selects a scenario and device, runs it step-by-step,
# and writes a detailed result report
```

Results are saved to: `mobile-automator/results/run_YYYYMMDD_HHMMSS.json`

---

## Prerequisites

Before running execute, ensure:

1. **Setup is complete**
   - `mobile-automator/config.json` exists

2. **Scenarios exist**
   - At least one scenario in `mobile-automator/scenarios/*.json`

3. **Device is connected**
   - Confirm with `mauto devices` (lists reachable devices)

4. **App is installed**
   - Point the agent at a prebuilt artifact to install it directly, or let the agent build

---

## Pre-Flight Checks

When you start execution, the agent verifies:

```
✓ Checking setup state...
✓ Found: mobile-automator/config.json

✓ Detecting devices (mauto devices)...
  Available devices:
    1. Pixel 6 (Android 34)
    2. iPhone 14 Pro (iOS 17.2)

  Select device (1-2): 1

✓ Verifying app installation...
  App: com.example.myapp
  Status: Not installed

  Prebuilt artifact supplied: build/app/outputs/flutter-apk/app-debug.apk
  Installing (mauto install)... ✓

✓ Listing available scenarios...
  1. login_happy_path.json
  2. checkout_flow.json
  3. search_products.json

  Select scenario (1-3): 1
```

If you don't name an artifact, the agent builds and installs using the
`build_command` from `mobile-automator/config.json`. To reuse a build you
already have, name its path when you start the run — for example, "run
checkout_flow using build/app/outputs/flutter-apk/app-debug.apk". If a
different build of the app is already on the device, the agent uninstalls it
first and tells you that app data was wiped.

---

## Execution Workflow

### Phase 1: Setup

Before test execution begins, the agent reads cross-session memory (`mauto memory show`) to pull in prior run history, app-knowledge, and preferences — known flaky screens, waits, and conventions for this app inform how it runs and interprets the scenario.

1. **Clear previous runs** (optional)
   - Ask: "Clear app data before test? (y/n)"
   - Ensures clean state for test execution

2. **Capture baseline state**
   - Screenshot of initial app screen
   - Recorded in results for context

3. **Initialize execution context**
   - Creates run ID: `run_20260301_143000`
   - Records device info, app version, environment

### Phase 2: Step Execution

For each step in your scenario:

#### 2a. Get Current Screen State
```
├─ Run mauto elements
├─ Get current UI element tree (visible text + role + coordinates)
└─ Record screenshot (mauto screenshot)
```

#### 2b. Execute Action

| Action Type | What Happens |
|-------------|--------------|
| `tap` | Clicks element at coordinates |
| `type` | Types text into input field |
| `swipe` | Performs swipe gesture (up/down/left/right) |
| `scroll_to_element` | Scrolls until element visible |
| `long_press` | Holds finger on element |
| `double_tap` | Double-click gesture |
| `wait_for_element` | Waits up to timeout for element |
| `wait_for_loading_complete` | Waits for loading indicators to disappear |
| `press_button` | Presses hardware button (back, home) |
| `launch_app` | Starts your app |
| `clear_app_data` | Resets app to fresh state |
| `capture_value` | Extracts text/value from element |
| `open_url` | Opens URL in browser |

#### 2c. Wait & Observe

After action executes:
- Waits for app response (typically 1-2 seconds)
- Captures screenshot of new state
- Records timing (how long step took)

#### 2d. Evaluate Assertions

For assertions targeting this step:
- Check against new screen state
- Record: passed, failed, or error
- Capture expected vs. actual values

#### 2e. Intelligent Observations

After step completes, checks for:

**Flakiness:**
- Did step fail initially then pass on retry?
- Suggests adding retry policy or longer waits
- Example: "Step 3 failed initially (timeout), passed on retry after 2s wait"

**Regressions:**
- Visual differences from baseline?
- Element missing or relocated?
- Text changed unexpectedly?
- Example: "Button color changed from blue to gray"

**Device State:**
- Is device in airplane mode?
- Low memory or battery?
- Network unavailable?
- Example: "Device in low-power mode"

### Phase 3: Assertion Evaluation

For each assertion in your scenario:

1. **Determine target element** — Which UI element to verify
2. **Get current state** — Current text, visibility, position
3. **Evaluate condition** — Does it match expected value?
4. **Record result** — Pass/fail with expected vs. actual

**Common Assertions:**

```json
{
  "type": "element_exists",
  "element": "login_button",
  "result": "passed",
  "actual": "Button 'Login' visible at (200, 400)"
}
```

```json
{
  "type": "element_text",
  "element": "welcome_message",
  "expected_text": "Welcome back!",
  "actual": "Welcome back!",
  "result": "passed"
}
```

```json
{
  "type": "text_contains",
  "element": "error_message",
  "expected_substring": "timeout",
  "actual": "Network timeout occurred",
  "result": "passed"
}
```

### Phase 4: Results Aggregation

After all steps execute:

1. **Calculate statistics**
   - Total steps: 8
   - Passed: 7
   - Failed: 1
   - Errors: 0
   - Total duration: 45.2 seconds

2. **Determine overall status**
   - `passed` — All assertions passed
   - `failed` — At least one assertion failed
   - `error` — Execution error (crash, element not found)

3. **Generate observations**
   - Flakiness trends
   - Regression patterns
   - Device/environment issues

4. **Create result file**
   - Saved to `mobile-automator/results/run_*.json`
   - Ready for analysis

5. **Harvest memory** (automatic)
   - On `result finalize`, the typed observations (regression / flakiness / state_context) are folded into a bounded rolling per-scenario aggregate in `mobile-automator/memory/run-history.md`, so future runs carry forward what earlier runs learned.
   - This is best-effort: a memory-write failure never fails an otherwise-successful finalize — it is reported in the envelope `hint` instead.

---

## Understanding Results

### Result File Structure

```json
{
  "run_id": "run_20260301_143000",
  "scenario_id": "login_happy_path",
  "status": "passed",
  "metadata": {
    "device_model": "Pixel 6",
    "api_level": "34",
    "app_version": "1.2.3",
    "environment": "staging",
    "timestamp": "2026-03-01T14:30:00Z"
  },
  "total_assertions": 5,
  "passed_assertions": 5,
  "failed_assertions": 0,
  "duration_seconds": 45.2,
  "steps_executed": [...],
  "assertion_results": [...],
  "observations": [...],
  "captured_variables": {...},
  "summary": "✓ Test passed (5/5 assertions passed)"
}
```

### Status Values

| Status | Meaning | Examples |
|--------|---------|----------|
| `passed` | All assertions passed, no errors | Normal successful test |
| `failed` | At least one assertion failed | Expected text didn't match |
| `error` | Execution couldn't continue | Crash, element not found, timeout |

### Step Results

```json
{
  "step_id": "tap_login_button",
  "status": "passed",
  "screenshot": "screenshots/run_20260301_143000/step_1_tap_login_button.png",
  "step_duration_ms": 245,
  "retried": false,
  "retry_count": 0,
  "error_message": null,
  "observations": null
}
```

**Step fields:**
- `step_id` — Step name (e.g., "tap_login_button")
- `status` — Outcome (passed, failed, skipped, error)
- `screenshot` — Captured screenshot for this step
- `step_duration_ms` — Time taken to execute
- `retried` — Whether retry was needed (flaky indicator)
- `retry_count` — How many retries were attempted
- `error_message` — Error details if step failed

### Assertion Results

```json
{
  "assertion_id": "login_success",
  "description": "Welcome screen is visible after login",
  "type": "element_text",
  "status": "passed",
  "expected": "Welcome back!",
  "actual": "Welcome back!",
  "message": "Text matches expected value",
  "element": "welcome_message",
  "reference_screenshot": null,
  "actual_screenshot": "screenshots/run_20260301_143000/assertion_welcome.png"
}
```

**Assertion fields:**
- `assertion_id` — Unique ID for assertion
- `description` — What this assertion verifies
- `type` — Assertion type (element_text, element_exists, etc.)
- `status` — Passed or failed
- `expected` — What was expected
- `actual` — What was actually found
- `element` — Target UI element

### Observations (Intelligent Insights)

```json
{
  "observations": [
    {
      "type": "flakiness",
      "severity": "medium",
      "message": "Step 4 failed initially (timeout), passed on retry after 2s wait",
      "affected_step": "wait_for_product_list",
      "suggestion": "Add a retry_policy or increase the wait timeout (wait_config.timeout_ms)"
    },
    {
      "type": "regression",
      "severity": "high",
      "message": "Login button color changed from blue (#0066FF) to gray (#999999)",
      "affected_element": "login_button",
      "baseline": "#0066FF",
      "current": "#999999"
    },
    {
      "type": "state_context",
      "severity": "info",
      "message": "Device in low-power mode, may affect animation timing",
      "context": "power_mode",
      "value": "low_power"
    }
  ]
}
```

**Observation types:**

- **Flakiness** — Test passed on retry after initial failure
  - Severity: Low (occasionally), Medium (sometimes), High (often)
  - Suggests: Add retry policy, increase timeouts, add explicit waits

- **Regression** — Visual or functional change from baseline
  - Severity: Medium (cosmetic), High (functional)
  - May indicate UI changes, bugs, or environment differences

- **State Context** — Device/environment factors affecting test
  - Severity: Info (context only), Medium (may affect results)
  - Examples: Low power mode, airplane mode, memory pressure, network issues

---

## Captured Variables

If your scenario captures values using `capture_value` steps:

```json
{
  "captured_variables": {
    "user_id": "12345",
    "order_total": "99.99",
    "receipt_number": "REC-2026-0042"
  }
}
```

These values are:
- Extracted during execution
- Available for later assertions
- Useful for data-driven testing

---

## Retry Behavior

If a step has a retry policy configured:

```json
{
  "id": "wait_for_product_list",
  "action": "wait_for_element",
  "target": "product_list",
  "description": "Wait for the product list to load",
  "on_failure": "retry",
  "retry_policy": {
    "max_attempts": 3,
    "backoff_ms": 2000
  }
}
```

Executor will:
1. Attempt step (max 3 times)
2. Wait 2 seconds between retries
3. If 3rd attempt succeeds, marks as `retried: true`
4. If all fail, marks as failed
5. Records retry count in result

**Result example:**
```json
{
  "step_id": "wait_for_products",
  "status": "passed",
  "retried": true,
  "retry_count": 2,
  "observations": "Step failed initially due to loading timeout, passed on 2nd retry"
}
```

---

## Timeout Behavior

For steps with timeouts (waits, element verification):

**Default timeouts:**
- Element waits: 10 seconds
- App launch: 15 seconds
- Loading indicators: 30 seconds

**If timeout is exceeded:**
- Step status: `failed` or `error`
- Error message: "Timeout waiting for element"
- Observation: "Consider adding retry_policy or increasing timeout"

**Customizing timeouts:**

Edit scenario JSON (increase the wait timeout from the default 10s to 30s):
```json
{
  "id": "wait_for_data_grid",
  "action": "wait_for_element",
  "target": "data_grid",
  "description": "Wait for the data grid to load",
  "wait_config": {
    "type": "element_visible",
    "timeout_ms": 30000
  }
}
```

---

## Screenshots

Executor captures screenshots at strategic points:

**Captured for:**
- Each step (before and after action)
- Each failed assertion
- On errors or exceptions
- Device state changes

**Storage:**
```
mobile-automator/results/
├── run_20260301_143000/
│   ├── step_1_tap_login.png
│   ├── step_2_enter_email.png
│   ├── assertion_welcome_screen.png
│   └── ...
└── run_20260301_143000.json
```

**Usage:**
- Visual documentation of test execution
- Help debug failures
- Track UI changes over time
- Create test reports for stakeholders

---

## Troubleshooting Execution

### "Element Not Found" Error

**Problem:** Step failed because element wasn't on screen.

**Solutions:**
1. **Add explicit wait before action:**
   ```json
   {
     "id": "wait_for_target",
     "action": "wait_for_element",
     "target": "target_element",
     "description": "Wait for the target element to appear",
     "wait_config": {
       "type": "element_visible",
       "timeout_ms": 10000
     }
   },
   {
     "id": "tap_target",
     "action": "tap",
     "target": "target_element",
     "description": "Tap the target element"
   }
   ```

2. **Add retry policy:**
   ```json
   {
     "id": "tap_target",
     "action": "tap",
     "target": "target_element",
     "description": "Tap the target element, retrying on failure",
     "on_failure": "retry",
     "retry_policy": {"max_attempts": 3, "backoff_ms": 2000}
   }
   ```

3. **Check element name is correct** — Match exactly as named in scenario

4. **Verify app is in expected state** — Screenshot shows what's actually on screen

### "Assertion Failed: Expected X, Got Y"

**Problem:** Text didn't match or element had unexpected state.

**Solutions:**
1. **Update expected value** — If app intentionally changed
2. **Check for whitespace** — "Welcome back!" vs " Welcome back! "
3. **Use text_contains instead of element_text** — More forgiving
4. **Capture and compare variables** — For dynamic values:
   ```json
   // step: capture the dynamic value
   {
     "id": "capture_dynamic_field",
     "action": "capture_value",
     "target": "dynamic_field",
     "capture_to": "actual_value",
     "description": "Capture the dynamic field value"
   }
   // assertion: compare a later element against the captured value
   {
     "id": "check_dynamic_field",
     "after_step": "capture_dynamic_field",
     "type": "value_matches_variable",
     "element_description": "dynamic_field",
     "variable_name": "actual_value",
     "description": "Field value matches the captured variable"
   }
   ```

### "Test Timed Out"

**Problem:** Step took too long to complete.

**Solutions:**
1. **Increase timeout:**
   ```json
   {
     "id": "wait_for_loading",
     "action": "wait_for_loading_complete",
     "description": "Wait for loading to complete (increased from the default)",
     "wait_config": {
       "type": "loading_complete",
       "timeout_ms": 60000
     }
   }
   ```

2. **Check device performance** — Device may be slow or overloaded

3. **Check network** — Device may have poor connectivity

4. **Add intermediate waits** — Break long operations into steps:
   ```json
   {
     "id": "wait_for_loading_bar",
     "action": "wait_for_element",
     "target": "loading_bar",
     "description": "Wait for the loading bar to appear",
     "wait_config": {
       "type": "element_visible",
       "timeout_ms": 5000
     }
   },
   {
     "id": "loading_bar_optional",
     "action": "wait_for_element",
     "target": "loading_bar",
     "description": "Loading bar may still be visible",
     "optional": true
   },
   {
     "id": "wait_for_content",
     "action": "wait_for_element",
     "target": "content",
     "description": "Wait for the content to load",
     "wait_config": {
       "type": "element_visible",
       "timeout_ms": 10000
     }
   }
   ```

### "App Crashed During Test"

**Problem:** Application crashed mid-execution.

**Solutions:**
1. **Check result file** — `mobile-automator/results/run_*.json` shows which step caused crash
2. **Review app logs** — use your platform's logging tools (Android logcat, Xcode debugger for iOS)
3. **Check if known issue** — May be app bug, not test issue
4. **Add preconditions** — Start from a fresh state before the test:
   ```json
   {
     "preconditions": {
       "app_state": "fresh_install",
       "device_actions": [
         { "action": "clear_app_data", "target_package": "com.example.myapp" }
       ]
     }
   }
   ```

### "Screenshot Capture Failed"

**Problem:** Executor couldn't save screenshots.

**Causes:**
- Device disconnected during execution
- Insufficient disk space
- File system permissions issue

**Solutions:**
1. Check device still connected
2. Verify free disk space: `du -sh mobile-automator/`
3. Check folder permissions: `chmod 755 mobile-automator/results/`

---

## Interpreting Observations

### Flakiness Observation

```json
{
  "type": "flakiness",
  "message": "Step 4 failed initially due to timeout, passed on retry",
  "suggestion": "Consider adding retry_policy to this step"
}
```

**What it means:**
- Step is unreliable (sometimes fails, sometimes passes)
- Likely cause: Timing issue, loading variability, network latency

**What to do:**
- Add retry policy (executor will retry automatically)
- Increase timeout (give more time for operations)
- Add explicit wait before step
- Consider step design (too aggressive, not waiting properly?)

### Regression Observation

```json
{
  "type": "regression",
  "message": "Button color changed from blue to gray",
  "affected_element": "login_button",
  "severity": "medium"
}
```

**What it means:**
- Visual change detected from expected baseline
- Could be intentional UI update or unintended change

**What to do:**
- **If intentional:** Update baseline screenshots in `mobile-automator/screenshots/`
- **If not intentional:** File bug report, may be rendering issue
- **If cosmetic:** Consider if assertion is too strict (color matching)

### State Context Observation

```json
{
  "type": "state_context",
  "message": "Device in low-power mode, may affect animation timing",
  "severity": "info"
}
```

**What it means:**
- Device or environment factor that could affect results
- Not a test failure, but useful context

**What to do:**
- Note for CI/CD: May need device reset between tests
- Add waits for animations if in low-power mode
- Re-run test on different device/environment to verify consistency

---

## Best Practices

### ✅ DO: Use Descriptive Assertions

```json
{
  "id": "assert_welcome",
  "after_step": "login",
  "type": "element_text",
  "element_description": "welcome_message",
  "expected_value": "Welcome back, John!",
  "description": "User is greeted by name after login"
}
```

### ✅ DO: Add Retry Policies for Flaky Operations

```json
{
  "id": "wait_for_loading",
  "action": "wait_for_loading_complete",
  "description": "Wait for loading to complete, retrying on failure",
  "on_failure": "retry",
  "retry_policy": {"max_attempts": 3, "backoff_ms": 2000}
}
```

### ✅ DO: Capture Dynamic Values

```json
// step: capture the order ID
{
  "id": "capture_order_id",
  "action": "capture_value",
  "target": "order_id",
  "capture_to": "generated_order_id",
  "description": "Capture the generated order ID"
}
// assertion: confirmation text contains the captured order ID
{
  "id": "confirm_order_id",
  "after_step": "capture_order_id",
  "type": "text_contains",
  "element_description": "confirmation_text",
  "expected_substring": "Order {{generated_order_id}}",
  "description": "Confirmation text includes the captured order ID"
}
```

### ❌ DON'T: Use Fixed Waits

```json
// Bad
{
  "id": "wait_for_data",
  "action": "wait_for_element",  // Uses a hardcoded timeout
  "target": "data",
  "description": "Wait for the data element",
  "wait_config": { "type": "element_visible", "timeout_ms": 3000 }
}

// Good
{
  "id": "wait_for_loading",
  "action": "wait_for_loading_complete",  // Waits for actual loading
  "description": "Wait for loading to complete"
}
```

### ❌ DON'T: Assert Insignificant Details

```json
// Bad
{
  "id": "assert_pixel_perfect",
  "after_step": "load_screen",
  "type": "screenshot_match",
  "reference_screenshot": "pixel_perfect_baseline.png",  // Too strict
  "description": "Screen matches a pixel-perfect baseline"
}

// Good
{
  "id": "assert_success",
  "after_step": "load_screen",
  "type": "element_exists",
  "element_description": "success_message",  // Functional assertion
  "description": "Success message is present"
}
```

---

## Next Steps

After execution:

1. **Review result file:** `mobile-automator/results/run_*.json`
2. **Check observations:** Look for flakiness or regression insights
3. **View screenshots:** Visual documentation of test flow
4. **Refine scenario:** Based on observations, improve scenario
5. **Re-run if needed:** Fix flakiness, update assertions, etc.

---

## See Also

- [Test Result Schema Reference](../reference/result-schema.md) — Detailed result format
- [Assertion Types Reference](../reference/assertions.md) — All assertion types
- [Generate Command Guide](generate.md) — Creating scenarios
- [FAQ: Execution Issues](../faq.md#test-execution)
