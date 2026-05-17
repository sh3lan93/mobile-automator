# Sample Shop

A deterministic Flutter e-commerce **fixture** for the mobile-automator extension. It is **not** a user-facing product — it exists so contributors and CI can drive `/mobile-automator:*` end-to-end against a stable target. See PRD: https://github.com/sh3lan93/mobile-automator/issues/44

## Why it exists

The extension had zero automated coverage of the real mobile-mcp execution path. This app is the known-good target that later slices (#46–#49) drive in CI.

## Local setup

1. Install Flutter (stable). This app pins the Flutter minor in `pubspec.yaml` (`environment.flutter`) and `.fvmrc`. With [fvm](https://fvm.app): `fvm install && fvm use`.
2. `cd sample-app && flutter pub get`
3. Run on an Android emulator: `flutter run`
4. Tests: `flutter test` · Analyze: `flutter analyze` · Build: `flutter build apk --debug`

## Accessibility-ID convention

Every interactive widget exposes a stable selector via `Semantics(identifier: '{screen}_{role}_{name}')` (snake_case). Examples: `bottom_nav_home`, `home_product_card_p001`, `product_button_favorite`, `cart_button_checkout`, `more_toggle_notifications`. These IDs surface to mobile-mcp on both Android and iOS and appear verbatim in generated scenarios.

## For extension contributors

Point the extension at this directory as a test workspace, or drive it in CI (slice #46+). The app is deterministic: bundled JSON, no network, cart/favorites reset on cold start.
