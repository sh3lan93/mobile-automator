# Assertion Types Reference

mobile-automator supports 27 assertion types organized in 8 categories for comprehensive test verification.

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
  "element": "login_button"
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
  "element": "loading_spinner"
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
  "element": "success_message"
}
```

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
  "element": "submit_button",
  "state": "enabled"
}
```

**Supported states:**
- `enabled` — Element is interactive
- `disabled` — Element is not interactive
- `focused` — Element has focus (cursor in text field)
- `selected` — Element is selected (checkbox, radio button)
- `checked` — Same as selected for checkboxes

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
  "element": "welcome_label",
  "expected_exact": "Welcome, John"
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
  "element": "message",
  "expected_contains": "Success"
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
  "element": "username_field"
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
  "element": "email_field",
  "expected_exact": "Enter email address"
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
  "element": "error_code",
  "expected_pattern": "^ERR_[0-9]{3}$"
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
  "element": "counter"
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
  "element": "profile_icon",
  "expected_exact": "User profile picture"
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
Count specific elements matching a selector.

**When to use:** Verify number of matching elements on screen (buttons, list items, tabs).

**Syntax:**
```json
{
  "type": "element_count",
  "element": "list_item",
  "expected_exact": 5
}
```

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
  "element": "messages_list",
  "expected_exact": 3
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
  "element": "search_results"
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
  "expected_image": "reference.png"
}
```

**Why AI-based comparison:** Tests are resilient to cosmetic changes (fonts, anti-aliasing, small positioning adjustments) while catching functional regressions (colors, layout, missing elements).

**Example scenario usage:**
```
Verify the login screen looks correct
Check that the dashboard appears as expected
```

---

### visual_state
Check visual appearance of element.

**When to use:** Verify element styling without needing a reference screenshot (highlighted, faded, etc.).

**Syntax:**
```json
{
  "type": "visual_state",
  "element": "card",
  "state": "highlighted"
}
```

**Common states:**
- `highlighted` — Element has emphasis/highlight styling
- `faded` — Element appears disabled or dimmed
- `focused` — Element has focus indication
- `active` — Element is in active state

**Example scenario usage:**
```
Verify the selected tab is highlighted
Check that the disabled button appears faded
```

---

### element_fully_visible
Verify element is completely visible (not clipped).

**When to use:** Ensure element is not cut off by parent container or screen bounds.

**Syntax:**
```json
{
  "type": "element_fully_visible",
  "element": "button"
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
  "element": "error_text",
  "expected_color": "#FF0000"
}
```

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
  "expected_exact": "Login"
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
  "expected_exact": "Are you sure?"
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
  "expected_contains": "Saved"
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
  "type": "keyboard_visible"
}
```

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
  "element": "close_button",
  "expected_exact": "Close dialog"
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
  "expected_variable": "captured_email",
  "element": "email_field"
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
  "expected_permission": "Camera"
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
  "type": "dark_mode_active"
}
```

**Example scenario usage:**
```
Verify dark mode is enabled on the device
Check that the app switched to dark theme
```

---

## Using Assertions in Test Scenarios

### In JSON Format

Add assertions as named steps in your test scenario:

```json
{
  "schema_version": "2.0",
  "id": "test_001",
  "steps": {
    "tap_login": { "type": "tap", "element": "login_button" },
    "verify_welcome": {
      "type": "element_text",
      "element": "welcome_message",
      "expected_exact": "Welcome, John"
    },
    "verify_enabled": {
      "type": "element_state",
      "element": "logout_button",
      "state": "enabled"
    }
  },
  "assertions": [
    { "id": "welcome_check", "step": "verify_welcome" },
    { "id": "button_check", "step": "verify_enabled" }
  ]
}
```

### In Natural Language to Generator

When using `/mobile-automator:generate`, describe assertions in natural language:

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
**Troubleshoot:** Button may be off-screen, hidden, or using different ID

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

- [Test Scenario Schema v2](schema-v2.md) — How to define assertions in JSON
- [MCP Tools Reference](mcp-tools.md) — Device automation primitives
- [Test Result Schema](result-schema.md) — How assertion results are stored

[← Back to Reference Index](index.md)
