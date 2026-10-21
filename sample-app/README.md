# Sample Shop

A deterministic Flutter e-commerce **fixture** for the mobile-automator CLI. It is **not** a user-facing product — it exists so contributors and CI can drive `mauto` end-to-end against a stable target. See PRD: https://github.com/sh3lan93/mobile-automator/issues/44

## Why it exists

The CLI had zero automated coverage of the real mobile-mcp execution path. This app is the known-good target the real-device E2E drives in CI.

## Local setup

1. Install Flutter (stable). This app pins the Flutter minor in `pubspec.yaml` (`environment.flutter`) and `.fvmrc`. With [fvm](https://fvm.app): `fvm install && fvm use`.
2. `cd sample-app && flutter pub get`
3. Run on an Android emulator: `flutter run`
4. Tests: `flutter test` · Analyze: `flutter analyze` · Build: `flutter build apk --debug`

## Accessibility-ID convention

Every interactive widget also carries a stable `Semantics` id in the form `{screen}_{role}_{name}` (snake_case), for example `bottom_nav_home` or `cart_button_checkout`. These ids are for tools that select by OS element id. **mauto scenarios must not use them**: agnostic mode targets what a user can perceive — on-screen text and accessibility labels — and `tests/lint/e2e-agnostic.test.js` fails the build if a scenario in `scenarios/` names one.

## The real-device E2E

`scripts/run-e2e.mjs` runs the scenarios in `scenarios/` against this app by driving the **shipped `mauto` CLI** — the same binary a user installs, nothing else. In CI (`.github/workflows/sample-app-e2e-android.yml`) that binary is the packed npm tarball, installed into a temp prefix.

For each run the harness:

1. creates a scratch project, runs `mauto setup --mode agnostic`, copies the scenarios in and checks each with `mauto validate --strict`;
2. executes every step with one-shot verbs — `launch`, `elements`, `tap --at`, `type`, `press <semantic action>`, `screenshot` — following the `mauto guide execute` recipe;
3. resolves every target with the CLI's own matcher (`findFirst` from `src/assertion/evaluator.js` of the install under test), so a target means exactly what it means to `mauto assert`;
4. checks assertions with `mauto assert` and records everything through `mauto result add-step` / `add-assertion` / `finalize`, so the result file is the CLI's own.

A launch that succeeds but leaves the element list empty fails with *engine returned zero elements after a successful launch* — that is engine drift or an app that did not render, never a missing target. See `TROUBLESHOOTING.md`.

Scenarios:

- `smoke_nav` — switches between the three bottom-nav tabs and checks each tab's app-bar header. The Home tab is targeted by its tab label `Tab 1 of 3`, because on the default engine `Home` first matches the leaked "Home & Kitchen" tile ([#251](https://github.com/sh3lan93/mobile-automator/issues/251)).
- `golden_search_empty` — searches for a query with no matches on More. Its result is normalized (only steps, assertions and their statuses; no run ids, timings, device data or messages) and compared with `scenarios/golden/golden_search_empty.result.json`.

### Known failures (xfail / xpass)

`scenarios/golden/known-failures.json` lists scenarios that fail for a tracked reason outside this repo, each pinned to an `issue`, a `reason` and the `failing_step` it fails at:

| Outcome | When | Job |
|---|---|---|
| PASS | not listed, passed | ok |
| FAIL | failed, and not first at the listed `failing_step` (or failed only on assertions) | **fails** |
| XFAIL | listed, and the first failed step is its `failing_step` | ok |
| XPASS | listed, but passed | **fails** — the fix landed; remove the entry |

A failure anywhere other than the pinned step is never excused, and a missing or mismatched golden fixture fails the job on its own, whatever the classification. `golden_search_empty` is listed until #251 is fixed: the default engine drops the "Search products" field's label, so `tap_search` cannot resolve.

### Running it locally

Build and install the app on an emulator first (`flutter build apk --debug`, then `adb install build/app/outputs/flutter-apk/app-debug.apk`), then from the repo root either test the packed tarball, as CI does:

```bash
npm ci
npm pack
npm install ./mobile-automator-*.tgz --prefix /tmp/mauto-prefix --no-save --ignore-scripts
MAUTO_BIN=/tmp/mauto-prefix/node_modules/.bin/mauto node sample-app/scripts/run-e2e.mjs
```

or test whatever `mauto` is on your `PATH` (for example an `npm link`ed checkout):

```bash
MAUTO_BIN=$(command -v mauto) node sample-app/scripts/run-e2e.mjs
```

Optional environment: `E2E_SCENARIOS=smoke_nav` runs a subset; `E2E_ARTIFACTS_DIR=<dir>` receives the screenshots, results and session log at the end, pass or fail.

To run against the legacy robot (`MOBILEMCP_LEGACY_ROBOT=1`, which reaches the search field), first release the default engine's device server, which outlives every session and holds the device's UiAutomation connection (each harness run gets a fresh scratch project, so there is no old session to end):

```bash
adb shell pkill -f com.mobilenext.mobilecli.DeviceServer
MOBILEMCP_LEGACY_ROBOT=1 MAUTO_BIN=$(command -v mauto) node sample-app/scripts/run-e2e.mjs
```

The harness logic lives in `scripts/lib/` (CommonJS, unit-tested under `tests/unit/e2e-harness/`); `scripts/` has no `package.json` and no dependencies of its own.
