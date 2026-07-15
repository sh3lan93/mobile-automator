---
description: "Test Scenario Schema reference - named step IDs, 14 action types, 27 assertion types, variables, retry policies, and conditional logic."
---

# Test Scenario Schema Reference

The schema for test scenarios. Defines the complete structure for test steps, assertions, variables, execution metadata, and advanced features like retry policies and conditional branching.

## Overview

The scenario schema defines the format for mobile test scenarios:

- **Named string step IDs** — `tap_login`, `wait_for_home` (not integer indices)
- **14 action types** — From simple tap/type to advanced waits and variable capture
- **27 assertion types** — Comprehensive UI, content, visual, and accessibility checks
- **Variables & capture** — Extract dynamic values during execution for later assertions
- **Conditional execution** — Optional steps, conditional branching, retry policies
- **Structured preconditions** — Setup actions and device state requirements

**Schema version identifier:** Every scenario carries a `$schema_version` field (note the leading `$`). It accepts `"2.0"` or `"2.1"` and defaults to `"2.0"`. **2.1 is the current version** and is purely additive over 2.0 — it adds the `mode` metadata field and four platform-agnostic semantic actions (`press_back`, `dismiss_keyboard`, `grant_permission`, `deny_permission`). Existing `"2.0"` scenarios remain valid; new scenarios should use `"2.1"`.

## Schema Structure Overview

```
Test Scenario
├─ Metadata
│  ├─ $schema_version (required: "2.0" or "2.1")
│  ├─ scenario_id (required: snake_case)
│  ├─ name (required: human-readable)
│  ├─ description (required: what it tests)
│  ├─ platform (required: android/ios/cross-platform)
│  ├─ app_package (required: bundle/package ID)
│  └─ metadata (required: app_version, environment)
├─ Organization
│  └─ tags (optional: filtering tags)
├─ Setup
│  ├─ variables (optional: variable definitions)
│  └─ preconditions (optional: setup actions)
├─ Execution
│  ├─ steps (required: ordered array of test actions)
│  └─ assertions (required: verification rules)
└─ Execution Metadata (runtime-only, in result schema)
```

## Complete Field Reference

### Root Level Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `$schema_version` | string | **YES** | Accepts `"2.0"` or `"2.1"` (default `"2.0"`). `"2.1"` is current. |
| `scenario_id` | string | **YES** | Unique identifier in snake_case (e.g., `login_happy_path`) |
| `name` | string | **YES** | Human-readable scenario title |
| `description` | string | **YES** | What this scenario tests and business value |
| `platform` | string | **YES** | Target platform: `android`, `ios`, or `cross-platform` |
| `app_package` | string | **YES** | Android package name or iOS bundle identifier |
| `metadata` | object | **YES** | Design-time metadata with `app_version` and `environment` |
| `tags` | array | No | Categorization tags for filtering (max 10 tags, max 20 chars each) |
| `variables` | object | No | Variable declarations for `capture_value` steps |
| `preconditions` | object | No | Setup requirements and device actions before test |
| `steps` | array | **YES** | Ordered array of step objects (each with `id`, `action`, `description`) |
| `assertions` | array | **YES** | Array of assertion checks |

### Example Minimal Scenario

```json
{
  "$schema_version": "2.1",
  "scenario_id": "login_happy_path",
  "name": "User Login - Happy Path",
  "description": "Verify user can log in with valid credentials and access the dashboard",
  "platform": "android",
  "app_package": "com.example.app",
  "metadata": {
    "app_version": "1.2.3",
    "environment": "staging"
  },
  "steps": [
    {
      "id": "tap_login_button",
      "action": "tap",
      "description": "Tap the login button on the welcome screen",
      "target": "Login button"
    },
    {
      "id": "wait_for_form",
      "action": "wait_for_element",
      "description": "Wait for the email input field to appear",
      "target": "Email input field",
      "wait_config": { "type": "element_visible", "timeout_ms": 5000 }
    }
  ],
  "assertions": [
    {
      "id": "login_form_visible",
      "after_step": "wait_for_form",
      "type": "element_exists",
      "description": "The login form is displayed",
      "element_description": "Email input field"
    }
  ]
}
```

## Steps Array

The `steps` field is an **ordered array** of step objects. Each object requires `id`, `action`, and `description`. The `target` field is a *semantic* description of the element (never a `resource-id` or OS-specific locator) — the agent resolves it to a tappable element at replay time.

### Step ID Format

- Must be lowercase alphanumeric with underscores: `^[a-z][a-z0-9_]*$`
- Examples: `tap_login`, `wait_for_home`, `type_email_address`
- Unique within the scenario; used for screenshot naming and `after_step` references

