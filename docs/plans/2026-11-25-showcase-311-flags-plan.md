# Showcase flags: two feature flags and one scenario per setting (#311) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Two feature flags on the Settings screen, each visibly changing a flow on Android and iOS. Each flag value lives in the existing `LocalStore`, survives a restart and is cleared by Reset app data. Ship one scenario per flag setting (four), each resetting app data and then choosing its setting on Settings in its first steps, and all passing. Fold in the maintainer's decision: one shared back-arrow top bar in `screens/common/`, used by the seven screens that copy it today.

**Architecture:** Two new `LocalStore` declarations through the existing registering `boolean(...)` factory, so `reset()` clears them with no edit. `SettingsViewModel` exposes and sets them. `DetailsViewModel` reads the layout flag; `WatchlistSectionViewModel` reads the removal flag and owns the confirmation state. A pure `formatRuntime` helper builds the compact layout's facts line. `screens/common/BackTopBar.kt` replaces seven copied `TopAppBar` blocks. `TmdbClient`, `KtorTmdbClient`, `GuestRatings` and `Watchlist` do not change.

**Spec:** issue #311, PRD #304 (and its comments), `docs/plans/2026-11-11-movie-tracker-showcase-design.md`, the #305–#310 plans (their Global Constraints apply unchanged), and the orchestrator's context notes for this slice.

## Global Constraints

- All #305–#310 constraints apply: Android and iOS only, no UI test dependency, no `testTag`, no committed key, schema 2.1 platform-agnostic scenarios with mechanical assertions only, facts shown as visible text, devices driven only through `mauto` verbs.
- **One store.** Flags are `LocalStore` values built with `boolean(...)`. No second store, no new `KeyValueStorage`, no new codec; `reset()` is not edited.
- **Reuse, do not copy.** `screens/common/` (`Centered`, `FailureContent`, `MovieList`, the new `BackTopBar`) and the shared test fakes (`FakeTmdbClient`, `FakeGuestTmdb`, `InMemoryKeyValueStorage`).
- **Existing scenarios keep passing unchanged.** The flags default to today's behaviour (classic details, remove at once), and the top-bar refactor keeps every title, `Back` content description and action label.
- Nothing under `src/`, `bin/` or `package.json` changes: no version bump, no CHANGELOG entry.
- Default engine (mobilecli). `engine: legacy` only if `mauto elements` shows a missing label or hidden content (#379), and say so in the PR.
- Timing: every tap or type waits for its target first (the #310 lost-first-letter lesson).
- Worktree `sample-app-311-flags`, branch `sample-app/311-flags`. Subagents `cd` there and check `git branch --show-current` before any commit.
- Both devices are this worker's. When done: `mauto session end`, `pkill -f 'mobilecli.* daemon'`, and `adb shell pidof com.mobilenext.mobilecli.DeviceServer` finds nothing.

## The flags (decision: open, recommendation below)

| Flag | Store key | Default | Setting A | Setting B | What changes |
|---|---|---|---|---|---|
| Details layout | `compact_details` | off | `Classic layout` | `Compact layout` | Classic (today): `Released 1994`, `142 min`, genres on separate lines. Compact: one facts line `1994 · 2h 22m · Drama, Crime`-style, then an `Overview` heading over the overview. Watchlist and rating sections unchanged in both. |
| Watchlist removal | `confirm_watchlist_removal` | off | `Remove at once` | `Ask first` | Remove at once (today): `Remove from watchlist` removes. Ask first: the tap opens a dialog `Remove <title> from your watchlist?` with `Yes, remove` and `Keep it`; only `Yes, remove` removes. The flow gains a step, which is the variant a flag adds in a real app. |

Why these two: one changes a screen's layout (the design doc's own example), the other changes a flow's steps. Both effects are visible text built from long-settled facts (Shawshank's year and 142-minute runtime) or from text the scenario caused.

## Settings controls

A `Feature flags` section, **below** `Reset app data` so the reset button never moves (every shipped scenario taps it). The column gets `verticalScroll`, though both devices fit it without scrolling (checked on device in Task 6).

Each flag is a label, two selectable option rows (radio-style, `Modifier.selectable`, `Role.RadioButton`) and a status line. Two options rather than a switch so that **every** scenario taps its own setting, including the default one: the "off" scenario sets the flag explicitly instead of relying on Reset having left it off, and tapping an already selected option is a no-op. The chip check on #304 showed selected state does not reach `mauto elements`, so the status line states the setting in words.

Exact copy (scenario contracts; targets are case-insensitive substrings, first match wins):

