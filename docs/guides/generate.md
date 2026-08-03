---
description: "Generate test scenarios from natural language descriptions using mobile-automator's AI-powered test generation."
---

# Generate Command Guide

The **Generate Command** creates test scenarios using natural language descriptions. It understands what you want to test, launches your app on a device, resolves UI elements, and generates a JSON scenario file ready for execution.

**Key benefit**: No need to write complex JSON or learn special syntax — just describe your test in plain English.

## Quick Start

In Claude Code, run the slash-command:

```
/mobile-automator-generate
```

With any other agent, have it read the guide and drive the device through `mauto` verbs:

```bash
mauto guide generate
# the agent then selects a device, you describe your test steps,
# and it writes the generated scenario
```

Generated scenarios are saved to: `mobile-automator/scenarios/<name>.json`

---

## Prerequisites

Before generating, ensure:

1. **Setup is complete**
   - `mobile-automator/config.json` exists (created by `mauto setup`)
   - Your agent is wired up via `mauto init --agent <host>` (installs the native Agent Skill / slash-commands for your host)

2. **Device is connected**
   - Confirm with `mauto devices` (lists reachable devices)

3. **App is installed** (or name a prebuilt artifact, or — in platform-aware projects — allow the agent to build)
   - Required for element resolution and screenshot capture

---

## Pre-Flight Checks

When you start generation, the agent performs these checks:

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
  Status: Installed (v1.2.3)

  Ready to generate!
