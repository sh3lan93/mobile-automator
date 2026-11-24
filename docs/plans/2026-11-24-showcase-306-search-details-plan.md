# Showcase Search and Film Details (#306) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Search films by title on a Search screen, open any film (from search or the popular list) on a Details screen, with a visible result count and a clear empty message; ship two scenarios: search a fixed title and open it, and search with no results.

**Architecture:** Two new calls on the existing `TmdbClient` (`searchMovies`, `movieDetails`), both through `KtorTmdbClient`'s one private `call(...)`, so key handling, failure mapping and the simulation switches #307 adds there reach them unchanged. Two new screens under `screens/search/` and `screens/details/`, each with a ViewModel unit-tested against a fake client. The list, row, centred-message and failure rendering now inside `PopularScreen.kt` move to `screens/common/` so all three screens share one copy. Two routes added to `App.kt`'s `NavHost`.

**Spec:** issue #306, PRD #304, `docs/plans/2026-11-11-movie-tracker-showcase-design.md`. Conventions from `docs/plans/2026-11-11-showcase-305-skeleton-plan.md` (Global Constraints apply unchanged).

## Global Constraints

All of #305's plan, plus:

- Work only in worktree `sample-app-306-search-details` on branch `sample-app/306-search-details` (subagents: `cd` there and check `git branch --show-current` before any commit).
- Extend `TmdbClient`, `di/Koin.kt` and `App.kt` **additively**; #307 changes the same files in parallel. Do not reshape `call(...)`, `TmdbResult` or `TmdbFailure`.
- No UI test dependency, no `testTag`.
- Nothing under `src/`, `bin/` or `package.json`: no version bump, no CHANGELOG entry.
- Never print, copy or commit the TMDB key.

## Review Focus

1. **Typing fast.** Each keystroke must not fire a request, and a slow earlier response must never overwrite a later query's results. → Task 2.
2. **Clearing the field.** Back to the idle prompt, no request, no stale results. → Task 2.
3. **A details response missing runtime, genres or overview.** Shown without the missing lines, never `null` or `0 min`. → Tasks 1, 4.
4. **A film id TMDB no longer has (404).** `Something went wrong` with Retry, not a crash. → Task 1.
5. **Back from details** returns to the same search results, not a re-run or an empty field. → Task 4.
6. **The text field's own text matching a target on Android.** Guarded in Task 5.

---

## File Structure

```
showcase-app/shared/src/commonMain/kotlin/io/github/sh3lan93/mobileautomator/showcase/
  App.kt                                   # + routes search, details/{movieId}
  di/Koin.kt                               # + SearchViewModel, DetailsViewModel
  data/Movie.kt                            # + MovieDetails
  data/TmdbClient.kt                       # + searchMovies, movieDetails
  data/KtorTmdbClient.kt                   # + two endpoints over the existing call(...)
  screens/common/MovieList.kt              # moved from PopularScreen: MovieList, MovieRow, filmCount
  screens/common/Messages.kt               # moved: Centered, Retryable; new FailureContent
  screens/popular/PopularScreen.kt         # uses common/, + Search action, rows open details
  screens/search/SearchViewModel.kt
  screens/search/SearchScreen.kt
  screens/details/DetailsViewModel.kt
  screens/details/DetailsScreen.kt
showcase-app/shared/src/commonTest/kotlin/.../
  data/KtorTmdbClientTest.kt               # + search and details tests
  screens/search/SearchViewModelTest.kt
  screens/details/DetailsViewModelTest.kt
showcase-app/scenarios/search_open_details.json
showcase-app/scenarios/search_no_results.json
tests/lint/showcase-scenarios.test.js      # + typed-text rule
tests/lint/CLAUDE.md                       # guard paragraph: the new rule
showcase-app/README.md                     # scenarios list
```

---

### Task 1: Search and details in the TMDB client

**Interfaces:**

```kotlin
data class MovieDetails(
    val id: Int,
    val title: String,
    val releaseYear: String?,
    val runtimeMinutes: Int?,      // null when missing or 0
    val genres: List<String>,      // empty when missing
    val overview: String?,         // null when missing or blank
    val posterUrl: String?,
)

/** First page of a search, and TMDB's count of every match (shown as the count line). */
data class SearchPage(val movies: List<Movie>, val totalResults: Int)

interface TmdbClient {
    suspend fun popularMovies(): TmdbResult<List<Movie>>
    suspend fun searchMovies(query: String): TmdbResult<SearchPage>
    suspend fun movieDetails(id: Int): TmdbResult<MovieDetails>
}
```

- Search: `GET /3/search/movie?api_key=…&query=<query>&include_adult=false&language=en-US&page=1`, parsed with the existing `PageDto`/`MovieDto`; `PageDto` gains `total_results` (default 0), so `totalResults` is TMDB's full match count, not the page size (maintainer decision).
- Details: `GET /3/movie/<id>?api_key=…&language=en-US`.
- Year and poster mapping is shared with `MovieDto.toMovie()` (one private helper each), not restated.
- Both go through `call(...)`: blank key → `MissingKey` with no request; 401 → `RejectedKey`; other non-2xx (including details 404) → `ServerError`; unparseable → `ServerError`; I/O → `NoConnection`; cancellation rethrown.