### Action Types (14 total)

Each step's `action` field is one of these values. In platform-agnostic (`mode: "platform-agnostic"`) scenarios you can additionally use the four semantic actions `press_back`, `dismiss_keyboard`, `grant_permission`, and `deny_permission`, which resolve to the right per-platform mechanics at replay time.

#### 1. launch_app
Launch the app under test on the device.

**Fields:**
- `action` — `"launch_app"`

**Example:**
```json
{
  "id": "launch_app",
  "action": "launch_app",
  "description": "Launch the app under test"
}
```

---

#### 2. tap
Tap on a UI element.

**Fields:**
- `action` — `"tap"`
- `target` — Semantic description of the element to tap
- `optional` (optional) — If `true`, step continues even if element not found (default: `false`)
- `retry_policy` (optional) — Retry configuration

**Example:**
```json
{
  "id": "tap_login_button",
  "action": "tap",
  "description": "Tap the login button",
  "target": "Login button"
}
```

---

#### 3. long_press
Long-press on a UI element.

**Fields:**
- `action` — `"long_press"`
- `target` — Element to long-press

**Example:**
```json
{
  "id": "long_press_menu_item",
  "action": "long_press",
  "description": "Long-press the list item to open the context menu",
  "target": "First message in the list"
}
```

---

#### 4. double_tap
Double-tap on a UI element.

**Fields:**
- `action` — `"double_tap"`
- `target` — Element to double-tap

**Example:**
```json
{
  "id": "double_tap_zoom",
  "action": "double_tap",
  "description": "Double-tap the image to zoom in",
  "target": "Product image"
}
```

---

#### 5. type
Type text into the currently focused input field.

**Fields:**
- `action` — `"type"`
- `value` — Text to type

**Example:**
```json
{
  "id": "enter_email",
  "action": "type",
  "description": "Type the account email into the focused field",
  "value": "user@example.com"
}
```

---

#### 6. swipe
Swipe/scroll in a direction.

**Fields:**
- `action` — `"swipe"`
- `value` — `up`, `down`, `left`, or `right`

**Example:**
```json
{
  "id": "scroll_down_page",
  "action": "swipe",
  "description": "Scroll down the page",
  "value": "down"
}
```

---

#### 7. scroll_to_element
Scroll until a specific element is visible.

**Fields:**
- `action` — `"scroll_to_element"`
- `target` — Element to scroll to

**Example:**
```json
{
  "id": "scroll_to_submit",
  "action": "scroll_to_element",
  "description": "Scroll until the submit button is on screen",
  "target": "Submit button"
}
```

---

#### 8. press_button
Press a hardware/virtual device button.

**Fields:**
- `action` — `"press_button"`
- `value` — `BACK`, `HOME`, or `ENTER`

**Example:**
```json
{
  "id": "press_back",
  "action": "press_button",
  "description": "Press the device back button",
  "value": "BACK"
}
```

---

#### 9. open_url
Open a URL (deep link or web) on the device.

**Fields:**
- `action` — `"open_url"`
- `value` — URL to open

**Example:**
```json
{
  "id": "open_help_page",
  "action": "open_url",
  "description": "Open the help page in the browser",
  "value": "https://help.example.com"
}
```

---

#### 10. wait_for_element
Wait until an element appears on screen.

**Fields:**
- `action` — `"wait_for_element"`
- `target` — Element to wait for
- `wait_config` — `{ "type": "element_visible", "timeout_ms": <1000–60000> }`

**Example:**
```json
{
  "id": "wait_for_dashboard",
  "action": "wait_for_element",
  "description": "Wait for the dashboard content to appear",
  "target": "Dashboard content",
  "wait_config": { "type": "element_visible", "timeout_ms": 15000 }
}
```

---

#### 11. wait_for_element_gone
Wait until an element disappears from screen.

**Fields:**
- `action` — `"wait_for_element_gone"`
- `target` — Element to wait for disappearance
- `wait_config` — `{ "type": "element_gone", "timeout_ms": <1000–60000> }`

**Example:**
```json
{
  "id": "wait_for_loading_done",
  "action": "wait_for_element_gone",
  "description": "Wait for the loading spinner to disappear",
  "target": "Loading spinner",
  "wait_config": { "type": "element_gone", "timeout_ms": 20000 }
}
```

---

#### 12. wait_for_loading_complete
Wait until loading indicators disappear.

**Fields:**
- `action` — `"wait_for_loading_complete"`
- `wait_config` — `{ "type": "loading_complete", "indicator": "any", "timeout_ms": <1000–60000> }`

