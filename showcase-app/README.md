# Reel Tracker (showcase app)

A small Compose Multiplatform movie tracker for Android and iOS, built on [TMDB](https://www.themoviedb.org). It sits beside the Sample Shop fixture in `sample-app/`: Sample Shop is the deterministic target the CI E2E drives, while this app shows mauto driving a real cross-platform app with live data, one scenario for both platforms. PRD: https://github.com/sh3lan93/mobile-automator/issues/304

The full walkthrough arrives with #312. This README covers the key, the build and the scenarios.

## Your TMDB key

The app calls TMDB with your own free key; no key is committed.

1. Create a TMDB account and request a v3 API key at https://www.themoviedb.org/settings/api.
2. Copy `tmdb.properties.example` to `tmdb.properties` (git-ignored) and paste the key after `TMDB_API_KEY=`.

Without a key the app opens on an "Add your TMDB key" screen; a key TMDB rejects gets its own message.

## Build and install

Requires JDK 17 and the Android SDK; the iOS build also needs Xcode. Run from `showcase-app/`.

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

The app has no UI test code by design: no Espresso, no XCUITest, no Compose UI tests. Its on-device behaviour is checked by mauto scenarios, which target what a person sees (on-screen text and accessibility labels), never a test tag. `tests/lint/showcase-scenarios.test.js` fails the build if either changes.

## Scenarios

Scenarios live in `scenarios/`. Each is platform-agnostic and runs unchanged on both platforms, because the Android application id and the iOS bundle id are the same string:

| Scenario | Flow |
|---|---|
| `browse_popular.json` | The popular films list, then About and back |
| `search_open_details.json` | Search `Shawshank`, open The Shawshank Redemption, check its release year, go back to the results |
| `search_no_results.json` | Search for a title nothing matches and see the empty message |
| `rate_and_remove.json` | Reset app data, rate The Shawshank Redemption 8/10, see the rating on its details and in My ratings, then remove it and see both cleared |

The search scenarios check what typing caused (the result count, the film shown), never the search field's own text: Android exposes what was typed, iOS does not.

Check one from the repo root:

```bash
mauto validate --strict showcase-app/scenarios/browse_popular.json
```

Replay it (needs a configured key, a booted device or emulator, and a workspace created with `mauto setup`):

```bash
mauto run showcase-app/scenarios/browse_popular.json
```

## Settings

mauto cannot clear an app's saved data or turn a device's network off, so the app does both itself. Settings (on the popular films screen) has a "Reset app data" button, which clears everything the app saved on the device and returns to the start, and two switches, "Simulate offline" and "Simulate server error", which make every TMDB request fail with the matching message until you turn them off. Scenarios that depend on saved state start with Reset app data, so they begin from the first-launch state whatever ran before them: `simulate_offline.json` and `simulate_server_error.json` both do, and both leave their switch off.

## Ratings

Rating a film needs no TMDB account: the app rates through a TMDB guest session, which it creates the first time you rate a film. TMDB stores the rating, and "My ratings" (the star on the popular films screen) lists the films the session has rated, read back from TMDB. The session id is the only thing the app keeps on the device, and Reset app data clears it, so the next rating starts a new session with no ratings. `rate_and_remove.json` starts with Reset app data and removes the rating it adds.

## Attribution

This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB. The About screen shows this notice with the TMDB logo.

## Credits

The project structure starts from [Kotlin/KMP-App-Template](https://github.com/Kotlin/KMP-App-Template), Apache-2.0 (see `LICENSE-template`).
