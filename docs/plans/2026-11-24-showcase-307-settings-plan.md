# Showcase settings: reset app data, simulated offline and server error (#307) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Settings screen in Reel Tracker with "Simulate offline" and "Simulate server error" switches and a "Reset app data" button, backed by a new on-device `LocalStore` and by the simulation switches in `KtorTmdbClient`; plus two shipped scenarios that reset, turn a switch on, hit the failure screen, turn it off and recover with Retry.

**Architecture:** `LocalStore` is the single owner of everything persisted on the device. It sits on a tiny platform seam, `KeyValueStorage` (SharedPreferences on Android, a named `NSUserDefaults` suite on iOS, an in-memory map in tests). Each persisted value is a `StoredValue<T>` that registers itself with the store when declared, so `reset()` clears every value, including the ones later slices add, in one call. `KtorTmdbClient` reads the current `Simulation` before every request inside its existing private `call()`, so every endpoint (306's included) inherits the switches without per-endpoint code.

**Tech Stack:** unchanged from #305 (Kotlin Multiplatform, Compose Multiplatform, Ktor + `ktor-client-mock`, Koin, navigation-compose, kotlinx-coroutines-test, Jest for the repo guard). No new library.

**Spec:** issue #307, PRD #304, `docs/plans/2026-11-11-movie-tracker-showcase-design.md`; conventions from `docs/plans/2026-11-11-showcase-305-skeleton-plan.md`.

## Global Constraints

- Everything from the #305 plan's Global Constraints still holds: Android + iOS only, no UI test dependency, no committed key, v3 `api_key` query parameter, schema 2.1 platform-agnostic cross-platform scenarios with mechanical assertions only, visible-text facts, no `testTag`, devices driven only through `mauto` verbs.
- Nothing under `src/`, `bin/` or `package.json` changes: no version bump, no CHANGELOG entry.
- **Additive over #306.** #306 runs in parallel and also touches `TmdbClient`, `di/` and `App.kt`. This slice adds a defaulted constructor parameter to `KtorTmdbClient` (existing call sites and tests compile unchanged), adds one module and one route, and never reshapes what #305 created. Conflicts are resolved at sync with `node scripts/sync-branch.js`.
- On-device check: iOS simulator only (the 306 worker owns the Android emulator). On-device replay is not an acceptance criterion.
- The TMDB key in `showcase-app/tmdb.properties` is never printed, copied or committed.
- Worktree `sample-app-307-settings-reset-simulation`, branch `sample-app/307-settings-reset-simulation`. Subagents `cd` there and check `git branch --show-current` before any commit. Per-task commits ending with the repo's `Co-Authored-By` line.

## Review Focus

1. **Reset that misses a value.** A later slice adds the watchlist and forgets to wire it into reset. → `StoredValue` registers itself with the store; reset iterates the registry. Task 1 test.
2. **Reset that leaves stale screens.** Reset clears the store but the popular list (or a 306 search screen) keeps showing old in-memory state. → Reset navigates to the start route with the back stack cleared, so every screen's view model is recreated. Task 4.
3. **Simulated failure that still hits the network.** → The switch check runs before the request; the mock engine call count stays 0. Task 2 test.
4. **Switch state not readable on iOS.** Switch on/off state exposure was not verified on either platform (like chip state in the PRD). → Each switch has a visible status line; scenarios assert that text, never the switch's checked state. Task 4.
5. **Corrupt or foreign data in storage.** A stored value that does not decode → treated as the default, never a crash. Task 1 test.

---

## File Structure

```
showcase-app/shared/src/
  commonMain/kotlin/io/github/sh3lan93/mobileautomator/showcase/
    data/Simulation.kt              # NEW: data class Simulation(offline, serverError)
    data/KtorTmdbClient.kt          # MODIFY: simulation parameter, checked in call()
    store/KeyValueStorage.kt        # NEW: platform seam interface + InMemoryKeyValueStorage
    store/LocalStore.kt             # NEW: LocalStore, StoredValue<T>, codecs
    screens/settings/SettingsViewModel.kt   # NEW
    screens/settings/SettingsScreen.kt      # NEW
    screens/popular/PopularScreen.kt        # MODIFY: Settings + Refresh top-bar actions
    App.kt                          # MODIFY: settings route; reset → start route, back stack cleared
    di/Koin.kt                      # MODIFY: initKoin(platformModule), LocalStore, client wiring, SettingsViewModel
  androidMain/kotlin/.../store/SharedPreferencesStorage.kt   # NEW
  iosMain/kotlin/.../store/UserDefaultsStorage.kt            # NEW
  iosMain/kotlin/.../di/KoinIos.kt                           # NEW: initKoinIos()
  commonTest/kotlin/.../store/LocalStoreTest.kt              # NEW
  commonTest/kotlin/.../data/KtorTmdbClientTest.kt           # MODIFY: simulation tests
  commonTest/kotlin/.../screens/settings/SettingsViewModelTest.kt  # NEW
  iosTest/kotlin/.../store/UserDefaultsStorageTest.kt        # NEW: the real iOS storage round-trips and clears
showcase-app/androidApp/src/main/kotlin/.../ShowcaseApp.kt   # MODIFY: pass the Android storage module
showcase-app/iosApp/iosApp/iOSApp.swift                      # MODIFY: call initKoinIos
showcase-app/scenarios/simulate_offline.json                 # NEW
showcase-app/scenarios/simulate_server_error.json            # NEW
showcase-app/README.md                                       # MODIFY: one short Settings paragraph
tests/lint/CLAUDE.md                                         # MODIFY only if the guard changes (it should not)
```

---

### Task 1: Local store

**Interfaces (produced):**

```kotlin
// store/KeyValueStorage.kt — the only platform-specific piece.
interface KeyValueStorage {
    fun getString(key: String): String?
    fun putString(key: String, value: String)
    fun remove(key: String)
}
class InMemoryKeyValueStorage : KeyValueStorage   // tests, and nothing else

// store/LocalStore.kt
class StoredValue<T> internal constructor(key: String, default: T, codec: Codec<T>, storage: KeyValueStorage) {
    val value: StateFlow<T>
    fun set(newValue: T)
}

class LocalStore(storage: KeyValueStorage) {
    val simulateOffline: StoredValue<Boolean>
    val simulateServerError: StoredValue<Boolean>
    val simulation: StateFlow<Simulation>        // combined view the client and Settings read
    fun reset()                                   // removes every registered key; every value back to its default
    // later slices add declarations here, e.g.:
    //   val guestSessionId = string("guest_session_id")              (#309)
    //   val watchlist = json("watchlist", emptyList<WatchlistEntry>()) (#310)
    //   val newDetailsLayout = boolean("flag_new_details_layout")     (#311)
}
```

- Private factories `boolean(key, default = false)`, `string(key)` (nullable), and `json(key, default, serializer)` (kotlinx.serialization) create and register a `StoredValue`. Keys are prefixed `reel_tracker.`.
- A stored string that does not decode for its codec reads as the default.
- **Why a registry:** reset cannot drift from the set of stored values; adding a value is one line and reset needs no edit.

- [ ] **Step 1: Failing tests** (`LocalStoreTest`, over `InMemoryKeyValueStorage`):
  - `freshStore_switchesAreOff`
  - `set_updatesValueFlowImmediately`
  - `values_persistAcrossStoreInstances` — set both switches, build a new `LocalStore` over the same storage, both read `true` (stands in for an app relaunch)
  - `reset_clearsEveryValue_andEmitsDefaults` — set everything, `reset()`, both flows `false` and storage holds no `reel_tracker.` key
  - `reset_clearsPersistedState` — after `reset()`, a new store over the same storage reads defaults
  - `undecodableStoredValue_readsAsDefault` — storage pre-seeded with `reel_tracker.simulate_offline = "banana"` → `false`
  - `simulation_combinesBothSwitches`
- [ ] **Step 2:** Run `./gradlew :shared:testAndroidHostTest` → fails on missing types.
- [ ] **Step 3:** Implement `KeyValueStorage`, `InMemoryKeyValueStorage`, `LocalStore`, `StoredValue`, `Simulation` (`data class Simulation(val offline: Boolean = false, val serverError: Boolean = false)` in `data/`).
- [ ] **Step 4:** `./gradlew :shared:testAndroidHostTest :shared:iosSimulatorArm64Test` → pass.
- [ ] **Step 5: Commit** `feat(showcase): on-device local store with one-call reset`.

### Task 2: Simulation switches in the TMDB client

**Interface change (additive):**

```kotlin
class KtorTmdbClient(
    private val http: HttpClient,
    apiKey: String,
    private val simulation: () -> Simulation = { Simulation() },
) : TmdbClient
```

- In private `call()`, after the missing-key check and before any request: `offline` → `Failed(NoConnection)`; else `serverError` → `Failed(ServerError)`; no request is sent in either case.
- Precedence: missing key first (nothing works without one, and the add-your-key screen is the fix), then offline (no request would reach a server), then server error.
- The client takes a function, not `LocalStore`, so it stays independent of persistence; Koin wires `{ store.simulation.value }`.

- [ ] **Step 1: Failing tests** added to `KtorTmdbClientTest`:
  - `simulateOffline_returnsNoConnection_withoutCallingNetwork` (call count 0)
  - `simulateServerError_returnsServerError_withoutCallingNetwork` (call count 0)
  - `bothSwitches_offlineWins`
  - `blankKey_beatsSimulation` → `MissingKey`
  - `switchReadPerCall` — a mutable simulation: on → `NoConnection`, off → `Ok`, proving retry after turning it off recovers
- [ ] **Step 2–4:** red, implement, green on both runtimes. The 10 existing client tests stay untouched and green.
- [ ] **Step 5: Commit** `feat(showcase): simulate offline and server error in the TMDB client`.

### Task 3: Platform storage and DI

- `androidMain/.../SharedPreferencesStorage(prefs: SharedPreferences)`; `iosMain/.../UserDefaultsStorage(defaults: NSUserDefaults)`. Both use a dedicated store (`reel_tracker_store` preferences file / `io.github.sh3lan93.mobileautomator.showcase.store` suite), so nothing outside the app's own data is ever touched.
- `di/Koin.kt`: `fun initKoin(platformModule: Module)` (required, so a platform cannot forget its storage); `appModule` gains `single { LocalStore(get()) }`, `single<TmdbClient> { KtorTmdbClient(get(), TMDB_API_KEY) { get<LocalStore>().simulation.value } }`, `viewModelOf(::SettingsViewModel)`.
- Android `ShowcaseApp` passes `module { single<KeyValueStorage> { SharedPreferencesStorage(getSharedPreferences("reel_tracker_store", MODE_PRIVATE)) } }`. iOS: Kotlin `initKoinIos()` in `iosMain` builds the `NSUserDefaults(suiteName = …)` module; `iOSApp.swift` calls `KoinIosKt.doInitKoinIos()`.
- [ ] **Step 1:** `iosTest/UserDefaultsStorageTest` (real `NSUserDefaults` on a test-only suite name): put/get round-trip, remove, and `LocalStore.reset()` over it leaves the suite empty. (Android's `SharedPreferences` needs a device or Robolectric; it is covered by the by-hand check, not a unit test.)
- [ ] **Step 2:** Implement; Android `assembleDebug` and the iOS `xcodebuild` from #305 both succeed.
- [ ] **Step 3: Commit** `feat(showcase): persist the local store on Android and iOS`.

### Task 4: Settings screen, reset and navigation

**Interfaces (produced):**

```kotlin
class SettingsViewModel(private val store: LocalStore) : ViewModel() {
    val simulation: StateFlow<Simulation>
    fun setSimulateOffline(on: Boolean)
    fun setSimulateServerError(on: Boolean)
    fun resetAppData()            // store.reset(); the screen then calls onReset()
}
@Composable fun SettingsScreen(onBack: () -> Unit, onReset: () -> Unit, viewModel: SettingsViewModel = koinViewModel())
```

Exact visible copy (contracts for scenarios):

| Where | Text |
|---|---|
| Popular top bar actions | `Refresh` (icon button, `contentDescription`), `Settings` (text button), `About` (text button, unchanged) |
| Settings top bar title / back | `Settings` / back `contentDescription` `Back` |
| Section heading | `Simulation` |
| Switch row 1 label / status | `Simulate offline` / `Offline simulation is on` or `Offline simulation is off` |
| Switch row 2 label / status | `Simulate server error` / `Server error simulation is on` or `Server error simulation is off` |
| Reset button / helper line | `Reset app data` / `Clears everything the app saved on this device and returns to the start.` |
| Failure screens | unchanged from #305: `No connection` + `Retry`, `Something went wrong` + `Retry` |

- Each switch row is one `Modifier.toggleable` row (label + status + `Switch`), so tapping the label text toggles it on both platforms.
- `Refresh` on the popular screen calls `viewModel.retry()` (reload). It exists so a scenario can trigger a load after turning a switch on; Retry on the failure screen is then the recovery path the acceptance criteria name.
- Reset: `resetAppData()` then `navController.navigate(ROUTE_POPULAR) { popUpTo(0) { inclusive = true } }`: the app is back on a freshly created popular screen, which loads with every switch off, exactly as on first launch. No confirmation dialog: one tap, so scenarios need no extra step.
- [ ] **Step 1: Failing tests** `SettingsViewModelTest` (over a real `LocalStore` + `InMemoryKeyValueStorage`): toggling updates `simulation`; `resetAppData()` turns both off and clears storage.
- [ ] **Step 2–3:** red, implement view model, screen, the two top-bar actions, the route and reset navigation.
- [ ] **Step 4:** builds and both test runtimes green.
- [ ] **Step 5: By-hand check on the iOS simulator** with the real key, through `mauto` verbs only: Settings → Simulate offline on → back → Refresh → `No connection`; Settings → off → back → Retry → film list. Same for server error (`Something went wrong`). Turn a switch on, terminate and relaunch the app → still on (persistence). Reset app data → popular list, both switches off. Record in the PR exactly what was checked.
- [ ] **Step 6: Commit** `feat(showcase): settings screen with reset app data and simulation switches`.

### Task 5: Scenarios

`simulate_offline.json` and `simulate_server_error.json`, same shape as `browse_popular.json` (schema 2.1, `platform-agnostic`, `cross-platform`, shared `app_package`, tags `["showcase","settings","failure"]`). Steps for offline (server error mirrors it with its own strings):

1. `launch` `launch_app`
2. `wait_list` `wait_for_element` `Popular films` (30000 ms)
3. `open_settings` `tap` `Settings`; `wait_settings` `wait_for_element` `Reset app data`
4. `reset` `tap` `Reset app data`; `wait_reset` `wait_for_element` `Popular films` — assertion `pattern_match` `^\d+ films$` (the fresh first-launch list)
5. `open_settings_again` `tap` `Settings`; `switch_on` `tap` `Simulate offline` — assertion `text_contains` `Offline simulation is on`
6. `back_to_list` `press_back`; `refresh` `tap` `Refresh`; `wait_failure` `wait_for_element` `No connection` — assertions `element_visible` `No connection`, `element_visible` `Retry`
7. `open_settings_off` `tap` `Settings`; `switch_off` `tap` `Simulate offline` — assertion `text_contains` `Offline simulation is off`
8. `back_to_failure` `press_back`; `retry` `tap` `Retry`; `wait_recovered` `wait_for_element` `Popular films` — assertion `pattern_match` `^\d+ films$`

Both start by resetting app data and end with the switch off (the acceptance criterion). The existing guard (`tests/lint/showcase-scenarios.test.js`) already covers strict validation, mechanical types, OS ids, `testTag` literals and app id; it needs no change.

- [ ] **Step 1:** write both files; `npx jest tests/lint/showcase-scenarios.test.js` green; `node bin/mauto.js validate --strict showcase-app/scenarios/<file>` → `"ok":true`, no blocking warning, for each.
- [ ] **Step 2: Commit** `test(showcase): scenarios for simulated offline and server error`.

### Task 6: README and verification

- [ ] **Step 1:** `showcase-app/README.md`: a short "Settings" paragraph: why the switches and reset exist (mauto cannot clear app data or toggle wifi), and that every shipped scenario starts with Reset app data. No Node version, no unsupported action named by its id.
- [ ] **Step 2: Full verification, output in the PR:** `npm test`, `npm run lint`, `npm run lint:guides`, `./gradlew :shared:testAndroidHostTest :shared:iosSimulatorArm64Test :androidApp:assembleDebug`, the `xcodebuild` command, `git ls-files showcase-app | grep tmdb.properties$` (only `.example`).
- [ ] **Step 3:** Mutation check: break `reset()` (skip one key) and the simulation check in `call()`; confirm the new tests go red; restore.
- [ ] **Step 4: Commit** `docs(showcase): settings in the README`; push; update the draft PR.

---

## Acceptance map (#307)

| Criterion | Task |
|---|---|
| Reset clears everything the store holds in one action; app returns to first-launch state | 1, 4 |
| Simulate offline → no-connection message; retry after turning off recovers | 2, 4, 5 |
| Simulate server error → server-error message; retry after turning off recovers | 2, 4, 5 |
| Local store (persistence, reset) and client switches unit-tested | 1, 2, 3 |
| Both failure scenarios start by resetting and leave switches off | 5 |
| No UI test dependency | existing guard, all |
| Scenarios pass `validate --strict`, mechanical only, no OS ids | 5 |