**Note:** `indicator` may be `shimmer`, `spinner`, `progress_bar`, `skeleton`, or `any` (default `any`).

**Example:**
```json
{
  "id": "wait_for_data_load",
  "action": "wait_for_loading_complete",
  "description": "Wait for the feed to finish loading",
  "wait_config": { "type": "loading_complete", "indicator": "any", "timeout_ms": 30000 }
}
```

---

#### 13. capture_value
Extract text/value from an element and store it in a variable.

**Fields:**
- `action` — `"capture_value"`
- `target` — Element to extract from
- `capture_to` — Variable name to store the value in (must be declared in the `variables` block)

**Example:**
```json
{
  "id": "capture_order_id",
  "action": "capture_value",
  "description": "Capture the order confirmation code",
  "target": "Order confirmation code",
  "capture_to": "order_id"
}
```

---

#### 14. clear_app_data
Clear app data and cache (setup action).

**Fields:**
- `action` — `"clear_app_data"`

**Example:**
```json
{
  "id": "reset_app",
  "action": "clear_app_data",
  "description": "Clear app data to start from a clean state"
}
```

---

### Step Field Options

Additional optional fields that can be added to any step object:

#### optional
If `true`, failure to find or interact with the target is silently ignored and execution continues. Default: `false`

```json
{
  "id": "optional_feature_check",
  "action": "tap",
  "description": "Dismiss the promo banner if it appears",
  "target": "Promo banner close button",
  "optional": true
}
```

#### retry_policy
Configure automatic retry behavior. Only applies when `on_failure` is `"retry"`.

```json
{
  "id": "flaky_element_step",
  "action": "wait_for_element",
  "description": "Wait for the sometimes-slow element",
  "target": "Slow-loading widget",
  "wait_config": { "type": "element_visible", "timeout_ms": 10000 },
  "on_failure": "retry",
  "retry_policy": {
    "max_attempts": 3,
    "backoff_ms": 500
  }
}
```

- `max_attempts` — Total attempts including the first (integer, 2–5)
- `backoff_ms` — Milliseconds to wait between attempts (default `1000`)

#### condition
Execute the step only if the condition object evaluates to true; otherwise the step is skipped.

```json
{
  "id": "conditionally_submit",
  "action": "tap",
  "description": "Submit only when running on Android",
  "target": "Submit button",
  "condition": {
    "type": "device_property",
    "property": "platform",
    "operator": "==",
    "value": "android"
  }
}
```

Condition `type` is one of `device_property`, `previous_step_skipped`, `variable_value`, or `element_visible`.

#### on_failure
What to do when the step fails: `"fail"` (default), `"skip"`, or `"retry"`.

```json
{
  "id": "critical_step",
  "action": "tap",
  "description": "Tap the critical confirm button",
  "target": "Confirm button",
  "on_failure": "fail"
}
```

#### sub_steps
A nested sub-flow (array of step objects) to execute when this step's `condition` is met. After the sub-steps complete, execution resumes at the next top-level step.

```json
{
  "id": "complex_flow",
  "action": "tap",
  "description": "Open the menu, then run the nested flow",
  "target": "Menu button",
  "sub_steps": [
    { "id": "tap_submenu", "action": "tap", "description": "Open the submenu", "target": "Settings submenu" },
    { "id": "verify_result", "action": "wait_for_element", "description": "Wait for the settings panel", "target": "Settings panel", "wait_config": { "type": "element_visible", "timeout_ms": 5000 } }
  ]
}
```

#### wait_config
Configuration for wait-type actions (`wait_for_element`, `wait_for_element_gone`, `wait_for_loading_complete`).

```json
{
  "id": "wait_step",
  "action": "wait_for_element",
  "description": "Wait for the confirmation banner",
  "target": "Confirmation banner",
  "wait_config": {
    "type": "element_visible",
    "timeout_ms": 5000
  }
}
```

- `type` — `element_visible`, `element_gone`, or `loading_complete`
- `timeout_ms` — Maximum wait in milliseconds (1000–60000)
- `indicator` (loading only) — `shimmer`, `spinner`, `progress_bar`, `skeleton`, or `any`

---

## Variables Object

Declare variables that will be captured during test execution and used in assertions or conditions.

**Format:**
```json
{
  "variables": {
    "variable_name": {
      "type": "string|integer|number|boolean",
      "description": "Human-readable description"
    }
  }
}
```