- [ ] **Step 1: Failing tests** added to `KtorTmdbClientTest`:

| Test | Assert |
|---|---|
| `search_sendsQueryAndApiKey` | path `/3/search/movie`; `query` = `the matrix` (space survives encoding); `include_adult=false`, `language=en-US`, `page=1`, `api_key`; no `Authorization` |
| `search_parsesResults` | same mapping as popular (title, year, poster); `totalResults` from `total_results` (e.g. 57 with 20 listed) |
| `search_blankKey_returnsMissingKey_withoutCallingNetwork` | call count 0 |
| `search_http401_returnsRejectedKey` | |
| `details_sendsIdInPath` | path `/3/movie/278`, `api_key`, `language` |
| `details_parsesAllFields` | runtime 142, genres `[Drama, Crime]`, overview, year `1994`, poster URL |
| `details_missingOptionalFields_areNullOrEmpty` | `runtime` null and `0` → null; no `genres` → `[]`; blank overview → null |
| `details_http404_returnsServerError` | |

- [ ] **Step 2:** `./gradlew :shared:testAndroidHostTest` fails on the missing members.
- [ ] **Step 3:** Implement. Private DTO for details inside `KtorTmdbClient.kt`.
- [ ] **Step 4:** `./gradlew :shared:testAndroidHostTest :shared:iosSimulatorArm64Test` passes.
- [ ] **Step 5: Commit** `feat(showcase): search and film details in the TMDB client`.

### Task 2: Search state

**Interfaces:**

```kotlin
sealed interface SearchUiState {
    data object Idle : SearchUiState                       // blank query
    data object Searching : SearchUiState
    data class Results(val movies: List<Movie>, val totalResults: Int) : SearchUiState
    data object NoMatches : SearchUiState
    data class Failed(val failure: TmdbFailure) : SearchUiState
}

class SearchViewModel(private val client: TmdbClient) : ViewModel() {
    val query: StateFlow<String>
    val state: StateFlow<SearchUiState>
    fun onQueryChange(text: String)   // updates query; searches the trimmed text after SEARCH_DEBOUNCE_MS (400)
    fun retry()                       // searches the current trimmed query again, now
}
```

Searching starts as the user types (debounced): no submit key, so a scenario needs no OS-specific "search" key.

- [ ] **Step 1: Failing tests** (fake client recording every query, `StandardTestDispatcher`, `runTest`):
  - `startsIdle_noRequest`
  - `typing_searchesAfterDebounce` — before 400 ms no call; after: `Searching` then `Results`
  - `fastTyping_searchesOnlyTheLastQuery` — `"S"`, `"Sh"`, `"Shawshank"` within the window → one call, `"Shawshank"`
  - `slowEarlierResponse_doesNotOverwriteLaterQuery` — fake suspends the first query; a second query lands; first must not win
  - `blankOrSpacesQuery_isIdle_noRequest`, also after results were shown
  - `queryIsTrimmed`
  - `emptyResult_isNoMatches` (no movies listed, whatever `totalResults` says)
  - `failure_isFailed` (each `TmdbFailure`)
  - `retry_rerunsCurrentQuery`
- [ ] **Steps 2–4:** red, implement (`debounce` + `mapLatest`/`collectLatest` over the query flow in `viewModelScope`), green on both runtimes.
- [ ] **Step 5: Commit** `feat(showcase): debounced search state`.

### Task 3: Details state

```kotlin
sealed interface DetailsUiState {
    data object Loading : DetailsUiState
    data class Loaded(val details: MovieDetails) : DetailsUiState
    data class Failed(val failure: TmdbFailure) : DetailsUiState
}
class DetailsViewModel(private val movieId: Int, private val client: TmdbClient) : ViewModel() {
    val state: StateFlow<DetailsUiState>   // Loading, loads on init
    fun retry()
}
```

- [ ] Tests: `loadsTheGivenId`, `loaded`, `failure_isFailed`, `retry_afterFailure_loadsAgain`. Red, implement, green on both runtimes.
- [ ] **Commit** `feat(showcase): film details state`.

### Task 4: Screens and navigation

**Shared UI (moved, not copied):** `MovieList(movies, onOpen, modifier)` and `MovieRow` (row now clickable), `filmCount(n)`, `Centered`, `Retryable`, and a new `FailureContent(failure, onRetry, modifier)` holding the `when` over `TmdbFailure` that `PopularScreen` has today. Popular, Search and Details all render failures through it.

Exact visible copy (scenario contracts):

