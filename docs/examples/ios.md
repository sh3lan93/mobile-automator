---
description: "iOS test scenario examples - Face ID authentication, tab bar navigation, swipe-to-go-back gestures, alert handling, and background sync."
---

# iOS Examples

Complete test scenario examples for iOS applications. Each example demonstrates iOS-specific patterns and best practices.

All scenarios below use scenario schema **2.1** (the current version — additive over 2.0, adding the `mode` metadata field and the four platform-agnostic semantic actions). Existing 2.0 scenarios remain valid. Every example on this page validates with `mauto validate <file>`.

## Table of Contents

1. [Login with Biometric Fallback](#login-with-biometric-fallback) — Face ID with password fallback
2. [UITabBar Navigation](#uitabbar-navigation) — Tab switching and state management
3. [SwipeBack Dismissal](#swipeback-dismissal) — Gesture-based screen dismissal
4. [Alert Presentation](#alert-presentation) — UIAlertController handling
5. [Background Sync](#background-sync) — Background task and silent notification handling

---

## Login with Biometric Fallback

Demonstrates handling biometric authentication with Face ID and fallback to password entry.

**Key Features:**

- Biometric prompt detection and interaction
- Face ID/Touch ID authentication
- Password fallback mechanism
- Biometric failure handling
- Secure authentication flow

### Scenario JSON

```json
{
  "$schema_version": "2.1",
  "scenario_id": "ios_login_biometric_fallback",
  "name": "Login with Face ID and Password Fallback",
  "description": "User authenticates with Face ID and falls back to password entry if biometric fails",
  "platform": "ios",
  "app_package": "com.example.app",
  "metadata": { "app_version": "2.1.0", "environment": "staging" },
  "tags": ["authentication", "biometric", "face-id", "ios"],
  "variables": {
    "test_password": { "type": "string", "description": "Password used for the fallback authentication path", "value": "SecurePassword123!" }
  },
  "preconditions": {
    "app_state": "logged_out",
    "notes": ["Start on the login screen with a biometric identity enrolled"]
  },
  "steps": [
    { "id": "launch_app", "action": "launch_app", "description": "Launch the authentication-enabled app", "target": "com.example.app" },
    { "id": "wait_for_login_screen", "action": "wait_for_element", "description": "Wait for the login screen to display", "target": "login screen title", "wait_config": { "type": "element_visible", "timeout_ms": 5000 } },
    { "id": "tap_biometric_button", "action": "tap", "description": "Tap the Face ID authentication button", "target": "Face ID button" },
    { "id": "wait_for_biometric_prompt", "action": "wait_for_element", "description": "Wait for the system biometric prompt", "target": "system biometric prompt", "wait_config": { "type": "element_visible", "timeout_ms": 3000 } },
    { "id": "cancel_biometric", "action": "tap", "description": "Tap cancel on the biometric prompt to trigger the fallback", "target": "biometric prompt cancel button" },
    { "id": "wait_for_fallback", "action": "wait_for_element", "description": "Wait for the password input field to appear", "target": "password input field", "wait_config": { "type": "element_visible", "timeout_ms": 3000 } },
    { "id": "tap_password_field", "action": "tap", "description": "Tap the password input field", "target": "password input field" },
    { "id": "enter_password", "action": "type", "description": "Enter the password for fallback authentication", "target": "password input field", "value": "SecurePassword123!" },
    { "id": "tap_login_button", "action": "tap", "description": "Tap the login button", "target": "login button" },
    { "id": "wait_for_dashboard", "action": "wait_for_element", "description": "Wait for the dashboard to load after password login", "target": "dashboard title", "wait_config": { "type": "element_visible", "timeout_ms": 5000 } }
  ],
  "assertions": [
    { "id": "login_screen_loaded", "after_step": "wait_for_login_screen", "type": "element_exists", "description": "Login screen is displayed", "element_description": "login screen title" },
    { "id": "biometric_button_available", "after_step": "wait_for_login_screen", "type": "element_visible", "description": "Face ID button is available and visible", "element_description": "Face ID button", "expected_visible": true },
    { "id": "password_field_shown_after_cancel", "after_step": "wait_for_fallback", "type": "element_exists", "description": "Password input field appears after biometric cancel", "element_description": "password input field" },
    { "id": "password_entered", "after_step": "enter_password", "type": "element_text", "description": "Password is entered in the field", "element_description": "password input field", "expected_value": "SecurePassword123!" },
    { "id": "login_button_enabled", "after_step": "enter_password", "type": "element_state", "description": "Login button is enabled when the password is entered", "element_description": "login button", "state_property": "enabled" },
    { "id": "dashboard_accessible", "after_step": "wait_for_dashboard", "type": "screen_title", "description": "Dashboard is displayed after fallback login", "expected_text": "Dashboard" },
    { "id": "no_error_on_fallback", "after_step": "wait_for_dashboard", "type": "element_not_exists", "description": "No error message on successful fallback", "element_description": "error message banner" }
  ]
}
```

### What This Tests

- Biometric authentication button presence and functionality
- System biometric prompt handling
- Fallback to password when biometric cancelled
- Password entry and validation
- Dashboard access after fallback authentication
- Error handling and recovery

### Adaptation Tips

- Test successful biometric flow without fallback
- Vary biometric prompt responses (accept, deny, timeout)
- Include Touch ID as alternative to Face ID
- Add assertions for biometric failure scenarios
- Verify secure password entry (masked characters)

---

## UITabBar Navigation

Demonstrates tab bar navigation, tab switching, and state persistence across tabs.

**Key Features:**

- Tab bar element interaction
- Tab switching and content update
- Active tab indication
- State persistence between tabs
- Badge count handling

### Scenario JSON

```json
{
  "$schema_version": "2.1",
  "scenario_id": "ios_tabbar_navigation",
  "name": "Navigate Between Tabs and Verify State",
  "description": "User switches between tab bar tabs and verifies the correct content loads for each tab",
  "platform": "ios",
  "app_package": "com.example.shop",
  "metadata": { "app_version": "1.8.0", "environment": "staging" },
  "tags": ["navigation", "tabbar", "ios", "ui"],
  "variables": {
    "cart_item_count": { "type": "string", "description": "Item count captured from the cart tab badge" }
  },
  "preconditions": {
    "app_state": "logged_in",
    "notes": ["User is logged in on the home tab"]
  },
  "steps": [
    { "id": "launch_app", "action": "launch_app", "description": "Launch the shopping application", "target": "com.example.shop" },
    { "id": "wait_for_home_tab", "action": "wait_for_element", "description": "Wait for the home tab content to load", "target": "home tab content", "wait_config": { "type": "element_visible", "timeout_ms": 5000 } },
    { "id": "tap_search_tab", "action": "tap", "description": "Tap on the search tab", "target": "search tab" },
    { "id": "wait_for_search_content", "action": "wait_for_element", "description": "Wait for the search tab content to load", "target": "search bar", "wait_config": { "type": "element_visible", "timeout_ms": 3000 } },
    { "id": "tap_cart_tab", "action": "tap", "description": "Tap on the cart tab", "target": "cart tab" },
    { "id": "wait_for_cart_content", "action": "wait_for_element", "description": "Wait for the cart tab to load", "target": "cart items list", "wait_config": { "type": "element_visible", "timeout_ms": 3000 } },
    { "id": "capture_cart_count", "action": "capture_value", "description": "Capture the cart item count from the badge", "target": "cart badge count", "capture_to": "cart_item_count" },
    { "id": "tap_account_tab", "action": "tap", "description": "Tap on the account/profile tab", "target": "account tab" },
    { "id": "wait_for_account_content", "action": "wait_for_element", "description": "Wait for the account tab to load", "target": "account header", "wait_config": { "type": "element_visible", "timeout_ms": 3000 } },
    { "id": "tap_home_tab_again", "action": "tap", "description": "Return to the home tab", "target": "home tab" },
    { "id": "wait_for_home_content_reload", "action": "wait_for_element", "description": "Wait for the home tab content to reload", "target": "home tab content", "wait_config": { "type": "element_visible", "timeout_ms": 3000 } }
  ],
  "assertions": [
    { "id": "tabbar_visible", "after_step": "wait_for_home_tab", "type": "element_exists", "description": "Tab bar is visible at the bottom of the screen", "element_description": "bottom tab bar" },
    { "id": "home_tab_loads", "after_step": "wait_for_home_tab", "type": "element_exists", "description": "Home tab content displays correctly", "element_description": "home tab content" },
    { "id": "search_tab_loads", "after_step": "wait_for_search_content", "type": "element_exists", "description": "Search tab content loads with the search bar", "element_description": "search bar" },
    { "id": "cart_tab_loads", "after_step": "wait_for_cart_content", "type": "element_exists", "description": "Cart tab displays the items list", "element_description": "cart items list" },
    { "id": "cart_badge_visible", "after_step": "capture_cart_count", "type": "element_exists", "description": "Cart badge displays the item count", "element_description": "cart badge count" },
    { "id": "account_tab_loads", "after_step": "wait_for_account_content", "type": "element_exists", "description": "Account tab displays the user profile header", "element_description": "account header" },
    { "id": "home_tab_persists", "after_step": "wait_for_home_content_reload", "type": "element_exists", "description": "Home tab state is maintained after returning", "element_description": "home tab content" },
    { "id": "no_tab_errors", "after_step": "wait_for_home_content_reload", "type": "element_not_exists", "description": "No error messages shown during tab switching", "element_description": "error alert" }
  ]
}
```

### What This Tests

- Tab bar rendering and visibility
- Tab selection and active state indication
- Content loading for each tab
- Tab switching performance
- State persistence across tabs
- Badge display (cart count)
- Error handling during navigation

### Adaptation Tips

- Add scroll verification within tabs
- Test tab re-selection (double tap behavior)
- Verify network requests on tab load
- Check for memory leaks with rapid switching
- Test badge counter updates

---

## SwipeBack Dismissal

Demonstrates gesture-based screen dismissal using iOS swipe-to-pop navigation gesture.

**Key Features:**

- Interactive dismissal gesture
- Gesture animation
- Navigation stack management
- Data persistence during swipe
- Gesture cancellation/recovery

### Scenario JSON

```json
{
  "$schema_version": "2.1",
  "scenario_id": "ios_swipeback_dismissal",
  "name": "Dismiss Screen with Swipe Gesture",
  "description": "User swipes back to dismiss a detail screen and return to the list",
  "platform": "ios",
  "app_package": "com.example.articles",
  "metadata": { "app_version": "1.3.0", "environment": "staging" },
  "tags": ["gestures", "navigation", "ios", "swipe"],
  "variables": {
    "selected_article": { "type": "string", "description": "Title of the article opened during the test", "value": "iOS Development Guide" }
  },
  "preconditions": {
    "app_state": "logged_in",
    "notes": ["User is logged in on the articles list screen"]
  },
  "steps": [
    { "id": "launch_app", "action": "launch_app", "description": "Launch the articles app", "target": "com.example.articles" },
    { "id": "wait_for_articles_list", "action": "wait_for_element", "description": "Wait for the articles list to load", "target": "articles list", "wait_config": { "type": "element_visible", "timeout_ms": 5000 } },
    { "id": "tap_article", "action": "tap", "description": "Tap on the iOS Development article", "target": "iOS Development Guide article row" },
    { "id": "wait_for_detail_screen", "action": "wait_for_element", "description": "Wait for the article detail screen to load", "target": "article detail title", "wait_config": { "type": "element_visible", "timeout_ms": 3000 } },
    { "id": "swipe_back", "action": "swipe", "description": "Swipe from the left edge to the right to dismiss the detail screen", "target": "article detail screen", "value": "right" },
    { "id": "wait_for_list_return", "action": "wait_for_element", "description": "Wait for the return to the articles list after the swipe", "target": "articles list", "wait_config": { "type": "element_visible", "timeout_ms": 2000 } }
  ],
  "assertions": [
    { "id": "articles_list_visible", "after_step": "wait_for_articles_list", "type": "element_exists", "description": "Articles list is initially displayed", "element_description": "articles list" },
    { "id": "article_cell_tappable", "after_step": "wait_for_articles_list", "type": "element_visible", "description": "Article cell is visible and tappable", "element_description": "iOS Development Guide article row", "expected_visible": true },
    { "id": "detail_screen_pushed", "after_step": "wait_for_detail_screen", "type": "element_text", "description": "Detail screen displays the correct article", "element_description": "article detail title", "expected_value": "iOS Development Guide" },
    { "id": "back_navigation_available", "after_step": "wait_for_detail_screen", "type": "element_exists", "description": "Back button or swipe gesture is available", "element_description": "back button" },
    { "id": "swipe_returns_to_list", "after_step": "wait_for_list_return", "type": "screen_title", "description": "Swipe gesture returns the user to the articles screen", "expected_text": "Articles" },
    { "id": "list_state_maintained", "after_step": "wait_for_list_return", "type": "element_exists", "description": "List returns to the same state after the swipe", "element_description": "articles list" },
    { "id": "no_animation_glitch", "after_step": "wait_for_list_return", "type": "element_not_exists", "description": "Transition completes without an error overlay", "element_description": "error overlay" }
  ]
}
```

> **Cross-platform tip:** This example targets iOS with a raw left-to-right swipe. In a `platform-agnostic` scenario you would instead use the `press_back` semantic action, which resolves to a left-edge pop swipe on iOS and the BACK button on Android — one step, both platforms.

### What This Tests

- Swipe-to-pop gesture recognition
- Navigation stack management
- Screen dismissal animation
- State restoration after gesture
- Back button alternative
- Gesture edge detection

### Adaptation Tips

- Test swipe from different screen edges
- Verify gesture cancellation (swipe and return)
- Check navigation controller state
- Test rapid gesture sequences
- Verify no data is lost during dismissal

---

## Alert Presentation

Demonstrates UIAlertController handling, including different button actions and alert content.

**Key Features:**

- Alert presentation and dismissal
- Alert button interaction
- Alert content verification
- Multiple alert types (alert, action sheet)
- Alert action handling

### Scenario JSON

```json
{
  "$schema_version": "2.1",
  "scenario_id": "ios_alert_confirmation",
  "name": "Handle Alert Dialog and Confirm Action",
  "description": "User sees a confirmation alert and taps to confirm a destructive action",
  "platform": "ios",
  "app_package": "com.example.todo",
  "metadata": { "app_version": "2.0.0", "environment": "staging" },
  "tags": ["alerts", "dialogs", "ios", "confirmation"],
  "variables": {
    "todo_item": { "type": "string", "description": "Title of the todo item targeted for deletion", "value": "Complete project setup" }
  },
  "preconditions": {
    "app_state": "logged_in",
    "notes": ["Start on the todo list with at least one item"]
  },
  "steps": [
    { "id": "launch_app", "action": "launch_app", "description": "Launch the todo app", "target": "com.example.todo" },
    { "id": "wait_for_todo_list", "action": "wait_for_element", "description": "Wait for the todo list to load", "target": "todos list", "wait_config": { "type": "element_visible", "timeout_ms": 5000 } },
    { "id": "find_todo_item", "action": "scroll_to_element", "description": "Scroll to find the specific todo item", "target": "Complete project setup todo row", "value": "down" },
    { "id": "long_press_todo", "action": "long_press", "description": "Long press on the todo item to show the options menu", "target": "Complete project setup todo row" },
    { "id": "wait_for_action_sheet", "action": "wait_for_element", "description": "Wait for the action sheet to appear", "target": "action sheet", "wait_config": { "type": "element_visible", "timeout_ms": 2000 } },
    { "id": "tap_delete_option", "action": "tap", "description": "Tap the delete option in the action sheet", "target": "action sheet delete button" },
    { "id": "wait_for_confirmation_alert", "action": "wait_for_element", "description": "Wait for the delete confirmation alert", "target": "confirmation alert", "wait_config": { "type": "element_visible", "timeout_ms": 2000 } },
    { "id": "tap_confirm_delete", "action": "tap", "description": "Tap the confirm button to delete the item", "target": "alert delete button" },
    { "id": "wait_for_deletion", "action": "wait_for_element_gone", "description": "Wait for the item to be removed from the list", "target": "Complete project setup todo row", "wait_config": { "type": "element_gone", "timeout_ms": 2000 } }
  ],
  "assertions": [
    { "id": "list_displayed", "after_step": "wait_for_todo_list", "type": "element_exists", "description": "Todo list is displayed", "element_description": "todos list" },
    { "id": "item_found", "after_step": "find_todo_item", "type": "element_exists", "description": "Todo item is visible in the list", "element_description": "Complete project setup todo row" },
    { "id": "action_sheet_shown", "after_step": "wait_for_action_sheet", "type": "element_exists", "description": "Action sheet appears after the long press", "element_description": "action sheet" },
    { "id": "delete_option_available", "after_step": "wait_for_action_sheet", "type": "element_visible", "description": "Delete option is visible in the action sheet", "element_description": "action sheet delete button", "expected_visible": true },
    { "id": "alert_presented", "after_step": "wait_for_confirmation_alert", "type": "alert_present", "description": "Confirmation alert is presented" },
    { "id": "alert_message_correct", "after_step": "wait_for_confirmation_alert", "type": "alert_text", "description": "Alert message is correct", "expected_text": "Are you sure you want to delete this item?" },
    { "id": "delete_confirmed", "after_step": "wait_for_deletion", "type": "element_not_exists", "description": "Item is deleted after confirmation", "element_description": "Complete project setup todo row" },
    { "id": "no_errors", "after_step": "wait_for_deletion", "type": "element_not_exists", "description": "No error messages displayed", "element_description": "error alert" }
  ]
}
```

### What This Tests

- Alert/action sheet presentation
- Alert button interaction
- Alert message verification
- Destructive action confirmation
- Alert dismissal and result handling
- UI state after alert action

### Adaptation Tips

- Test different alert types (default, destructive, cancel)
- Verify alert appears at correct time
- Test alert button order and styling
- Include non-destructive alerts
- Test alert cancellation (tap outside or cancel button)

---

## Background Sync

Demonstrates handling background tasks and silent notifications during app usage and backgrounding.

**Key Features:**

- Background task initiation
- Silent notification handling
- Data sync verification
- Background state management
- Sync completion indicators

### Scenario JSON

```json
{
  "$schema_version": "2.1",
  "scenario_id": "ios_background_sync",
  "name": "Handle Background Sync and Data Update",
  "description": "App syncs data in the background and the user sees updated content on return to the foreground",
  "platform": "ios",
  "app_package": "com.example.messages",
  "metadata": { "app_version": "3.1.0", "environment": "staging" },
  "tags": ["background", "sync", "notifications", "ios"],
  "variables": {
    "message_count_before": { "type": "number", "description": "Message count captured before backgrounding the app" },
    "message_count_after": { "type": "number", "description": "Message count captured after the background sync" },
    "sync_timestamp": { "type": "string", "description": "Last sync timestamp captured after returning to the foreground" }
  },
  "preconditions": {
    "app_state": "logged_in",
    "notes": ["User is logged in on the messages screen"]
  },
  "steps": [
    { "id": "launch_app", "action": "launch_app", "description": "Launch the messages app", "target": "com.example.messages" },
    { "id": "wait_for_messages_load", "action": "wait_for_element", "description": "Wait for the messages list to load", "target": "messages list", "wait_config": { "type": "element_visible", "timeout_ms": 5000 } },
    { "id": "capture_initial_count", "action": "capture_value", "description": "Capture the initial message count", "target": "message count badge", "capture_to": "message_count_before" },
    { "id": "wait_for_sync_indicator", "action": "wait_for_element", "description": "Wait for the sync indicator if it is present", "target": "sync indicator", "optional": true, "wait_config": { "type": "element_visible", "timeout_ms": 2000 } },
    { "id": "press_home_button", "action": "press_button", "description": "Press the home button to background the app", "value": "HOME" },
    { "id": "wait_background_time", "action": "wait_for_loading_complete", "description": "Allow time for the background sync to occur", "wait_config": { "type": "loading_complete", "timeout_ms": 5000 } },
    { "id": "relaunch_app", "action": "launch_app", "description": "Relaunch the app from the background", "target": "com.example.messages" },
    { "id": "wait_for_list_reload", "action": "wait_for_element", "description": "Wait for the messages list to load after relaunch", "target": "messages list", "wait_config": { "type": "element_visible", "timeout_ms": 5000 } },
    { "id": "capture_updated_count", "action": "capture_value", "description": "Capture the updated message count", "target": "message count badge", "capture_to": "message_count_after" },
    { "id": "capture_sync_time", "action": "capture_value", "description": "Capture the last sync timestamp", "target": "last sync timestamp", "capture_to": "sync_timestamp" }
  ],
  "assertions": [
    { "id": "messages_load_initially", "after_step": "wait_for_messages_load", "type": "element_exists", "description": "Messages list loads on app launch", "element_description": "messages list" },
    { "id": "message_count_visible", "after_step": "capture_initial_count", "type": "element_exists", "description": "Message count badge is displayed", "element_description": "message count badge" },
    { "id": "app_returns_from_background", "after_step": "wait_for_list_reload", "type": "element_exists", "description": "App returns from the background state", "element_description": "messages list" },
    { "id": "list_reloaded", "after_step": "wait_for_list_reload", "type": "element_exists", "description": "Messages list is reloaded after returning from the background", "element_description": "messages list" },
    { "id": "sync_occurred", "after_step": "capture_sync_time", "type": "element_exists", "description": "Background sync occurred (timestamp updated)", "element_description": "last sync timestamp" },
    { "id": "content_updated", "after_step": "capture_updated_count", "type": "value_matches_variable", "description": "New message count matches the captured post-sync value", "element_description": "message count badge", "variable_name": "message_count_after" },
    { "id": "no_sync_error", "after_step": "wait_for_list_reload", "type": "element_not_exists", "description": "No error message during sync", "element_description": "sync error banner" }
  ]
}
```

### What This Tests

- Background app behavior
- Silent notification processing
- Data sync during backgrounding
- Content refresh on app return
- Sync timestamp accuracy
- Badge count updates
- Network resilience

### Adaptation Tips

- Test with network interruptions
- Verify sync indicator UX
- Check data consistency after sync
- Test rapid foreground/background transitions
- Monitor battery usage in background

---

## Best Practices

When adapting these examples:

1. **Test biometric variations** — Include Face ID, Touch ID, and fallback flows
2. **Verify gesture precision** — Use appropriate swipe distances and durations
3. **Handle alert timing** — Ensure alerts appear before interaction
4. **Test state persistence** — Verify data isn't lost during transitions
5. **Check animation completion** — Wait for visual transitions to finish
6. **Test network scenarios** — Include offline/slow network conditions
7. **Verify battery impact** — Monitor background task efficiency
8. **Document iOS version** — Note minimum iOS version requirements

---

## Next Steps

- [Android Examples](android.md) — View Android-specific examples
- [Schema Reference](../reference/schema.md) — Full schema documentation
- [Generate Tests](../guides/generate.md) — Create similar tests for your app
- [Execute Tests](../guides/execute.md) — Run generated tests

[Back to Examples →](index.md)
