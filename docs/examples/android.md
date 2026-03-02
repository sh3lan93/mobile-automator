# Android Examples

Complete test scenario examples for Android applications. Each example demonstrates key patterns and best practices.

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
  "$schema_version": "2.0",
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
  "testrail": {
    "case_id": 1001,
    "project_id": 1,
    "case_url": "https://testrail.example.com/index.php?/cases/view/1001"
  },
  "variables": {
    "user_email": {
      "type": "string",
      "value": "testuser@example.com"
    },
    "user_password": {
      "type": "string",
      "value": "SecurePassword123!"
    },
    "dashboard_title": {
      "type": "string"
    }
  },
  "preconditions": {
    "setup_actions": [
      {
        "type": "clear_app_data",
        "description": "Clear app cache to ensure fresh login state"
      }
    ],
    "device_state": "Clean login screen required"
  },
  "steps": {
    "launch_app": {
      "type": "launch_app",
      "description": "Launch the app to login screen"
    },
    "verify_login_screen": {
      "type": "wait_for_element",
      "element": "email_input",
      "timeout_seconds": 5,
      "description": "Wait for login screen to appear"
    },
    "tap_email_field": {
      "type": "tap",
      "element": "email_input",
      "description": "Tap on email input field"
    },
    "enter_email": {
      "type": "type",
      "element": "email_input",
      "text": "testuser@example.com",
      "clear_before": true,
      "description": "Enter test user email address"
    },
    "tap_password_field": {
      "type": "tap",
      "element": "password_input",
      "description": "Tap on password input field"
    },
    "enter_password": {
      "type": "type",
      "element": "password_input",
      "text": "SecurePassword123!",
      "clear_before": true,
      "description": "Enter user password"
    },
    "tap_login_button": {
      "type": "tap",
      "element": "login_button",
      "description": "Tap login button to submit form"
    },
    "wait_for_loading": {
      "type": "wait_for_loading_complete",
      "timeout_seconds": 10,
      "description": "Wait for loading animation to complete"
    },
    "verify_dashboard_reached": {
      "type": "wait_for_element",
      "element": "dashboard_title",
      "timeout_seconds": 5,
      "description": "Verify dashboard screen is displayed"
    }
  },
  "assertions": [
    {
      "id": "email_field_visible",
      "description": "Email input field is visible on login screen",
      "type": "element_exists",
      "element": "email_input"
    },
    {
      "id": "password_field_visible",
      "description": "Password input field is visible on login screen",
      "type": "element_exists",
      "element": "password_input"
    },
    {
      "id": "login_button_clickable",
      "description": "Login button is visible and accessible",
      "type": "element_visible",
      "element": "login_button"
    },
    {
      "id": "dashboard_screen_reached",
      "description": "Dashboard screen is displayed after login",
      "type": "screen_title",
      "expected_text": "Dashboard"
    },
    {
      "id": "no_error_message",
      "description": "No error message displayed during login",
      "type": "element_not_exists",
      "element": "error_message_view"
    }
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
- Use variables to parameterize credentials

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
  "$schema_version": "2.0",
  "scenario_id": "android_list_scrolling",
  "name": "Navigate List and Select Item",
  "description": "User scrolls through a product list and selects an item to view details",
  "platform": "android",
  "app_package": "com.example.shop",
  "metadata": {
    "app_version": "2.1.0",
    "environment": "staging"
  },
  "tags": ["navigation", "list", "scrolling"],
  "variables": {
    "selected_product": {
      "type": "string",
      "value": "Premium Widget"
    },
    "product_price": {
      "type": "string"
    }
  },
  "preconditions": {
    "setup_actions": [
      {
        "type": "launch_app"
      }
    ],
    "device_state": "Logged in and on products list screen"
  },
  "steps": {
    "launch_app": {
      "type": "launch_app",
      "description": "Launch shopping app"
    },
    "wait_for_product_list": {
      "type": "wait_for_element",
      "element": "products_recycler_view",
      "timeout_seconds": 5,
      "description": "Wait for products list to load"
    },
    "verify_list_not_empty": {
      "type": "list_is_empty",
      "element": "products_recycler_view",
      "expected": false,
      "description": "Verify list contains items"
    },
    "scroll_to_premium_widget": {
      "type": "scroll_to_element",
      "element": "products_recycler_view",
      "target_element": "product_item_premium_widget",
      "timeout_seconds": 10,
      "description": "Scroll down to find Premium Widget product"
    },
    "verify_item_visible": {
      "type": "element_visible",
      "element": "product_item_premium_widget",
      "description": "Verify Premium Widget is visible on screen"
    },
    "tap_product_item": {
      "type": "tap",
      "element": "product_item_premium_widget",
      "description": "Tap on Premium Widget item"
    },
    "wait_for_detail_screen": {
      "type": "wait_for_element",
      "element": "product_detail_title",
      "timeout_seconds": 5,
      "description": "Wait for product detail screen to load"
    }
  },
  "assertions": [
    {
      "id": "list_displayed",
      "description": "Products list is displayed",
      "type": "element_exists",
      "element": "products_recycler_view"
    },
    {
      "id": "list_has_items",
      "description": "Products list contains items",
      "type": "list_is_empty",
      "element": "products_recycler_view",
      "expected": false
    },
    {
      "id": "product_item_found",
      "description": "Premium Widget product item is found",
      "type": "element_exists",
      "element": "product_item_premium_widget"
    },
    {
      "id": "detail_screen_loaded",
      "description": "Product detail screen displays correct product",
      "type": "element_text",
      "element": "product_detail_title",
      "expected_text": "Premium Widget"
    },
    {
      "id": "price_displayed",
      "description": "Product price is displayed on detail screen",
      "type": "element_exists",
      "element": "product_detail_price"
    }
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
  "$schema_version": "2.0",
  "scenario_id": "android_camera_permission_request",
  "name": "Request Camera Permission",
  "description": "User grants camera permission to enable photo capture feature",
  "platform": "android",
  "app_package": "com.example.photoapp",
  "metadata": {
    "app_version": "3.0.0",
    "environment": "staging"
  },
  "tags": ["permissions", "camera", "system-dialog"],
  "preconditions": {
    "setup_actions": [
      {
        "type": "clear_app_data",
        "description": "Clear app to reset permission state"
      }
    ],
    "device_state": "Camera permission not yet granted"
  },
  "steps": {
    "launch_app": {
      "type": "launch_app",
      "description": "Launch photo app"
    },
    "wait_for_home_screen": {
      "type": "wait_for_element",
      "element": "home_screen_title",
      "timeout_seconds": 5,
      "description": "Wait for home screen to load"
    },
    "tap_camera_button": {
      "type": "tap",
      "element": "camera_button",
      "description": "Tap camera button to trigger permission request"
    },
    "wait_for_permission_dialog": {
      "type": "wait_for_element",
      "element": "permission_dialog_title",
      "timeout_seconds": 3,
      "description": "Wait for Android permission dialog to appear"
    },
    "verify_dialog_message": {
      "type": "wait_for_element",
      "element": "permission_message_text",
      "timeout_seconds": 2,
      "description": "Verify permission request message is displayed"
    },
    "tap_allow_button": {
      "type": "tap",
      "element": "permission_allow_button",
      "description": "Tap Allow button in permission dialog"
    },
    "wait_for_camera_feature": {
      "type": "wait_for_element",
      "element": "camera_preview",
      "timeout_seconds": 5,
      "description": "Wait for camera preview to load after permission granted"
    }
  },
  "assertions": [
    {
      "id": "permission_dialog_shown",
      "description": "Android camera permission dialog is displayed",
      "type": "permission_dialog_shown",
      "permission_type": "android.permission.CAMERA"
    },
    {
      "id": "dialog_title_correct",
      "description": "Permission dialog shows correct title",
      "type": "element_text",
      "element": "permission_dialog_title",
      "expected_text": "Allow photo app to access your camera?"
    },
    {
      "id": "allow_button_visible",
      "description": "Allow button is visible in permission dialog",
      "type": "element_visible",
      "element": "permission_allow_button"
    },
    {
      "id": "camera_available_after_grant",
      "description": "Camera preview is available after permission granted",
      "type": "element_exists",
      "element": "camera_preview"
    },
    {
      "id": "no_error_shown",
      "description": "No error message displayed after granting permission",
      "type": "element_not_exists",
      "element": "error_toast"
    }
  ]
}
```

### What This Tests

- Permission dialog triggering
- Permission dialog content verification
- User action on permission dialog
- Feature availability after permission grant
- Error handling during permission flow

### Adaptation Tips

- Change permission type (CAMERA, LOCATION, CONTACTS, etc.)
- Adjust timeout based on device and network
- Add deny button testing for rejection flow
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
  "$schema_version": "2.0",
  "scenario_id": "android_toast_verification",
  "name": "Verify Toast Notifications",
  "description": "User performs action that triggers success toast message",
  "platform": "android",
  "app_package": "com.example.notes",
  "metadata": {
    "app_version": "1.5.0",
    "environment": "staging"
  },
  "tags": ["notifications", "toast", "feedback"],
  "variables": {
    "note_title": {
      "type": "string",
      "value": "Test Note"
    }
  },
  "preconditions": {
    "setup_actions": [
      {
        "type": "launch_app"
      }
    ],
    "device_state": "Logged in on notes list screen"
  },
  "steps": {
    "launch_app": {
      "type": "launch_app",
      "description": "Launch notes application"
    },
    "wait_for_notes_list": {
      "type": "wait_for_element",
      "element": "notes_list",
      "timeout_seconds": 5,
      "description": "Wait for notes list to display"
    },
    "tap_create_note_button": {
      "type": "tap",
      "element": "create_note_button",
      "description": "Tap create new note button"
    },
    "wait_for_note_form": {
      "type": "wait_for_element",
      "element": "note_title_input",
      "timeout_seconds": 3,
      "description": "Wait for note creation form"
    },
    "enter_note_title": {
      "type": "type",
      "element": "note_title_input",
      "text": "Test Note",
      "clear_before": true,
      "description": "Enter note title"
    },
    "tap_note_content": {
      "type": "tap",
      "element": "note_content_input",
      "description": "Tap on note content field"
    },
    "enter_note_content": {
      "type": "type",
      "element": "note_content_input",
      "text": "This is a test note created during automated testing.",
      "clear_before": true,
      "description": "Enter note content"
    },
    "tap_save_button": {
      "type": "tap",
      "element": "save_note_button",
      "description": "Tap save button"
    },
    "wait_for_toast": {
      "type": "toast_visible",
      "message": "Note saved successfully",
      "timeout_seconds": 3,
      "description": "Wait for success toast to appear"
    }
  },
  "assertions": [
    {
      "id": "create_button_visible",
      "description": "Create note button is visible",
      "type": "element_visible",
      "element": "create_note_button"
    },
    {
      "id": "form_displayed",
      "description": "Note creation form is displayed",
      "type": "element_exists",
      "element": "note_title_input"
    },
    {
      "id": "title_entered",
      "description": "Note title is entered correctly",
      "type": "element_text",
      "element": "note_title_input",
      "expected_text": "Test Note"
    },
    {
      "id": "content_entered",
      "description": "Note content is entered correctly",
      "type": "text_contains",
      "element": "note_content_input",
      "expected_substring": "test note created"
    },
    {
      "id": "success_toast_shown",
      "description": "Success toast message is displayed",
      "type": "toast_visible",
      "message": "Note saved successfully"
    },
    {
      "id": "back_to_list",
      "description": "User returns to notes list after save",
      "type": "element_exists",
      "element": "notes_list"
    }
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
  "$schema_version": "2.0",
  "scenario_id": "android_error_handling",
  "name": "Handle Login Validation Error",
  "description": "User enters invalid email and sees validation error message",
  "platform": "android",
  "app_package": "com.example.app",
  "metadata": {
    "app_version": "1.2.3",
    "environment": "staging"
  },
  "tags": ["validation", "error-handling", "forms"],
  "preconditions": {
    "setup_actions": [
      {
        "type": "clear_app_data",
        "description": "Clear app data for clean state"
      }
    ],
    "device_state": "On login screen"
  },
  "steps": {
    "launch_app": {
      "type": "launch_app",
      "description": "Launch application"
    },
    "wait_for_login_screen": {
      "type": "wait_for_element",
      "element": "email_input",
      "timeout_seconds": 5,
      "description": "Wait for login screen to load"
    },
    "tap_email_field": {
      "type": "tap",
      "element": "email_input",
      "description": "Tap email input field"
    },
    "enter_invalid_email": {
      "type": "type",
      "element": "email_input",
      "text": "invalid.email",
      "clear_before": true,
      "description": "Enter invalid email format"
    },
    "tap_password_field": {
      "type": "tap",
      "element": "password_input",
      "description": "Tap password field to trigger validation"
    },
    "wait_for_error_message": {
      "type": "wait_for_element",
      "element": "email_error_message",
      "timeout_seconds": 2,
      "description": "Wait for email validation error to appear"
    },
    "verify_error_displayed": {
      "type": "element_visible",
      "element": "email_error_message",
      "description": "Verify error message is visible"
    },
    "verify_login_button_disabled": {
      "type": "element_state",
      "element": "login_button",
      "expected_state": "disabled",
      "description": "Verify login button is disabled due to validation error"
    }
  },
  "assertions": [
    {
      "id": "login_screen_ready",
      "description": "Login screen is displayed",
      "type": "element_exists",
      "element": "email_input"
    },
    {
      "id": "invalid_email_entered",
      "description": "Invalid email is entered in field",
      "type": "element_text",
      "element": "email_input",
      "expected_text": "invalid.email"
    },
    {
      "id": "error_message_displayed",
      "description": "Email validation error message is shown",
      "type": "element_exists",
      "element": "email_error_message"
    },
    {
      "id": "error_text_correct",
      "description": "Error message contains correct validation text",
      "type": "element_text",
      "element": "email_error_message",
      "expected_text": "Please enter a valid email address"
    },
    {
      "id": "login_button_disabled",
      "description": "Login button is disabled when validation fails",
      "type": "element_state",
      "element": "login_button",
      "expected_state": "disabled"
    },
    {
      "id": "error_icon_visible",
      "description": "Error icon is shown next to email field",
      "type": "element_exists",
      "element": "email_error_icon"
    }
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
- [Schema v2 Reference](../reference/schema-v2.md) — Full schema documentation
- [Generate Tests](../guides/generate.md) — Create similar tests for your app
- [Execute Tests](../guides/execute.md) — Run generated tests

[Back to Examples →](index.md)