```

If the app isn't installed, name a prebuilt artifact path when you start and the
agent installs it with `mauto install`. Without an artifact, a **platform-aware**
project builds using the `build_command` from your config; a **platform-agnostic**
project never builds and asks you to install the app yourself.

---

## The Generation Workflow

### Step 0: Consult cross-session memory

Before authoring, the agent reads what it already knows about this app:

```bash
mauto memory show
```

This surfaces prior run history, app-knowledge, and preferences — so it can reuse known selectors, waits, and conventions instead of re-discovering them. As it learns durable facts during generation (a reliable element reference, a project convention, a flaky screen to guard), it records them for next time:

```bash
mauto memory add "Login screen shows a shimmer loader; wait for it to clear" --kind app-knowledge
mauto memory add "Prefer semantic waits over fixed delays" --kind preferences
```

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

1. **Takes a screenshot** — Captures current app screen (`mauto screenshot`)
2. **Lists all elements** — Runs `mauto elements` to read the on-screen UI tree
3. **Matches your reference** — Fuzzy-matches your description to actual UI elements by visible text, role, and coordinates (never resource-ids)
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

The generator creates a scenario JSON file with all information:

```json
{
  "$schema_version": "2.1",
  "scenario_id": "login_happy_path",
  "name": "User Login - Happy Path",
  "description": "User can log in with valid credentials and see home screen",
  "platform": "android",
  "app_package": "com.example.myapp",
  "metadata": {
    "app_version": "1.2.3",
    "environment": "staging"
  },
  "steps": [
    {
      "id": "tap_login_button",
      "action": "tap",
      "description": "Open the login form",
      "target": "Login button"
    },
    {
      "id": "enter_email",
      "action": "type",
      "description": "Enter the account email",
      "target": "Email field",
      "value": "user@example.com"
    },
    {
      "id": "enter_password",
      "action": "type",
      "description": "Enter the account password",
      "target": "Password field",
      "value": "password123"
    },
    {
      "id": "tap_signin",
      "action": "tap",
      "description": "Submit the login form",
      "target": "Sign in button"
    },
    {
      "id": "wait_loading",
      "action": "wait_for_loading_complete",
      "description": "Wait for the login spinner to clear",
      "wait_config": {
        "type": "loading_complete",
        "indicator": "spinner",
        "timeout_ms": 10000
      }
    }
  ],
  "assertions": [
    {
      "id": "login_button_exists",
      "after_step": "tap_login_button",
      "type": "element_exists",
      "description": "Login button is visible on startup",
      "element_description": "Login button"
    },
    {
      "id": "home_screen_title",
      "after_step": "wait_loading",
      "type": "element_text",
      "description": "Home screen shows correct greeting",
      "element_description": "Home screen title",
      "expected_text": "Welcome back!"
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
  "steps": [
    {
      "id": "capture_user_id",
      "action": "capture_value",
      "description": "Capture the user ID shown in the welcome message",
      "target": "welcome_message",
      "capture_to": "user_id"
    }
  ],
  "assertions": [
    {
      "id": "id_matches",
      "after_step": "capture_user_id",
      "type": "value_matches_variable",
      "description": "Verify the profile ID matches the captured user_id",
      "element_description": "profile_id",
      "variable_name": "user_id"
    }
  ]
}
```

Variables are captured by a `capture_value` **step** (via `capture_to`) and checked by a `value_matches_variable` **assertion** (via `variable_name`).

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
  "steps": [
    {
      "id": "enter_email",
      "action": "type",
      "description": "Enter the email address when the field is present",
      "target": "email_field",
      "value": "user@example.com",
      "optional": true,
      "condition": {
        "type": "element_visible",
        "element_description": "email_field"
      }
    }
  ]
}
```

Condition `type` is one of `element_visible`, `variable_value`, `device_property`, or `previous_step_skipped` — pair it with `optional: true` so an unmet condition skips the step instead of failing it.

### Retry Policies

For flaky steps that need retry logic:

```
Wait for product list to load (retry up to 3 times if timeout)
```

Generator creates:
```json
{
  "id": "wait_for_products",
  "action": "wait_for_element",
  "description": "Wait for the product list to load",
  "target": "product_list",
  "wait_config": {
    "type": "element_visible",
    "timeout_ms": 10000
  },
  "on_failure": "retry",
  "retry_policy": {
    "max_attempts": 3,
    "backoff_ms": 2000
  }
}
```

`retry_policy` applies only when `on_failure` is `"retry"`. `max_attempts` (2–5) counts the initial try plus retries; `backoff_ms` is the pause between attempts.

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

Scenarios carry a `$schema_version` field (note the leading `$`). Two values are valid:

```json
{ "$schema_version": "2.1" }
```

`2.0` is the baseline. **`2.1` is current and additive** — it adds the `mode` metadata field and the four platform-agnostic semantic actions (`press_back`, `dismiss_keyboard`, `grant_permission`, `deny_permission`) without removing anything. Existing `2.0` scenarios remain valid, so there is no forced migration; new scenarios should use `2.1`.

Either version provides features like variables, retry policies, and comprehensive assertions.

### Step IDs (Named Strings)

`steps` is an ordered array; each step carries a descriptive `id` (plus `action` and `description`):
```json
"steps": [
  { "id": "tap_login", "action": "tap", "description": "..." },
  { "id": "enter_email", "action": "type", "description": "..." },
  { "id": "wait_loading", "action": "wait_for_element", "description": "..." }
]
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
- Verify the device is still connected: `mauto devices`
- Restart the app: re-run `/mobile-automator-generate` (or `mauto guide generate`) and the agent will rebuild/reinstall
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

**Scenario file:** Ready to execute immediately with `/mobile-automator-execute` (or `mauto guide execute`)

**Screenshots:** Reference images for visual verification during execution

---

## Next Steps

1. **Review scenario:** Open `mobile-automator/scenarios/<name>.json` in editor
2. **Validate it:** Run `mauto validate <file>` to check it against the scenario schema
3. **Refine if needed:** Edit JSON or regenerate with different description
4. **Execute the test:** `/mobile-automator-execute` (or `mauto guide execute`)
5. **Review results:** Check `mobile-automator/results/run_*.json`

See [Execute Command Guide](execute.md) for running tests.

---

## Advanced: Editing Generated Scenarios

Generated JSON is fully editable. Common modifications:

**Add retry policy:**
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

**Make step optional:**
```json
{
  "id": "dismiss_newsletter_prompt",
  "action": "tap",
  "target": "newsletter_prompt",
  "description": "Dismiss the newsletter prompt if it appears",
  "optional": true
}
```

**Add condition:**
```json
{
  "id": "tap_premium_feature",
  "action": "tap",
  "target": "premium_feature",
  "description": "Tap the premium feature when the premium badge is present",
  "condition": {
    "type": "element_visible",
    "element_description": "premium_badge"
  }
}
```

See [Schema Reference](../reference/schema.md) for all available options.

---

## See Also

- [Execute Command Guide](execute.md) — Running your generated scenarios
- [Schema Reference](../reference/schema.md) — Detailed scenario format
- [Assertion Types Reference](../reference/assertions.md) — All assertion types available
