# Generate Command Guide

The **Generate Command** creates test scenarios using natural language descriptions or TestRail test cases. It understands what you want to test, launches your app on a device, resolves UI elements, and generates a JSON scenario file ready for execution.

**Key benefit**: No need to write complex JSON or learn special syntax — just describe your test in plain English.

## Quick Start

```bash
# Run the command
gemini /mobile-automator:generate

# Select a device and app
# Describe your test steps
# Review the generated scenario
```

Generated scenarios are saved to: `mobile-automator/scenarios/<name>.json`

---

## Prerequisites

Before running generate, ensure:

1. **Setup is complete**
   - `mobile-automator/config.json` exists
   - `.gemini/skills/mobile-automator-generator/SKILL.md` is installed

2. **Device is connected**
   - Android: `adb devices` shows your device
   - iOS: `xcrun simctl list` or physical device connected

3. **App is installed** (or allow generator to build/install)
   - Required for element resolution and screenshot capture

---

## Pre-Flight Checks

When you run `/mobile-automator:generate`, the wrapper performs these checks:

```
✓ Checking setup state...
✓ Found: mobile-automator/config.json
✓ Found: .gemini/skills/mobile-automator-generator/SKILL.md

✓ Detecting devices...
  Available devices:
    1. Pixel 6 (Android 34)
    2. iPhone 14 Pro (iOS 17.2)

  Select device (1-2): 1

✓ Verifying app installation...
  App: com.example.myapp
  Status: Installed (v1.2.3)

  Ready to generate!
```

If app isn't installed, generator offers to build and install it.

---

## The Generation Workflow

### Step 1: Natural Language Input

The generator prompts you to describe your test in plain English:

```
Describe your test scenario (what do you want to test?):
```

You can provide test steps in natural language:

**Example 1: Simple Login Flow**
```
1. Tap the login button
2. Enter "user@example.com" in the email field
3. Enter "password123" in the password field
4. Tap the sign in button
5. Wait for the loading spinner to disappear
6. Verify the home screen title says "Welcome back!"
```

**Example 2: Product Search Flow**
```
Launch the app
Navigate to search
Enter "blue shoes" in search field
Wait for results to load
Verify at least 5 products displayed
Tap the first product
Wait for product details to load
Verify product title and price are visible
```

**Example 3: Complex User Flow**
```
Tap hamburger menu
Wait for menu to open
Tap settings option
Wait for settings screen
Toggle dark mode on
Verify app background changed to dark
Go back to main screen
Verify dark mode is persisted
```

### Step 2: Action Recognition

The generator parses your natural language and recognizes actions:

| Your Input | Recognized Action | Details |
|------------|-------------------|---------|
| "Tap the button" | `tap` | Finds button element |
| "Enter 'text' in field" | `type` | Inputs text into field |
| "Wait for element" | `wait_for_element` | Waits up to 10s for element |
| "Wait for loading" | `wait_for_loading_complete` | Waits for loading indicators |
| "Swipe up/down/left/right" | `swipe` | Performs swipe gesture |
| "Scroll to element" | `scroll_to_element` | Scrolls until element visible |
| "Double tap" | `double_tap` | Double-tap gesture |
| "Long press" | `long_press` | Long-press gesture |
| "Press back/home/enter" | `press_button` | Hardware button press |
| "Launch the app" | `launch_app` | Starts your app |
| "Open URL" | `open_url` | Opens a web link |
| "Clear app data" | `clear_app_data` | Resets app state |
| "Verify/Check/Ensure element" | `element_exists` | Assertion: element is visible |
| "Verify text says" | `element_text` | Assertion: text content matches |
| "Verify text contains" | `text_contains` | Assertion: text includes value |
| "Capture value to X" | `capture_value` | Variable capture for dynamic values |

### Step 3: Element Resolution

For each action involving an element (tap, type, verify), the generator:

1. **Takes a screenshot** — Captures current app screen
2. **Lists all elements** — Calls `mobile_list_elements_on_screen()`
3. **Matches your reference** — Fuzzy-matches your description to actual UI elements
4. **Confirms or asks** — "I found a button labeled 'Login' at (200, 400). Use this? (y/n)"

**Element Resolution Examples:**

Your input → Generator finds:
- "Tap the login button" → Button with text "Login"
- "Enter email in the email field" → TextField with hint "Email address"
- "Verify success message" → Text element containing "Success"
- "Tap hamburger menu" → Image/Icon matching common menu patterns

**If Element Not Found:**
- Generator shows available elements on screen
- Asks for clarification: "Email field not found. Available text fields: [list]"
- You can select from list or provide more specific description
- Example: "The email field in the login form" instead of just "email field"

### Step 4: Screenshot Capture

Generator captures screenshots at key points:

- **Before each action** — Shows app state before interaction
- **After each assertion** — Captures result of verification
- **On error** — Captures screen when action fails
- **Reference screenshots** — Saved to `mobile-automator/screenshots/`

Screenshots help you:
- Verify the test matches your intent
- Debug failures during execution
- Create visual test documentation

### Step 5: JSON Generation

The generator creates a v2 scenario JSON file with all information:

```json
{
  "$schema_version": "2.0",
  "scenario_id": "login_happy_path",
  "name": "User Login - Happy Path",
  "description": "User can log in with valid credentials and see home screen",
  "platform": "android",
  "app_package": "com.example.myapp",
  "metadata": {
    "app_version": "1.2.3",
    "environment": "staging"
  },
  "steps": {
    "tap_login_button": {
      "type": "tap",
      "element": "login_button",
      "coordinates": [200, 400]
    },
    "enter_email": {
      "type": "type",
      "element": "email_field",
      "text": "user@example.com"
    },
    "enter_password": {
      "type": "type",
      "element": "password_field",
      "text": "password123"
    },
    "tap_signin": {
      "type": "tap",
      "element": "signin_button"
    },
    "wait_loading": {
      "type": "wait_for_loading_complete",
      "timeout_seconds": 10
    },
    "verify_welcome": {
      "type": "element_text",
      "element": "home_title",
      "expected_exact": "Welcome back!"
    }
  },
  "assertions": [
    {
      "id": "login_button_exists",
      "description": "Login button is visible on startup",
      "type": "element_exists",
      "element": "login_button"
    },
    {
      "id": "home_screen_title",
      "description": "Home screen shows correct greeting",
      "type": "element_text",
      "element": "home_title",
      "expected_exact": "Welcome back!"
    }
  ]
}
```

### Step 6: Review & Refinement

After generation, you can:

**Review the scenario:**
- Generator shows summary of steps and assertions
- Shows captured screenshots
- Lists any ambiguous element matches

**Edit the JSON directly:**
- Generated JSON is human-readable
- You can manually refine step details
- Add advanced features like retry policies, conditional steps, variables

**Or regenerate:**
- Re-run generator with clearer description
- Add more specific element references
- Provide additional context

---

## Advanced Features

### TestRail Integration

If your project uses TestRail, the generator can fetch test cases:

**Input method:**
```
Test source (1-2):
  1. Natural language description
  2. TestRail test case

Select: 2
```

**TestRail workflow:**
1. Generator asks for TestRail credentials (cached securely)
2. Fetches test case ID or searches by title
3. Extracts test case steps
4. Parses steps as natural language
5. Generates JSON scenario
6. Includes TestRail metadata for later sync

**Generated scenario includes:**
```json
{
  "scenario_id": "login_happy_path",
  "testrail": {
    "case_id": 12345,
    "project_id": 1,
    "case_url": "https://testrail.example.com/cases/12345"
  },
  ...
}
```

After execution, results sync automatically to TestRail.

### Variables & Dynamic Values

For tests with dynamic data (usernames, IDs, etc.), use variable capture:

```
1. Capture the user ID from the welcome message to variable "user_id"
2. Tap profile menu
3. Verify the ID displayed matches variable "user_id"
```

Generator creates:
```json
{
  "variables": {
    "user_id": {
      "type": "string",
      "description": "User ID from welcome message"
    }
  },
  "steps": {
    "capture_user_id": {
      "type": "capture_value",
      "element": "welcome_message",
      "capture_to": "user_id"
    },
    "verify_id_matches": {
      "type": "value_matches_variable",
      "element": "profile_id",
      "variable": "user_id"
    }
  }
}
```

### Conditional Steps

For conditional branching (skip steps if condition not met):

```
1. Tap login button
2. If email field exists, enter "user@example.com"
3. Otherwise, skip to biometric login
4. Complete login flow
```

Generator creates:
```json
{
  "steps": {
    "enter_email": {
      "type": "type",
      "element": "email_field",
      "text": "user@example.com",
      "optional": true,
      "condition": {
        "type": "element_exists",
        "element": "email_field"
      }
    }
  }
}
```

### Retry Policies

For flaky steps that need retry logic:

```
Wait for product list to load (retry up to 3 times if timeout)
```

Generator creates:
```json
{
  "type": "wait_for_element",
  "element": "product_list",
  "timeout_seconds": 10,
  "retry_policy": {
    "max_retries": 3,
    "wait_between_retries_ms": 2000
  }
}
```

---

## Best Practices for Descriptions

### ✅ DO: Be Specific

```
Good:  "Tap the 'Sign Up' button in the top-right corner of the login screen"
Bad:   "Tap the button"

Good:  "Enter 'test@example.com' in the email field and verify it appears"
Bad:   "Type in a field"
```

