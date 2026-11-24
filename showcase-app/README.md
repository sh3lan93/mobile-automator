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

Scenarios live in `scenarios/`. Each is platform-agnostic and runs unchanged on both platforms, because the Android application id and the iOS bundle id are the same string. Check one from the repo root:

```bash
mauto validate --strict showcase-app/scenarios/browse_popular.json
```

Replay it (needs a configured key, a booted device or emulator, and a workspace created with `mauto setup`):

```bash
mauto run showcase-app/scenarios/browse_popular.json
```

## Settings

mauto cannot clear an app's saved data or turn a device's network off, so the app does both itself. Settings (on the popular films screen) has a "Reset app data" button, which clears everything the app saved on the device and returns to the start, and two switches, "Simulate offline" and "Simulate server error", which make every TMDB request fail with the matching message until you turn them off. Scenarios that depend on saved state start with Reset app data, so they begin from the first-launch state whatever ran before them: `simulate_offline.json` and `simulate_server_error.json` both do, and both leave their switch off.

## Attribution

This application uses TMDB and the TMDB APIs but is not endorsed, certified, or otherwise approved by TMDB. The About screen shows this notice with the TMDB logo.

## Credits

The project structure starts from [Kotlin/KMP-App-Template](https://github.com/Kotlin/KMP-App-Template), Apache-2.0 (see `LICENSE-template`).
