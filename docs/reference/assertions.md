---
description: "All 27 assertion types in mobile-automator - element state, text content, visual layout, navigation, accessibility, and platform-specific checks."
---

# Assertion Types Reference

mobile-automator supports 27 assertion types organized in 8 categories for comprehensive test verification.

Every assertion object requires `id`, `after_step` (the step `id` it runs after), `type`, and `description`. Element-based assertions locate their target with `element_description` — a *semantic* description of the element, never a `resource-id` or OS-specific locator. The syntax snippets below show only the type-specific fields for brevity.

## Quick Reference Table

| Category | Types | Count |
|----------|-------|-------|
| Element State | element_exists, element_not_exists, element_visible, element_state | 4 |
| Text & Content | element_text, text_contains, text_not_empty, element_hint, pattern_match, text_changed, content_description | 7 |
| Count & Collections | element_count, list_item_count, list_is_empty | 3 |
| Visual & Layout | screenshot_match, visual_state, element_fully_visible, color_style | 4 |
| Navigation & Screen | screen_title, alert_present, alert_text, toast_visible, keyboard_visible | 5 |
| Accessibility | has_accessibility_label | 1 |
| Data & Variables | value_matches_variable | 1 |
| Platform-Specific | permission_dialog_shown, dark_mode_active | 2 |

## Element State Assertions (4 types)

### element_exists
Verify element is present in UI.

**When to use:** Check that expected UI element is on screen.

**Syntax:**
```json
{
  "type": "element_exists",
  "element_description": "Login button"
}
```

**Example scenario usage:**
```
Verify the login button is present on the screen
Check that the welcome message exists
```

---

### element_not_exists
Verify element is absent from UI.

**When to use:** Verify something that shouldn't be there is gone (e.g., loading indicator disappeared, error message cleared).

**Syntax:**
```json
{
  "type": "element_not_exists",
  "element_description": "Loading spinner"
}
```

**Example scenario usage:**
```
Verify the loading spinner has disappeared
Check that the error message is no longer visible
```

---

### element_visible
Verify element is visible to user.

**When to use:** Element exists but might be hidden or clipped. This is stricter than `element_exists`.

**Syntax:**
```json
{
  "type": "element_visible",
  "element_description": "Success message",
  "expected_visible": true
}
```

`expected_visible` is a boolean: `true` = must be visible/showing, `false` = must be hidden/dismissed.

**Example scenario usage:**
```
Verify the success message is visible to the user
Check that the button is not hidden by other content
```

---

### element_state
Check element state (enabled, disabled, focused, selected, etc.).

**When to use:** Verify an element's interactive state or selection status.

**Syntax:**
```json
{
  "type": "element_state",
  "element_description": "Submit button",
  "state_property": "enabled"
}
```

**Supported `state_property` values:**
- `enabled` — Element is interactive
- `disabled` — Element is not interactive
- `selected` — Element is selected (checkbox, radio button)
- `not_selected` — Element is not selected
- `focused` — Element has focus (cursor in text field)
- `clickable` — Element is clickable

**Example scenario usage:**
```
Verify the submit button is enabled
Check that the accept checkbox is selected
Check that the input field is focused
```

---

## Text & Content Assertions (7 types)

### element_text
Verify exact text match.

**When to use:** Check exact content of a label, button, or message. Whitespace must match exactly.

**Syntax:**
```json
{
  "type": "element_text",
  "element_description": "Welcome label",
  "expected_value": "Welcome, John"
}
```

**Example scenario usage:**
```
Verify the welcome message says "Welcome, John"
Check the button text is exactly "Sign In"
```

---

### text_contains
Verify substring is present.

**When to use:** Check that text contains a substring (useful when exact text varies or contains dynamic content).

**Syntax:**
```json
{
  "type": "text_contains",
  "element_description": "Status message",
  "expected_substring": "Success"
}
```

**Example scenario usage:**
```
Verify the message contains "Success"
Check that the error text includes "Invalid email"
```

---

### text_not_empty
Verify field has any text.