| Element | Text |
|---|---|
| Section heading | `Feature flags` |
| Flag 1 label | `Details screen` |
| Flag 1 options | `Classic layout` / `Compact layout` |
| Flag 1 status | `Details layout in use: classic` / `Details layout in use: compact` |
| Flag 2 label | `Removing from the watchlist` |
| Flag 2 options | `Remove at once` / `Ask first` |
| Flag 2 status | `Watchlist removal is immediate` / `Watchlist removal needs confirmation` |

Collision check: no option is a substring of a status line, a label, another option or any other Settings text (`Classic layout` is not in `Details layout in use: classic`; `Ask first` and `Remove at once` appear nowhere else). On Details, `Yes, remove` and `Keep it` are not substrings of `Remove from watchlist`, the membership lines or the dialog message; `In your watchlist` is not a substring of `… from your watchlist?`. `Overview` is checked against Shawshank's overview text on device.

## Shared top bar (maintainer decision)

```kotlin
// screens/common/BackTopBar.kt
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BackTopBar(title: String, onBack: () -> Unit, actions: @Composable RowScope.() -> Unit = {})
```

Used by Settings, Filters (with its `Clear`/`Done` actions), My ratings, Details (title is the film title or `""`), About, Watchlist and Search. Popular has no back arrow and keeps its own bar. Each screen loses its `TopAppBar`/`IconButton`/`Icon`/`ArrowBack` imports and its `@OptIn` where no longer needed. A guard in `showcase-scenarios.test.js` (or a sibling) fails if any showcase screen other than `BackTopBar.kt` and `PopularScreen.kt` contains `ArrowBack`, so the copy cannot come back.

## File Structure

```
showcase-app/shared/src/commonMain/kotlin/io/github/sh3lan93/mobileautomator/showcase/
  store/LocalStore.kt                       # + compactDetails, confirmWatchlistRemoval = boolean(...)
  screens/common/BackTopBar.kt              # NEW
  screens/{settings,filters,ratings,details,about,watchlist,search}/*Screen.kt  # use BackTopBar
  screens/settings/SettingsScreen.kt        # + Feature flags section, verticalScroll
  screens/settings/SettingsViewModel.kt     # + the two flags
  screens/details/DetailsViewModel.kt       # + compactLayout: StateFlow<Boolean> (store injected)
  screens/details/DetailsScreen.kt          # classic vs compact DetailsContent
  screens/details/DetailsFormat.kt          # NEW: formatRuntime, compactFacts (pure)
  screens/details/WatchlistSectionViewModel.kt  # + confirming state, requestRemove/confirmRemove/keep
  screens/details/WatchlistSection.kt       # + AlertDialog when confirming
  di/Koin.kt                                # constructor changes only
showcase-app/shared/src/commonTest/kotlin/.../
  store/LocalStoreTest.kt, screens/settings/SettingsViewModelTest.kt,
  screens/details/DetailsViewModelTest.kt, screens/details/DetailsFormatTest.kt (NEW),
  screens/details/WatchlistSectionViewModelTest.kt
showcase-app/scenarios/details_layout_classic.json      # NEW
showcase-app/scenarios/details_layout_compact.json      # NEW
showcase-app/scenarios/watchlist_remove_at_once.json    # NEW
showcase-app/scenarios/watchlist_remove_ask_first.json  # NEW
tests/lint/showcase-scenarios.test.js                   # + no copied back-arrow bar
showcase-app/README.md                                  # Feature flags section + 4 scenario rows
```

---

### Task 1: Shared back-arrow top bar
- [ ] Add `BackTopBar`; switch the seven screens to it, keeping every title, `Back` description and action.
- [ ] Add the lint guard (no `ArrowBack` outside `BackTopBar.kt`/`PopularScreen.kt`); see it red before the last screen is switched.
- [ ] `./gradlew :shared:testAndroidHostTest :shared:iosSimulatorArm64Test :androidApp:assembleDebug`, `npx jest tests/lint/showcase-scenarios.test.js`.
- [ ] Commit `refactor(showcase): one shared back-arrow top bar`.

### Task 2: Flag values in the store and on Settings
- [ ] Failing tests: `LocalStoreTest` `flags_freshStore_areOff`, `flags_persistAcrossStoreInstances`, `reset_clearsFlags` (no `reel_tracker.` key left); `SettingsViewModelTest` `setCompactDetails_updatesStore`, `setConfirmRemoval_updatesStore`, `reset_turnsFlagsOff`.
- [ ] Implement the two `boolean(...)` values, the view model members and the Settings section with the exact copy above.
- [ ] Commit `feat(showcase): feature flags on the settings screen`.

