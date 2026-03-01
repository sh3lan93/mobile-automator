# Test Scenario Schema v2 Reference

The default schema for test scenarios. Defines the complete structure for test steps, assertions, variables, execution metadata, and advanced features like retry policies and conditional branching.

## Overview

Schema v2 introduces a modern, feature-rich format for defining mobile test scenarios:

- **Named string step IDs** — `tap_login`, `wait_for_home` (not integer indices)
- **14 action types** — From simple tap/type to advanced waits and variable capture
- **27 assertion types** — Comprehensive UI, content, visual, and accessibility checks
- **Variables & capture** — Extract dynamic values during execution for later assertions
- **Conditional execution** — Optional steps, conditional branching, retry policies
- **Structured preconditions** — Setup actions and device state requirements
- **TestRail integration** — 1:1 mapping between scenarios and test cases

**Schema version identifier:** All v2 scenarios MUST have `"$schema_version": "2.0"` as the first field.

## Schema Structure Overview

```
Test Scenario v2
├─ Metadata
│  ├─ $schema_version (required: "2.0")
│  ├─ scenario_id (required: snake_case)
│  ├─ name (required: human-readable)
│  ├─ description (required: what it tests)
│  ├─ platform (required: android/ios/cross-platform)
│  ├─ app_package (required: bundle/package ID)
│  └─ metadata (required: app_version, environment)
├─ Organization
│  ├─ tags (optional: filtering tags)
│  └─ testrail (optional: TestRail mapping)
├─ Setup
│  ├─ variables (optional: variable definitions)
│  └─ preconditions (optional: setup actions)
├─ Execution
│  ├─ steps (required: test actions)
│  └─ assertions (required: verification rules)
└─ Execution Metadata (runtime-only, in result schema)
```

## Complete Field Reference

### Root Level Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `$schema_version` | string | **YES** | Must be exactly `"2.0"` for v2 scenarios |
| `scenario_id` | string | **YES** | Unique identifier in snake_case (e.g., `login_happy_path`) |
| `name` | string | **YES** | Human-readable scenario title |
| `description` | string | **YES** | What this scenario tests and business value |
| `platform` | string | **YES** | Target platform: `android`, `ios`, or `cross-platform` |
| `app_package` | string | **YES** | Android package name or iOS bundle identifier |
| `metadata` | object | **YES** | Design-time metadata with `app_version` and `environment` |
| `tags` | array | No | Categorization tags for filtering (max 10 tags, max 20 chars each) |
| `testrail` | object | No | Optional TestRail integration with `case_id`, `project_id`, `case_url` |
| `variables` | object | No | Variable declarations for capture_value steps |
| `preconditions` | object | No | Setup requirements and device actions before test |
| `steps` | object | **YES** | Named test steps (key = step_id, value = action definition) |
| `assertions` | array | **YES** | Array of assertion checks |

### Example Minimal v2 Scenario

```json
{
  "$schema_version": "2.0",
  "scenario_id": "login_happy_path",
  "name": "User Login - Happy Path",
  "description": "Verify user can log in with valid credentials and access dashboard",
  "platform": "android",
  "app_package": "com.example.app",
  "metadata": {
    "app_version": "1.2.3",
    "environment": "staging"
  },
  "steps": {
    "tap_login_button": {
      "type": "tap",
      "element": "login_button"
    },
    "wait_for_form": {
      "type": "wait_for_element",
      "element": "email_field",
      "timeout_seconds": 5
    }
  },
  "assertions": [
    {
      "id": "login_form_visible",
      "description": "Login form is displayed",
      "type": "element_exists",
      "element": "email_field"
    }
  ]
}
```

## Steps Object

The `steps` object contains named test actions. Each key is the step ID (snake_case), and the value is an action definition.

### Step ID Format

- Must be lowercase alphanumeric with underscores: `^[a-z][a-z0-9_]*$`
- Examples: `tap_login`, `wait_for_home`, `type_email_address`
- Max length: 50 characters

### Action Types (14 total)

#### 1. launch_app
Launch the app on the device.

**Fields:**
- `type` — `"launch_app"`
- `app_package` (optional) — Override default package (rarely needed)

**Example:**
```json
{
  "launch_app_step": {
    "type": "launch_app"
  }
}
```

---

#### 2. tap
Tap/click on a UI element.

