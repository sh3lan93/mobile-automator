# Manual test: recorder on Android (live capture, #103)

End-to-end verification that `mauto record` captures interactions on a real Android
emulator/device and renders them in the GUI **live**, producing a schema-conformant
scenario. The unit and integration suites cover module-level behaviour with faked device
I/O; this checklist covers what CI cannot reach (real `/dev/input` touch capture, getevent
line-format parsing, coordinate scaling onto real elements, GUI rendering, generated JSON).

Run this before merging [#104](https://github.com/sh3lan93/mobile-automator/pull/104) and
any time the recorder's Android code paths change.

> **Android capture differs from iOS.** This branch captures Android touches from
> `adb shell getevent -lt` (raw `/dev/input` events) — **not** from a screen-recording
> overlay. So there is **no "Show taps" requirement and no `ffmpeg` dependency** for the
> Android path. The trade-off: a captured touch must originate from the touchscreen, so
> `adb shell input tap` does **not** work for this test (it injects above `/dev/input`).
> See §2 for the two ways to drive real touches.

**Estimated time:** ~15 minutes.

---

## 0. Environment

### 0.1 Prerequisites

- [ ] `adb devices` lists a connected emulator or device in `device` state.
- [ ] `which adb` resolves on `PATH` (the sidecar spawns `adb shell getevent -lt`).
- [ ] `node --version` is 18 or newer.
- [ ] This branch (`recorder/103-live-capture`) is checked out and deps are installed
      (`npm install` at repo root). Run the CLI straight from the checkout:
      ```bash
      MAUTO="node /ABSOLUTE/PATH/TO/mobile-automator/bin/mauto.js"
      # …or `npm link` in the checkout to expose `mauto` on PATH.
      ```
- [ ] A test app is installed. This guide uses the in-repo Flutter fixture at `sample-app/`
      (package `io.github.sh3lan93.mobile_automator.sample_shop`). Any app with labelled
      controls works.

> `ffmpeg` is **not** required for the Android getevent path on this branch.

### 0.2 Boot an emulator

- [ ] Boot any AVD:
      ```bash
      "$HOME/Library/Android/sdk/emulator/emulator" -avd <YOUR_AVD> -no-snapshot-load &
      adb wait-for-device
      until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1 ]; do sleep 2; done
      ```
- [ ] `adb devices` shows it as `device`.

### 0.3 Install + launch the test app

- [ ] Build (once) and install the sample app:
      ```bash
      ( cd sample-app && flutter build apk --debug )       # if not already built
      adb install -r -g sample-app/build/app/outputs/flutter-apk/app-debug.apk
      adb shell monkey -p io.github.sh3lan93.mobile_automator.sample_shop \
        -c android.intent.category.LAUNCHER 1
      ```
- [ ] The "Sample Shop" product grid is visible.
- [ ] Add the app package to the workspace config so crash/lifecycle wiring resolves:
      `sample-app/mobile-automator/config.json` → add
      `"app_package": "io.github.sh3lan93.mobile_automator.sample_shop"`.

### 0.4 Decide your touch-injection method (read §2 first)

- [ ] **Production / Google-Play AVD** (`adb root` → `adbd cannot run as root`): you will
      tap the **emulator window by hand** (§2, Option A).
- [ ] **userdebug / rootable AVD or device:** you can drive touches with `sendevent`
      (§2, Option B) for a fully scripted run.

---

## 1. The recorder starts and the GUI auto-opens (AC: launch)

- [ ] From the workspace, start a recording:
      ```bash
      cd sample-app
      $MAUTO record manual_android_smoke --platform android
      ```
- [ ] **Expected (stderr):**
      ```
      🌐 Recorder GUI: http://127.0.0.1:<port>/
      mobile-mcp server running on stdio
      ```
- [ ] **Expected:** your default browser **auto-opens** to that URL showing the recorder GUI
      (title "Mobile Automator Recorder").
- [ ] **Expected:** the getevent stream is live — `adb shell ps -A | grep getevent` shows a
      `getevent` process.
- [ ] **Expected:** `sample-app/mobile-automator/.recorder/manual_android_smoke/` exists and
      `hierarchy/` is accumulating snapshots (`ls .../hierarchy | wc -l` grows over time).

---

## 2. Touch + gesture capture (AC: live capture)

Drive **real** touches one of two ways. Watch the GUI step list update **live** as you go.

**Option A — human tap (works on any AVD/device).** Tap directly in the emulator window.

**Option B — `sendevent` (userdebug/rootable only).** A tap on the virtio touchscreen
(`adb shell getevent -lp` shows ABS max `32767`; scale raw = `screen_px * 32768 / screen_dim`,
screen size from `adb shell wm size`):
```bash
adb root
D=/dev/input/event1   # the virtio_input_multi_touch device from getevent -lp
# tap near screen (320,1150) on a 1280x2856 panel -> raw (8192,13195):
adb shell "sendevent $D 3 57 0; sendevent $D 3 53 8192; sendevent $D 3 54 13195; \
           sendevent $D 1 330 1; sendevent $D 0 0 0; \
           sendevent $D 3 57 4294967295; sendevent $D 1 330 0; sendevent $D 0 0 0"
```

Now exercise the gesture vocabulary:

- [ ] **Tap a labelled product** (e.g. *Wireless Earbuds*).
- [ ] **Expected (within ~1 s):** a step row `Tap "Wireless Earbuds"` appears **live**.
- [ ] **Tap an unlabelled area.**
- [ ] **Expected:** a row rendered as unnamed (`Tap "…"` flagged unnamed) — confirm the step
      did **not** resolve a bogus label.
- [ ] **Long-press a product for ~700 ms.**
- [ ] **Expected:** a row `Long press "<target>"`.
- [ ] **Double-tap a product.**
- [ ] **Expected:** a row `Double tap "<target>"`.
- [ ] **Swipe up on the product grid.**
- [ ] **Expected:** a row `Swipe up` (no target span).

If a touch is clearly delivered to the app but **no row appears**, the device's `getevent`
line format or coordinate scaling may be off — see Troubleshooting.

---

## 3. Hardware BACK key is captured (AC: getevent key capture)

This branch also captures hardware keys from the same getevent stream (new behaviour).

- [ ] Navigate into a product detail screen, then **press the hardware BACK button**
      (emulator side toolbar ⟵, or `adb shell input keyevent 4` does **not** count — it
      bypasses `/dev/input`; use the emulator's BACK control / a real device's key, or
      `sendevent` a `KEY_BACK` on the `gpio-keys` device on a rootable AVD).
- [ ] **Expected (agnostic workspace — the sample-app default):** the step is recorded as a
      `press_back` semantic action (the sample-app config `mode` is `platform-agnostic`).
- [ ] **Expected (aware workspace):** the step is recorded as a literal back/key press, not a
      semantic action. (Check the workspace `config.json` `mode` to know which to expect.)

---

## 4. Sensitive-input masking (AC: bonus — optional)

The sample shop has no password field; skip unless your test app has a secure input. If it
does:

- [ ] **Tap a password field**, then **type a few characters** on the on-screen keyboard.
- [ ] **Expected:** the row renders `Type "•••" into "<field_label>"` (bullet-masked); the
      literal value is **not** shown in the step list.

The Android secure-input detection paths are covered by
`tests/unit/recorder/focus-detector.test.js`.

---

## 5. Save & Generate produces a schema-conformant scenario (AC: integration)

- [ ] Before Save, confirm capture actually happened:
      ```bash
      BD=sample-app/mobile-automator/.recorder/manual_android_smoke
      wc -c "$BD/events.jsonl"   # MUST be > 0
      cat "$BD/events.jsonl"
      ```
- [ ] **Verify:** each captured `tap` has a `target` that matches the element you tapped
      (e.g. a product name) — **not** `*_unknown`. This is the proof that raw→screen
      coordinate scaling is correct.
- [ ] Click **Save & Generate** in the recorder GUI.
- [ ] **Expected:** the GUI signals saved, the sidecar exits with status 0, and the recorder
      guide flow (`mauto guide record`) synthesises the scenario.
- [ ] **Expected:** `mobile-automator/scenarios/manual_android_smoke.json` is created.
- [ ] Open it and **verify:**
  - [ ] `schema_version` is `2.1` (or current).
  - [ ] `steps[]` contains the taps you performed with the expected `target_element.display_name`.
  - [ ] **No** `resource-id` / OS-specific element ids appear anywhere (platform-agnostic invariant).
  - [ ] If the workspace is agnostic and you pressed BACK: a `press_back` step exists.
- [ ] **Expected:** `mobile-automator/.recorder/manual_android_smoke/` is **deleted** after
      Save (the artifact bundle is consumed).

---

## 6. Cleanup

- [ ] Stop the recorder if still running: `pkill -f "bin/mauto.js record" ; pkill -f mobile-mcp`.
- [ ] `rm -rf sample-app/mobile-automator/.recorder/manual_android_smoke`.
- [ ] (Optional) `rm sample-app/mobile-automator/scenarios/manual_android_smoke.json`.
- [ ] (Optional) revert the `app_package` edit in `sample-app/mobile-automator/config.json`.
- [ ] (Optional) `adb emu kill` to shut the emulator down.

---

## Sign-off

If every box above is checked, the Android live-capture path is verified end-to-end on this
machine.

| Field | Value |
|---|---|
| Tester | _your-handle_ |
| Date | _YYYY-MM-DD_ |
| Host OS | `sw_vers -productVersion` (macOS) / `uname -a` |
| Device | _e.g. Pixel_9_Pro AVD, API 35_ · production or userdebug |
| Touch method | _human tap / sendevent_ |
| App tested | _e.g. sample-app sample_shop_ |
| All checks passed? | _yes / no — if no, file an issue referencing this checklist_ |

---

## Troubleshooting

**`events.jsonl` stays 0 bytes after `adb shell input tap`.** Expected — `input tap` injects
at the InputManager layer, above `/dev/input`, so `getevent` never sees it. Use a **human
tap** in the emulator window or `sendevent` (§2).

**`sendevent: /dev/input/eventN: Permission denied`.** The AVD is a production (Google-Play)
build with no root (`adb root` → `adbd cannot run as root`). Use a **human tap**, or recreate
a **userdebug** AVD / use a rootable device.

**Taps captured but every `target` is `*_unknown`.** Coordinate scaling is off — the raw
getevent coordinate range doesn't match the screen. Compare `adb shell getevent -lp`
(`ABS_MT_POSITION_X/Y` `max`) against `adb shell wm size`; `android-scale.js` derives
`scale = screen / (absMax + 1)`. Capture the raw lines (`adb shell getevent -lt` in a
separate shell while tapping) and attach them to the PR if the format looks unusual.

**No `getevent` process on the device.** `adb` isn't on `PATH` for the sidecar, or the device
went offline. Confirm `adb devices` and re-launch.

**GUI never opens / no URL printed.** You're not running this branch's `bin/mauto.js`, or the
sidecar failed to start — read the recorder stderr.

**Sidecar exits before recording starts.** Common causes: `mobile-automator/config.json`
missing (run `mauto setup`), or a leftover `mobile-automator/.recorder/<name>/` from an
interrupted run (delete it).