**Example:**
```json
{
  "variables": {
    "auth_token": {
      "type": "string",
      "description": "Authentication token captured after login"
    },
    "user_id": {
      "type": "integer",
      "description": "User ID extracted from profile"
    },
    "is_premium": {
      "type": "boolean",
      "description": "Whether user has premium subscription"
    }
  }
}
```

---

## Preconditions Object

Define setup requirements and device state before test execution.

**Fields:**

| Field | Type | Description |
|-------|------|-------------|
| `app_state` | string | Required app state: `fresh_install`, `logged_in`, `logged_out`, `any` |
| `device_actions` | array | Automated setup actions to perform before the scenario starts |
| `device_properties` | object | Required device properties (network, location_services, orientation) |
| `notes` | array | Human-readable notes about preconditions that cannot be automated |

Each `device_actions` item has an `action` (`clear_app_data`, `uninstall_app`, `install_app`, `enable_wifi`, `disable_wifi`, `set_orientation`) plus optional `target_package`, `value`, and `description`.

**Example:**
```json
{
  "preconditions": {
    "app_state": "logged_out",
    "device_actions": [
      {
        "action": "clear_app_data",
        "target_package": "com.example.app",
        "description": "Clear any cached login data"
      }
    ],
    "device_properties": {
      "network": "wifi",
      "location_services": "enabled",
      "orientation": "portrait"
    },
    "notes": ["A valid test account must exist in the staging environment"]
  }
}
```

---

## Assertions Array

Define verification rules that must pass for the test to succeed. Each assertion requires `id`, `after_step`, `type`, and `description`.

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | **YES** | Unique assertion ID in snake_case |
| `after_step` | string | **YES** | The `id` of the step after which this assertion runs |
| `type` | string | **YES** | Assertion type (one of 27 types) |
| `description` | string | **YES** | Human-readable assertion description |
| `element_description` | string | Depends | Semantic description of the element to check (for element-based types) |
| Type-specific fields | varies | Depends | e.g., `expected_value`, `expected_substring`, `expected_count`, `expected_text`, `pattern` |

**Example:**
```json
{
  "assertions": [
    {
      "id": "welcome_message",
      "after_step": "wait_for_home",
      "type": "element_text",
      "description": "Welcome message displays the user's name",
      "element_description": "Welcome label",
      "expected_value": "Welcome, John Doe"
    },
    {
      "id": "dashboard_visible",
      "after_step": "wait_for_home",
      "type": "element_fully_visible",
      "description": "Dashboard content is fully visible",
      "element_description": "Dashboard content"
    },
    {
      "id": "verification_code_format",
      "after_step": "wait_for_home",
      "type": "pattern_match",
      "description": "Verification code has the correct format",
      "element_description": "Verification code display",
      "pattern": "^[0-9]{6}$"
    }
  ]
}
```

**See [Assertion Types Reference](assertions.md) for complete documentation on all 27 assertion types and their type-specific fields.**

---

## Metadata Object

Design-time metadata about the scenario. Runtime metadata (device, API level, timestamp) is captured in the result schema.

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `app_version` | string | **YES** | Target app version (e.g., `"1.2.3"`, `"staging-latest"`) |
| `environment` | string | **YES** | Target environment: `production`, `staging`, `development`, etc. |
| `target_version` | string | No | Optional target major version (e.g., `"v4.x"`) for compatibility |

**Example:**
```json
{
  "metadata": {
    "app_version": "2.1.0",
    "environment": "staging",
    "target_version": "2.x"
  }
}
```

---

## Tags

Categorization tags for filtering and organizing scenarios.

**Format:**
- Lowercase alphanumeric with hyphens: `^[a-z0-9][a-z0-9-]*$`
- Max 10 tags per scenario
- Max 20 characters per tag

**Example:**
```json
{
  "tags": ["smoke", "regression", "p0", "auth", "critical-flow"]
}
```

**Common tag categories:**
- **Priority:** `p0`, `p1`, `p2`, `p3`
- **Type:** `smoke`, `regression`, `integration`, `sanity`
- **Feature:** `auth`, `checkout`, `payment`, `search`
- **Status:** `flaky`, `experimental`, `deprecated`

---

## Complete Example: Login Scenario with Variables

