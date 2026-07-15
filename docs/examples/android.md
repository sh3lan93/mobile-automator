---
description: "Android test scenario examples - login flow, RecyclerView scrolling, permission dialogs, toast notifications, and error handling patterns."
---

# Android Examples

Complete test scenario examples for Android applications. Each example demonstrates key patterns and best practices.

All scenarios below use scenario schema **2.1** (the current version — additive over 2.0, adding the `mode` metadata field and the four platform-agnostic semantic actions). Existing 2.0 scenarios remain valid. Every example on this page validates with `mauto validate <file>`.

## Table of Contents

1. [Login Flow](#login-flow) — Email validation, loading states, error handling
2. [List Navigation & Scrolling](#list-navigation-scrolling) — RecyclerView handling, scrolling to element
3. [Permission Requests](#permission-requests) — Android permission dialog handling
4. [Toast Notifications](#toast-notifications) — Confirming toast messages
5. [Error Handling](#error-handling) — Network errors and validation errors

---

## Login Flow

A realistic login scenario demonstrating email validation, password entry, loading states, and dashboard access.

**Key Features:**

- Email field interaction and validation
- Password entry
- Loading indicator handling
- Screen transition verification
- Error state handling

### Scenario JSON

```json
{
  "$schema_version": "2.1",
  "scenario_id": "android_login_happy_path",
  "name": "Login with Valid Credentials",
  "description": "User successfully logs in with valid email and password, completes loading, and accesses dashboard",
  "platform": "android",
  "app_package": "com.example.app",
  "metadata": {
    "app_version": "1.2.3",
    "environment": "staging"
  },
  "tags": ["authentication", "login", "happy-path"],
  "variables": {
    "dashboard_title": {
      "type": "string",
      "description": "Title text captured from the dashboard screen after login"
    }
  },
  "preconditions": {
    "app_state": "logged_out",
    "device_actions": [
      {
        "action": "clear_app_data",
        "target_package": "com.example.app",
        "description": "Clear app cache to ensure a fresh login state"
      }
    ],
    "notes": ["A clean login screen is required before the scenario starts"]
  },
  "steps": [
    { "id": "launch_app", "action": "launch_app", "description": "Launch the app to the login screen", "target": "com.example.app" },
    { "id": "verify_login_screen", "action": "wait_for_element", "description": "Wait for the login screen to appear", "target": "email input field", "wait_config": { "type": "element_visible", "timeout_ms": 5000 } },
    { "id": "tap_email_field", "action": "tap", "description": "Tap on the email input field", "target": "email input field" },
    { "id": "enter_email", "action": "type", "description": "Enter the test user email address", "target": "email input field", "value": "testuser@example.com" },
    { "id": "tap_password_field", "action": "tap", "description": "Tap on the password input field", "target": "password input field" },
    { "id": "enter_password", "action": "type", "description": "Enter the user password", "target": "password input field", "value": "SecurePassword123!" },
    { "id": "tap_login_button", "action": "tap", "description": "Tap the login button to submit the form", "target": "login button" },
    { "id": "wait_for_loading", "action": "wait_for_loading_complete", "description": "Wait for the loading animation to complete", "wait_config": { "type": "loading_complete", "indicator": "spinner", "timeout_ms": 10000 } },
    { "id": "verify_dashboard_reached", "action": "wait_for_element", "description": "Verify the dashboard screen is displayed", "target": "dashboard screen title", "wait_config": { "type": "element_visible", "timeout_ms": 5000 } }
  ],
  "assertions": [
    { "id": "email_field_visible", "after_step": "verify_login_screen", "type": "element_exists", "description": "Email input field is visible on the login screen", "element_description": "email input field" },
    { "id": "password_field_visible", "after_step": "verify_login_screen", "type": "element_exists", "description": "Password input field is visible on the login screen", "element_description": "password input field" },
    { "id": "login_button_clickable", "after_step": "verify_login_screen", "type": "element_visible", "description": "Login button is visible and accessible", "element_description": "login button", "expected_visible": true },
    { "id": "dashboard_screen_reached", "after_step": "verify_dashboard_reached", "type": "screen_title", "description": "Dashboard screen is displayed after login", "expected_text": "Dashboard" },
    { "id": "no_error_message", "after_step": "verify_dashboard_reached", "type": "element_not_exists", "description": "No error message displayed during login", "element_description": "error message banner" }
  ]
}
```

### What This Tests

- User authentication flow
- Email input validation
- Password entry security
- Loading state handling
- Navigation to protected content
- Error message absence during happy path

### Adaptation Tips

- Change email/password credentials for different test accounts
- Modify timeout values based on network speed
- Add additional assertions for custom dashboard elements
- Capture dynamic values (like the dashboard title) into declared `variables`

---

## List Navigation & Scrolling

Demonstrates handling of RecyclerView/ListViews, scrolling to elements, and selecting items from lists.

**Key Features:**

- List item scrolling and visibility
- Item selection and tap handling
- List scrolling to specific element
- Item count verification
- List state validation

### Scenario JSON

```json
{
  "$schema_version": "2.1",
  "scenario_id": "android_list_scrolling",
  "name": "Navigate List and Select Item",
  "description": "User scrolls through a product list and selects an item to view details",
  "platform": "android",
  "app_package": "com.example.shop",
  "metadata": { "app_version": "2.1.0", "environment": "staging" },
  "tags": ["navigation", "list", "scrolling"],
  "variables": {
    "product_price": { "type": "string", "description": "Price text captured from the product detail screen" }
  },
  "preconditions": {
    "app_state": "logged_in",
    "notes": ["User is logged in and on the products list screen"]
  },
  "steps": [
    { "id": "launch_app", "action": "launch_app", "description": "Launch the shopping app", "target": "com.example.shop" },
    { "id": "wait_for_product_list", "action": "wait_for_element", "description": "Wait for the products list to load", "target": "products list", "wait_config": { "type": "element_visible", "timeout_ms": 5000 } },
    { "id": "scroll_to_premium_widget", "action": "scroll_to_element", "description": "Scroll down to find the Premium Widget product", "target": "Premium Widget product row", "value": "down" },
    { "id": "tap_product_item", "action": "tap", "description": "Tap on the Premium Widget item", "target": "Premium Widget product row" },
    { "id": "wait_for_detail_screen", "action": "wait_for_element", "description": "Wait for the product detail screen to load", "target": "product detail title", "wait_config": { "type": "element_visible", "timeout_ms": 5000 } },
    { "id": "capture_price", "action": "capture_value", "description": "Capture the product price from the detail screen", "target": "product detail price", "capture_to": "product_price" }
  ],
  "assertions": [
    { "id": "list_displayed", "after_step": "wait_for_product_list", "type": "element_exists", "description": "Products list is displayed", "element_description": "products list" },
    { "id": "list_has_items", "after_step": "wait_for_product_list", "type": "list_item_count", "description": "Products list contains at least one item", "element_description": "products list", "operator": ">", "expected_count": 0 },
    { "id": "product_item_found", "after_step": "scroll_to_premium_widget", "type": "element_exists", "description": "Premium Widget product item is found", "element_description": "Premium Widget product row" },
    { "id": "detail_screen_loaded", "after_step": "wait_for_detail_screen", "type": "element_text", "description": "Product detail screen displays the correct product", "element_description": "product detail title", "expected_value": "Premium Widget" },
    { "id": "price_displayed", "after_step": "capture_price", "type": "element_exists", "description": "Product price is displayed on the detail screen", "element_description": "product detail price" }
  ]
}
```

### What This Tests

- List rendering and population
- Scrolling functionality in RecyclerView
- Item visibility during scroll
- Item selection and navigation
- Detail screen loading
- Product information display

### Adaptation Tips

- Change target element to any product in your list
- Adjust scroll timeout for large lists
- Add item count assertions for specific list sizes
- Include price or rating capture for dynamic validation

---

## Permission Requests

Demonstrates handling Android runtime permission dialogs and permission-dependent features.

**Key Features:**

- Permission dialog detection
- Permission grant/deny handling
- Feature availability after permission grant
- Permission state checking

### Scenario JSON

```json
{
  "$schema_version": "2.1",
  "scenario_id": "android_camera_permission_request",
  "name": "Request Camera Permission",
  "description": "User grants camera permission to enable the photo capture feature",
  "platform": "android",
  "app_package": "com.example.photoapp",
  "metadata": { "app_version": "3.0.0", "environment": "staging" },
  "tags": ["permissions", "camera", "system-dialog"],
  "preconditions": {
    "app_state": "fresh_install",
    "device_actions": [
      { "action": "clear_app_data", "target_package": "com.example.photoapp", "description": "Clear app data to reset the permission state" }
    ],
    "notes": ["Camera permission has not yet been granted"]
  },
  "steps": [
    { "id": "launch_app", "action": "launch_app", "description": "Launch the photo app", "target": "com.example.photoapp" },
    { "id": "wait_for_home_screen", "action": "wait_for_element", "description": "Wait for the home screen to load", "target": "home screen title", "wait_config": { "type": "element_visible", "timeout_ms": 5000 } },
    { "id": "tap_camera_button", "action": "tap", "description": "Tap the camera button to trigger the permission request", "target": "camera button" },
    { "id": "wait_for_permission_dialog", "action": "wait_for_element", "description": "Wait for the system permission dialog to appear", "target": "camera permission dialog", "wait_config": { "type": "element_visible", "timeout_ms": 3000 } },
    { "id": "grant_camera_permission", "action": "grant_permission", "description": "Grant the camera permission on the system dialog", "permission_name": "camera" },
    { "id": "wait_for_camera_feature", "action": "wait_for_element", "description": "Wait for the camera preview to load after the permission is granted", "target": "camera preview", "wait_config": { "type": "element_visible", "timeout_ms": 5000 } }
  ],
  "assertions": [
    { "id": "permission_dialog_shown", "after_step": "wait_for_permission_dialog", "type": "permission_dialog_shown", "description": "System camera permission dialog is displayed", "permission_name": "camera" },
    { "id": "allow_button_visible", "after_step": "wait_for_permission_dialog", "type": "element_visible", "description": "Allow button is visible in the permission dialog", "element_description": "Allow button", "expected_visible": true },
    { "id": "camera_available_after_grant", "after_step": "wait_for_camera_feature", "type": "element_exists", "description": "Camera preview is available after the permission is granted", "element_description": "camera preview" },
    { "id": "no_error_shown", "after_step": "wait_for_camera_feature", "type": "element_not_exists", "description": "No error toast displayed after granting permission", "element_description": "error toast" }
  ]
}
```

> **Semantic action:** This scenario uses the `grant_permission` action, one of the four platform-agnostic semantic actions (`press_back`, `dismiss_keyboard`, `grant_permission`, `deny_permission`). In a `platform-agnostic` scenario these resolve to the correct per-platform mechanics at replay time — the same step works on Android and iOS. Swap it for `deny_permission` to exercise the rejection flow.

### What This Tests

- Permission dialog triggering
- Permission dialog content verification
- User action on permission dialog
- Feature availability after permission grant
- Error handling during permission flow

### Adaptation Tips

- Change the permission name (`camera`, `location`, `contacts`, etc.)
- Adjust timeout based on device and network
- Swap `grant_permission` for `deny_permission` to test the rejection flow
- Include feature-specific assertions

---

## Toast Notifications

Demonstrates verification of toast messages during user interactions.

**Key Features:**

- Toast message appearance detection
- Toast message text verification
- Toast display timing
- Multiple toast handling
- Toast dismissal

### Scenario JSON

```json
{
  "$schema_version": "2.1",
  "scenario_id": "android_toast_verification",
  "name": "Verify Toast Notifications",
  "description": "User performs an action that triggers a success toast message",
  "platform": "android",
  "app_package": "com.example.notes",
  "metadata": { "app_version": "1.5.0", "environment": "staging" },
  "tags": ["notifications", "toast", "feedback"],
  "variables": {
    "note_title": { "type": "string", "description": "Title used for the note created during the test", "value": "Test Note" }
  },
  "preconditions": {
    "app_state": "logged_in",
    "notes": ["User is logged in on the notes list screen"]
  },
  "steps": [
    { "id": "launch_app", "action": "launch_app", "description": "Launch the notes application", "target": "com.example.notes" },
    { "id": "wait_for_notes_list", "action": "wait_for_element", "description": "Wait for the notes list to display", "target": "notes list", "wait_config": { "type": "element_visible", "timeout_ms": 5000 } },
    { "id": "tap_create_note_button", "action": "tap", "description": "Tap the create new note button", "target": "create note button" },
    { "id": "wait_for_note_form", "action": "wait_for_element", "description": "Wait for the note creation form", "target": "note title input", "wait_config": { "type": "element_visible", "timeout_ms": 3000 } },
    { "id": "enter_note_title", "action": "type", "description": "Enter the note title", "target": "note title input", "value": "Test Note" },
    { "id": "tap_note_content", "action": "tap", "description": "Tap on the note content field", "target": "note content input" },
    { "id": "enter_note_content", "action": "type", "description": "Enter the note content", "target": "note content input", "value": "This is a test note created during automated testing." },
    { "id": "tap_save_button", "action": "tap", "description": "Tap the save button", "target": "save note button" },
    { "id": "wait_for_toast", "action": "wait_for_element", "description": "Wait for the success toast to appear", "target": "success toast", "wait_config": { "type": "element_visible", "timeout_ms": 3000 } }
  ],
  "assertions": [
    { "id": "create_button_visible", "after_step": "wait_for_notes_list", "type": "element_visible", "description": "Create note button is visible", "element_description": "create note button", "expected_visible": true },
    { "id": "form_displayed", "after_step": "wait_for_note_form", "type": "element_exists", "description": "Note creation form is displayed", "element_description": "note title input" },
    { "id": "title_entered", "after_step": "enter_note_title", "type": "element_text", "description": "Note title is entered correctly", "element_description": "note title input", "expected_value": "Test Note" },
    { "id": "content_entered", "after_step": "enter_note_content", "type": "text_contains", "description": "Note content includes the expected text", "element_description": "note content input", "expected_substring": "test note created" },
    { "id": "success_toast_shown", "after_step": "wait_for_toast", "type": "toast_visible", "description": "Success toast message is displayed", "expected_text": "Note saved successfully" },
    { "id": "back_to_list", "after_step": "wait_for_toast", "type": "element_exists", "description": "User returns to the notes list after save", "element_description": "notes list" }
  ]
}
```

### What This Tests

- Toast message appearance
- Toast message content verification
- Toast timing and duration
- Toast dismissal behavior
- Multiple toast handling
- User feedback for actions

### Adaptation Tips

- Change toast message to your app's specific messages
- Test both success and error toasts
- Verify toast appears at correct timing
- Add assertions for toast position and styling

---

## Error Handling

Demonstrates verification of error states, network errors, and validation error messages.

**Key Features:**

- Network error detection
- Validation error messages
- Error recovery actions
- Retry mechanisms
- Error state UI elements

### Scenario JSON

```json
{
  "$schema_version": "2.1",
  "scenario_id": "android_error_handling",
  "name": "Handle Login Validation Error",
  "description": "User enters an invalid email and sees a validation error message",
  "platform": "android",
  "app_package": "com.example.app",
  "metadata": { "app_version": "1.2.3", "environment": "staging" },
  "tags": ["validation", "error-handling", "forms"],
  "preconditions": {
    "app_state": "logged_out",
    "device_actions": [
      { "action": "clear_app_data", "target_package": "com.example.app", "description": "Clear app data for a clean state" }
    ],
    "notes": ["Start on the login screen"]
  },
  "steps": [
    { "id": "launch_app", "action": "launch_app", "description": "Launch the application", "target": "com.example.app" },
    { "id": "wait_for_login_screen", "action": "wait_for_element", "description": "Wait for the login screen to load", "target": "email input field", "wait_config": { "type": "element_visible", "timeout_ms": 5000 } },
    { "id": "tap_email_field", "action": "tap", "description": "Tap the email input field", "target": "email input field" },
    { "id": "enter_invalid_email", "action": "type", "description": "Enter an invalid email format", "target": "email input field", "value": "invalid.email" },
    { "id": "tap_password_field", "action": "tap", "description": "Tap the password field to trigger validation", "target": "password input field" },
    { "id": "wait_for_error_message", "action": "wait_for_element", "description": "Wait for the email validation error to appear", "target": "email error message", "wait_config": { "type": "element_visible", "timeout_ms": 2000 } }
  ],
  "assertions": [
    { "id": "login_screen_ready", "after_step": "wait_for_login_screen", "type": "element_exists", "description": "Login screen is displayed", "element_description": "email input field" },
    { "id": "invalid_email_entered", "after_step": "enter_invalid_email", "type": "element_text", "description": "Invalid email is entered in the field", "element_description": "email input field", "expected_value": "invalid.email" },
    { "id": "error_message_displayed", "after_step": "wait_for_error_message", "type": "element_exists", "description": "Email validation error message is shown", "element_description": "email error message" },
    { "id": "error_text_correct", "after_step": "wait_for_error_message", "type": "element_text", "description": "Error message contains the correct validation text", "element_description": "email error message", "expected_value": "Please enter a valid email address" },
    { "id": "login_button_disabled", "after_step": "wait_for_error_message", "type": "element_state", "description": "Login button is disabled when validation fails", "element_description": "login button", "state_property": "disabled" },
    { "id": "error_icon_visible", "after_step": "wait_for_error_message", "type": "element_exists", "description": "Error icon is shown next to the email field", "element_description": "email error icon" }
  ]
}
```

### What This Tests

- Input validation on blur/focus
- Error message display and content
- Error message visibility and styling
- Form state when validation fails
- Button state changes on validation error
- Error recovery (clearing field removes error)

### Adaptation Tips

- Test different validation scenarios (empty field, format, length)
- Verify error messages for specific field validations
- Check button disabled/enabled states
- Test network error scenarios with offline mode
- Include retry mechanisms for network errors

---

## Best Practices

When adapting these examples:

1. **Use realistic test data** — Replace placeholder values with actual test account credentials
2. **Set appropriate timeouts** — Consider network speed and device performance
3. **Handle loading states** — Always wait for loading indicators to complete
4. **Verify in layers** — Use multiple assertions to catch different issues
5. **Clean preconditions** — Ensure consistent starting state
6. **Use variables** — For dynamic content that changes between test runs
7. **Test error paths** — Include both happy path and error scenarios
8. **Document steps** — Use descriptive step names and descriptions

---

## Next Steps

- [iOS Examples](ios.md) — View iOS-specific examples
- [Schema Reference](../reference/schema.md) — Full schema documentation
- [Generate Tests](../guides/generate.md) — Create similar tests for your app
- [Execute Tests](../guides/execute.md) — Run generated tests

[Back to Examples →](index.md)
