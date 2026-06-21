# Recorder live interaction capture — design

- **Date:** 2026-06-21
- **Issue:** [#103](https://github.com/sh3lan93/mobile-automator/issues/103) · **PRD:** [#21](https://github.com/sh3lan93/mobile-automator/issues/21)
- **Status:** approved design, pre-implementation

## Problem

On-device validation (Pixel 9 Pro emulator, sample-app, v0.17.0) showed the recorder's core
interaction capture is non-functional in the live path. The GUI auto-opens (#65) and the UI
hierarchy is captured (517 snapshots in a session), but **zero taps/gestures are recorded**
(`events.jsonl` = 0 bytes) and **no steps ever render in the GUI** during recording. A user taps
through their flow, sees an empty step list, and Saves an empty scenario.

This is the PRD's "best-effort, needs on-device validation" risk (Refs #69/#77), confirmed for the
first time end-to-end.

## Root cause — three distinct defects

**A. Touch detected in a batch at `stop()`, never live.**
`capture/tap-source.js:64–74` — `stop()` stops the screen recording, ffmpeg-extracts frames from the
whole-session video, then runs the detector. Nothing detects during recording → no live feedback by
design.

**B. Captured steps are never broadcast to the GUI.**
`lifecycle/mode-b.js:128–146` → `store.appendEvent()` (`artifacts.js:25`) is the only sink. The GUI
handles a `step-added` WS message (`web/app.js:223`) but no server code ever broadcasts it.

**C. Teardown drops end-of-session detection.**
`mode-b.js:173–193` — `finish()` runs `classifier.flush()` / `typeBuffer.flush()` then fires
`tapSource.stop()` un-awaited, then `resolveExit(code)`. The async detection in `stop()` cannot
complete before the process exits.

## Design

Unified live `tap` event shape (unchanged): `{ t, kind: 'down'|'move'|'up', x, y }`.

### Component 1 — Platform tap sources

**`capture/getevent-tap-source.js`** (new, Android). Spawns `adb shell getevent -lt`; parses
`EV_ABS ABS_MT_POSITION_X/Y`, `EV_KEY BTN_TOUCH`, `EV_SYN SYN_REPORT`; emits live down/move/up.
Coordinates are raw input-device values — scale to screen pixels using ABS axis maxima
(`adb shell getevent -lp`) and `adb shell wm size`, computed once at start. The stream also carries
hardware keys (BACK/HOME/VOLUME via `EV_KEY KEY_*`), so the source emits those too — closing the
never-wired key-capture gap. Best-effort and self-disabling if `adb` is missing (mirror
`adb-getevent.js`).

**`capture/screenshot-tap-source.js`** (new, iOS Simulator). Polls `xcrun simctl io <udid>
screenshot` at ~8 fps; feeds each PNG to the streaming detector (Component 2). No ffmpeg, no segment
gaps. May miss very fast taps (accepted).

### Component 2 — Streaming detector (refactor `capture/video-tap-detector.js`)

Add `feed(frame)` that persists active-touch state across calls (today `processFrames` resets
`active` between calls). The iOS source drives it frame-by-frame. Keep `extractFrames` /
`processFrames` for back-compat and existing tests.

### Component 3 — Live broadcast (fixes defect B), `lifecycle/mode-b.js`

Where `classifier.emit` / `typeBuffer.emit` call `store.appendEvent(ev)`, also
`wsCtx.broadcast({ type: 'step-added', step })`. `store` assigns the step index/id and returns the
stored record to broadcast. The GUI already renders `step-added` (`web/app.js:223`).

### Component 4 — Teardown ordering (fixes defect C), `lifecycle/mode-b.js`

Make `finish()` async: `await tapSource.stop()` (so the final `up`/gesture is processed) → then
`classifier.flush()` / `typeBuffer.flush()` → then `resolveExit(code)`. Thread async through
`finish()`'s callers (save/cancel/onDone). With live detection there is no heavy batch at stop, so
this is cheap and correct.

### Component 5 — Platform selection, `lifecycle/mode-b.js`

Select the source by `platform` (`android` → getevent, `ios` → screenshot). Preserve
`deps.tapSource` / `deps.createTapSource` injection so the unit suite stays device-free. Retire the
batch video path from the Android live path.

## Scope boundaries (YAGNI)

- Single-touch only; no multitouch slots (pinch/rotate already out of PRD scope).
- getevent requires `adb` (already a hard dep); iOS requires `simctl`.
- iOS screenshot fps may miss very fast taps.

## Slice plan (independently verifiable)

1. **Defect B** — live `step-added` broadcast. Cheapest, platform-agnostic, unit-verifiable; makes
   captured steps render live.
2. **Android** getevent tap source + coord scaling + platform selection. On-device validate (Pixel).
3. **iOS** screenshot tap source + streaming detector `feed()`. On-device validate (iPhone sim).
4. **Defect C** — async teardown ordering.

## Verification

- **Unit (existing seams):** getevent `EV_ABS` parser + coordinate scaling; streaming `feed()` state
  machine; broadcast-on-`appendEvent`; `finish()` ordering (stop awaited before flush).
- **On-device:** re-run the Pixel validation (drive taps → `events.jsonl` fills AND `step-added`
  broadcasts) + an iPhone-sim run.

## Risks

- getevent coordinate scaling is device-dependent (ABS ranges); validate on real hardware.
- iOS screenshot latency vs. missed fast taps.
- Retiring the Android video path removes ffmpeg/color-calibration/"Show taps" dependencies — fewer
  moving parts, but the getevent path is new and unproven on physical devices.
