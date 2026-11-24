# Showcase ratings: TMDB guest session, rate, My ratings, remove (#309) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rate a film from its Details screen without an account, using a TMDB guest session; show the current rating as visible text there; list rated films on a "My ratings" screen read back from TMDB; remove a rating. Ship one scenario that resets, rates a film, checks it on both screens, and removes the rating it added.

**Architecture:** Four new calls on `TmdbClient`, all through `KtorTmdbClient`'s private `call(...)` (which gains defaulted `method`/`body`/`notFound` parameters, so existing endpoints are unchanged). A new `GuestRatings` owns the guest-session lifecycle on top of the client and `LocalStore` (session created lazily on the first rating, id kept in the store, replaced when TMDB stops accepting it). Details gets a self-contained rating section with its own view model, so #310 (watchlist) and #311 (details layout flag) add sections beside it without editing it. "My ratings" is a new screen and route.

**Spec:** issue #309, PRD #304 (and its comments), `docs/plans/2026-11-11-movie-tracker-showcase-design.md`. Conventions from the #305, #306 and #307 plans (their Global Constraints apply unchanged).

## Live API check (done while planning, 2026-11-24)

Run with `curl` against `api.themoviedb.org/3`, key from `showcase-app/tmdb.properties` read into a shell variable and never printed. Two throwaway guest sessions; every rating they made was deleted afterwards (both rated lists read back empty).

| Question | Result |
|---|---|
| Guest session with the v3 `api_key` query parameter | `GET /authentication/guest_session/new` → 200, `guest_session_id`, `expires_at` 24 h ahead. No bearer token used or needed. |
| Rate | `POST /movie/{id}/rating?guest_session_id=…` body `{"value":8}` → 201 (status_code 1; 12 on update). Values above 10 → 400 (status_code 18). Unknown film → 404. |
| Remove | `DELETE /movie/{id}/rating?guest_session_id=…` → 200 (status_code 13), also when the film was not rated. |
| Rated list | `GET /guest_session/{id}/rated/movies` → 200 with `results[].rating`. **A session with no ratings returns 404 (status_code 34), not an empty page.** |
| Current rating on one film | `GET /movie/{id}/account_states?guest_session_id=…` → **401 (status_code 3)**: not usable with a guest session. The rated list is the only server source. |
| Unknown / expired session | 401, status_code 3. A rejected key is 401 with status_code **7**, so the two are told apart by the body. |
| Read-back lag | New ratings and deletions showed in the list within about 1 s. One read taken immediately after an update still showed the old value, and one taken right after two quick ratings showed only the first; both had settled on the next read (~1 s later). Twelve reads over two minutes never regressed. |

**Outcome:** guest-session rating works with the `api_key` parameter and the read-back is fast enough to assert on, so the on-device fallback is **not** needed. To make the ~1 s lag invisible to scenarios, a write is reported only after the rated list confirms it (Task 2). This is posted on #304 in Task 7. The TMDB terms (comment on #304) do not rule this out: the app stores only the guest session id on the device.

## Global Constraints

