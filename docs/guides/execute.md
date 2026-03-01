# Execute Command Guide

The **Execute Command** runs your test scenarios on a real device or simulator, evaluates assertions, captures screenshots, and generates detailed result reports with intelligent observations about flakiness, regressions, and device context.

**Key benefit**: You get comprehensive test data — not just pass/fail, but detailed insights about why tests failed and how to fix them.

## Quick Start

```bash
# Run the command
gemini /mobile-automator:execute

# Select scenario and device
# Watch test execute step-by-step
# Review detailed results
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
   - Android: `adb devices` shows your device
   - iOS: Simulator running or physical device connected

4. **App is installed**
   - Executor will build/install if needed

---

## Pre-Flight Checks

When you run `/mobile-automator:execute`, the wrapper verifies:

```
✓ Checking setup state...
✓ Found: mobile-automator/config.json
✓ Found: .gemini/skills/mobile-automator-executor/SKILL.md

✓ Detecting devices...
  Available devices:
    1. Pixel 6 (Android 34)
    2. iPhone 14 Pro (iOS 17.2)

  Select device (1-2): 1

✓ Verifying app installation...
  App: com.example.myapp
  Status: Not installed

  Build and install now? (y/n): y
  Building... Installing... ✓

✓ Listing available scenarios...
  1. login_happy_path.json
  2. checkout_flow.json
  3. search_products.json

  Select scenario (1-3): 1
```

---

## Execution Workflow

### Phase 1: Setup

Before test execution begins:

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
├─ Call mobile_list_elements_on_screen()
├─ Get current UI element tree
└─ Record screenshot
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
  "expected_exact": "Welcome back!",
  "actual": "Welcome back!",
  "result": "passed"
}
```

```json
{
  "type": "text_contains",
  "element": "error_message",
  "expected_contains": "timeout",
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
   - Ready for analysis and TestRail sync

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
      "suggestion": "Add retry_policy or increase timeout_seconds"
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

## Captured Variables (v2 Scenarios)

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
- Synced to TestRail if configured
- Useful for data-driven testing

---

## Retry Behavior

If a step has a retry policy configured:

```json
{
  "type": "wait_for_element",
  "element": "product_list",
  "retry_policy": {
    "max_retries": 3,
    "wait_between_retries_ms": 2000
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

Edit scenario JSON:
```json
{
  "type": "wait_for_element",
  "element": "data_grid",
  "timeout_seconds": 30  ← Increase from default 10s
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

## TestRail Sync

If your scenario includes TestRail metadata:

```json
{
  "scenario_id": "login_happy_path",
  "testrail": {
    "case_id": 12345,
    "project_id": 1,
    "case_url": "https://testrail.example.com/cases/12345"
  }
}
```

After execution, results automatically sync to TestRail:

1. Maps result status to TestRail status
   - `passed` → Test case passed
   - `failed` → Test case failed
   - `error` → Test case blocked

2. Uploads screenshots and observations
3. Records execution time and device info
4. Adds result comment with detailed findings

**Manual sync:**
```bash
gemini /mobile-automator:execute --testrail-sync
```

---

## Troubleshooting Execution

### "Element Not Found" Error

**Problem:** Step failed because element wasn't on screen.

**Solutions:**
1. **Add explicit wait before action:**
   ```json
   {
     "type": "wait_for_element",
     "element": "target_element",
     "timeout_seconds": 10
   },
   {
     "type": "tap",
     "element": "target_element"
   }
   ```

2. **Add retry policy:**
   ```json
   {
     "type": "tap",
     "element": "target_element",
     "retry_policy": {"max_retries": 3, "wait_between_retries_ms": 2000}
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
   {
     "type": "capture_value",
     "element": "dynamic_field",
     "capture_to": "actual_value"
   },
   {
     "type": "value_matches_variable",
     "variable": "actual_value"
   }
   ```

### "Test Timed Out"

**Problem:** Step took too long to complete.

**Solutions:**
1. **Increase timeout:**
   ```json
   {
     "type": "wait_for_loading_complete",
     "timeout_seconds": 60  ← Increase from default
   }
   ```

2. **Check device performance** — Device may be slow or overloaded

3. **Check network** — Device may have poor connectivity

4. **Add intermediate waits** — Break long operations into steps:
   ```json
   {
     "type": "wait_for_element",
     "element": "loading_bar",
     "timeout_seconds": 5
   },
   {
     "type": "wait_for_element",
     "element": "loading_bar",
     "optional": true  ← May disappear
   },
   {
     "type": "wait_for_element",
     "element": "content",
     "timeout_seconds": 10
   }
   ```

### "App Crashed During Test"

**Problem:** Application crashed mid-execution.

**Solutions:**
1. **Check result file** — `mobile-automator/results/run_*.json` shows which step caused crash
2. **Review app logs** — `adb logcat` (Android) or Xcode debugger (iOS)
3. **Check if known issue** — May be app bug, not test issue
4. **Add preconditions** — Clear app data before test:
   ```json
   {
     "preconditions": {
       "clear_app_data": true,
       "restart_app": true
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
  "type": "element_text",
  "element": "welcome_message",
  "expected_exact": "Welcome back, John!",
  "description": "User is greeted by name after login"
}
```

### ✅ DO: Add Retry Policies for Flaky Operations

```json
{
  "type": "wait_for_loading_complete",
  "retry_policy": {"max_retries": 3, "wait_between_retries_ms": 2000}
}
```

### ✅ DO: Capture Dynamic Values

```json
{
  "type": "capture_value",
  "element": "order_id",
  "capture_to": "generated_order_id"
},
{
  "type": "element_text",
  "element": "confirmation_text",
  "expected_contains": "Order captured_to {{generated_order_id}}"
}
```

### ❌ DON'T: Use Fixed Waits

```json
// Bad
{
  "type": "wait_for_element",  // Uses hardcoded timeout
  "element": "data",
  "timeout_seconds": 3
}

// Good
{
  "type": "wait_for_loading_complete"  // Waits for actual loading
}
```

### ❌ DON'T: Assert Insignificant Details

```json
// Bad
{
  "type": "screenshot_match",
  "reference": "pixel_perfect_baseline.png"  // Too strict
}

// Good
{
  "type": "element_exists",
  "element": "success_message"  // Functional assertion
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