**Fields:**
- `type` — `"tap"`
- `element` — Element ID/locator to tap
- `optional` (optional) — If `true`, step continues even if element not found (default: `false`)
- `retry_policy` (optional) — Retry configuration

**Example:**
```json
{
  "tap_login_button": {
    "type": "tap",
    "element": "login_button"
  }
}
```

---

#### 3. long_press
Long-press on a UI element.

**Fields:**
- `type` — `"long_press"`
- `element` — Element to long-press
- `duration_ms` (optional) — Press duration in milliseconds (default: 500)

**Example:**
```json
{
  "long_press_menu_item": {
    "type": "long_press",
    "element": "menu_item",
    "duration_ms": 1000
  }
}
```

---

#### 4. double_tap
Double-tap on a UI element.

**Fields:**
- `type` — `"double_tap"`
- `element` — Element to double-tap

**Example:**
```json
{
  "double_tap_zoom": {
    "type": "double_tap",
    "element": "image"
  }
}
```

---

#### 5. type
Type text into a focused input field.

**Fields:**
- `type` — `"type"`
- `text` — Text to type
- `clear_first` (optional) — Clear field before typing (default: `false`)

**Example:**
```json
{
  "enter_email": {
    "type": "type",
    "text": "user@example.com",
    "clear_first": true
  }
}
```

---

#### 6. swipe
Swipe/scroll in a direction.

**Fields:**
- `type` — `"swipe"`
- `direction` — `up`, `down`, `left`, or `right`
- `distance_pixels` (optional) — Distance in pixels (default: 400)

**Example:**
```json
{
  "scroll_down_page": {
    "type": "swipe",
    "direction": "down",
    "distance_pixels": 500
  }
}
```

---

#### 7. scroll_to_element
Scroll until a specific element is visible.

**Fields:**
- `type` — `"scroll_to_element"`
- `element` — Element to scroll to
- `max_swipes` (optional) — Maximum scroll attempts (default: 10)
- `direction` (optional) — `up` or `down` (default: `down`)

**Example:**
```json
{
  "scroll_to_submit": {
    "type": "scroll_to_element",
    "element": "submit_button",
    "direction": "down"
  }
}
```

---

#### 8. press_button
Press a device button.

**Fields:**
- `type` — `"press_button"`
- `button` — `BACK`, `HOME`, `VOLUME_UP`, `VOLUME_DOWN`, `ENTER`

**Example:**
```json
{
  "press_back": {
    "type": "press_button",
    "button": "BACK"
  }
}
```

---

#### 9. open_url
Open a URL in the default browser.

**Fields:**
- `type` — `"open_url"`
- `url` — URL to open

**Example:**
```json
{
  "open_help_page": {
    "type": "open_url",
    "url": "https://help.example.com"
  }
}
```

---

#### 10. wait_for_element
Wait until an element appears on screen.

**Fields:**
- `type` — `"wait_for_element"`
- `element` — Element to wait for
- `timeout_seconds` (optional) — Max wait time (default: 10)

**Example:**
```json
{
  "wait_for_dashboard": {
    "type": "wait_for_element",
    "element": "dashboard_content",
    "timeout_seconds": 15
  }
}
```

---

#### 11. wait_for_element_gone
Wait until an element disappears from screen.

**Fields:**
- `type` — `"wait_for_element_gone"`
- `element` — Element to wait for disappearance
- `timeout_seconds` (optional) — Max wait time (default: 10)

**Example:**
```json
{
  "wait_for_loading_done": {
    "type": "wait_for_element_gone",
    "element": "loading_spinner",
    "timeout_seconds": 20
  }
}
```

---

#### 12. wait_for_loading_complete
Wait until loading indicators disappear.

**Fields:**
- `type` — `"wait_for_loading_complete"`
- `timeout_seconds` (optional) — Max wait time (default: 10)

**Note:** Automatically detects project-specific loading indicators from `mobile-automator/config.json`

**Example:**
```json
{
  "wait_for_data_load": {
    "type": "wait_for_loading_complete",
    "timeout_seconds": 30
  }
}
```

---

#### 13. capture_value
Extract text/value from an element and store in a variable.

**Fields:**
- `type` — `"capture_value"`
- `element` — Element to extract from
- `capture_to` — Variable name to store value (must be declared in `variables` section)