### ✅ DO: Describe Intent & Outcome

```
Good:  "Wait for loading spinner to disappear, then verify the product list is visible"
Bad:   "Wait 5 seconds"

Good:  "Tap the menu icon and verify all menu options are displayed"
Bad:   "Tap menu"
```

### ✅ DO: Use Natural Language

The generator understands human language better than special syntax:

```
Good:  "Verify the price is not empty"
Bad:   "assert(price != '')"

Good:  "Scroll down until the checkout button is visible"
Bad:   "scroll(0, 500)"
```

### ❌ DON'T: Be Too Vague

```
Bad:  "Do something with login"
Bad:  "Test the app"
Bad:  "Verify stuff works"
```

### ❌ DON'T: Include Implementation Details

```
Bad:  "Tap at coordinates (200, 400)"
      (Use: "Tap the login button" instead)

Bad:  "Wait 3 seconds"
      (Use: "Wait for loading spinner to disappear" instead)
```

---

## Understanding Generated Scenarios

### Schema Version

All generated scenarios are v2:
```json
{ "$schema_version": "2.0" }
```

v2 provides modern features like variables, retry policies, and better assertions.

### Step IDs (Named Strings)

v2 uses descriptive step IDs instead of integers:
```json
"steps": {
  "tap_login": {...},
  "enter_email": {...},
  "wait_loading": {...}
}
```

Benefits:
- More readable and maintainable
- Easier to reference in assertions
- Better error messages

### Assertion Types

Generator supports 27 different assertions. Common types:

| Type | Example |
|------|---------|
| `element_exists` | Verify button is visible |
| `element_not_exists` | Verify loading spinner disappeared |
| `element_text` | Verify text says exactly "Welcome" |
| `text_contains` | Verify message includes "success" |
| `element_visible` | Verify element is in viewport |
| `screenshot_match` | Verify screen matches reference |
| `element_count` | Verify list has 5 items |
| `list_is_empty` | Verify no results shown |
| `value_matches_variable` | Verify value matches captured variable |

See [Assertion Reference](../reference/assertions.md) for full list.

---

## Troubleshooting

### "Element Not Found"

**Problem:** Generator can't find an element you referenced.

**Solution:**
- Make sure element is visible on current screen
- Try more specific description: "Login button in the center" instead of "button"
- Check for typos in text content
- Add explicit wait before action: "Wait 2 seconds, then tap login button"

### "Generated Scenario Doesn't Match Intent"

**Problem:** Generated JSON has extra or missing steps.

**Solution:**
- Review generator's summary of recognized actions
- Edit the JSON manually to refine details
- Re-run generator with clearer description
- Use the reference UI elements shown during generation

### "Screenshot Capture Failed"

**Problem:** Generator couldn't capture screenshots.

**Causes:**
- Device connection lost
- App crashed during test
- Insufficient disk space

**Solution:**
- Verify device is still connected: `adb devices` or `xcrun simctl list`
- Restart app: `/mobile-automator:generate` will rebuild/reinstall
- Check free disk space

### "Too Many Steps Generated"

**Problem:** Generator created more steps than you described.

**Solution:**
- Generator may be breaking down complex actions
- Edit JSON to combine related steps
- Re-run with simpler, more concise description

---

## Generated Files

After generation, check the created files:

```
mobile-automator/
├── scenarios/
│   └── login_happy_path.json          ← Your scenario
├── screenshots/
│   ├── login_happy_path_step1.png
│   ├── login_happy_path_step2.png
│   └── ...
└── config.json
```

**Scenario file:** Ready to execute immediately with `/mobile-automator:execute`

**Screenshots:** Reference images for visual verification during execution

---

## Next Steps

1. **Review scenario:** Open `mobile-automator/scenarios/<name>.json` in editor
2. **Refine if needed:** Edit JSON or regenerate with different description
3. **Execute the test:** `/mobile-automator:execute`
4. **Review results:** Check `mobile-automator/results/run_*.json`

See [Execute Command Guide](execute.md) for running tests.

---

## Advanced: Editing Generated Scenarios

Generated JSON is fully editable. Common modifications:

**Add retry policy:**
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

**Make step optional:**
```json
{
  "type": "element_text",
  "element": "newsletter_prompt",
  "optional": true
}
```

**Add condition:**
```json
{
  "type": "tap",
  "element": "premium_feature",
  "condition": {
    "type": "element_exists",
    "element": "premium_badge"
  }
}
```

See [Schema v2 Reference](../reference/schema-v2.md) for all available options.

---

## See Also

- [Execute Command Guide](execute.md) — Running your generated scenarios
- [Schema v2 Reference](../reference/schema-v2.md) — Detailed scenario format
- [Assertion Types Reference](../reference/assertions.md) — All assertion types available
