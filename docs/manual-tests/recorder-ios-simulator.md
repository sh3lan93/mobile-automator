# Manual test: recorder on iOS Simulator (slice #25)

End-to-end verification that the experimental `/mobile-automator:record` command captures interactions on a booted iOS Simulator with the same UX and same output schema as Android. The unit and integration suites cover module-level behaviour; this checklist covers the parts CI cannot reach (real device automation, Simulator-host overlays, GUI rendering, generated scenario JSON).

Run this before merging [#42](https://github.com/sh3lan93/mobile-automator/pull/42) and any time the recorder's iOS code paths change.

**Estimated time:** ~15 minutes.

---

## 0. Environment

### 0.1 Prerequisites

- [ ] `xcrun simctl list devices available` shows at least one iPhone simulator.
- [ ] `which ffmpeg` resolves to a binary on `PATH` (the sidecar shells out to `ffmpeg` for frame extraction).
- [ ] `node --version` is 18 or newer.
- [ ] You are at the root of a mobile-automator-installed test project (i.e. `mobile-automator/config.json` exists and `.gemini/skills/mobile-automator-recorder/SKILL.md` is installed). If not, run `/mobile-automator:setup` first in **platform-aware** mode (the agnostic recorder is tracked under #29 and is out of scope here).
- [ ] You have a small test app installed (or a `build_command` in config that the pre-flight can run). Apple's stock Settings app works fine for the back-navigation test if you don't have a custom build.

### 0.2 Enable "Show Single Touches"

The recorder's video tap detector picks up the macOS Simulator app's "Show Single Touches" overlay disk. Enable it once per machine:

- [ ] Run `defaults write com.apple.iphonesimulator ShowSingleTouches -bool true` (or toggle **Simulator → I/O → Show Single Touches** in the GUI). The setting persists across simulator reboots.
- [ ] Verify with `defaults read com.apple.iphonesimulator ShowSingleTouches` → expect `1`.

### 0.3 Boot a simulator

- [ ] Pick a simulator and boot it: `xcrun simctl boot "iPhone 16 Pro"` (substitute any device from your `simctl list`).
- [ ] `open -a Simulator` so the host renders the touch-indicator overlay.
- [ ] `xcrun simctl list devices booted` shows the simulator in `Booted` state.

### 0.4 Opt in to the experimental recorder

- [ ] `export MOBILE_AUTOMATOR_RECORDER=1` in the shell you'll launch Gemini from.

---

## 1. Pre-flight detects the iOS Simulator (AC: pre-flight)

### 1.1 Single-device path

- [ ] In Gemini, run `/mobile-automator:record manual_ios_smoke`.
- [ ] **Expected:** The command prints the experimental-gate confirmation, runs the ffmpeg pre-flight, then announces the booted iPhone simulator as the selected device. **No "platform unsupported" halt.**
- [ ] **Expected:** The sidecar invocation includes `--platform ios` (visible in the `Starting recorder sidecar...` announcement, which echoes the platform). If you don't see it surfaced in the user-visible copy, check `mobile-automator/.recorder/manual_ios_smoke/` was created — the sidecar started.

### 1.2 Multi-device disambiguation (optional, only if you also have an Android device connected)

- [ ] With both an Android device and an iOS Simulator booted, re-run `/mobile-automator:record manual_ios_smoke_2`.
- [ ] **Expected:** Gemini prompts you to pick a device; both are listed; selecting the iOS sim forwards `--platform ios`.

### 1.3 Pre-flight rejects unsupported platforms (negative case)

This is hard to trigger manually and is fully covered by the unit test for the sidecar's `--platform` flag rejection. Skip unless you are introducing a new platform value.

---

## 2. Video tap detector picks up the iOS Sim overlay (AC: tap detection)

After 1.1's recording started, the GUI should be open in your default browser at `localhost:<port>`. The sidecar is now streaming events.

- [ ] **Tap the centre of the iOS Simulator window** once.
- [ ] **Expected (within ~1 second):** A new step row appears in the GUI step list rendered as `Tap "<element label>"` (e.g. `Tap "Settings"` if you tapped a labelled UI element).
- [ ] **Tap an unlabelled view** (e.g. an empty area).
- [ ] **Expected:** A row labelled `Tap "unnamed_<class>"` appears (e.g. `Tap "unnamed_button"`, `Tap "unnamed_view"`). The class shortener strips the `XCUIElementType` prefix — verify you do **not** see `unnamed_xcuielementtypebutton`.
- [ ] **Long-press anywhere for ~700 ms.**
- [ ] **Expected:** A row labelled `Long press "<target>"` appears.
- [ ] **Double-tap an icon.**
- [ ] **Expected:** A row labelled `Double tap "<target>"` appears (slice #24's gesture vocabulary already wired through; verify it survives the iOS path).
- [ ] **Swipe down from the top of the screen.**
- [ ] **Expected:** A row labelled `Swipe down` (or the appropriate direction) appears.

If any tap **fails to register** despite the host-rendered indicator being clearly visible: the band may need re-tuning against your specific simulator. See "Known limitation" in the PR body.

---

## 3. Aware-mode nav-bar back is a literal `tap` (AC: no special-case logic)

- [ ] Navigate inside the app to a screen that has a navigation-bar **back** chevron (in iOS Settings: tap into any sub-page).
- [ ] **Tap the navigation-bar back button.**
- [ ] **Expected:** The GUI shows a step row `Tap "Back"` (or whatever the nav-bar back accessibility label resolves to in your app, e.g. `Tap "Settings"` if the chevron's label is the previous screen's title).
- [ ] **Expected:** The row is rendered as a `tap` action, **not** a `press_back` semantic action. Inspect the row's `data-action` attribute (DevTools → element inspector) — it should be `data-action="tap"`.

This locks in the aware-mode acceptance criterion: aware mode preserves what you actually did. Agnostic-mode `press_back` detection lands in slice #29.

---

## 4. Sensitive-input detection on iOS (AC: bonus / focus-detector traits)

If your app has a password field, or Settings has a Wi-Fi password prompt:

- [ ] **Tap a secure text field** to give it focus.
- [ ] **Type a few characters.**
- [ ] **Expected:** The step row renders `Type "•••" into "<field_label>"` (bullet-masked). The mask-on-display logic was wired in slice #35; this confirms it survives when the iOS hierarchy exposes secure-input via either:
  - The `XCUIElementTypeSecureTextField` class name, or
  - A trait on `XCUIElementTypeTextField`: `accessibility_traits: ['secureTextField']`, or
  - The boolean `secureTextEntry: true`.
- [ ] **Expected:** The literal value is **not** rendered in the step list.

Skip this section if you don't have a convenient password field — the trait/boolean detection paths are fully covered by `tests/unit/recorder/focus-detector.test.js`.

---

## 5. Save & Generate produces a schema-conformant scenario (AC: integration)

- [ ] Click **Save & Generate** in the recorder GUI.
- [ ] **Expected:** The browser surface signals "scenario saved" (or closes), the sidecar exits with status code 0, Gemini continues and the recorder skill at `.gemini/skills/mobile-automator-recorder/SKILL.md` runs.
- [ ] **Expected:** A JSON file at `mobile-automator/scenarios/manual_ios_smoke.json` is created (the skill writes it).
- [ ] Open the scenario file. **Verify:**
  - [ ] `$schema_version: "2.1"` (or the current schema version).
  - [ ] `steps[]` contains a `tap` step on the back button with the expected `target_element.display_name`.
  - [ ] **No** `press_back` semantic action exists in any step (locks in aware-mode literal-tap).
  - [ ] If you typed into a secure field: the corresponding `type` step has its sensitive flag set, but the literal value is preserved (sensitive-input caution UI / auto-templatize is slice #30 and explicitly out of scope here).
- [ ] **Expected:** `mobile-automator/.recorder/manual_ios_smoke/` is **deleted** after Save (the artifact bundle is consumed and removed; cleanup-on-Save).

---

## 6. Cleanup

- [ ] `xcrun simctl shutdown booted`.
- [ ] (Optional) Remove the test scenario: `rm mobile-automator/scenarios/manual_ios_smoke.json`.
- [ ] (Optional) Disable Show Single Touches: `defaults delete com.apple.iphonesimulator ShowSingleTouches`.

---

## Sign-off

If every box above is checked, slice #25 is verified end-to-end on this machine.

| Field | Value |
|---|---|
| Tester | _your-handle_ |
| Date | _YYYY-MM-DD_ |
| macOS version | `sw_vers -productVersion` |
| Xcode version | `xcodebuild -version` |
| Simulator used | _e.g. iPhone 16 Pro, iOS 18.4_ |
| App tested | _e.g. iOS Settings_ |
| All checks passed? | _yes / no — if no, file an issue referencing this checklist_ |

---

## Troubleshooting

**Touches not appearing in the GUI.** Verify the host-rendered overlay is actually visible: tap inside the Simulator window and look for the translucent gray disk. If it isn't visible, re-check section 0.2 — the `defaults` write must target `com.apple.iphonesimulator` and the Simulator app may need to be restarted (`killall Simulator && open -a Simulator`) to pick it up.

**Sidecar exits before recording starts.** Read the sidecar's stderr in Gemini's transcript. Common causes: ffmpeg not on PATH (re-run section 0.1), `mobile-automator/config.json` missing (re-run `/mobile-automator:setup` in platform-aware mode), or an existing `mobile-automator/.recorder/<scenario_name>/` directory from a previous interrupted run (delete it).

**Tap detected at the wrong coords.** This is the Known limitation called out in the PR — pure colour-thresholding loses fidelity at high overlay translucency. Capture a frame from `mobile-automator/.recorder/<scenario_name>/screenshots/` (or extract one from the screen-recording video file under the same directory) and attach it to the slice review for re-tuning the `ios_simulator` band.

**Step list shows `unnamed_xcuielementtypebutton` instead of `unnamed_button`.** The class-name shortener regression. File against this PR.