**Example:**
```json
{
  "capture_order_id": {
    "type": "capture_value",
    "element": "order_confirmation_code",
    "capture_to": "order_id"
  }
}
```

---

#### 14. clear_app_data
Clear app data and cache (precondition action).

**Fields:**
- `type` — `"clear_app_data"`
- `app_package` (optional) — Package to clear (default: primary app)

**Example:**
```json
{
  "reset_app": {
    "type": "clear_app_data"
  }
}
```

---

### Step Field Options

Additional fields that can be added to any step:

#### optional
If `true`, step continues even if it fails. Default: `false`

```json
{
  "optional_feature_check": {
    "type": "tap",
    "element": "optional_button",
    "optional": true
  }
}
```

#### retry_policy
Configure automatic retry behavior for flaky steps.

```json
{
  "flaky_element_step": {
    "type": "wait_for_element",
    "element": "sometimes_slow_element",
    "retry_policy": {
      "max_retries": 3,
      "backoff_ms": 500,
      "backoff_multiplier": 1.5
    }
  }
}
```

#### condition
Execute step only if condition is true. Reference variables: `"${{variable_name}}"`

```json
{
  "conditionally_submit": {
    "type": "tap",
    "element": "submit_button",
    "condition": "${{user_role}} == 'admin'"
  }
}
```

#### on_failure
Action to take if step fails: `"skip_remaining"`, `"retry"`, `"capture_screenshot"`, `"continue"`

```json
{
  "critical_step": {
    "type": "tap",
    "element": "critical_button",
    "on_failure": "capture_screenshot"
  }
}
```

#### sub_steps
Nested steps within a parent step (useful for complex interactions).

```json
{
  "complex_flow": {
    "type": "tap",
    "element": "menu",
    "sub_steps": [
      { "tap_submenu": { "type": "tap", "element": "submenu_item" } },
      { "verify_result": { "type": "wait_for_element", "element": "result" } }
    ]
  }
}
```

#### wait_config
Configure wait behavior within a step.

```json
{
  "step_with_custom_wait": {
    "type": "tap",
    "element": "button",
    "wait_config": {
      "implicit_wait_ms": 1000,
      "explicit_timeout_seconds": 5
    }
  }
}
```

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
| `device_actions` | array | Setup actions to perform (clear data, install app, etc.) |
| `device_properties` | object | Required device properties (network, location, orientation) |

**Example:**
```json
{
  "preconditions": {
    "app_state": "logged_out",
    "device_actions": [
      {
        "action": "clear_app_data",
        "description": "Clear any cached login data"
      }
    ],
    "device_properties": {
      "network": "wifi",
      "location_services": "enabled",
      "orientation": "portrait"
    }
  }
}
```

---

## Assertions Array

Define verification rules that must pass for the test to succeed.

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `id` | string | **YES** | Unique assertion ID in snake_case |
| `description` | string | **YES** | Human-readable assertion description |
| `type` | string | **YES** | Assertion type (one of 27 types) |
| `element` | string | Depends | Element to assert (required for most types) |
| Additional fields | varies | Depends | Type-specific fields (e.g., `expected_exact`, `expected_contains`) |

**Example:**
```json
{
  "assertions": [
    {
      "id": "welcome_message",
      "description": "Welcome message displays user's name",
      "type": "element_text",
      "element": "welcome_label",
      "expected_exact": "Welcome, John Doe"
    },
    {
      "id": "dashboard_visible",
      "description": "Dashboard content is fully visible",
      "type": "element_fully_visible",
      "element": "dashboard_content"
    },
    {
      "id": "verification_code_format",
      "description": "Verification code has correct format",
      "type": "pattern_match",
      "element": "code_display",
      "expected_pattern": "^[0-9]{6}$"
    }
  ]
}
```

