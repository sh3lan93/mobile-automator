# MCP Tool Reference

The Mobile MCP Server (`mobile-mcp`) provides 20+ device automation primitives for controlling mobile devices and simulators. These tools are used internally by the executor skill but can also be called directly for custom test logic.

## Overview

The MCP server provides low-level device control capabilities:

- **Device Management** — List devices, launch/terminate apps, install/uninstall apps
- **Screen Capture** — Take screenshots, list UI elements
- **User Interactions** — Tap, swipe, type, press buttons
- **Navigation** — Open URLs, press back/home
- **Device Control** — Orientation, audio, connectivity

## Device Management Tools

### mobile_list_available_devices()

Returns all connected devices and simulators (iOS and Android).

**Parameters:** None

**Returns:**
```json
{
  "devices": [
    {
      "id": "emulator-5554",
      "os": "Android",
      "model": "Pixel 7",
      "version": "34"
    },
    {
      "id": "A8F3X9Z2",
      "os": "Android",
      "model": "Galaxy S24",
      "version": "34"
    },
    {
      "id": "simulator-iPhone14",
      "os": "iOS",
      "model": "iPhone 14 Pro",
      "version": "17.2"
    },
    {
      "id": "device-iPhone12",
      "os": "iOS",
      "model": "iPhone 12",
      "version": "17.1"
    }
  ]
}
```

**Use cases:**
- Detect available devices before starting tests
- Choose target device for test execution
- Verify device connectivity

**Example:**
```json
{
  "type": "wait_for_element",
  "description": "Get list of connected devices"
}
```

---

### mobile_launch_app(device, packageName)

Launch an app on the specified device.

**Parameters:**
- `device` (string, required) — Device ID from `mobile_list_available_devices()`
- `packageName` (string, required) — iOS bundle ID or Android package name

**Returns:**
```json
{
  "status": "success",
  "message": "App launched successfully"
}
```

**Errors:**
- App not installed
- Device not found
- Invalid package name

**Use cases:**
- Start app before test execution
- Relaunch app after crash
- Test app startup sequence

**Example:**
```json
{
  "type": "launch_app"
}
```

---

### mobile_terminate_app(device, packageName)

Terminate a running app on the device.

**Parameters:**
- `device` (string, required) — Device ID
- `packageName` (string, required) — Package to terminate

**Returns:**
```json
{
  "status": "success",
  "message": "App terminated successfully"
}
```

**Use cases:**
- Stop app between test scenarios
- Reset app state without clearing data
- Cleanup before test

---

### mobile_install_app(device, path)

Install app from APK (Android) or IPA (iOS).

**Parameters:**
- `device` (string, required) — Device ID
- `path` (string, required) — Path to APK/IPA file

**Returns:**
```json
{
  "status": "success",
  "message": "App installed successfully"
}
```

**Use cases:**
- Install test build before test run
- Update app to specific version
- Install multiple app variants

---

### mobile_uninstall_app(device, bundle_id)

Uninstall an app from the device.

**Parameters:**
- `device` (string, required) — Device ID
- `bundle_id` (string, required) — iOS bundle ID or Android package name

**Returns:**
```json
{
  "status": "success",
  "message": "App uninstalled successfully"
}
```

---

### mobile_list_apps(device)

List all installed apps on the device.

**Parameters:**
- `device` (string, required) — Device ID

**Returns:**
```json
{
  "apps": [
    {
      "package": "com.example.app",
      "name": "Example App",
      "version": "1.2.3",
      "installed": true
    },
    {
      "package": "com.android.chrome",
      "name": "Chrome",
      "version": "120.0.1",
      "installed": true
    }
  ]
}
```

**Use cases:**
- Verify app installation
- Check for required dependencies
- List available apps on device

---

## Screen Capture & UI Tools

### mobile_take_screenshot(device)

Capture the current device screen as a base64-encoded image.

**Parameters:**
- `device` (string, required) — Device ID

**Returns:**
```json
{
  "image": "iVBORw0KGgoAAAANSUhEUg...",
  "format": "png",
  "dimensions": {
    "width": 1170,
    "height": 2532
  }
}
```

**Use cases:**
- Capture current state for visual assertions
- Debug test failures
- Generate reference screenshots
- Compare visual changes

**Note:** Base64 image can be decoded and saved as PNG file.

---

### mobile_save_screenshot(device, saveTo)

Capture screen and save directly to file.

**Parameters:**
- `device` (string, required) — Device ID
- `saveTo` (string, required) — File path to save PNG

**Returns:**
```json
{
  "status": "success",
  "path": "/path/to/screenshot.png"
}
```

**Use cases:**
- Save reference screenshots for visual assertions
- Generate test reports with screenshots
- Archive execution results

---

### mobile_list_elements_on_screen(device)

Get all interactive UI elements currently visible on the screen.

**Parameters:**
- `device` (string, required) — Device ID

