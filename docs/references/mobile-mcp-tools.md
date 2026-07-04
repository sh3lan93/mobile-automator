# Mobile-MCP Tool Reference

!!! note "Internal engine — not the agent-facing API"
    The `mobile_*` tools below are the **internal mobile-mcp engine** that `mauto`
    verbs wrap. AI agents never call them directly — they drive the device only
    through `mauto` verbs (`elements`, `tap`, `type`, `swipe`, `press`,
    `screenshot`, …). The contract is **agent → `mauto` verbs → mobile-mcp engine
    → device**. This page documents the engine layer so contributors understand
    what each verb does under the hood.

This document provides the mapping between test scenario actions, the `mauto`
verbs that execute them, and the mobile-mcp engine primitives those verbs wrap.

## Tool Mapping

Each scenario action is executed by a `mauto` verb, which internally calls the
mobile-mcp engine primitive shown below:

| Scenario Action   | `mauto` Verb            | Internal mobile-mcp Engine Tool              | Description |
|-------------------|-------------------------|----------------------------------------------|-------------|
| `launch_app`      | `mauto launch`          | `mobile_launch_app`                          | Launch the app on the connected device |
| `tap`             | `mauto tap`             | `mobile_click_on_screen_at_coordinates`      | Tap on screen at specific coordinates |
| `type`            | `mauto type <text>`     | `mobile_type_keys`                           | Type text into focused input field |
| `swipe`           | `mauto swipe`           | `mobile_swipe_on_screen`                     | Swipe in a direction (up, down, left, right) |
| `press_button`    | `mauto press <button>`  | `mobile_press_button`                        | Press hardware/system buttons (back, home) |
| `wait`            | (use delay/polling)     | (use delay/polling)                          | Wait for a condition or duration |
| `open_url`        | `mauto open-url`        | `mobile_open_url`                            | Open a URL in the device browser |
| (screenshot)      | `mauto screenshot`      | `mobile_take_screenshot` / `mobile_save_screenshot` | Capture screenshot for verification |
| (find element)    | `mauto elements`        | `mobile_list_elements_on_screen`             | List all interactive elements on screen |

## Common Usage Patterns

### Finding Elements
Always use `mobile_list_elements_on_screen()` before interacting with UI elements. This returns a list of elements with their coordinates, text content, and accessibility labels.

**Never hardcode coordinates** - always derive them from element discovery.

### Waiting for Loading
Use `mobile_take_screenshot()` and `mobile_list_elements_on_screen()` in a polling loop to wait for loading indicators to disappear or for specific elements to appear.

### Screenshot Comparison
- `mobile_take_screenshot()` - Returns screenshot data directly
- `mobile_save_screenshot(path)` - Saves screenshot to specified path for later comparison

## Platform-Specific Notes

### Android
- Back button: `mobile_press_button("BACK")`
- Home button: `mobile_press_button("HOME")`
- Uses accessibility IDs and content descriptions for element targeting

### iOS
- No back button (use navigation bar back button via tap)
- Home button: `mobile_press_button("HOME")`
- Uses accessibility labels and identifiers for element targeting

## Error Handling

If a tool call fails:
1. **Element not found**: Verify the element exists using `mobile_list_elements_on_screen()`
2. **Timing issues**: Add explicit wait for loading indicators to complete
3. **Device disconnected**: Check device connection with `mobile_list_available_devices()`
4. **App crashed**: Check device logs and restart the app

## Best Practices

1. **Always verify before acting**: Call `mobile_list_elements_on_screen()` before every tap/type action
2. **Wait for stability**: Ensure loading indicators disappear before proceeding
3. **Capture evidence**: Take screenshots at every checkpoint
4. **Handle platform differences**: Account for Android vs iOS behavioral differences
5. **Use semantic targeting**: Target elements by text/label, not coordinates