**See [Assertion Types Reference](assertions.md) for complete documentation on all 27 assertion types.**

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
    "target_version": "v2.x"
  }
}
```

---

## TestRail Integration

Optional integration with TestRail for 1:1 mapping between scenarios and test cases.

**Fields:**

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `case_id` | string | **YES** | TestRail case ID (e.g., `"C12345"`) |
| `project_id` | string | **YES** | TestRail project ID (e.g., `"P1"`) |
| `case_url` | string | **YES** | Full TestRail case URL for reference |

**Example:**
```json
{
  "testrail": {
    "case_id": "C45678",
    "project_id": "P12",
    "case_url": "https://example.testrail.io/index.php?/cases/view/45678"
  }
}
```

When present, the executor automatically syncs test results to TestRail.

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
  "$schema_version": "2.0",
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
  "testrail": {
    "case_id": "C12345",
    "project_id": "P1",
    "case_url": "https://example.testrail.io/index.php?/cases/view/12345"
  },
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
        "description": "Clear cached login data"
      }
    ]
  },
  "steps": {
    "launch_app": {
      "type": "launch_app"
    },
    "wait_for_login_screen": {
      "type": "wait_for_element",
      "element": "email_input",
      "timeout_seconds": 10
    },
    "enter_email": {
      "type": "type",
      "text": "testuser@example.com"
    },
    "enter_password": {
      "type": "tap",
      "element": "password_input"
    },
    "type_password": {
      "type": "type",
      "text": "SecurePassword123!"
    },
    "tap_login": {
      "type": "tap",
      "element": "login_button"
    },
    "wait_for_2fa_prompt": {
      "type": "wait_for_element",
      "element": "2fa_code_input",
      "timeout_seconds": 15,
      "retry_policy": {
        "max_retries": 2,
        "backoff_ms": 1000
      }
    },
    "enter_2fa_code": {
      "type": "type",
      "text": "123456"
    },
    "tap_verify": {
      "type": "tap",
      "element": "verify_2fa_button"
    },
    "wait_for_dashboard": {
      "type": "wait_for_loading_complete",
      "timeout_seconds": 20
    },
    "capture_auth_token": {
      "type": "capture_value",
      "element": "auth_header_token",
      "capture_to": "auth_token"
    }
  },
  "assertions": [
    {
      "id": "login_success",
      "description": "User successfully logged in and dashboard is visible",
      "type": "element_exists",
      "element": "dashboard_content"
    },
    {
      "id": "welcome_message",
      "description": "Welcome message displays correct user",
      "type": "text_contains",
      "element": "welcome_label",
      "expected_contains": "Welcome"
    },
    {
      "id": "auth_token_captured",
      "description": "Authentication token was captured",
      "type": "text_not_empty",
      "element": "auth_header_token"
    },
    {
      "id": "dashboard_fully_loaded",
      "description": "Dashboard is fully visible",
      "type": "element_fully_visible",
      "element": "dashboard_content"
    }
  ]
}
```

---

## Migration from v1

v1 scenarios are deprecated. To migrate:

```bash
/mobile-automator:migrate <scenario_id>
```

**Key differences:**

| Feature | v1 | v2 |
|---------|-----|------|
| Step IDs | Integer (1, 2, 3) | String snake_case (`tap_login`) |
| Step references | `after_step_id: 2` | Direct step ID in `sub_steps` |
| Variables | Limited | Full support with types |
| Preconditions | Array of strings | Structured object |
| Actions | 8 types | 14 types |
| Assertions | 12 types | 27 types |
| Retry policy | Not supported | Built-in support |
| Conditions | Not supported | Full conditional execution |

**Timeline:**
- **Now - 6 months:** v1 supported with deprecation warnings
- **6-12 months:** v1 blocked from execution (warning → error)
- **12+ months:** v1 hard fail with migration message

---

## Validation Rules

**schema_version:**
- Must be exactly `"2.0"`
- Required, must be first field

**scenario_id:**
- Format: `^[a-z][a-z0-9_]*$`
- Max 50 characters
- Unique within project

**platform:**
- One of: `android`, `ios`, `cross-platform`

**app_package:**
- Android: Java package format (e.g., `com.example.app`)
- iOS: Bundle identifier (e.g., `com.example.App`)
- Must be valid for target platform

**Steps:**
- All step IDs must follow format: `^[a-z][a-z0-9_]*$`
- Step IDs must be unique within scenario
- All referenced elements must be valid locators

**Assertions:**
- All assertion IDs must be unique
- `type` must be one of 27 supported types
- Type-specific fields must be present

---

## Related References

- [Assertion Types](assertions.md) — All 27 assertion types with examples
- [MCP Tools Reference](mcp-tools.md) — Device automation primitives
- [Test Result Schema](result-schema.md) — How results are structured

[← Back to Reference Index](index.md)