- All of the #305/#306/#307 plans' constraints: Android + iOS only, no UI test dependency, no `testTag`, no committed key, v3 `api_key` only, schema 2.1 platform-agnostic scenarios with mechanical assertions, visible-text facts, devices driven only through `mauto` verbs.
- Nothing under `src/`, `bin/` or `package.json`: no version bump, no CHANGELOG entry.
- **Additive.** #308 (PR #380, still open) edits `PopularScreen.kt`, `App.kt`, `di/Koin.kt`, `TmdbClient`/`KtorTmdbClient` and adds a shared test `FakeTmdbClient`. This slice adds members, a defaulted parameter list on `call(...)`, one route, one top-bar action and one `PopularScreen` parameter; it reshapes nothing. Re-sync with `node scripts/sync-branch.js` when #308 merges and add the four new members to its shared fake then.
- `TmdbFailure` and `TmdbResult` are unchanged: an expired guest session is an outcome `GuestRatings` handles, never a failure a screen sees.
- Default engine (mobilecli). Switch to `engine: legacy` only if `mauto elements` shows a missing label or hidden content, and say so (#379).
- **No device work without asking the maintainer first** (the #308 worker holds both devices).
- Worktree `sample-app-309-ratings-guest-session`, branch `sample-app/309-ratings-guest-session`. Subagents `cd` there and check `git branch --show-current` before any commit. Per-task commits ending with the repo's `Co-Authored-By` line.

## Review Focus

1. **Expired guest session shown as "TMDB rejected your key".** 401 status_code 3 must not map to `RejectedKey`. → Task 1 (body status_code), Task 2 (new session, retry once).
2. **Empty rated list shown as "Something went wrong".** 404 on the rated list is "no ratings". → Task 1.
3. **Read-back lag.** Back to My ratings straight after rating or removing must show the new state. → Task 2 (confirm before reporting done).
4. **Double taps.** Two quick score taps must not create two sessions or interleave writes. → Task 2 (mutex), Task 3 (buttons disabled while saving).
5. **Reset** clears the session id, so the next rating starts a new session with no ratings. → Task 2 test, scenario.
6. **Target collisions** (CLI targets are case-insensitive substrings, first match wins). → Task 4 copy table.
7. **Later slices.** #310 adds a watchlist section and store entry, #311 a details layout flag; neither should need to edit the rating section. → Task 3/4 structure.

---

## File Structure

```
showcase-app/shared/src/commonMain/kotlin/io/github/sh3lan93/mobileautomator/showcase/
  data/Movie.kt                     # + RatedMovie
  data/TmdbClient.kt                # + GuestCall<T>, four members
  data/KtorTmdbClient.kt            # + four endpoints; call(...) gains defaulted method/body/notFound; 401 split by status_code
  data/GuestRatings.kt              # NEW: session lifecycle, write-then-confirm, rating text
  store/LocalStore.kt               # + guestSessionId (string factory now used)
  screens/details/RatingSection.kt  # NEW: RatingViewModel + RatingSection composable
  screens/details/DetailsScreen.kt  # renders RatingSection under the details lines (one call)
  screens/ratings/MyRatingsViewModel.kt   # NEW
  screens/ratings/MyRatingsScreen.kt      # NEW
  screens/common/MovieList.kt       # MovieList/MovieRow gain a defaulted `supporting` line
  screens/popular/PopularScreen.kt  # + `My ratings` top-bar action, + onRatings
  App.kt                            # + route ratings
  di/Koin.kt                        # + GuestRatings, RatingViewModel, MyRatingsViewModel
showcase-app/shared/src/commonTest/kotlin/.../
  data/KtorTmdbClientTest.kt        # + guest-session endpoint tests
  data/GuestRatingsTest.kt          # NEW
  screens/details/RatingViewModelTest.kt  # NEW
  screens/ratings/MyRatingsViewModelTest.kt  # NEW
  store/LocalStoreTest.kt           # + guest session id persists and is cleared by reset
  (Search/Details/Popular private fakes gain the four members as error("not used"))
showcase-app/scenarios/rate_and_remove.json   # NEW
showcase-app/README.md                        # scenarios list + one ratings paragraph
```

---

### Task 1: Guest-session calls in the TMDB client

**Interfaces:**

```kotlin
// data/Movie.kt
/** A film the guest session rated; [rating] is TMDB's value, 0.5..10. */
data class RatedMovie(val movie: Movie, val rating: Double)

// data/TmdbClient.kt
/** A guest-session call either did its work or found that TMDB no longer accepts the session. */
sealed interface GuestCall<out T> {
    data class Done<T>(val value: T) : GuestCall<T>
    data object SessionExpired : GuestCall<Nothing>
}

interface TmdbClient {
    // existing members unchanged
    suspend fun createGuestSession(): TmdbResult<String>
    suspend fun rateMovie(sessionId: String, movieId: Int, value: Double): TmdbResult<GuestCall<Unit>>
    suspend fun removeRating(sessionId: String, movieId: Int): TmdbResult<GuestCall<Unit>>
    suspend fun ratedMovies(sessionId: String): TmdbResult<GuestCall<List<RatedMovie>>>
}
```

- Endpoints: `GET authentication/guest_session/new`; `POST movie/{id}/rating` (JSON `{"value":…}`); `DELETE movie/{id}/rating`; `GET guest_session/{id}/rated/movies` (`language=en-US`, `page=1`, `sort_by=created_at.asc`). Session calls pass `guest_session_id` as a query parameter, beside `api_key`. Never an `Authorization` header.
- `call(...)` gains defaulted parameters: `method: HttpMethod = Get`, `body: Any? = null` (sent as JSON), `notFound: (() -> T)? = null` (a 404 becomes `Ok(notFound())` when given). Existing endpoints pass none of them, so their behaviour and tests are untouched. Missing-key and simulation checks run first for the new calls too.
- 401 handling inside `call(...)`: read the body's `status_code`; `3` → the call returns a value the guest-session members turn into `GuestCall.SessionExpired`; anything else (including `7` and an unreadable body) → `RejectedKey`, exactly as today. Exact mechanism (an internal sentinel or a `sessionExpired: (() -> T)?` parameter mirroring `notFound`) is the implementer's, as long as it is one place.
- The rated list's 404 → `Ok(Done(emptyList()))`.
- Rated rows reuse the existing `MovieDto` mapping (one private DTO with an added `rating` field, or a wrapper), not a copy of the year/poster mapping.

- [ ] **Step 1: Failing tests** in `KtorTmdbClientTest`:

| Test | Assert |
|---|---|
| `createGuestSession_returnsId` | path `/3/authentication/guest_session/new`, `api_key`, no `Authorization`; id parsed |
| `rateMovie_postsValueWithSession` | `POST /3/movie/278/rating`, `guest_session_id`, `api_key`, JSON body `{"value":8.0}`; 201 → `Done(Unit)` |
| `removeRating_deletesWithSession` | `DELETE /3/movie/278/rating`, `guest_session_id`; 200 → `Done(Unit)` |
| `ratedMovies_parsesRatingAndFilm` | `/3/guest_session/<id>/rated/movies`; title, year, poster, rating 8.0 |
| `ratedMovies_404_isEmptyList` | `Ok(Done([]))` |
| `sessionCalls_401Status3_isSessionExpired` | all three session calls |
| `sessionCalls_401Status7_isRejectedKey` | and 401 with an unreadable body → `RejectedKey` |
| `guestCalls_blankKey_missingKey_noRequest` | call count 0 |
| `guestCalls_simulatedOffline_noRequest` | call count 0 |
| `rateMovie_404_isServerError` | unknown film (no `notFound` on this call) |

- [ ] **Step 2–4:** red, implement, green on `./gradlew :shared:testAndroidHostTest :shared:iosSimulatorArm64Test`. All existing client tests untouched and green.
- [ ] **Step 5: Commit** `feat(showcase): guest-session rating calls in the TMDB client`.

### Task 2: Guest ratings (session lifecycle)

**Interfaces:**

```kotlin
// store/LocalStore.kt
val guestSessionId = string("guest_session_id")   // null until the first rating; cleared by reset()

// data/GuestRatings.kt
class GuestRatings(
    private val client: TmdbClient,
    private val store: LocalStore,
    private val confirmAttempts: Int = 10,
    private val confirmIntervalMs: Long = 500,
) {
    suspend fun rated(): TmdbResult<List<RatedMovie>>
    suspend fun ratingFor(movieId: Int): TmdbResult<Double?>
    suspend fun rate(movieId: Int, value: Double): TmdbResult<Unit>
    suspend fun remove(movieId: Int): TmdbResult<Unit>
}

/** `8.0` → `"Your rating: 8/10"`, `6.5` → `"Your rating: 6.5/10"`: the one formatter both screens use. */
fun ratingText(value: Double): String
```

- **No session yet:** `rated()` → `Ok([])` and `ratingFor` → `Ok(null)` without any request; `remove` → `Ok` without a request. `rate` creates a session, stores its id, then rates. Sessions are never created just to read, so launches do not mint sessions.
- **Session expired:** clear the stored id. `rated`/`ratingFor` → empty / null (a new session has no ratings). `rate` → create a new session and retry once. `remove` → `Ok` (nothing is rated in a new session).
- **Write-then-confirm:** after a successful POST/DELETE, read `rated()` until it shows the write (the film with that value / the film absent), up to `confirmAttempts` reads `confirmIntervalMs` apart; then return `Ok` either way (the write was accepted; confirmation only hides the lag). A read failure during confirmation ends confirmation, not the write.
- A `Mutex` serialises `rate`/`remove` (and session creation), so two quick taps never create two sessions or interleave.
- Reads the session id from the store on every call: no cached copy, so Reset takes effect at once.

- [ ] **Step 1: Failing tests** `GuestRatingsTest` (scripted fake `TmdbClient`, real `LocalStore` over `InMemoryKeyValueStorage`, `runTest` virtual time):
  - `noSession_readsAreEmpty_withoutRequests`
  - `firstRate_createsAndStoresSession_thenRates`
  - `secondRate_reusesSession`
  - `rate_waitsUntilListShowsValue` (list stale for two reads, then current → three reads, `Ok`)
  - `rate_confirmationGivesUp_stillOk` (after `confirmAttempts` reads)
  - `remove_waitsUntilFilmAbsent`
  - `expiredSession_onRate_createsNewSessionAndRetriesOnce`
  - `expiredSession_onRead_clearsIdAndReadsEmpty`
  - `rateFailure_isReturned_sessionKept` (e.g. `NoConnection`)
  - `concurrentRates_createOneSession`
  - `reset_clearsSession_nextRateCreatesNew`
  - `ratingText_formatsWholeAndHalf`
  - `LocalStoreTest`: `guestSessionId_persistsAndResetClearsIt`
- [ ] **Step 2–4:** red, implement, green on both runtimes. Remove the `@Suppress("unused")` on `string(...)`.
- [ ] **Step 5: Commit** `feat(showcase): guest ratings with session lifecycle and read-back confirmation`.

### Task 3: Rating section on Details

**Interfaces:**

```kotlin
sealed interface RatingUiState {
    data object Checking : RatingUiState
    data object NotRated : RatingUiState
    data class Rated(val value: Double) : RatingUiState
    data object Saving : RatingUiState
    data class Failed(val failure: TmdbFailure, val last: RatingUiState) : RatingUiState   // last known Rated/NotRated, kept on screen
}

class RatingViewModel(private val movieId: Int, private val ratings: GuestRatings) : ViewModel() {
    val state: StateFlow<RatingUiState>   // Checking, reads ratingFor(movieId) on init
    fun rate(value: Int)                   // ignored while Saving
    fun remove()
    fun retry()                            // re-reads after a failed check
}

@Composable fun RatingSection(movieId: Int, viewModel: RatingViewModel = koinViewModel(key = "rating-$movieId") { parametersOf(movieId) })
```

- `DetailsScreen` calls `RatingSection(movieId)` once, after the details lines, only when details are loaded. That one line is the only edit to `DetailsScreen`/`DetailsContent`; `DetailsViewModel` and its tests are unchanged. #310 adds its watchlist section the same way; #311's layout flag arranges sections without editing them.
- [ ] **Step 1: Failing tests** `RatingViewModelTest`: `checksOnInit_notRated`, `checksOnInit_rated`, `rate_showsSavingThenRated`, `rate_ignoredWhileSaving`, `remove_showsNotRated`, `rateFailure_keepsLastStateAndShowsFailure`, `checkFailure_retryReadsAgain`.
- [ ] **Step 2–4:** red, implement view model and composable, green.
- [ ] **Step 5: Commit** `feat(showcase): rate and remove a rating on the details screen`.

### Task 4: My ratings screen, navigation, copy

```kotlin
sealed interface MyRatingsUiState {
    data object Loading : MyRatingsUiState
    data object Empty : MyRatingsUiState
    data class Loaded(val films: List<RatedMovie>) : MyRatingsUiState
    data class Failed(val failure: TmdbFailure) : MyRatingsUiState
}
class MyRatingsViewModel(private val ratings: GuestRatings) : ViewModel() {
    val state: StateFlow<MyRatingsUiState>
    fun refresh()            // called each time the screen resumes, so back from Details re-reads
}
@Composable fun MyRatingsScreen(onBack: () -> Unit, onOpen: (Int) -> Unit, viewModel: MyRatingsViewModel = koinViewModel())
```

- The list reuses `MovieList`/`MovieRow`: both gain a defaulted `supporting: (Movie) -> String? = { it.releaseYear }` line, and My ratings passes the rating text. No second list composable.
- Re-reads on every resume (`LifecycleResumeEffect`), so a rating removed on Details is gone when the user comes back.
- Route `ratings`; a row opens `details/<id>`; back pops one entry.

Exact visible copy (scenario contracts):

| Where | Text |
|---|---|
| Popular top bar | new icon button (star), `contentDescription` `My ratings`, between `Refresh` and `Settings`; existing actions unchanged |
| My ratings top bar / back | `My ratings` / `Back` |
| My ratings count line | `1 rated film` / `<n> rated films` |
| My ratings row | film title; supporting line `Your rating: 8/10` |
| My ratings loading / empty | `Loading your ratings…` / `You have not rated any films yet` |
| Rating section status | `Checking your rating…` / `You have not rated this film` / `Your rating: 8/10` / `Saving your rating…` |
| Score buttons | ten buttons showing `1`…`10`; each exposes only the label `Rate <n> out of 10` (semantics cleared and set, so the bare digit is not an element) |
| Remove button (only when rated) | `Remove rating` |
| Rating failure line | `Could not reach TMDB. Try again.` (no connection) / `Could not update your rating. Try again.` (anything else); a failed check also shows `Retry` |
| Failures on My ratings | the shared `FailureContent` (`No connection` / `Something went wrong` + `Retry`, key screens) |

Collision check: no new label is a case-insensitive substring of other text on its screen (`Rate 1 out of 10` vs `Rate 10 out of 10` differ at the digit; `My ratings` appears on no other popular-screen text; `Your rating:` appears only in status lines, never as a target).

- [ ] **Step 1: Failing tests** `MyRatingsViewModelTest`: `loads_loaded`, `noRatings_empty`, `failure_failed`, `refresh_reReads`.
- [ ] **Step 2–3:** red, implement screen, `MovieList` parameter, popular action, route, Koin.
- [ ] **Step 4:** `./gradlew :shared:testAndroidHostTest :shared:iosSimulatorArm64Test :androidApp:assembleDebug` and the #305 `xcodebuild` command.
- [ ] **Step 5: Commit** `feat(showcase): My ratings screen read back from TMDB`.

### Task 5: Scenario

`rate_and_remove.json` (schema 2.1, `platform-agnostic`, `cross-platform`, shared `app_package`, tags `["showcase","ratings"]`; description says a TMDB key is needed and that it removes the rating it adds):

1. `launch`; `wait_list` (`Popular films`, 30 s)
2. `open_settings` (tap `Settings`, retry policy as `simulate_offline`); `wait_settings` (`Reset app data`); `reset` (tap); `wait_reset` (`Popular films`, 30 s)
3. `open_search` (tap `Search`); `focus_field` (tap `Search films`); `type_title` (`Shawshank`); `hide_keyboard` (`dismiss_keyboard`); `wait_result` (`The Shawshank Redemption`, 15 s); `open_film` (tap, `target_pattern` `^The Shawshank Redemption`, as #306)
4. `wait_not_rated` (`You have not rated this film`, 15 s) — assertion `element_visible` `You have not rated this film` (caused by the reset: a new session has no ratings)
5. `rate_8` (tap `Rate 8 out of 10`); `wait_rated` (`Your rating: 8/10`, 20 s) — assertion `element_visible` `Your rating: 8/10`
6. `back_to_results`, `back_to_list` (`press_back` ×2, each followed by a wait on `Search films` / `Popular films`); `open_ratings` (tap `My ratings`); `wait_ratings` (`The Shawshank Redemption`, 15 s) — assertions `element_visible` `Your rating: 8/10`, `text_contains` `1 rated film`
7. `open_rated_film` (tap `The Shawshank Redemption`); `wait_rated_again` (`Your rating: 8/10`); `remove` (tap `Remove rating`); `wait_removed` (`You have not rated this film`, 20 s) — assertion `element_visible` `You have not rated this film`
8. `back_to_ratings` (`press_back`); `wait_empty` (`You have not rated any films yet`, 15 s) — assertions `element_visible` `You have not rated any films yet`, `element_not_exists` `Your rating: 8/10`

It asserts only text the scenario caused (the rating it set, its removal, the reset's empty state) and the long-settled title. If it fails part-way, the rating stays on a guest session nothing reads again: the next run's Reset starts a new session.

- [ ] **Step 1:** write the file; `npx jest tests/lint/showcase-scenarios.test.js` green (existing guard: strict validation, mechanical types, OS ids, typed-text rule; no guard change expected); `node bin/mauto.js validate --strict showcase-app/scenarios/rate_and_remove.json` → `"ok":true`, no blocking warning.
- [ ] **Step 2: Commit** `test(showcase): rate and remove scenario`.

### Task 6: By-hand device check (only after the maintainer frees a device)

- [ ] Ask the maintainer for a device. Then, through `mauto` verbs only, default engine: `mauto elements` on Details and My ratings (labels present, `Rate <n> out of 10` exposed, no hidden content; if not, report and consider `engine: legacy` per #379), and replay `rate_and_remove.json` on that device. Record exactly what ran in the PR; if no device is granted, leave it unchecked.

### Task 7: Docs, PRD note, full verification

- [ ] `showcase-app/README.md`: add `rate_and_remove.json` to the scenario list and one paragraph: ratings use a TMDB guest session (no account), the session id is kept on the device and cleared by Reset app data, and the scenario removes the rating it adds.
- [ ] Comment on #304: the live API check table above, the outcome (no fallback), and `Refs #309`.
- [ ] Full verification, output in the PR: `npm test`, `npm run lint`, `npm run lint:guides`, the Gradle and `xcodebuild` commands, `validate --strict` on every showcase scenario, `git ls-files showcase-app | grep tmdb.properties$` (only `.example`).
- [ ] Mutation checks: map 401 status 3 to `RejectedKey`, drop the 404 → empty mapping, skip `reset` of the session (remove the `guestSessionId` declaration's registration), skip confirmation; each must turn a named test red; restore.
- [ ] **Commit** `docs(showcase): ratings in the README`; push; update the draft PR.

---

## Acceptance map (#309)

| Criterion | Task |
|---|---|
| A rating is stored by TMDB under a guest session and shown as visible text on Details | 1, 2, 3 |
| My ratings lists rated films from the server; removing a rating removes it there | 1, 2, 4 |
| The guest session id lives in the local store and is cleared by Reset app data | 2 |
| Authentication outcome and fallback decision recorded on the PRD | Live API check, 7 |
| Guest-session flow in the TMDB client unit-tested | 1, 2 |
| Rating scenario starts from reset and leaves no rating behind | 5 |
| No UI test dependency | existing guard |
| Scenario passes `validate --strict`, mechanical only, no OS id | existing guard, 5 |
