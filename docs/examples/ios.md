# iOS Examples

Complete test scenario examples for iOS applications. Each example demonstrates iOS-specific patterns and best practices.

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
  "$schema_version": "2.0",
  "scenario_id": "ios_login_biometric_fallback",
  "name": "Login with Face ID and Password Fallback",
  "description": "User authenticates with Face ID, and falls back to password entry if biometric fails",
  "platform": "ios",
  "app_package": "com.example.app",
  "metadata": {
    "app_version": "2.1.0",
    "environment": "staging"
  },
  "tags": ["authentication", "biometric", "face-id", "ios"],
  "testrail": {
    "case_id": 2001,
    "project_id": 1,
    "case_url": "https://testrail.example.com/index.php?/cases/view/2001"
  },
  "variables": {
    "test_password": {
      "type": "string",
      "value": "SecurePassword123!"
    },
    "dashboard_loaded": {
      "type": "boolean"
    }
  },
  "preconditions": {
    "setup_actions": [
      {
        "type": "clear_app_data",
        "description": "Clear app keychain and defaults"
      }
    ],
    "device_state": "On login screen with biometric enrolled"
  },
  "steps": {
    "launch_app": {
      "type": "launch_app",
      "description": "Launch authentication enabled app"
    },
    "wait_for_login_screen": {
      "type": "wait_for_element",
      "element": "login_view_title",
      "timeout_seconds": 5,
      "description": "Wait for login screen to display"
    },
    "verify_biometric_button": {
      "type": "element_visible",
      "element": "biometric_auth_button",
      "description": "Verify Face ID button is visible"
    },
    "tap_biometric_button": {
      "type": "tap",
      "element": "biometric_auth_button",
      "description": "Tap Face ID authentication button"
    },
    "wait_for_biometric_prompt": {
      "type": "wait_for_element",
      "element": "biometric_system_prompt",
      "timeout_seconds": 3,
      "description": "Wait for system biometric prompt"
    },
    "deny_biometric": {
      "type": "tap",
      "element": "biometric_cancel_button",
      "description": "Tap cancel on biometric prompt to trigger fallback"
    },
    "wait_for_fallback": {
      "type": "wait_for_element",
      "element": "password_input",
      "timeout_seconds": 3,
      "description": "Wait for password input field to appear"
    },
    "tap_password_field": {
      "type": "tap",
      "element": "password_input",
      "description": "Tap password input field"
    },
    "enter_password": {
      "type": "type",
      "element": "password_input",
      "text": "SecurePassword123!",
      "clear_before": true,
      "description": "Enter password for fallback authentication"
    },
    "tap_login_button": {
      "type": "tap",
      "element": "login_button",
      "description": "Tap login button"
    },
    "wait_for_dashboard": {
      "type": "wait_for_element",
      "element": "dashboard_title",
      "timeout_seconds": 5,
      "description": "Wait for dashboard to load after password login"
    }
  },
  "assertions": [
    {
      "id": "login_screen_loaded",
      "description": "Login screen is displayed",
      "type": "element_exists",
      "element": "login_view_title"
    },
    {
      "id": "biometric_button_available",
      "description": "Face ID button is available and visible",
      "type": "element_visible",
      "element": "biometric_auth_button"
    },
    {
      "id": "password_field_shown_after_cancel",
      "description": "Password input field appears after biometric cancel",
      "type": "element_exists",
      "element": "password_input"
    },
    {
      "id": "password_entered",
      "description": "Password is entered in field",
      "type": "element_text",
      "element": "password_input",
      "expected_text": "SecurePassword123!"
    },
    {
      "id": "login_button_enabled",
      "description": "Login button is enabled when password entered",
      "type": "element_visible",
      "element": "login_button"
    },
    {
      "id": "dashboard_accessible",
      "description": "Dashboard is displayed after fallback login",
      "type": "screen_title",
      "expected_text": "Dashboard"
    },
    {
      "id": "no_error_on_fallback",
      "description": "No error message on successful fallback",
      "type": "element_not_exists",
      "element": "error_message"
    }
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
  "$schema_version": "2.0",
  "scenario_id": "ios_tabbar_navigation",
  "name": "Navigate Between Tabs and Verify State",
  "description": "User switches between tab bar tabs and verifies correct content loads for each tab",
  "platform": "ios",
  "app_package": "com.example.shop",
  "metadata": {
    "app_version": "1.8.0",
    "environment": "staging"
  },
  "tags": ["navigation", "tabbar", "ios", "ui"],
  "variables": {
    "current_tab": {
      "type": "string"
    },
    "cart_item_count": {
      "type": "string"
    }
  },
  "preconditions": {
    "setup_actions": [
      {
        "type": "launch_app"
      }
    ],
    "device_state": "Logged in on home tab"
  },
  "steps": {
    "launch_app": {
      "type": "launch_app",
      "description": "Launch shopping application"
    },
    "wait_for_home_tab": {
      "type": "wait_for_element",
      "element": "home_tab_content",
      "timeout_seconds": 5,
      "description": "Wait for home tab content to load"
    },
    "verify_home_tab_active": {
      "type": "element_visible",
      "element": "home_tab_icon_active",
      "description": "Verify home tab is selected (active state)"
    },
    "tap_search_tab": {
      "type": "tap",
      "element": "search_tab",
      "description": "Tap on search tab"
    },
    "wait_for_search_content": {
      "type": "wait_for_element",
      "element": "search_bar",
      "timeout_seconds": 3,
      "description": "Wait for search tab content to load"
    },
    "verify_search_tab_active": {
      "type": "element_visible",
      "element": "search_tab_icon_active",
      "description": "Verify search tab is now active"
    },
    "tap_cart_tab": {
      "type": "tap",
      "element": "cart_tab",
      "description": "Tap on cart tab"
    },
    "wait_for_cart_content": {
      "type": "wait_for_element",
      "element": "cart_items_list",
      "timeout_seconds": 3,
      "description": "Wait for cart tab to load"
    },
    "capture_cart_count": {
      "type": "capture_value",
      "element": "cart_badge_count",
      "capture_to": "cart_item_count",
      "description": "Capture cart item count from badge"
    },
    "verify_cart_tab_active": {
      "type": "element_visible",
      "element": "cart_tab_icon_active",
      "description": "Verify cart tab is selected"
    },
    "tap_account_tab": {
      "type": "tap",
      "element": "account_tab",
      "description": "Tap on account/profile tab"
    },
    "wait_for_account_content": {
      "type": "wait_for_element",
      "element": "account_header",
      "timeout_seconds": 3,
      "description": "Wait for account tab to load"
    },
    "verify_account_tab_active": {
      "type": "element_visible",
      "element": "account_tab_icon_active",
      "description": "Verify account tab is selected"
    },
    "tap_home_tab_again": {
      "type": "tap",
      "element": "home_tab",
      "description": "Return to home tab"
    },
    "wait_for_home_content_reload": {
      "type": "wait_for_element",
      "element": "home_tab_content",
      "timeout_seconds": 3,
      "description": "Wait for home tab content to reload"
    }
  },
  "assertions": [
    {
      "id": "tabbar_visible",
      "description": "Tab bar is visible at bottom of screen",
      "type": "element_exists",
      "element": "bottom_tab_bar"
    },
    {
      "id": "home_tab_loads",
      "description": "Home tab content displays correctly",
      "type": "element_exists",
      "element": "home_tab_content"
    },
    {
      "id": "search_tab_loads",
      "description": "Search tab content loads with search bar",
      "type": "element_exists",
      "element": "search_bar"
    },
    {
      "id": "search_tab_active",
      "description": "Search tab icon shows active state",
      "type": "element_exists",
      "element": "search_tab_icon_active"
    },
    {
      "id": "cart_tab_loads",
      "description": "Cart tab displays items list",
      "type": "element_exists",
      "element": "cart_items_list"
    },
    {
      "id": "cart_badge_visible",
      "description": "Cart badge displays item count",
      "type": "element_exists",
      "element": "cart_badge_count"
    },
    {
      "id": "account_tab_loads",
      "description": "Account tab displays user profile header",
      "type": "element_exists",
      "element": "account_header"
    },
    {
      "id": "home_tab_persists",
      "description": "Home tab state is maintained after returning",
      "type": "element_exists",
      "element": "home_tab_content"
    },
    {
      "id": "no_tab_errors",
      "description": "No error messages shown during tab switching",
      "type": "element_not_exists",
      "element": "error_alert"
    }
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
  "$schema_version": "2.0",
  "scenario_id": "ios_swipeback_dismissal",
  "name": "Dismiss Screen with Swipe Gesture",
  "description": "User swipes back to dismiss a detail screen and return to list",
  "platform": "ios",
  "app_package": "com.example.articles",
  "metadata": {
    "app_version": "1.3.0",
    "environment": "staging"
  },
  "tags": ["gestures", "navigation", "ios", "swipe"],
  "variables": {
    "selected_article": {
      "type": "string",
      "value": "iOS Development Guide"
    }
  },
  "preconditions": {
    "setup_actions": [
      {
        "type": "launch_app"
      }
    ],
    "device_state": "Logged in on articles list screen"
  },
  "steps": {
    "launch_app": {
      "type": "launch_app",
      "description": "Launch articles app"
    },
    "wait_for_articles_list": {
      "type": "wait_for_element",
      "element": "articles_table_view",
      "timeout_seconds": 5,
      "description": "Wait for articles list to load"
    },
    "verify_article_visible": {
      "type": "element_visible",
      "element": "article_cell_ios_development",
      "description": "Verify iOS Development article is visible"
    },
    "tap_article": {
      "type": "tap",
      "element": "article_cell_ios_development",
      "description": "Tap on iOS Development article"
    },
    "wait_for_detail_screen": {
      "type": "wait_for_element",
      "element": "article_detail_title",
      "timeout_seconds": 3,
      "description": "Wait for article detail screen to load"
    },
    "verify_article_loaded": {
      "type": "element_text",
      "element": "article_detail_title",
      "expected_text": "iOS Development Guide",
      "description": "Verify correct article detail loaded"
    },
    "verify_back_button": {
      "type": "element_visible",
      "element": "back_button",
      "description": "Verify back button is visible"
    },
    "swipe_back": {
      "type": "swipe",
      "direction": "left",
      "location": "left_edge",
      "distance": 200,
      "description": "Swipe from left edge to dismiss detail screen"
    },
    "wait_for_list_return": {
      "type": "wait_for_element",
      "element": "articles_table_view",
      "timeout_seconds": 2,
      "description": "Wait for return to articles list after swipe"
    },
    "verify_list_restored": {
      "type": "element_visible",
      "element": "article_cell_ios_development",
      "description": "Verify original article cell is still visible"
    }
  },
  "assertions": [
    {
      "id": "articles_list_visible",
      "description": "Articles list is initially displayed",
      "type": "element_exists",
      "element": "articles_table_view"
    },
    {
      "id": "article_cell_tappable",
      "description": "Article cell is visible and tappable",
      "type": "element_visible",
      "element": "article_cell_ios_development"
    },
    {
      "id": "detail_screen_pushed",
      "description": "Detail screen displays correct article",
      "type": "element_text",
      "element": "article_detail_title",
      "expected_text": "iOS Development Guide"
    },
    {
      "id": "back_navigation_available",
      "description": "Back button or swipe gesture available",
      "type": "element_exists",
      "element": "back_button"
    },
    {
      "id": "swipe_gesture_responsive",
      "description": "Swipe gesture responds to user interaction",
      "type": "screen_title",
      "expected_text": "Articles"
    },
    {
      "id": "list_state_maintained",
      "description": "List returns to same state after swipe",
      "type": "element_exists",
      "element": "articles_table_view"
    },
    {
      "id": "no_animation_glitch",
      "description": "Transition animation completes without errors",
      "type": "element_not_exists",
      "element": "error_overlay"
    }
  ]
}
```

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
  "$schema_version": "2.0",
  "scenario_id": "ios_alert_confirmation",
  "name": "Handle Alert Dialog and Confirm Action",
  "description": "User sees confirmation alert and taps to confirm destructive action",
  "platform": "ios",
  "app_package": "com.example.todo",
  "metadata": {
    "app_version": "2.0.0",
    "environment": "staging"
  },
  "tags": ["alerts", "dialogs", "ios", "confirmation"],
  "variables": {
    "todo_item": {
      "type": "string",
      "value": "Complete project setup"
    }
  },
  "preconditions": {
    "setup_actions": [
      {
        "type": "launch_app"
      }
    ],
    "device_state": "On todo list with items"
  },
  "steps": {
    "launch_app": {
      "type": "launch_app",
      "description": "Launch todo app"
    },
    "wait_for_todo_list": {
      "type": "wait_for_element",
      "element": "todos_table_view",
      "timeout_seconds": 5,
      "description": "Wait for todo list to load"
    },
    "find_todo_item": {
      "type": "scroll_to_element",
      "element": "todos_table_view",
      "target_element": "todo_cell_setup",
      "timeout_seconds": 5,
      "description": "Scroll to find specific todo item"
    },
    "long_press_todo": {
      "type": "long_press",
      "element": "todo_cell_setup",
      "duration": 1000,
      "description": "Long press on todo item to show options menu"
    },
    "wait_for_action_sheet": {
      "type": "wait_for_element",
      "element": "action_sheet_title",
      "timeout_seconds": 2,
      "description": "Wait for action sheet to appear"
    },
    "tap_delete_option": {
      "type": "tap",
      "element": "action_sheet_delete_button",
      "description": "Tap delete option in action sheet"
    },
    "wait_for_confirmation_alert": {
      "type": "wait_for_element",
      "element": "confirmation_alert_title",
      "timeout_seconds": 2,
      "description": "Wait for delete confirmation alert"
    },
    "verify_alert_message": {
      "type": "alert_text",
      "message": "Are you sure you want to delete this item?",
      "description": "Verify confirmation message text"
    },
    "tap_confirm_delete": {
      "type": "tap",
      "element": "alert_delete_button",
      "description": "Tap confirm button to delete item"
    },
    "wait_for_deletion": {
      "type": "wait_for_element_gone",
      "element": "todo_cell_setup",
      "timeout_seconds": 2,
      "description": "Wait for item to be removed from list"
    }
  },
  "assertions": [
    {
      "id": "list_displayed",
      "description": "Todo list is displayed",
      "type": "element_exists",
      "element": "todos_table_view"
    },
    {
      "id": "item_found",
      "description": "Todo item is visible in list",
      "type": "element_exists",
      "element": "todo_cell_setup"
    },
    {
      "id": "action_sheet_shown",
      "description": "Action sheet appears after long press",
      "type": "element_exists",
      "element": "action_sheet_title"
    },
    {
      "id": "delete_option_available",
      "description": "Delete option is visible in action sheet",
      "type": "element_visible",
      "element": "action_sheet_delete_button"
    },
    {
      "id": "alert_presented",
      "description": "Confirmation alert is presented",
      "type": "alert_present"
    },
    {
      "id": "alert_message_correct",
      "description": "Alert message is correct",
      "type": "alert_text",
      "message": "Are you sure you want to delete this item?"
    },
    {
      "id": "delete_confirmed",
      "description": "Item is deleted after confirmation",
      "type": "element_not_exists",
      "element": "todo_cell_setup"
    },
    {
      "id": "no_errors",
      "description": "No error messages displayed",
      "type": "element_not_exists",
      "element": "error_alert"
    }
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
  "$schema_version": "2.0",
  "scenario_id": "ios_background_sync",
  "name": "Handle Background Sync and Data Update",
  "description": "App syncs data in background and user sees updated content on return to foreground",
  "platform": "ios",
  "app_package": "com.example.messages",
  "metadata": {
    "app_version": "3.1.0",
    "environment": "staging"
  },
  "tags": ["background", "sync", "notifications", "ios"],
  "variables": {
    "message_count_before": {
      "type": "number"
    },
    "message_count_after": {
      "type": "number"
    },
    "sync_timestamp": {
      "type": "string"
    }
  },
  "preconditions": {
    "setup_actions": [
      {
        "type": "launch_app"
      }
    ],
    "device_state": "Logged in on messages screen"
  },
  "steps": {
    "launch_app": {
      "type": "launch_app",
      "description": "Launch messages app"
    },
    "wait_for_messages_load": {
      "type": "wait_for_element",
      "element": "messages_list",
      "timeout_seconds": 5,
      "description": "Wait for messages list to load"
    },
    "capture_initial_count": {
      "type": "capture_value",
      "element": "message_count_badge",
      "capture_to": "message_count_before",
      "description": "Capture initial message count"
    },
    "wait_for_sync_indicator": {
      "type": "wait_for_element",
      "element": "sync_indicator",
      "timeout_seconds": 2,
      "optional": true,
      "description": "Wait for sync indicator if present"
    },
    "press_home_button": {
      "type": "press_button",
      "button": "HOME",
      "description": "Press home button to background app"
    },
    "wait_background_time": {
      "type": "wait_for_loading_complete",
      "timeout_seconds": 5,
      "description": "Allow time for background sync to occur"
    },
    "relaunch_app": {
      "type": "launch_app",
      "description": "Relaunch app from background"
    },
    "wait_for_list_reload": {
      "type": "wait_for_element",
      "element": "messages_list",
      "timeout_seconds": 5,
      "description": "Wait for messages list to load after relaunch"
    },
    "capture_updated_count": {
      "type": "capture_value",
      "element": "message_count_badge",
      "capture_to": "message_count_after",
      "description": "Capture updated message count"
    },
    "capture_sync_time": {
      "type": "capture_value",
      "element": "last_sync_timestamp",
      "capture_to": "sync_timestamp",
      "description": "Capture last sync timestamp"
    }
  },
  "assertions": [
    {
      "id": "messages_load_initially",
      "description": "Messages list loads on app launch",
      "type": "element_exists",
      "element": "messages_list"
    },
    {
      "id": "message_count_visible",
      "description": "Message count badge is displayed",
      "type": "element_exists",
      "element": "message_count_badge"
    },
    {
      "id": "app_returns_from_background",
      "description": "App returns from background state",
      "type": "element_exists",
      "element": "messages_list"
    },
    {
      "id": "list_reloaded",
      "description": "Messages list is reloaded after returning from background",
      "type": "element_exists",
      "element": "messages_list"
    },
    {
      "id": "sync_occurred",
      "description": "Background sync occurred (timestamp updated)",
      "type": "element_exists",
      "element": "last_sync_timestamp"
    },
    {
      "id": "content_updated",
      "description": "New messages appear after sync",
      "type": "value_matches_variable",
      "element": "message_count_badge",
      "variable": "message_count_after"
    },
    {
      "id": "no_sync_error",
      "description": "No error message during sync",
      "type": "element_not_exists",
      "element": "sync_error_banner"
    }
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
- [Schema v2 Reference](../reference/schema-v2.md) — Full schema documentation
- [Generate Tests](../guides/generate.md) — Create similar tests for your app
- [Execute Tests](../guides/execute.md) — Run generated tests

[Back to Examples →](index.md)