**Returns:**
```json
{
  "elements": [
    {
      "id": "button_1",
      "text": "Login",
      "type": "button",
      "accessibility_label": "Login button",
      "x": 100,
      "y": 200,
      "width": 150,
      "height": 50,
      "visible": true,
      "enabled": true,
      "center": {
        "x": 175,
        "y": 225
      }
    },
    {
      "id": "input_2",
      "text": "Email address",
      "type": "edittext",
      "accessibility_label": null,
      "x": 50,
      "y": 100,
      "width": 300,
      "height": 40,
      "visible": true,
      "enabled": true,
      "center": {
        "x": 200,
        "y": 120
      }
    }
  ]
}
```

**Fields per element:**
- `id` — Element identifier
- `text` — Visible text content
- `type` — Element type (button, edittext, image, etc.)
- `accessibility_label` — Screen reader label
- `x, y` — Top-left coordinates in pixels
- `width, height` — Element dimensions
- `center` — Center point coordinates (useful for tapping)
- `visible` — Whether element is visible on screen
- `enabled` — Whether element is interactive

**Use cases:**
- Find element coordinates for tapping
- Verify element properties and state
- Get element locators for step definitions
- Debug UI layout

---

## User Interaction Tools

### mobile_click_on_screen_at_coordinates(device, x, y)

Tap/click at specific coordinates on the screen.

**Parameters:**
- `device` (string, required) — Device ID
- `x` (number, required) — X coordinate in pixels
- `y` (number, required) — Y coordinate in pixels

**Returns:**
```json
{
  "status": "success",
  "message": "Tap executed at (100, 200)"
}
```

**Usage tip:** Use `mobile_list_elements_on_screen()` first to get element coordinates, then use the `center` point for tapping.

**Example flow:**
1. Call `mobile_list_elements_on_screen()` to get login button coordinates
2. Extract `center.x` and `center.y` from the button
3. Call `mobile_click_on_screen_at_coordinates(device, center.x, center.y)`

---

### mobile_double_tap_on_screen(device, x, y)

Double-tap at specific coordinates.

**Parameters:**
- `device` (string, required) — Device ID
- `x` (number, required) — X coordinate in pixels
- `y` (number, required) — Y coordinate in pixels

**Returns:**
```json
{
  "status": "success",
  "message": "Double tap executed at (500, 600)"
}
```

**Use cases:**
- Zoom in on images or maps
- Open items in list views
- Activate double-tap actions

---

### mobile_long_press_on_screen_at_coordinates(device, x, y, duration)

Long-press at specific coordinates.

**Parameters:**
- `device` (string, required) — Device ID
- `x` (number, required) — X coordinate in pixels
- `y` (number, required) — Y coordinate in pixels
- `duration` (integer, optional) — Press duration in milliseconds (default: 500, max: 10000)

**Returns:**
```json
{
  "status": "success",
  "message": "Long press executed for 1000ms at (150, 250)"
}
```

**Use cases:**
- Open context menus
- Select items in lists
- Activate long-press gestures

---

### mobile_type_keys(device, text, submit)

Type text into the currently focused input field.

**Parameters:**
- `device` (string, required) — Device ID
- `text` (string, required) — Text to type
- `submit` (boolean, optional) — Send ENTER key after text (default: false)

**Returns:**
```json
{
  "status": "success",
  "message": "Typed: 'hello world'"
}
```

**Important:** Must tap on an input field first to focus it before calling this tool.

**Example flow:**
1. Call `mobile_click_on_screen_at_coordinates()` on email input
2. Call `mobile_type_keys(device, 'user@example.com', false)`
3. Call `mobile_click_on_screen_at_coordinates()` on password input
4. Call `mobile_type_keys(device, 'password123', false)`

---

### mobile_swipe_on_screen(device, direction, distance)

Swipe/scroll in a specific direction.

**Parameters:**
- `device` (string, required) — Device ID
- `direction` (string, required) — `up`, `down`, `left`, or `right`
- `distance` (integer, optional) — Distance in pixels (default: ~30% of screen dimension)

**Returns:**
```json
{
  "status": "success",
  "message": "Swiped down 400 pixels"
}
```

**Use cases:**
- Scroll through lists
- Navigate between pages
- Dismiss overlays

---

### mobile_scroll_to_element(device, element)

Scroll until a specific element is visible on screen.

**Parameters:**
- `device` (string, required) — Device ID
- `element` (string, required) — Element ID to scroll to

**Returns:**
```json
{
  "status": "success",
  "message": "Scrolled to element: button_submit"
}
```

**Use cases:**
- Find off-screen elements
- Navigate to bottom of long lists
- Scroll to buttons/fields below viewport

---

### mobile_press_button(device, button)

Press a device button (hardware or virtual).

**Parameters:**
- `device` (string, required) — Device ID
- `button` (string, required) — Button to press:
  - `BACK` — Android back button
  - `HOME` — Home button (all platforms)
  - `VOLUME_UP` — Volume up
  - `VOLUME_DOWN` — Volume down
  - `ENTER` — Return/Enter key

**Returns:**
```json
{
  "status": "success",
  "message": "Pressed BACK button"
}
```

