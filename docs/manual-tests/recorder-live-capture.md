# Manual test — recorder live interaction capture (#103)

End-to-end verification that `mauto record` **captures taps/gestures live** on a real
device and shows them in the GUI as they happen. The unit suite (`npx jest`) proves the
parser / scaling / broadcast / teardown logic with faked device I/O — it can **not**
exercise a real device. This checklist covers exactly that gap.

Branch under test: `recorder/103-live-capture` (PR #104).

## What this proves (and why it must be manual)

A genuine touch must originate from the device touchscreen and reach `/dev/input` — that
is what Android `getevent` reads. Two things only a real device can confirm:

1. This device's actual `getevent -lt` line format parses correctly into taps.
2. The raw→screen-pixel coordinate scaling lands the tap on the **right UI element**
   (resolved `target`, not `*_unknown`).

> ⚠️ `adb shell input tap` does **not** work for this test — it injects above `/dev/input`
> (InputManager level), so `getevent` never sees it. You need either a **human tap in the
> emulator window** or a **rootable (userdebug) AVD** where you can `sendevent` raw events.

## Prerequisites

- Node ≥ 18, repo deps installed (`npm install` at repo root).
- `ffmpeg` and `adb` on `PATH` (`which ffmpeg adb`). iOS also needs Xcode `xcrun simctl`.
- A target: an Android emulator/device, and/or a booted iOS Simulator.
- This branch checked out. Run the CLI straight from the checkout:
  ```bash
  # from anywhere, point node at this checkout's bin:
  MAUTO="node /ABSOLUTE/PATH/TO/mobile-automator/bin/mauto.js"
  # …or `npm link` in the checkout to expose `mauto` on PATH.
  ```

## 0. Fast automated gate (no device)

```bash
npx jest tests/unit/recorder      # recorder unit suite (parser, scaling, broadcast, teardown)
npm run lint:guides               # prose/guide lint guards
npx jest                          # full suite
```
Expected: all green. This validates the logic but **not** real-device capture — continue below.

---

## 1. Android end-to-end (the real validation)

Uses the in-repo Flutter fixture at `sample-app/` (package
`io.github.sh3lan93.mobile_automator.sample_shop`).

### 1.1 Boot + install

```bash
# boot an emulator (any AVD)
"$HOME/Library/Android/sdk/emulator/emulator" -avd <YOUR_AVD> -no-snapshot-load &
adb wait-for-device
until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = 1 ]; do sleep 2; done

# build (once) + install + launch the sample app
( cd sample-app && flutter build apk --debug )   # if not already built
adb install -r -g sample-app/build/app/outputs/flutter-apk/app-debug.apk
adb shell monkey -p io.github.sh3lan93.mobile_automator.sample_shop -c android.intent.category.LAUNCHER 1
```

Set the app package in the sample-app workspace config (so crash/lifecycle wiring resolves):
```bash
# sample-app/mobile-automator/config.json -> add "app_package": "io.github.sh3lan93.mobile_automator.sample_shop"
```

### 1.2 Record

```bash
cd sample-app
$MAUTO record smoke_android --platform android
```

Expected on start (stderr):
```
🌐 Recorder GUI: http://127.0.0.1:<port>/
mobile-mcp server running on stdio
```
The browser GUI **auto-opens** to that URL. The recorder spawns `adb shell getevent -lt`
(confirm: `adb shell ps -A | grep getevent` shows one process).

### 1.3 Drive real touches

**Option A — human tap (works on any device, incl. production AVDs).**
Tap 3 products in the **emulator window** (e.g. *Wireless Earbuds*, *Smart Watch*,
*Bluetooth Speaker*). Each tap should make a step row appear **live** in the GUI within a
beat.

**Option B — `sendevent` (only on a rootable/userdebug AVD).** A production
(Google-Play) image returns `adbd cannot run as root` — use Option A there. On a userdebug
image:
```bash
adb root
# touch device + ABS range from: adb shell getevent -lp   (virtio max is 32767)
# raw = screen_px * 32768 / screen_dim   (screen size: adb shell wm size)
# example tap near screen (320,1150) on a 1280x2856 panel -> raw (8192,13195):
D=/dev/input/event1
adb shell "sendevent $D 3 57 0; sendevent $D 3 53 8192; sendevent $D 3 54 13195; \
           sendevent $D 1 330 1; sendevent $D 0 0 0; \
           sendevent $D 3 57 4294967295; sendevent $D 1 330 0; sendevent $D 0 0 0"
```

### 1.4 Save + verify

- Click **Save & Generate** in the GUI.
- Verify the captured events before/after save:
  ```bash
  BD=sample-app/mobile-automator/.recorder/smoke_android
  wc -c "$BD/events.jsonl"     # MUST be > 0
  cat "$BD/events.jsonl"
  ```

**PASS criteria:**
- [ ] GUI auto-opened at the printed URL.
- [ ] Step rows appeared **live** while tapping (not only after Save).
- [ ] `events.jsonl` is **non-empty** with one `tap` per touch.
- [ ] Each tap's `target` resolves to the tapped element's label (e.g. a product name) —
      **not** `*_unknown`. (Confirms coordinate scaling is correct.)
- [ ] On Save, a scenario JSON is produced (per the recorder guide flow).

---

## 2. iOS Simulator end-to-end

```bash
xcrun simctl boot "iPhone 16 Pro" && open -a Simulator
# build + install + launch the iOS sample app (see sample-app build docs)
cd sample-app
$MAUTO record smoke_ios --platform ios
```
- GUI auto-opens. iOS uses `simctl io screenshot` polling (~8 fps), so live steps may lag
  ≤ ~1 frame interval.
- Tap 3 elements in the Simulator, **Save**.
- Verify `sample-app/mobile-automator/.recorder/smoke_ios/events.jsonl` is non-empty with
  sensible targets.

> iOS detection relies on the on-screen touch indicator. Enable
> **Simulator → I/O → Show Single Touches** before recording.

---

## Troubleshooting

| Symptom | Likely cause |
|---|---|
| GUI never opens / no URL line | Wrong `bin/mauto.js` path, or not on this branch. |
| `events.jsonl` stays 0 bytes after `input tap` | `input tap` bypasses `/dev/input` — use a **human tap** or `sendevent`. |
| `sendevent: Permission denied` | Production AVD (no root). Use a human tap or a userdebug AVD. |
| Taps captured but `target` is `*_unknown` | Coordinate scaling off — check `getevent -lp` ABS max vs `wm size` (Android `android-scale.js`). |
| No `getevent` process on device | `adb` not on PATH for the sidecar, or device offline. |
| Live steps lag a lot (iOS) | Expected with screenshot polling; very fast taps may be missed. |

## Cleanup

```bash
pkill -f "bin/mauto.js record" ; pkill -f mobile-mcp
rm -rf sample-app/mobile-automator/.recorder/smoke_android sample-app/mobile-automator/.recorder/smoke_ios
# revert the app_package edit to sample-app/mobile-automator/config.json if you don't want to keep it
```
