'use strict';

// Integration test: live tap capture against a real running device.
//
// This is the test that proves the v0.12.0 soft-launch gate
// (`MOBILE_AUTOMATOR_RECORDER=1`) can come off — it exercises the full
// chain end-to-end: pre-flight → sidecar → `adb exec-out screenrecord` /
// `xcrun simctl io booted recordVideo` → ffmpeg → PngFramer →
// StreamingVideoTapDetector → GestureClassifier → store.appendEvent.
//
// It is intentionally SKIPPED until the sample-app fixture is far enough
// along to give CI a reproducible target. See PRD #44 (sample-app) slice 2
// for the Android emulator runner; slice 3 covers the iOS Simulator.
//
// When the skip is removed, the test should:
//
//   1. Launch the recorder against the sample-app installed on the
//      connected emulator (Android) or booted Simulator (iOS) via
//      `startLiveCapture({ projectRoot, scenarioId, platform, mode: 'b' })`.
//   2. Drive a known interaction with `mobile_click_on_screen_at_coordinates`
//      against a fixture button whose hierarchy entry has a stable
//      `display_name`.
//   3. Wait up to ~3s for a `tap` event with the expected step_id to land
//      in the artifact store (events.jsonl).
//   4. Send a `save` WebSocket message and assert exit code 0.
//   5. Assert the emitted scenario JSON validates against
//      `templates/mobile-automator-generator/references/scenario_schema.json`
//      and contains exactly one `tap` step.
//   6. Repeat on the other platform (iOS Simulator) so cross-platform
//      capture is covered by a single integration boundary.

describe.skip('live tap capture against sample-app (blocked on sample-app PRD #44 slice 2)', () => {
  test('Android emulator: tapping the login button produces a tap event with the resolved target', async () => {
    // TODO: enable when sample-app PRD #44 slice 2 lands an emulator runner.
    // See file header for the test shape.
  });

  test('iOS Simulator: tapping the login button produces a tap event with the resolved target', async () => {
    // TODO: enable when sample-app PRD #44 slice 3 lands a Simulator runner.
  });
});