**Use cases:**
- Navigate back in app
- Go to home screen
- Adjust volume
- Submit forms (ENTER key)

---

## Navigation Tools

### mobile_open_url(device, url)

Open a URL in the default browser on the device.

**Parameters:**
- `device` (string, required) — Device ID
- `url` (string, required) — Full URL to open

**Returns:**
```json
{
  "status": "success",
  "message": "URL opened in browser"
}
```

**Use cases:**
- Test deep linking from browser
- Open external web pages
- Verify URL handling

---

## Device Orientation Tools

### mobile_get_orientation(device)

Get the current screen orientation of the device.

**Parameters:**
- `device` (string, required) — Device ID

**Returns:**
```json
{
  "orientation": "portrait"
}
```

**Possible values:** `portrait` or `landscape`

**Use cases:**
- Verify orientation before test
- Check responsive behavior
- Get current state for logging

---

### mobile_set_orientation(device, orientation)

Set the screen orientation.

**Parameters:**
- `device` (string, required) — Device ID
- `orientation` (string, required) — `portrait` or `landscape`

**Returns:**
```json
{
  "status": "success",
  "message": "Device orientation changed to landscape"
}
```

**Use cases:**
- Test landscape mode UI
- Verify orientation change handling
- Test rotation robustness

---

### mobile_get_screen_size(device)

Get screen dimensions in pixels.

**Parameters:**
- `device` (string, required) — Device ID

**Returns:**
```json
{
  "width": 1170,
  "height": 2532
}
```

**Use cases:**
- Know screen dimensions for coordinate calculations
- Verify responsive layout
- Calculate tap positions relative to screen size

---

## Best Practices

### 1. Always Get Device First
```
1. Call mobile_list_available_devices()
2. Select appropriate device from list
3. Use device ID in subsequent calls
```

### 2. Find Elements Before Tapping
```
1. Call mobile_list_elements_on_screen()
2. Find element by ID or text
3. Use element center point for coordinates
4. Call mobile_click_on_screen_at_coordinates()
```

### 3. Focus Before Typing
```
1. Tap on input field with mobile_click_on_screen_at_coordinates()
2. Verify keyboard is visible
3. Call mobile_type_keys() to enter text
```

### 4. Wait for Elements to Load
```
1. Take initial screenshot with mobile_take_screenshot()
2. Call mobile_list_elements_on_screen()
3. Check if target element is present
4. If not found, wait and retry
```

### 5. Screenshot for Debugging
```
Whenever test fails:
- mobile_take_screenshot() to capture state
- Save with mobile_save_screenshot()
- Include in test report
```

### 6. Handle Network Delays
```
- Add implicit waits between actions
- Use retry logic for flaky operations
- Account for loading indicators
```

### 7. Clean Up After Tests
```
- mobile_terminate_app() to stop app
- Consider mobile_uninstall_app() if needed
- Use mobile_press_button("HOME") to reset
```

---

## Error Handling

All tools return consistent error responses:

```json
{
  "status": "error",
  "code": "DEVICE_NOT_FOUND",
  "message": "Device 'emulator-5554' not found or disconnected"
}
```

**Common error codes:**
- `DEVICE_NOT_FOUND` — Device ID invalid or disconnected
- `APP_NOT_INSTALLED` — Package not found on device
- `ELEMENT_NOT_FOUND` — Element not visible on screen
- `TIMEOUT` — Operation exceeded timeout
- `INVALID_PARAMETER` — Parameter value incorrect
- `PERMISSION_DENIED` — Permission required for operation

---

## Tool Availability by Platform

| Tool | Android | iOS |
|------|---------|-----|
| mobile_launch_app | ✓ | ✓ |
| mobile_terminate_app | ✓ | ✓ |
| mobile_install_app | ✓ | ✓ |
| mobile_uninstall_app | ✓ | ✓ |
| mobile_list_apps | ✓ | ✓ |
| mobile_take_screenshot | ✓ | ✓ |
| mobile_save_screenshot | ✓ | ✓ |
| mobile_list_elements_on_screen | ✓ | ✓ |
| mobile_click_on_screen_at_coordinates | ✓ | ✓ |
| mobile_double_tap_on_screen | ✓ | ✓ |
| mobile_long_press_on_screen_at_coordinates | ✓ | ✓ |
| mobile_type_keys | ✓ | ✓ |
| mobile_swipe_on_screen | ✓ | ✓ |
| mobile_scroll_to_element | ✓ | ✓ |
| mobile_press_button | ✓ | ✓ |
| mobile_open_url | ✓ | ✓ |
| mobile_get_orientation | ✓ | ✓ |
| mobile_set_orientation | ✓ | ✓ |
| mobile_get_screen_size | ✓ | ✓ |

All tools work on both simulators/emulators and real devices.

---

## Related References

- [Test Scenario Schema v2](schema-v2.md) — How action types map to MCP tools
- [Assertion Types](assertions.md) — Verification after tool operations
- [Test Result Schema](result-schema.md) — How tool operations are logged

[← Back to Reference Index](index.md)
