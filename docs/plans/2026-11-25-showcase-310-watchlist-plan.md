# Showcase watchlist: add, remove and view, stored on the device (#310) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a film to a watchlist from its Details screen, remove it, and view the watchlist on its own screen. The list is stored on the device in the existing `LocalStore`, survives an app restart, and is emptied by Reset app data. Membership is visible text on Details. Ship one scenario that resets, adds a film, sees it in the watchlist after a cold restart, and removes it.

**Architecture:** One new `LocalStore` declaration, `watchlist`, built with the store's existing `json(...)` factory (its first use). Because the declaration registers itself, `reset()` clears it with no edit. A small `Watchlist` class in `data/` sits over that value: it maps between `Movie` and a private serializable entry, prevents duplicates, and removes by id. Details gets a `WatchlistSection` beside `RatingSection`, with its own view model and the same one-line call pattern #309 set up. The Watchlist screen reuses `MovieList`/`MovieRowData` and `filmCount`. Nothing in `TmdbClient`, `KtorTmdbClient` or `GuestRatings` changes.

**Spec:** issue #310, PRD #304 (and its comments), `docs/plans/2026-11-11-movie-tracker-showcase-design.md`, and the #305–#309 plans, whose Global Constraints apply unchanged.

## TMDB check: can a guest session use the server-side watchlist? (done while planning, 2026-11-25)

**Reference** (developer.themoviedb.org): `POST /3/account/{account_id}/watchlist` and `GET /3/account/{account_id}/watchlist/movies` take a path `account_id` and a query `session_id`, which is a signed-in user's session. Neither endpoint takes `guest_session_id`. The only guest-session list endpoint is `GET /3/guest_session/{id}/rated/movies`.

**Live** (`curl`, v3 `api_key`; key read into a shell variable and never printed; one throwaway guest session, nothing written):

| Call | Result |
|---|---|
| `POST account/{0,null}/watchlist?guest_session_id=…`, `POST account/watchlist?guest_session_id=…` | 401, status_code 3 ("Authentication failed: You do not have permissions") |
| `POST account/0/watchlist?session_id=<guest id>` | 401, status_code 3 |
| `GET account/0/watchlist/movies?guest_session_id=…` | 401, status_code 3 |
| `GET account?session_id=<guest id>` | 401, status_code 3: a guest session has no account |
| `GET guest_session/{id}/watchlist/movies` | 404, status_code 34: no such resource |

**Outcome:** a guest session cannot use TMDB's watchlist. It needs a signed-in account, which the PRD rules out of scope. The watchlist stays on the device, as the PRD and the orchestrator's notes already decided. Task 6 posts this on #304.

## Global Constraints