```json
{
  "$schema_version": "2.1",
  "scenario_id": "login_with_2fa",
  "name": "Login with 2FA",
  "description": "Verify user can log in with email/password and complete two-factor authentication",
  "platform": "android",
  "app_package": "com.example.app",
  "metadata": {
    "app_version": "2.1.0",
    "environment": "staging"
  },
  "tags": ["auth", "p0", "smoke"],
  "variables": {
    "auth_token": {
      "type": "string",
      "description": "JWT token received after successful login"
    }
  },
  "preconditions": {
    "app_state": "logged_out",
    "device_actions": [
      {
        "action": "clear_app_data",
        "target_package": "com.example.app",
        "description": "Clear cached login data"
      }
    ],
    "notes": ["A valid test account must exist in the staging environment"]
  },
  "steps": [
    {
      "id": "launch_app",
      "action": "launch_app",
      "description": "Launch the app under test"
    },
    {
      "id": "wait_for_login_screen",
      "action": "wait_for_element",
      "description": "Wait for the login screen to load",
      "target": "Email input field",
      "wait_config": { "type": "element_visible", "timeout_ms": 10000 }
    },
    {
      "id": "tap_email_field",
      "action": "tap",
      "description": "Focus the email field",
      "target": "Email input field"
    },
    {
      "id": "enter_email",
      "action": "type",
      "description": "Type the test account email",
      "value": "testuser@example.com"
    },
    {
      "id": "tap_password_field",
      "action": "tap",
      "description": "Focus the password field",
      "target": "Password input field"
    },
    {
      "id": "type_password",
      "action": "type",
      "description": "Type the test account password",
      "value": "SecurePassword123!"
    },
    {
      "id": "tap_login",
      "action": "tap",
      "description": "Submit the login form",
      "target": "Login button"
    },
    {
      "id": "wait_for_2fa_prompt",
      "action": "wait_for_element",
      "description": "Wait for the two-factor code prompt",
      "target": "2FA code input field",
      "wait_config": { "type": "element_visible", "timeout_ms": 15000 },
      "on_failure": "retry",
      "retry_policy": { "max_attempts": 3, "backoff_ms": 1000 }
    },
    {
      "id": "enter_2fa_code",
      "action": "type",
      "description": "Type the two-factor authentication code",
      "value": "123456"
    },
    {
      "id": "tap_verify",
      "action": "tap",
      "description": "Confirm the 2FA code",
      "target": "Verify button"
    },
    {
      "id": "wait_for_dashboard",
      "action": "wait_for_loading_complete",
      "description": "Wait for the dashboard to finish loading",
      "wait_config": { "type": "loading_complete", "timeout_ms": 20000 }
    },
    {
      "id": "capture_auth_token",
      "action": "capture_value",
      "description": "Capture the auth token from the session badge",
      "target": "Auth token badge",
      "capture_to": "auth_token"
    }
  ],
  "assertions": [
    {
      "id": "login_success",
      "after_step": "wait_for_dashboard",
      "type": "element_exists",
      "description": "User successfully logged in and the dashboard is visible",
      "element_description": "Dashboard content"
    },
    {
      "id": "welcome_message",
      "after_step": "wait_for_dashboard",
      "type": "text_contains",
      "description": "Welcome banner greets the user",
      "element_description": "Welcome banner",
      "expected_substring": "Welcome"
    },
    {
      "id": "auth_token_captured",
      "after_step": "capture_auth_token",
      "type": "text_not_empty",
      "description": "An auth token was captured",
      "element_description": "Auth token badge"
    },
    {
      "id": "dashboard_fully_loaded",
      "after_step": "wait_for_dashboard",
      "type": "element_fully_visible",
      "description": "Dashboard content is fully visible",
      "element_description": "Dashboard content"
    }
  ]
}
```

---


## Validation Rules

**$schema_version:**
- Accepts `"2.0"` or `"2.1"` (default `"2.0"`); `"2.1"` is current and additive
- Required

**scenario_id:**
- Format: `^[a-z][a-z0-9_]*$`
- Unique within project

**platform:**
- One of: `android`, `ios`, `cross-platform`

**app_package:**
- Android: Java package format (e.g., `com.example.app`)
- iOS: Bundle identifier (e.g., `com.example.App`)
- Must be valid for target platform

**Steps:**
- `steps` is an array; each item requires `id`, `action`, and `description`
- All step IDs must follow format: `^[a-z][a-z0-9_]*$`
- Step IDs must be unique within the scenario
- `target` values are semantic element descriptions, never `resource-id` / OS locators

**Assertions:**
- Each assertion requires `id`, `after_step`, `type`, and `description`
- `after_step` must reference a valid step `id`
- All assertion IDs must be unique
- `type` must be one of 27 supported types

Validate a scenario file at any time with `mauto validate <file>`, which returns the uniform envelope with `data.valid`.

---

## Related References

- [Assertion Types](assertions.md) — All 27 assertion types with examples
- [MCP Tools Reference](mcp-tools.md) — Device automation primitives
- [Test Result Schema](result-schema.md) — How results are structured

[← Back to Reference Index](index.md)
