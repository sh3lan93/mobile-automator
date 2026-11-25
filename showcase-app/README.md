# Reel Tracker (showcase app)

A small Compose Multiplatform movie tracker for Android and iOS, built on [TMDB](https://www.themoviedb.org). It sits beside the Sample Shop fixture in `sample-app/`: Sample Shop is the deterministic target the CI E2E drives, while this app shows mauto driving a real cross-platform app with live data, one scenario for both platforms. PRD: https://github.com/sh3lan93/mobile-automator/issues/304

The [walkthrough](#walkthrough) below goes from a fresh clone to replaying a shipped scenario on Android and iOS, then recording a flow of your own and replaying it on the other platform. The reference sections after it describe the scenarios and the app's test hooks.

## No UI test code

The app has no UI test code by design: no Espresso, no XCUITest, no Compose UI tests, and no UI test dependency or source set. Its on-device behaviour is checked only by the JSON scenarios in `scenarios/`, which target what a person sees (on-screen text and accessibility labels), never a test tag.

You can check it yourself. From `showcase-app/`, both of these print nothing:

```bash
grep -rniE 'espresso|androidx\.test|ui-test|uiTest|xcuitest|UITests' \
  --include='*.kts' --include='*.toml' --include='*.pbxproj' .
find . -type d \( -name androidTest -o -name androidInstrumentedTest -o -name '*UITests' \) -not -path '*/build/*'
```

`tests/lint/showcase-scenarios.test.js` fails the build if a UI test dependency or source set is added.

## Walkthrough

### 1. Clone and add your TMDB key

```bash
git clone https://github.com/sh3lan93/mobile-automator
cd mobile-automator/showcase-app
```

The app calls TMDB with your own free key; no key is committed.

1. Create a TMDB account and request a v3 API key at https://www.themoviedb.org/settings/api.
2. Copy `tmdb.properties.example` to `tmdb.properties` (git-ignored) and paste the key after `TMDB_API_KEY=`.

Without a key the app opens on an "Add your TMDB key" screen; a key TMDB rejects gets its own message.

### 2. Build and install on an emulator and a simulator

Requires JDK 17 and the Android SDK; the iOS build also needs Xcode. Run from `showcase-app/`.

Gradle needs to know where the Android SDK is. Either export `ANDROID_HOME`, or create `showcase-app/local.properties` (git-ignored) with one line:

```properties
sdk.dir=/path/to/Android/sdk
```

Without one of them the build fails with "SDK location not found".

Android (a booted emulator):

```bash
./gradlew :androidApp:installDebug
```

iOS (a booted simulator, Apple-silicon Mac):

```bash
xcodebuild -project iosApp/iosApp.xcodeproj -scheme iosApp -configuration Debug \
  -sdk iphonesimulator -derivedDataPath build/ios CODE_SIGNING_ALLOWED=NO build
xcrun simctl install booted "build/ios/Build/Products/Debug-iphonesimulator/Reel Tracker.app"
```

Unit tests (non-UI logic only):

```bash
./gradlew :shared:testAndroidHostTest :shared:iosSimulatorArm64Test
```

### 3. Install mauto and create a workspace

```bash
npm i -g mobile-automator
```

Then, still in `showcase-app/`:

```bash
mauto init --agent claude      # or: cursor | gemini | copilot | agents
mauto setup --mode agnostic
mauto devices
```

`mauto init` installs the skills and commands your agent uses to record scenarios (step 6). `mauto setup --mode agnostic` creates the workspace `showcase-app/.mobile-automator/`, which holds your config, recorded scenarios, results and screenshots. `showcase-app/.gitignore` keeps it out of git. `mauto devices` lists the booted emulator and simulator with their ids; you pass an id to `--device` below.

The default device engine works for this app. Switch to the legacy engine only if `mauto elements` on a screen shows a missing label or content from a screen that is not on display:

```bash
mauto config set engine legacy
```

The setup guide may suggest legacy more often than this app needs it (#379).

### 4. Replay a shipped scenario on Android

```bash
mauto run scenarios/browse_popular.json --device <android-id>
```

Use the emulator's id from `mauto devices`, for example `emulator-5554`.

No agent is involved: `mauto run` replays the scenario by itself and prints one JSON envelope. In it:

- `data.status` is `passed`, `failed` or `incomplete`.
- The exit code is 0 when the run passed, 6 when a check failed (`test_failed`), and 7 when the run is incomplete because a step needed an agent. The shipped scenarios never need one.
- `data.result_path` is the result file, under `.mobile-automator/results/`.
- On a failing step the runner saves a screenshot of the screen as `step_<id>_failure.png` under `.mobile-automator/screenshots/<scenario_id>/<run_id>/`, and `data.failed_step` and `data.failures` say what broke.

The shipped scenarios are curated fixtures, written by hand from the app's plans. They are not recordings made with mauto. Step 6 shows how to record one.

### 5. Replay the same file on iOS

```bash
mauto run scenarios/browse_popular.json --device <ios-simulator-id>
```

The file is the same, unchanged. It works because the Android application id and the iOS bundle id are the same string, and the scenarios target visible text and accessibility labels, never an OS element id.

The first iOS launch after an install can report success without bringing the app to the front. If the first step times out, run the command again.

### 6. Record a flow of your own

Recording needs an AI agent today. The agent follows `mauto guide generate`: in Claude Code run `/mobile-automator-generate`; in other hosts ask the agent to run `mauto guide generate` and follow it. The agent drives the app through mauto verbs and writes the scenario to `.mobile-automator/scenarios/<id>.json` in your workspace, here `showcase-app/.mobile-automator/scenarios/`.

Pick a flow that is not already shipped. Avoid changing a search field's text after typing in it: clearing a text field from a scenario does not work on iOS yet (#378). Two flows that work:

- Open Settings, turn on "Simulate server error", go back, see the error and its Retry button, then turn the switch off.
- Reset app data, open a film from the popular list and add it to the watchlist.

Begin the recording with Reset app data in Settings, so it starts from a known state.

Check the file your agent wrote:

```bash
mauto validate --strict .mobile-automator/scenarios/<id>.json
```

### 7. Replay your recording on the other platform

If you recorded on Android, replay on the simulator, or the other way round:

```bash
mauto run .mobile-automator/scenarios/<id>.json --device <other-id>
```

If it fails, read `data.failed_step` and `data.failures` in the envelope and look at the failure screenshot. To have an agent diagnose the run, ask it to follow `mauto guide execute`.

### 8. Replay in CI

A workflow file to copy into your own repo arrives with #313. It replays scenarios with `mauto run` on an Android emulator and an iOS simulator. A CI job branches on the exit codes from step 4: 0 passed, 6 failed, 7 incomplete.

### When something gets stuck

After a session on the default engine, the host's `mobilecli` daemon keeps holding the emulator's UI automation, so other tools such as `uiautomator dump` or Appium fail. Release it:

```bash
mauto session end
pkill -f 'mobilecli.* daemon'
```

Or run `adb shell pkill -f com.mobilenext.mobilecli.DeviceServer`, or wait 30 minutes. More fixes are in [TROUBLESHOOTING.md](../TROUBLESHOOTING.md).

## Scenarios

Scenarios live in `scenarios/`. Each is platform-agnostic and runs unchanged on both platforms, because the Android application id and the iOS bundle id are the same string:

| Scenario | Flow |
|---|---|
| `browse_popular.json` | The popular films list, then About and back |
| `search_open_details.json` | Search `Shawshank`, open The Shawshank Redemption, check its release year, go back to the results |
| `search_no_results.json` | Search for a title nothing matches and see the empty message |
| `filter_drama_1994.json` | Filter by Highest rated, 8+, 1994 and Drama; check the active-filters line, the count and The Shawshank Redemption |
| `filter_no_results.json` | Filter by 9+, 1931 and Animation, see the empty message, then clear the filters |
| `rate_and_remove.json` | Reset app data, rate The Shawshank Redemption 8/10, see the rating on its details and in My ratings, then remove it and see both cleared |
| `watchlist_add_remove.json` | Reset app data, add The Shawshank Redemption to the watchlist, restart the app and see it still listed, then remove it and see the watchlist empty |
| `simulate_offline.json` | Reset app data, turn on "Simulate offline" in Settings, reload the list and see No connection with its Retry button, then turn the switch off and see Retry load the list again |
| `simulate_server_error.json` | Reset app data, turn on "Simulate server error" in Settings, reload the list and see Something went wrong with its Retry button, then turn the switch off and see Retry load the list again |
| `details_layout_classic.json` | Reset app data, choose the classic details layout in Settings, open The Shawshank Redemption and see `Released 1994` and `142 min` |
| `details_layout_compact.json` | Reset app data, choose the compact details layout in Settings, open The Shawshank Redemption and see the one-line `1994 · 2h 22m` facts and the Overview heading |
| `watchlist_remove_at_once.json` | Reset app data, choose "Remove at once" in Settings, add The Shawshank Redemption to the watchlist and remove it with one tap |
| `watchlist_remove_ask_first.json` | Reset app data, choose "Ask first" in Settings, add The Shawshank Redemption, keep it once from the confirmation, then confirm the removal |

The filter scenarios check the active-filters line the app shows above the list (for example `Drama · 1994 · Rated 8+ · Highest rated`), not a chip's selected state, and pick combinations whose results have not changed in years.

The search scenarios check what typing caused (the result count, the film shown), never the search field's own text: Android exposes what was typed, iOS does not.

Check one from `showcase-app/`:

```bash
mauto validate --strict scenarios/browse_popular.json
```

Replay it from `showcase-app/` (needs a configured key, a booted emulator or simulator, and the workspace from step 3 of the walkthrough):

```bash
mauto run scenarios/browse_popular.json --device <device-id>
```

## Settings

mauto cannot clear an app's saved data or turn a device's network off, so the app does both itself. Settings (on the popular films screen) has a "Reset app data" button, which clears everything the app saved on the device and returns to the start, and two switches, "Simulate offline" and "Simulate server error", which make every TMDB request fail with the matching message until you turn them off. Scenarios that depend on saved state start with Reset app data, so they begin from the first-launch state whatever ran before them: `simulate_offline.json`, `simulate_server_error.json`, both filter scenarios, `rate_and_remove.json`, `watchlist_add_remove.json` and the four feature-flag scenarios do, and the simulation scenarios leave their switch off.

## Ratings

Rating a film needs no TMDB account: the app rates through a TMDB guest session, which it creates the first time you rate a film. TMDB stores the rating, and "My ratings" (the star on the popular films screen) lists the films the session has rated, read back from TMDB. The session id is the only part of a rating the app keeps on the device, and Reset app data clears it, so the next rating starts a new session with no ratings. `rate_and_remove.json` starts with Reset app data and removes the rating it adds.

## Watchlist

The watchlist is kept on the device, not on TMDB. TMDB's own watchlist needs a signed-in account, and a guest session cannot use it (checked on #304). Add or remove a film on its details screen, which says whether the film is in your watchlist. "Watchlist", beside "Filters" on the popular films screen, lists the films you saved. The list survives an app restart, and Reset app data empties it. `watchlist_add_remove.json` starts with Reset app data, restarts the app to show the film is still saved, and leaves the watchlist empty.

## Feature flags

One flow often turns into several through feature flags, and each variant needs testing on both platforms. Settings has a "Feature flags" section, below Reset app data, with two flags:

- **Details screen:** "Classic layout" shows the release year, runtime and genres on separate lines (`Released 1994`, `142 min`). "Compact layout" puts them on one line (`1994 · 2h 22m · Drama, Crime`) with an Overview heading above the overview.
- **Removing from the watchlist:** "Remove at once" removes a film with one tap on its details screen. "Ask first" adds a step: a confirmation asks before removing, with "Yes, remove" and "Keep it".

Each flag has two options instead of an on/off switch, and Settings states the setting in words under each flag. Both default to the first option, and Reset app data puts them back. The values are stored on the device and survive a restart.

Each setting has its own scenario, so four scenarios cover the two flags. Each one resets app data and then picks its setting in Settings before the flow starts, so a run never depends on what an earlier run left behind. All four are meant to pass: they show variant coverage, one file per variant, not a failure.

## Attribution

This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB. The About screen shows this notice with the TMDB logo.

## Credits

The project structure starts from [Kotlin/KMP-App-Template](https://github.com/Kotlin/KMP-App-Template), Apache-2.0 (see `LICENSE-template`).
