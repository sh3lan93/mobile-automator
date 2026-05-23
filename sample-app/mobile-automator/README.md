# Sample-App Gesture Corpus — Maintainer Runbook (slice 4, PRD #44)

This directory is the **committed output of running the mobile-automator
extension locally against `sample-app/`**. CI does not generate or execute it
(running the extension in CI is not yet supported — see `ROADMAP.md`). CI only
schema-validates `scenarios/*.json` and `results/*.json`.

Two scenario locations exist on purpose:
- `sample-app/scenarios/smoke_nav.json` — slice 2's hand-rolled `run-smoke.mjs`
  lane (do not move; the driver hardcodes that path).
- `sample-app/mobile-automator/scenarios/` — this slice's real-extension corpus.

## Prerequisites

- Flutter `3.35.6`, an Android emulator/device booted (`adb devices` shows one).
- Gemini CLI with this extension linked: from the repo root, `gemini extensions link .`
- Run all commands below from `sample-app/` so the extension workspace lands at
  `sample-app/mobile-automator/`.

## 1. Setup (platform-agnostic mode)

```
cd sample-app
flutter run            # leave the app running on the device
# in a Gemini session started from sample-app/:
/mobile-automator:setup
```
At the mode prompt choose **Platform-agnostic**. This writes
`sample-app/mobile-automator/config.json`. Commit `config.json` (it doubles as a
worked example). Do **not** commit `sample-app/.gemini/` (gitignored).

## 2. Generate the nine scenarios

Run `/mobile-automator:generate` once per scenario below and give it the listed
steps verbatim. The generator is a recorder — it executes exactly what it is
told and screenshots every step. Use these exact `scenario_id`s when it asks.

Product/category data: 12 products `p001`–`p012`; featured `p001,p002,p004,p007,p010`;
categories `electronics,home,books,toys`.

1. **`gesture_long_press_cart`** — Launch the app. Tap `bottom_nav_home`. Tap
   `home_product_card_p003`. Tap `product_button_add_to_cart`. Tap
   `appbar_icon_cart`. Long-press `cart_item_p003`. Tap
   `cart_dialog_remove_confirm`. (Assert `cart_item_p003` no longer exists.)
2. **`gesture_swipe_carousel`** — Launch. Tap `bottom_nav_home`. Swipe left on
   `home_carousel_featured`. (Assert a later `home_carousel_item_*` is visible.)
3. **`gesture_swipe_dismiss_cart`** — Launch. Tap `bottom_nav_home`. Tap
   `home_product_card_p005`. Tap `product_button_add_to_cart`. Tap
   `appbar_icon_cart`. Swipe `cart_item_p005` to dismiss. (Assert `cart_item_p005`
   no longer exists.)
4. **`gesture_double_tap_favorite`** — Launch. Tap `bottom_nav_home`. Tap
   `home_product_card_p001`. Double-tap `product_image`. (Assert
   `product_button_favorite` state = favorited.)
5. **`gesture_type_search`** — Launch. Tap `bottom_nav_more`. Type a known
   product-title substring into `more_field_search`. (Assert a
   `more_search_result_*` appears.) Dismiss the keyboard (semantic
   `dismiss_keyboard`). (Assert keyboard not visible.)
6. **`gesture_scroll_grid`** — Launch. Tap `bottom_nav_home`. Scroll the grid
   to `home_product_card_p012`. (Assert `home_product_card_p012` fully visible.)
7. **`gesture_press_back`** — Launch. Tap `bottom_nav_categories`. Tap
   `categories_list_item_electronics`. Press back (semantic `press_back`).
   (Assert `categories_list_item_electronics` is visible again.)
8. **`permission_notifications_grant`** — Precondition: fresh install / cleared
   app data so the OS permission dialog appears. Launch. Tap `bottom_nav_more`.
   Toggle `more_toggle_notifications`. Grant the permission (semantic
   `grant_permission`). (Assert the permission dialog was shown, toggle on.)
9. **`permission_notifications_deny`** — Precondition: fresh install / cleared
   app data. Launch. Tap `bottom_nav_more`. Toggle `more_toggle_notifications`.
   Deny the permission (semantic `deny_permission`). (Assert the permission
   dialog was shown, toggle remains off.)

All scenarios must be agnostic: `"$schema_version": "2.1"` first,
`"platform": "cross-platform"`, semantic actions recorded by name.

## 3. Execute the suite

```
/mobile-automator:execute --all
```
This writes `results/<run_id>.json` and execute screenshots. Re-run the suite
**at least 3 times**; note the pass/fail of each run for the PR's stability
observation (issue #48's flake AC is recorded here, not gated in CI).

## 4. Commit the corpus

```
git add sample-app/mobile-automator/config.json \
        sample-app/mobile-automator/scenarios \
        sample-app/mobile-automator/results \
        sample-app/mobile-automator/screenshots \
        sample-app/mobile-automator/README.md
git commit -m "test(sample-app): commit agnostic gesture corpus + evidence (slice 4)

Refs #48"
```

If any target surface is missing from the app, **stop** and file a slice-1
follow-up issue — do not add UI here (slice 4 is scenarios-only).