| Where | Text |
|---|---|
| Popular top bar action (text button, before `About`) | `Search` |
| Count line | `1 film` / `<n> films`, one `filmCount(n)` for both screens. Popular: films listed (unchanged, reads `20 films`, so `browse_popular`'s `^\d+ films$` holds). Search: TMDB's `total_results` (maintainer decision) |
| Search top bar title / back `contentDescription` | `Search` / `Back` |
| Search field label | `Search films` |
| Idle | `Type a film title to search` |
| Searching | `Searching…` |
| No matches | `No films match your search` |
| Details top bar title / back `contentDescription` | the film title / `Back` |
| Details lines, each only when present | `Released <year>`, `<n> min`, genres joined by `, `, the overview |
| Details poster `contentDescription` | `Poster` (not the title, so the title has one element on the screen) |
| Failures | as #305: `No connection` / `Something went wrong` + `Retry`; key screens unchanged |

Navigation: routes `search` and `details/{movieId}` (Int argument). Rows on Popular and Search open `details/<id>`; every back button and the system back pop one entry. The Search ViewModel is scoped to its back-stack entry, so returning from details keeps the query and results.

- [ ] **Step 1:** Move the shared composables to `screens/common/`; `PopularScreen` uses them (no behaviour change besides clickable rows and the `Search` action).
- [ ] **Step 2:** `SearchScreen(onBack, onOpen)`, `DetailsScreen(movieId, onBack)`; Koin: `viewModelOf(::SearchViewModel)`, `viewModel { (id: Int) -> DetailsViewModel(id, get()) }`.
- [ ] **Step 3:** Routes in `App.kt`.
- [ ] **Step 4: Verify builds:** `./gradlew :shared:testAndroidHostTest :shared:iosSimulatorArm64Test :androidApp:assembleDebug` and #305's `xcodebuild` command.
- [ ] **Step 5: Verify by hand on the Android emulator** with the configured key, driving it only through `mauto` verbs: Popular → Search → type `Shawshank` → count line and `The Shawshank Redemption` → open → title, `Released 1994` → back to the same results → type `xqzvbnmkw` → `No films match your search`; a popular row opens its details. Record the result in the PR.
- [ ] **Step 6: Commit** `feat(showcase): search and details screens`.

### Task 5: Scenarios and the typed-text rule

**Guard rule (new, in `tests/lint/showcase-scenarios.test.js`):** for each scenario, no step target and no assertion target or expected value **after a `type` step** may be contained (case-insensitive) in a value typed earlier. The CLI matches targets as case-insensitive substrings, and Android exposes the field's typed text while iOS does not, so such a target would hit the text field on Android only. Uses `targetValues` from `scenario-targets.js`; restates no field list. Prove it can fail: a fixture or temporary edit with target equal to the typed text goes red, then restore.

**`search_open_details.json`** (`tags: ["showcase","search","details"]`): `launch` → `wait_list` (`Popular films`, 30 s) → `open_search` (tap `Search`, retry policy as `browse_popular`) → `focus_field` (tap `Search films`) → `type_title` (`type`, value `Shawshank`) → `hide_keyboard` (`dismiss_keyboard`) → `wait_result` (`wait_for_element`, target `The Shawshank Redemption`, 15 s) → `open_film` (tap, target `The Shawshank Redemption` + `target_pattern` `^The Shawshank Redemption`, because TMDB also returns "Hope Springs Eternal: A Look Back at The Shawshank Redemption") → `wait_details` (`Released 1994`, 15 s) → `back` (`press_back`) → `wait_results_again` (`The Shawshank Redemption`).
Assertions: after `wait_result`, `pattern_match` `^\d+ films?$`; after `wait_details`, `screen_title` `The Shawshank Redemption` and `element_visible` `Released 1994`; after `wait_results_again`, `pattern_match` `^\d+ films?$`.

**`search_no_results.json`** (`tags: ["showcase","search"]`): launch → wait list → open search → focus field → type `xqzvbnmkw` → hide keyboard → `wait_empty` (`No films match your search`, 15 s). Assertions after `wait_empty`: `element_visible` `No films match your search`; `element_not_exists` `Type a film title to search` (proves the search ran, not the idle prompt).

Both descriptions say a TMDB key is needed. Neither asserts a count value, the popular list's order, or any live number.

- [ ] Write the rule red-first, then the two files; `npx jest tests/lint/showcase-scenarios.test.js` green; `node bin/mauto.js validate --strict` on each → `"ok":true`.
- [ ] **Commit** `test(showcase): search scenarios and the typed-text guard`.

### Task 6: Docs and full verification

- [ ] `tests/lint/CLAUDE.md`: add the typed-text rule to the showcase guard paragraph. `showcase-app/README.md`: list the three scenarios.
- [ ] Full verification, output in the PR: `npm test`, `npm run lint`, `npm run lint:guides`, the Gradle and `xcodebuild` commands, `validate --strict` on all three scenarios, and the no-key-committed checks from #305's Task 7.
- [ ] **Commit** `docs(showcase): search scenarios in the README and guard notes`.

---

## Acceptance map (#306)

| Criterion | Task |
|---|---|
| Typing a title shows matching films and a visible count | 1, 2, 4 |
| Tapping a film opens details; back returns to the list | 3, 4 |
| No-match search shows a clear empty message | 2, 4 |
| Scenarios assert the effect of typing, never the field; films targeted by title | 5 (rule + files) |
| No dependence on popular-list order or live values | 5 |
| No UI test dependency | existing guard |
| Scenarios pass `validate --strict`, mechanical only, no OS id | existing guard, 5 |