### Task 3: Details layout flag
- [ ] Failing tests: `DetailsFormatTest` (`142 → "2h 22m"`, `120 → "2h"`, `45 → "45m"`; facts line joins year, runtime and genres with ` · `, skipping missing parts); `DetailsViewModelTest` `compactLayout_followsStore`.
- [ ] `DetailsViewModel(movieId, client, store)`; `DetailsContent` picks classic (unchanged) or compact. Both keep `Poster`, `WatchlistSection`, `RatingSection`.
- [ ] Commit `feat(showcase): compact details layout behind a flag`.

### Task 4: Watchlist removal flag
- [ ] Failing tests in `WatchlistSectionViewModelTest`: `requestRemove_flagOff_removesAtOnce`, `requestRemove_flagOn_asksAndKeeps`, `confirmRemove_removesAndCloses`, `keep_closesAndKeeps`.
- [ ] `WatchlistSectionViewModel(movie, watchlist, store)` with `confirming: StateFlow<Boolean>`; `WatchlistSection` shows an `AlertDialog` while confirming. If Task 6 finds the dialog unreadable on either platform, replace it with the same copy inline under the button and note it in the PR.
- [ ] Commit `feat(showcase): ask before removing from the watchlist, behind a flag`.

### Task 5: Four scenarios
Each: `launch` → wait `Popular films` → Settings → wait `Reset app data` → reset → wait `Popular films` → Settings → wait the option → tap the option → wait and assert its status line → `press_back` → wait `Popular films`. Then the flow, reusing `watchlist_add_remove.json`'s search shapes (wait for `Search films` before focusing it; `target_pattern` `^The Shawshank Redemption`).

- `details_layout_classic`: open Shawshank; assert `Released 1994`, `142 min`; `element_not_exists` `2h 22m`.
- `details_layout_compact`: open Shawshank; assert `text_contains` `1994 · 2h 22m` and `Overview`; `element_not_exists` `Released 1994`.
- `watchlist_remove_at_once`: add; tap `Remove from watchlist`; assert `Not saved to your watchlist`, `element_not_exists` `Yes, remove`.
- `watchlist_remove_ask_first`: add; tap `Remove from watchlist`; assert the dialog message; `Keep it`; assert `In your watchlist`; remove again; `Yes, remove`; assert `Not saved to your watchlist`. Leaves the watchlist empty.

- [ ] `npx jest tests/lint/showcase-scenarios.test.js` green; `node bin/mauto.js validate --strict` on each → `"ok":true`, no blocking warning.
- [ ] Commit `test(showcase): one scenario per flag setting`.

### Task 6: Device check (both platforms)
- [ ] Fresh build on the Pixel 9 Pro emulator and the iPhone 17 Pro simulator; `mauto elements` on Settings (all flag copy, Reset visible), compact Details, and the dialog.
- [ ] `mauto run` **every** showcase scenario (13) on both devices; record results in the PR.
- [ ] Release the devices (see constraints).

### Task 7: Docs, verification, mutation checks
- [ ] README: a "Feature flags" section (what each flag changes, that each setting has its own scenario, that scenarios pick the setting on Settings after Reset) and four scenario-table rows; add them to the list of scenarios that start with Reset app data.
- [ ] Full verification, output in the PR: `npm test`, `npm run lint`, `npm run lint:guides`, Gradle + `xcodebuild`, `validate --strict` on every scenario, `git ls-files showcase-app | grep tmdb.properties$` (only `.example`).
- [ ] Mutation checks, each seen red then restored: (1) build a flag's `StoredValue` outside the registry → `reset_clearsFlags`; (2) `requestRemove` ignores the flag → `requestRemove_flagOn_asksAndKeeps`; (3) `formatRuntime` drops minutes → `DetailsFormatTest`; (4) put `ArrowBack` back in one screen → the top-bar guard.
- [ ] Commit `docs(showcase): feature flags in the README`; push; update the draft PR.

## Acceptance map (#311)

| Criterion | Task |
|---|---|
| ≥2 flags, each visibly changing a flow on both platforms | 2, 3, 4, 6 |
| Values in the local store, persist, cleared by Reset | 2 |
| One scenario per setting; each sets its flag itself; all validate | 5 |
| No scenario expected to fail | 5, 6 |
| No UI test dependency | existing guard |
| `validate --strict`, mechanical only, no OS id | existing guard, 5 |
| Shared top bar on all seven screens (maintainer) | 1 |