**When to use:** Check that a field is populated with something (exact content doesn't matter).

**Syntax:**
```json
{
  "type": "text_not_empty",
  "element_description": "Username field"
}
```

**Example scenario usage:**
```
Verify the username field is not empty
Check that the response contains some text
```

---

### element_hint
Check placeholder/hint text.

**When to use:** Verify placeholder text in input fields.

**Syntax:**
```json
{
  "type": "element_hint",
  "element_description": "Email field",
  "expected_text": "Enter email address"
}
```

**Example scenario usage:**
```
Verify the email field placeholder says "Enter email address"
Check that the input hint text is correct
```

---

### pattern_match
Verify text matches regex pattern.

**When to use:** Check format of dynamic text (phone numbers, email, dates, codes).

**Syntax:**
```json
{
  "type": "pattern_match",
  "element_description": "Error code",
  "pattern": "^ERR_[0-9]{3}$"
}
```

**Common patterns:**
- Email: `^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$`
- Phone (US): `^\\d{3}-\\d{3}-\\d{4}$`
- Date (YYYY-MM-DD): `^\\d{4}-\\d{2}-\\d{2}$`
- Alphanumeric code: `^[A-Z0-9]{6,10}$`

**Example scenario usage:**
```
Verify the confirmation code matches the pattern [A-Z0-9]{6}
Check that the phone number follows the format XXX-XXX-XXXX
```

---

### text_changed
Verify text changed since last check.

**When to use:** Confirm that a dynamic value updated (counter incremented, status changed, etc.).

**Syntax:**
```json
{
  "type": "text_changed",
  "element_description": "Counter label"
}
```

**Example scenario usage:**
```
Verify the counter value changed
Check that the status text was updated
```

---

### content_description
Verify accessibility content description.

**When to use:** Check alt text or accessibility description on images, icons, or custom views.

**Syntax:**
```json
{
  "type": "content_description",
  "element_description": "Profile icon",
  "expected_text": "User profile picture"
}
```

**Example scenario usage:**
```
Verify the profile icon has content description "User profile picture"
Check the accessibility label of the button
```

---

## Count & Collections Assertions (3 types)

### element_count
Count specific elements matching a description.

**When to use:** Verify number of matching elements on screen (buttons, list items, tabs).

**Syntax:**
```json
{
  "type": "element_count",
  "element_description": "List item",
  "operator": "==",
  "expected_count": 5
}
```

`operator` is one of `==`, `!=`, `>=`, `<=`, `>`, `<` (default `==`).

**Example scenario usage:**
```
Verify there are exactly 5 items in the list
Check that the search results show 10 products
```

---

### list_item_count
Count items in a list view or collection.

**When to use:** Verify number of items in a ListView, RecyclerView, or collection view.

**Syntax:**
```json
{
  "type": "list_item_count",
  "element_description": "Messages list",
  "operator": "==",
  "expected_count": 3
}
```

**Example scenario usage:**
```
Verify the chat has 3 messages
Check that the cart contains 5 items
```

---

### list_is_empty
Verify list has no items.

**When to use:** Check that a list view or search results are empty (no data state).

**Syntax:**
```json
{
  "type": "list_is_empty",
  "element_description": "Search results list"
}
```

**Example scenario usage:**
```
Verify the search results are empty
Check that the cart is empty when no items added
```

---

## Visual & Layout Assertions (4 types)

### screenshot_match
Semantic visual comparison against a reference screenshot.

**When to use:** Verify that the overall screen appearance matches expectations. Uses AI vision for semantic comparison, not pixel-perfect matching.

**Syntax:**
```json
{
  "type": "screenshot_match",
  "reference_screenshot": "screenshots/login_flow/reference.png",
  "tolerance": 0.9
}
```

`tolerance` ranges from `0.0` (any match) to `1.0` (pixel-perfect); default `0.9`.

**Why AI-based comparison:** Tests are resilient to cosmetic changes (fonts, anti-aliasing, small positioning adjustments) while catching functional regressions (colors, layout, missing elements).

**Example scenario usage:**
```
Verify the login screen looks correct
Check that the dashboard appears as expected
```

---

### visual_state
Check the loading/data state of the screen or element.

**When to use:** Verify a screen or element is in a specific data state without needing a reference screenshot.

**Syntax:**
```json
{
  "type": "visual_state",
  "element_description": "Product list",
  "expected_visual_state": "loaded"
}
```

**Supported `expected_visual_state` values:**
- `loaded` — Content finished loading
- `loading` — Content still loading
- `empty` — Empty / no-data state
- `error` — Error state

**Example scenario usage:**
```
Verify the product list finished loading
Check that the feed shows the empty state
```

---

### element_fully_visible
Verify element is completely visible (not clipped).

**When to use:** Ensure element is not cut off by parent container or screen bounds.

**Syntax:**
```json
{
  "type": "element_fully_visible",
  "element_description": "Confirmation button"
}
```

**Example scenario usage:**
```
Verify the confirmation button is fully visible
Check that the footer is not clipped off screen
```

---

### color_style
Check text or element color.

**When to use:** Verify element color (text color, background color, border color).

**Syntax:**
```json
{
  "type": "color_style",
  "element_description": "Error text",
  "color_hex": "#FF0000"
}
```

`color_hex` is a 3- or 6-digit hex value (e.g., `#0057FF`).

**Example scenario usage:**
```
Verify the error text is red (#FF0000)
Check that the success message is green
```

---

## Navigation & Screen Assertions (5 types)

### screen_title
Verify screen/activity name.

**When to use:** Confirm navigation to the correct screen.

**Syntax:**
```json
{
  "type": "screen_title",
  "expected_text": "Login"
}
```

**Example scenario usage:**
```
Verify we're on the Login screen
Check that the checkout screen is displayed
```

---

### alert_present
Check if alert dialog is showing.

**When to use:** Verify an alert, dialog, or modal appeared.

**Syntax:**
```json
{
  "type": "alert_present"
}
```

**Example scenario usage:**
```
Verify an error alert appeared
Check that the confirmation dialog is shown
```

---

### alert_text
Verify alert message text.

**When to use:** Check the content of an alert, dialog, or confirmation message.

**Syntax:**
```json
{
  "type": "alert_text",
  "expected_text": "Are you sure?"
}
```

**Example scenario usage:**
```
Verify the alert says "Are you sure you want to delete?"
Check that the confirmation message is correct
```

---

### toast_visible
Check toast notification is visible.

**When to use:** Verify short-lived notification messages (Android toast, iOS notification).

**Syntax:**
```json
{
  "type": "toast_visible",
  "expected_text": "Saved"
}
```

**Example scenario usage:**
```
Verify the "Saved successfully" toast appeared
Check that the notification shows "Loading complete"
```

---

### keyboard_visible
Verify soft keyboard is open.

**When to use:** Check that the on-screen keyboard appeared (usually after tapping input field).

**Syntax:**
```json
{
  "type": "keyboard_visible",
  "expected_visible": true
}
```

`expected_visible` is a boolean: `true` = keyboard must be showing, `false` = keyboard must be dismissed.

**Example scenario usage:**
```
Verify the keyboard appeared when tapping the email field
Check that the input keyboard is visible
```

---

## Accessibility Assertion (1 type)

### has_accessibility_label
Check accessibility label on element.

**When to use:** Verify that interactive elements have proper accessibility labels for screen readers.

**Syntax:**
```json
{
  "type": "has_accessibility_label",
  "element_description": "Close button",
  "label_value": "Close dialog"
}
```

**Example scenario usage:**
```
Verify the close button has accessibility label "Close dialog"
Check that the icon has proper accessibility description
```

---

## Data & Variables Assertion (1 type)

### value_matches_variable
Compare captured value to variable.

**When to use:** Verify that a dynamic value matches a previously captured variable.

**Syntax:**
```json
{
  "type": "value_matches_variable",
  "element_description": "Email field",
  "variable_name": "captured_email"
}
```

**How it works:**
1. In an earlier step, use `capture_value` to extract a value into `captured_email`
2. Later, use this assertion to verify current value matches that captured value
3. Useful for round-trip testing: capture initial value → navigate → verify same value

**Example scenario usage:**
```
Verify the email address matches what we captured earlier
Check that the order ID is the same as when we created it
```

---

## Platform-Specific Assertions (2 types)

### permission_dialog_shown
Check permission prompt (iOS/Android).

**When to use:** Verify system permission dialog appeared (camera, location, contacts, etc.).

**Syntax:**
```json
{
  "type": "permission_dialog_shown",
  "permission_name": "camera"
}
```

**Example scenario usage:**
```
Verify the camera permission dialog appeared
Check that the location services prompt is shown
```

---

### dark_mode_active
Check if dark mode is enabled.

**When to use:** Verify device or app dark mode is active.

**Syntax:**
```json
{
  "type": "dark_mode_active",
  "expected_theme": "dark"
}
```

`expected_theme` is `dark` or `light`.

**Example scenario usage:**
```
Verify dark mode is enabled on the device
Check that the app switched to dark theme
```

---

## Using Assertions in Test Scenarios

### In JSON Format

Assertions live in the scenario's top-level `assertions` array. Each one names the step it runs after via `after_step`:

```json
{
  "$schema_version": "2.1",
  "scenario_id": "assertion_examples",
  "name": "Assertion Examples",
  "description": "Demonstrates how assertions reference a step and check the resulting UI state",
  "platform": "android",
  "app_package": "com.example.app",
  "metadata": {
    "app_version": "1.0.0",
    "environment": "staging"
  },
  "steps": [
    {
      "id": "tap_login",
      "action": "tap",
      "description": "Tap the login button",
      "target": "Login button"
    },
    {
      "id": "wait_for_home",
      "action": "wait_for_element",
      "description": "Wait for the home screen to load",
      "target": "Welcome message",
      "wait_config": { "type": "element_visible", "timeout_ms": 5000 }
    }
  ],
  "assertions": [
    {
      "id": "welcome_check",
      "after_step": "wait_for_home",
      "type": "element_text",
      "description": "Welcome message greets the user by name",
      "element_description": "Welcome message",
      "expected_value": "Welcome, John"
    },
    {
      "id": "logout_enabled_check",
      "after_step": "wait_for_home",
      "type": "element_state",
      "description": "Logout button is enabled",
      "element_description": "Logout button",
      "state_property": "enabled"
    }
  ]
}
```

### In Natural Language to Generator

When using the generate workflow (`/mobile-automator-generate` or `mauto guide generate`), describe assertions in natural language:

```
After tapping login:
  - Verify the welcome message says "Welcome, John"
  - Check that the logout button is enabled
  - Verify the success screen is fully visible
```

The generator automatically converts these to appropriate assertion types.

### Best Practices

1. **Name assertions clearly** — Use snake_case IDs that describe what's being verified
2. **Use specific assertion types** — `element_text` for exact match, `text_contains` for substring
3. **Include one assertion per concept** — Multiple assertions per step is allowed but can make failures harder to debug
4. **Screenshot on key checkpoints** — Combine `screenshot_match` with other assertions at important milestones
5. **Consider dynamic content** — Use `pattern_match` for codes/IDs, `text_contains` for content that varies

---

## Assertion Failure Examples

### Failed: element_exists
```
Element 'login_button' not found on screen
```
**Troubleshoot:** Button may be off-screen, hidden, or described differently

### Failed: element_text
```
Expected: "Welcome, John Doe"
Actual: "Welcome, John D."
Text does not match exactly
```
**Troubleshoot:** Use `text_contains` if full text varies, or check for truncation

### Failed: text_contains
```
Expected substring 'Success' not found in element
Text was: "Operation failed: Connection timeout"
```
**Troubleshoot:** Operation may have failed, check previous steps

### Failed: screenshot_match
```
Semantic visual difference detected
Expected: Login screen with email input, password input, and login button
Actual: Login screen with email input only (password input missing)
```
**Troubleshoot:** Visual layout changed, may indicate a bug

---

## Related References

- [Test Scenario Schema](schema.md) — How to define assertions in JSON
- [MCP Tools Reference](mcp-tools.md) — Device automation primitives
- [Test Result Schema](result-schema.md) — How assertion results are stored

[← Back to Reference Index](index.md)