- All of the #305–#309 plans' constraints apply: Android and iOS only, no UI test dependency, no `testTag`, no committed key, schema 2.1 platform-agnostic scenarios with mechanical assertions only, facts shown as visible text, devices driven only through `mauto` verbs.
- **One store.** The watchlist is a `LocalStore` value built with the existing `json(...)` helper. Add no second store, no new `KeyValueStorage` and no new codec. `reset()` is not edited.
- **Reuse, do not copy.** `MovieList`, `MovieRowData`, `filmCount`, `Centered` and `FailureContent` come from `screens/common/`. Tests use the existing `InMemoryKeyValueStorage`. No client change means the shared `FakeTmdbClient`/`FakeGuestTmdb` need no new members. Any test that does need a client uses the shared fake.
- Nothing under `src/`, `bin/` or `package.json` changes: no version bump and no CHANGELOG entry.
- Default engine (mobilecli). Switch to `engine: legacy` only if `mauto elements` shows a missing label or hidden content, and say so in the PR (#379).
- Both devices are this worker's: the Android emulator and the iOS simulator. When done, release the Android DeviceServer and the host `mobilecli daemon` (`pkill -f 'mobilecli.* daemon'`, then `mauto session end`).
- Worktree `sample-app-310-watchlist`, branch `sample-app/310-watchlist`. Subagents `cd` there and check `git branch --show-current` before any commit. Per-task commits end with the repo's `Co-Authored-By` line.

## Review Focus

1. **Reset that misses the watchlist.** It is declared through the registering factory, never by hand. → Task 1 test: reset empties it and leaves no `reel_tracker.` key.
2. **Membership state that goes stale.** Details and the Watchlist screen both read one `StateFlow` from the store. Back from Details shows the change, and neither screen keeps a copy. → Task 2/3/4 tests.
3. **Duplicates.** Adding twice, for example a double tap, keeps one entry. → Task 2 test.
4. **Corrupt stored JSON** reads as an empty list and never crashes, through the `json(...)` helper's existing fallback. → Task 1 test.
5. **Target collisions.** CLI targets and element descriptions are case-insensitive substrings, and the first match wins. The two membership lines must not contain each other. → Task 4 copy table.
6. **The crowded popular top bar.** It is left unchanged; the entry goes in the filter row (decision below). The active-filters text keeps its `weight(1f)`, so a long filter line wraps and never pushes the buttons off. → Task 5 device check.

## Where the Watchlist entry goes (the popular top bar is crowded)

Today the bar has `Search` (text), `Refresh` (icon), `My ratings` (star icon), `Settings` (text) and `About` (text). Every shipped scenario taps `Settings` and waits on the `Popular films` title, so neither may move or be squeezed off the screen.

**Decision (maintainer, 2026-11-25, at plan approval): the filter row, not the top bar.** A `Watchlist` text button goes in the row under the bar, between the active-filters text and `Filters`. The top bar does not change. Reasons:
- The bar is already full, and every scenario relies on `Settings` and the `Popular films` title. Leaving the bar alone means no scenario can break because of the new entry.
- The filter row is shown in every state of the popular screen (loading, empty, failure), so the entry is always reachable.
- An overflow menu was rejected because it would hide `Settings` and break every scenario.

---

## File Structure

```
showcase-app/shared/src/commonMain/kotlin/io/github/sh3lan93/mobileautomator/showcase/
  store/LocalStore.kt                     # + watchlist = json(...) (drop the @Suppress("unused")); + private @Serializable entry
  data/Watchlist.kt                       # NEW: films StateFlow<List<Movie>>, contains, add, remove
  data/Movie.kt                           # + MovieDetails.toMovie()
  screens/details/WatchlistSection.kt     # NEW: WatchlistSectionViewModel + WatchlistSection composable
  screens/details/DetailsScreen.kt        # one line: WatchlistSection(details.toMovie()) beside RatingSection
  screens/watchlist/WatchlistViewModel.kt # NEW
  screens/watchlist/WatchlistScreen.kt    # NEW: MovieList + filmCount, empty state
  screens/popular/PopularScreen.kt        # + Watchlist text button in FilterRow, + onWatchlist
  App.kt                                  # + route watchlist
  di/Koin.kt                              # + Watchlist, WatchlistSectionViewModel, WatchlistViewModel
showcase-app/shared/src/commonTest/kotlin/.../
  store/LocalStoreTest.kt                 # + watchlist persists, reset empties it, corrupt JSON reads empty
  data/WatchlistTest.kt                   # NEW
  screens/details/WatchlistSectionViewModelTest.kt  # NEW
  screens/watchlist/WatchlistViewModelTest.kt       # NEW
showcase-app/scenarios/watchlist_add_remove.json    # NEW
showcase-app/README.md                              # scenario row + a Watchlist paragraph
```

---

### Task 1: Watchlist value in the local store

```kotlin
// store/LocalStore.kt
/** The films saved to the watchlist, oldest first; empty until the first add. Cleared by reset(). */
val watchlist = json("watchlist", emptyList<WatchlistEntry>(), ListSerializer(WatchlistEntry.serializer()))

/** A watchlisted film as stored on the device: the fields the Watchlist screen shows, nothing more. */
@Serializable
data class WatchlistEntry(val id: Int, val title: String, val releaseYear: String? = null, val posterUrl: String? = null)
```

- `WatchlistEntry` is the stored format. It lives in `store/`, so the domain `Movie` never takes on a serialization annotation. Its optional fields have defaults so a later field can be added without breaking old data.
- Per the TMDB terms comment on #304 (s.1.C), the store keeps only the id, title, year and poster path of films the user chose. That matches the design.

- [ ] **Step 1: Failing tests** in `LocalStoreTest`:
  - `watchlist_freshStore_isEmpty`
  - `watchlist_persistsAcrossStoreInstances`: set two entries, build a new store over the same storage, and read both back in order. This stands in for an app restart.
  - `reset_emptiesWatchlist`: the existing reset test extended, so no `reel_tracker.` key remains.
  - `watchlist_undecodableJson_readsEmpty`: storage pre-seeded with `reel_tracker.watchlist = "{not json"`.
- [ ] **Step 2–4:** red, implement, green on `./gradlew :shared:testAndroidHostTest :shared:iosSimulatorArm64Test`. The iOS `UserDefaultsStorageTest` stays green.
- [ ] **Step 5: Commit** `feat(showcase): watchlist value in the local store`.

### Task 2: `Watchlist`

```kotlin
// data/Watchlist.kt
class Watchlist(private val store: LocalStore) {
    /** Saved films, oldest first, as the screens show them. */
    val films: StateFlow<List<Movie>>
    fun contains(movieId: Int): StateFlow<Boolean>
    fun add(movie: Movie)        // no-op when already saved
    fun remove(movieId: Int)     // no-op when not saved
}

// data/Movie.kt
fun MovieDetails.toMovie() = Movie(id, title, releaseYear, posterUrl)
```

- `films` and `contains` are mapped from `store.watchlist.value` with `map(...).stateIn(...)`, or with a derived `StateFlow` that has no scope. Use one mechanism for both, and do not cache a copy. The implementer picks whichever keeps the reads synchronous in tests.
- [ ] **Step 1: Failing tests** `WatchlistTest` (real `LocalStore` over `InMemoryKeyValueStorage`): `add_thenListed`, `addTwice_keepsOne`, `remove_dropsOnlyThatFilm`, `remove_notSaved_noChange`, `contains_followsAddAndRemove`, `order_isOldestFirst`, `reset_emptiesFilms`.
- [ ] **Step 2–4:** red, implement, green.
- [ ] **Step 5: Commit** `feat(showcase): watchlist over the local store`.

### Task 3: Watchlist section on Details

```kotlin
class WatchlistSectionViewModel(private val movie: Movie, private val watchlist: Watchlist) : ViewModel() {
    val saved: StateFlow<Boolean>
    fun add()
    fun remove()
}
@Composable fun WatchlistSection(movie: Movie, viewModel: WatchlistSectionViewModel = koinViewModel(key = "watchlist-${movie.id}") { parametersOf(movie) })
```

- `DetailsContent` calls `WatchlistSection(details.toMovie())` once, between the details lines and `RatingSection`. That one line is the only edit to `DetailsScreen`. `RatingSection`, `DetailsViewModel` and their tests do not change. The writes are local and synchronous, so there is no saving or failure state.
- [ ] **Step 1: Failing tests** `WatchlistSectionViewModelTest`: `notSaved_initially`, `add_saved`, `remove_notSaved`, `savedElsewhere_isReflected` (the store is changed directly and the view model follows).
- [ ] **Step 2–4:** red, implement, green.
- [ ] **Step 5: Commit** `feat(showcase): add to and remove from the watchlist on the details screen`.

### Task 4: Watchlist screen, navigation and copy

```kotlin
class WatchlistViewModel(watchlist: Watchlist) : ViewModel() { val films: StateFlow<List<Movie>> }
@Composable fun WatchlistScreen(onBack: () -> Unit, onOpen: (Int) -> Unit, viewModel: WatchlistViewModel = koinViewModel())
```

- Rows use `MovieList(films.map(::MovieRowData), filmCount(n), onOpen)`, with the release year as the second line. There is no new list composable and no new count helper.
- Route `watchlist`. A row opens `details/<id>`, and back pops one entry. The screen collects the store's flow, so a film removed on Details is gone when the user comes back, with no reload.

Exact visible copy (scenario contracts):

| Where | Text |
|---|---|
| Popular filter row | text button `Watchlist`, before `Filters`; top bar unchanged |
| Watchlist top bar / back | `Watchlist` / `Back` |
| Watchlist count line | `1 film` / `<n> films` (shared `filmCount`) |
| Watchlist row | film title; second line the release year |
| Watchlist empty | `Your watchlist is empty` |
| Details membership line | `In your watchlist` / `Not saved to your watchlist` |
| Details button | `Add to watchlist` (when not saved) / `Remove from watchlist` (when saved) |

Collision check: `In your watchlist` is not a substring of `Not saved to your watchlist`, and the reverse holds too. That is why the second line does not read "Not in your watchlist". `Add to watchlist` and `Remove from watchlist` share no substring with either membership line. The `Watchlist` target appears only on Popular, which shows none of the Details text, and no active-filters text contains `watchlist`. On the Watchlist screen the title `Watchlist` is not a tap target.

- [ ] **Step 1: Failing tests** `WatchlistViewModelTest`: `empty_initially`, `listsSavedFilms`, `followsRemoval`.
- [ ] **Step 2–3:** red, implement the screen, the popular action, the route and Koin.
- [ ] **Step 4:** `./gradlew :shared:testAndroidHostTest :shared:iosSimulatorArm64Test :androidApp:assembleDebug` and the #305 `xcodebuild` command.
- [ ] **Step 5: Commit** `feat(showcase): watchlist screen`.

### Task 5: Scenario, then the device check

`watchlist_add_remove.json` (schema 2.1, `platform-agnostic`, `cross-platform`, the shared `app_package`, tags `["showcase","watchlist"]`). The description says it needs a TMDB key, starts from Reset app data and leaves the watchlist empty. Steps reuse `rate_and_remove.json`'s shapes, including its retry policy and its `target_pattern`:

1. `launch`; `wait_list` (`Popular films`, 30 s)
2. `open_settings`; `wait_settings`; `reset`; `wait_reset` (as in `rate_and_remove`)
3. `open_watchlist` (tap `Watchlist`); `wait_empty_start` (`Your watchlist is empty`). Assertion `element_visible` `Your watchlist is empty`, caused by the reset. Then `back_from_empty` (`press_back`) and `wait_list_again`.
4. `open_search`; `focus_field`; `type_title` (`Shawshank`); `hide_keyboard`; `wait_result`; `open_film` (`target_pattern` `^The Shawshank Redemption`)
5. `wait_not_saved` (`Not saved to your watchlist`, 15 s); assertion `element_visible`. Then `add` (tap `Add to watchlist`) and `wait_saved` (`In your watchlist`); assertions `element_visible` `In your watchlist` and `element_visible` `Remove from watchlist`.
6. `relaunch` (`launch_app`, a cold restart by default) and `wait_list_relaunch` (`Popular films`, 30 s). This proves the restart criterion.
7. `open_watchlist_again` (tap `Watchlist`) and `wait_listed` (`The Shawshank Redemption`, 10 s); assertions `element_visible` `The Shawshank Redemption` and `text_contains` `1 film`.
8. `open_saved_film` (tap the title, same pattern); `wait_saved_again` (`In your watchlist`); `remove` (tap `Remove from watchlist`); `wait_removed` (`Not saved to your watchlist`); assertion `element_visible`.
9. `back_to_watchlist` (`press_back`) and `wait_empty_end` (`Your watchlist is empty`); assertions `element_visible` `Your watchlist is empty` and `element_not_exists` `The Shawshank Redemption`.

It asserts only text the scenario caused (the reset's empty list, the add, the removal) and the long-settled title. `1 film` is the count the scenario's own single add produced. If it fails part-way, the next run's Reset empties the list.

- [ ] **Step 1:** write the file. `npx jest tests/lint/showcase-scenarios.test.js` must be green (strict validation, mechanical types, OS ids, the typed-text rule). No guard change is expected; if `Shawshank` trips the typed-text rule on a later target, use `target_pattern` as #309 did. `node bin/mauto.js validate --strict showcase-app/scenarios/watchlist_add_remove.json` → `"ok":true` with no blocking warning.
- [ ] **Step 2: Commit** `test(showcase): watchlist add and remove scenario`.
- [ ] **Step 3: Device check**, through `mauto` verbs only, on the default engine, with the real key, on both the Pixel 9 Pro emulator and the iPhone 17 Pro simulator. Install a fresh build; run `mauto elements` on Popular (`Watchlist` and `Filters` both present beside the active-filters line), on Details (membership line and button labels) and on Watchlist. Then `mauto run showcase-app/scenarios/watchlist_add_remove.json` on each device, and `mauto run` of `filter_drama_1994.json` on Android, which shows the longest active-filters line beside the two buttons. Record exactly what ran in the PR. If a label is missing or content is hidden, report it and consider `engine: legacy` per #379.
- [ ] **Step 4:** release the devices: `mauto session end`, `pkill -f 'mobilecli.* daemon'`, and check that `adb shell pidof` finds no `com.mobilenext.mobilecli.DeviceServer`.

### Task 6: Docs, PRD note, full verification

- [ ] `showcase-app/README.md`: add a `watchlist_add_remove.json` row to the scenario table, and a short "Watchlist" paragraph. It should say the list is kept on the device because TMDB's watchlist needs a signed-in account and a guest session cannot use it, that Reset app data empties it, and that the scenario restarts the app to show the list survives a restart and leaves it empty. Also add the scenario to the README's list of scenarios that start with Reset app data.
- [ ] Comment on #304: the TMDB check table above, the outcome (the list stays on the device) and `Refs #310`.
- [ ] Full verification, output in the PR: `npm test`, `npm run lint`, `npm run lint:guides`, the Gradle and `xcodebuild` commands, `validate --strict` on every showcase scenario, and `git ls-files showcase-app | grep tmdb.properties$` (only `.example`).
- [ ] Mutation checks, each turning a named test red, then restored:
  1. construct `watchlist`'s `StoredValue` directly, so it skips the registry, and check `reset_emptiesWatchlist` goes red;
  2. drop the duplicate check in `add` and check `addTwice_keepsOne` goes red;
  3. make `remove` a no-op and check `remove_dropsOnlyThatFilm` goes red;
  4. have the section view model read the store once instead of following it, and check `savedElsewhere_isReflected` goes red.
- [ ] **Commit** `docs(showcase): watchlist in the README`; push; update the draft PR.

---

## Acceptance map (#310)

| Criterion | Task |
|---|---|
| Add and remove work from Details; membership is visible text | 2, 3, 4 |
| The Watchlist screen lists saved films and survives an app restart | 1 (persistence test), 4, 5 (cold `launch_app` in the scenario) |
| Reset app data empties the watchlist | 1, 2, 5 |
| Whether guest sessions can use TMDB's watchlist is recorded on the PRD | TMDB check, 6 |
| The scenario starts from reset and leaves the watchlist empty | 5 |
| No UI test dependency | existing guard |
| Scenario passes `validate --strict`, mechanical only, no OS id | existing guard, 5 |
