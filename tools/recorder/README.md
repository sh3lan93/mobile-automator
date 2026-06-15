# Recorder sidecar

Sidecar process that drives the recorder GUI and captures device interactions for the experimental `/mobile-automator:record` command. The sidecar is invoked by `commands/mobile-automator/record.toml` after pre-flight (config, environment, device, app install) succeeds.

The recorder feature is being built incrementally per [PRD #21](https://github.com/sh3lan93/mobile-automator/issues/21) and is gated behind the `MOBILE_AUTOMATOR_RECORDER=1` environment variable until graduation.

## Supported targets

| Target | Status | Notes |
|---|---|---|
| Android emulator | Supported | Captures via `mobile_start_screen_recording` + visible-touch indicator + UI hierarchy polling. |
| Android physical device | Supported | Same capture pipeline as emulator; hardware keys captured via `adb getevent`. |
| iOS Simulator | Supported | Captures via screen recording + "Show Single Touches" overlay + UI hierarchy polling. |
| iOS physical device | **Not supported** | Apple does not expose a touch event stream to processes outside the app's own sandbox. Out of scope per PRD. |

## Recording on iOS Simulator

The recorder works against a booted iOS Simulator with the same UX and same output schema as Android. A few iOS-specific notes:

### Prerequisite: enable "Show Single Touches"

The iOS Simulator's macOS host app draws a translucent gray disk wherever a touch lands — the recorder's video tap detector picks up that disk. Enable it before recording:

- **Simulator menu → I/O → Show Single Touches** (toggle on)

This is a Simulator-app preference (`com.apple.iphonesimulator` defaults key `ShowSingleTouches`), not a device setting — the indicator is rendered by the macOS host on top of the iOS guest screen and survives device reboots.

### Launching the recorder

```bash
# Boot a simulator (any iPhone or iPad will do)
xcrun simctl boot "iPhone 16 Pro"
open -a Simulator

# Opt in to the experimental recorder
export MOBILE_AUTOMATOR_RECORDER=1

# Record a scenario — the pre-flight will detect the booted simulator
gemini  # then: /mobile-automator:record my_scenario_name
```

The pre-flight reads the device's `os` field returned by `mobile_list_available_devices()`, lowercases it, and forwards `--platform=ios` to the sidecar. The sidecar uses that to pick the iOS-tuned video tap-detector colour profile (`ios_simulator`, calibrated to the Simulator's mid-grey indicator) instead of the Android cyan-circle profile.

### Limitations on iOS

- **No hardware keys.** iOS has no equivalent to Android's `BACK` / `HOME` button stream; the recorder cannot capture key events on iOS.
- **Aware-mode back navigation = literal tap.** When you tap the navigation-bar back chevron, the recorder captures it as a regular `tap` step on the button (named via `accessibility_label`, e.g. `tap "Back"`) — not a special-cased `press_back` semantic action. This is intentional: aware mode preserves what you actually did.
- **Multi-touch gestures (pinch, rotate) not supported.** The single-touch indicator can only show one touch at a time. Same limitation on Android.
- **Mode B only.** The instrumentation-SDK Mode C3 protocol contract ships in v1.0; the iOS Swift Package SDK is v1.1 work.

## Capture-pipeline internals

The sidecar coordinates several deep modules under `src/`:

| Module | Responsibility |
|---|---|
| `capture/mobile-mcp-bridge.js` | Wraps mobile-mcp tool calls (screen recording, screenshots, hierarchy listing). |
| `capture/hierarchy-poller.js` | Polls `mobile_list_elements_on_screen` on a timer, retains a ring buffer for temporal lookup. |
| `capture/element-resolver.js` | Resolves a `(snapshot, x, y)` to a display name. Handles Android (`android.widget.*`, `resource_id`) and iOS (`XCUIElementType*`, `accessibility_label`, `accessibility_traits`) hierarchy shapes. |
| `capture/focus-detector.js` | Identifies the focused input field and whether it is sensitive (Android `inputType=textPassword`, iOS `XCUIElementTypeSecureTextField` class, iOS `accessibility_traits` containing `secureTextField`, iOS `secureTextEntry: true` boolean). |
| `capture/video-tap-detector.js` | Scans extracted video frames for the visible-touch indicator. Android uses the `light_blue` colour profile; iOS Simulator uses `ios_simulator` (mid-grey, low channel-delta). |
| `capture/keyboard-region.js` | Identifies whether a tap landed inside the on-screen keyboard subtree. Android-only for now; iOS keyboard region detection is deferred. |
| `coalesce/gesture-classifier.js` | Coalesces raw down/move/up events into the v1 gesture vocabulary (tap, long-press, double-tap, swipe). |
| `coalesce/type-buffer.js` | Coalesces sequential keyboard taps into a single `type` event when focus leaves the field, on Enter, on silence-timeout, or at session end. |
| `server/http-server.js` | Serves the recorder GUI over HTTP. Exposes `GET /api/mode` returning `{ mode, allow_sensitive_input }` (slice #9). |
| `server/ws-protocol.js` | Streams events to the GUI and receives Save/Cancel commands. |

## Sensitive input handling (slice #9)

When `capture/focus-detector.js` flags a focused field as sensitive, `coalesce/type-buffer.js` carries `sensitive: true` through to the emitted `type` event. The GUI then:

1. **Masks** the value in the step list with bullet characters (`web/app.js` render path, slice #35).
2. **Tracks** the step in an in-memory `Map<step_id, dirty:boolean>` and renders a ⚠ `.caution` span between the value and `into` spans.
3. **Gates Save**: on `#btn-save` click, counts entries where `dirty === true`. If non-zero (and `_allowSensitiveInput` is false), renders `#save-sensitive-confirm` inline in `<footer>` instead of sending `{type:'save'}`.
4. **Clears on edit**: `applyValueEdited` flips the dirty flag to `false` and removes the caution span. This is **intent-based** — the act of opening edit-value is the user's affirmation, independent of whether the new string differs from the captured literal. Edit-then-retype-the-same-literal still clears the caution.

`--allow-sensitive-input` (CLI flag declared in `src/index.js`, forwarded by `commands/mobile-automator/record.toml`) reaches the GUI via the `/api/mode` payload's `allow_sensitive_input` boolean and suppresses both the dirty-tracking AND the inline confirmation. The bullet-masking from slice #35 still applies — that's an orthogonal "never render the literal in the DOM" guarantee.

The `${env.VAR}` syntax users typically substitute is a **runtime convention enforced by the executor**, not a schema construct. The recorder neither validates nor resolves it.

Test fixtures live under `tests/fixtures/recorder/`:

- `video-frames/{light_blue,ios_simulator}-*.png` — synthetic frames for colour-profile detection.
- `video-frames/ios-real-touch.png` — calibrated against a real `xcrun simctl io booted screenshot` (regenerate via `scripts/fixtures/capture-ios-real-touch.sh`).
- `scripted-session*.json` — scripted-session inputs for the capture-pipeline integration test.
- `sample-bundle/` — end-to-end artifact bundle for the AI-skill ingestion test.

## Failure modes (slice #10)

Three policies guard the recording apparatus. All three watchdogs live under `tools/recorder/src/failure/` and report into a single orchestrator (`failure/orchestrator.js`) that owns every side effect.

| Failure | Detected by | Exit code | What the user sees |
|---|---|---|---|
| Device disconnect | 3 consecutive `mobile_list_elements_on_screen` / `mobile_take_screenshot` failures within 5s | `2` | Red non-dismissible banner in the GUI naming the device; CLI prints `device '<label>' disconnected — rerun /mobile-automator:record`. |
| App crash | `mobile_get_crash` returns a `{ log: ... }` payload (polled every 5s) | depends on user choice | Sticky modal with three buttons: **Relaunch** / **Save partial** / **Discard**. |
| Browser disconnect (close tab / network drop) | Last WS client gone + 60s no-reconnect | `130` (treated as cancel) | None — the GUI is gone by definition. |

Device-disconnect and browser-disconnect both run `cleanupOnCancel` and delete the in-bundle artifact tree under `mobile-automator/.recorder/<scenario_id>/`.

### Crash log persistence

Whenever a crash is detected, the log body is written **twice**:

1. `mobile-automator/.recorder/<scenario_id>/crashes/<ts>.log` — in-bundle. Goes with the bundle on Save partial; deleted by `cleanupOnCancel` on Discard.
2. `mobile-automator/crash-logs/<scenario_id>-<ts>.log` — **persistent**. Lives outside the recording bundle so it survives both `cleanupOnCancel` and `cleanupOnSuccess`. The path is gitignored.

The three crash-choice options:

- **Relaunch and resume** — calls `mobile_launch_app(<appPackage>)`. On success the recorder inserts a synthetic `launch_app` event into `events.jsonl` with `expected_state: "app relaunched after crash; see crash-logs/<basename>"`, then resumes the hierarchy poller and re-arms the crash watchdog. If the launch itself fails, the GUI shows `app-relaunch-failed` and the orchestrator falls through to Discard.
- **Save partial** — broadcasts `save-partial-ready` and hands off to the normal save flow with whatever steps were captured pre-crash. Both crash-log copies are preserved.
- **Discard** — deletes the recording bundle but leaves the persistent log behind for inspection.

The watchdogs themselves are pure state machines — they never call `process.exit`, never touch the artifact store, never broadcast. All policy lives in the orchestrator so the wiring is auditable in one place. The live `index.js` lifecycle doesn't host the orchestrator yet; the integration test at `tests/integration/recorder/failure-modes.test.js` drives the same plumbing the eventual lifecycle will adopt.

## See also

- `mauto guide record` — reasoning floor for AI synthesis of the captured timeline at Save time.
- `docs/references/platform-resolutions.md` — semantic-action resolutions used by the agnostic capture path.
- `docs/superpowers/plans/2026-05-05-mobile-automator-recording.md` — phased build plan.
