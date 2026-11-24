# Showcase Filters and Sort (#308) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Filter the popular film list by genre, release year and minimum rating, and change its sort order, each change being a TMDB discover call; show the active filters and the result count as visible text; ship two filter scenarios, one ending on the no-results message. Record on PRD #304 whether a filter chip's selected state reaches `mauto elements` on Android and iOS.

**Architecture:** A pure `FilterState` value (`data/FilterState.kt`) with `toDiscoverQuery()` and `activeFiltersText()`. Two new `TmdbClient` calls (`discoverMovies`, `movieGenres`) through `KtorTmdbClient`'s one private `call(...)`, so key handling, failure mapping and #307's simulation switches reach them unchanged. `PopularViewModel` owns the current `FilterState`: default state → `popularMovies()` as today; anything else → `discoverMovies(state.toDiscoverQuery())`. A new Filters screen (route `filters`) edits that same view model (obtained from the popular back-stack entry) and has a small `FiltersViewModel` of its own that loads the genre list. The popular screen gains one filter row above the list: the active-filters text and a `Filters` button.

**Spec:** issue #308, PRD #304 (and its comments), `docs/plans/2026-11-11-movie-tracker-showcase-design.md`. Conventions from the #305 and #306 plans (Global Constraints apply unchanged).

## Global Constraints

All of #305's and #306's, plus:

- Work only in worktree `sample-app-308-filters-sort` on branch `sample-app/308-filters-sort` (subagents: `cd` there and check `git branch --show-current` before any commit).
- Extend `TmdbClient`, `KtorTmdbClient`, `di/Koin.kt`, `App.kt` and `PopularScreen.kt` **additively**: #307 (PR #376) edits the same files and lands first or in parallel. Do not reshape `call(...)`, `TmdbResult`, `TmdbFailure`, the top bar actions, or the `PopularScreen` parameter list beyond adding one parameter.
- No UI test dependency, no `testTag`.
- Nothing under `src/`, `bin/` or `package.json`: no version bump, no CHANGELOG entry.
- Default engine (mobilecli). Switch to `engine: legacy` only if `mauto elements` shows a missing label or hidden content, and say so in the PR (#379).
- Never print, copy or commit the TMDB key. No device work without asking the maintainer first.

## Review Focus

1. **Fast chip taps.** Every change cancels the in-flight load; a slow earlier response never overwrites a later filter's results. → Task 3.
2. **Back to the default state** (Clear, or deselecting everything) goes back to the popular endpoint, not a discover call. → Task 3.
3. **Target collisions.** The CLI matches targets as case-insensitive substrings, first match wins. No chip label may be a substring of other text on the Filters screen, and the popular screen's `Filters` button must not collide with any other text there. → Task 4 copy table.
4. **Rating sorts without a vote floor** return 10/10 films with one vote. → Task 1.
5. **Everything on the Filters screen fits one phone screen**, so no scenario needs a scroll. → Task 4 Step 5.

---

## File Structure

```
showcase-app/gradle/libs.versions.toml                     # + kotlinx-datetime
showcase-app/shared/build.gradle.kts                       # + kotlinx-datetime in commonMain
showcase-app/shared/src/commonMain/kotlin/io/github/sh3lan93/mobileautomator/showcase/
  data/FilterState.kt          # NEW: FilterState, Sort, Genre, decades/years helpers
  data/Movie.kt                # SearchPage doc generalised ("a first page and TMDB's total"); no shape change
  data/TmdbClient.kt           # + discoverMovies, movieGenres
  data/KtorTmdbClient.kt       # + two endpoints over the existing call(...)
  di/Koin.kt                   # + FiltersViewModel (with the current year)
  App.kt                       # + route filters
  screens/popular/PopularViewModel.kt   # + filters: StateFlow<FilterState>, setFilters, NoMatches, count
  screens/popular/PopularScreen.kt      # + filter row (active-filters text, Filters button); + onFilters
  screens/filters/FiltersViewModel.kt   # NEW: genre list loading
  screens/filters/FiltersScreen.kt      # NEW
showcase-app/shared/src/commonTest/kotlin/.../
  data/FilterStateTest.kt               # NEW
  data/KtorTmdbClientTest.kt            # + discover and genres tests
  screens/popular/PopularViewModelTest.kt  # + filter tests (fake gains the two members)
  screens/filters/FiltersViewModelTest.kt  # NEW
  (Search/Details test fakes gain the two members, error("not used"))
showcase-app/scenarios/filter_drama_1994.json     # NEW
showcase-app/scenarios/filter_no_results.json     # NEW
showcase-app/README.md                            # scenarios list
```

---

### Task 1: Filter state (pure)

```kotlin
data class Genre(val id: Int, val name: String)

enum class Sort(val label: String, val sortBy: String) {
    MostPopular("Most popular", "popularity.desc"),     // default
    HighestRated("Highest rated", "vote_average.desc"),
    MostVotes("Most votes", "vote_count.desc"),
    TopGrossing("Top grossing", "revenue.desc"),
}

data class FilterState(
    val genre: Genre? = null,
    val year: Int? = null,
    val minRating: Int? = null,          // 5..9, "N+" meaning vote_average >= N
    val sort: Sort = Sort.MostPopular,
) {
    val isDefault: Boolean               // == FilterState()
    fun toDiscoverQuery(): Map<String, String>
    fun activeFiltersText(): String
}

const val MIN_VOTES_FOR_RATING = 200
val RATING_STEPS = 5..9
fun decades(currentYear: Int): List<Int>               // 1930, 1940, … up to currentYear's decade
fun yearsOf(decade: Int, currentYear: Int): List<Int>   // decade..decade+9, capped at currentYear
```

- `toDiscoverQuery()`: always `sort_by`, `include_adult=false`, `language=en-US`, `page=1`; `with_genres=<id>`, `primary_release_year=<y>`, `vote_average.gte=<n>` when set; `vote_count.gte=200` whenever `minRating` is set or the sort is `HighestRated` (otherwise one-vote 10/10 films top the list). Never `api_key`: that stays in `call(...)`.
- `activeFiltersText()`: the set parts joined by ` · ` in the order genre name, year, `Rated <n>+`, sort label, the sort included only when not the default. Default state → `All films`. Examples: `Drama · 1994 · Rated 8+ · Highest rated`, `Most votes`, `Animation · 1931 · Rated 9+`.
- Tests (`FilterStateTest`): default query (popularity, no filter keys) and `isDefault`; each field alone; the vote floor for a rating and for `HighestRated` and its absence otherwise; full combination; each text example above plus default; `decades(2026)` = 1930…2020; `yearsOf(2020, 2026)` = 2020…2026; `yearsOf(1990, 2026)` = 1990…1999.
- [ ] Red, implement, green on `./gradlew :shared:testAndroidHostTest :shared:iosSimulatorArm64Test`.
- [ ] **Commit** `feat(showcase): filter state with its discover query and active-filters text`.

### Task 2: Discover and genres in the TMDB client

```kotlin
interface TmdbClient {
    // existing three unchanged
    suspend fun discoverMovies(query: Map<String, String>): TmdbResult<SearchPage>
    suspend fun movieGenres(): TmdbResult<List<Genre>>
}
```

- `GET /3/discover/movie` with every entry of `query` as a parameter, parsed with the existing `PageDto` (so `totalResults` is TMDB's full count). `GET /3/genre/movie/list?language=en-US` → `{"genres":[{id,name}]}`.
- Tests: `discover_sendsEveryQueryParamAndApiKey`, `discover_parsesResultsAndTotal`, `discover_blankKey_returnsMissingKey_withoutCallingNetwork`, `discover_http401_returnsRejectedKey`, `genres_sendsPathAndLanguage`, `genres_parses`, `genres_http500_returnsServerError`.
- [ ] Red, implement, green on both runtimes. **Commit** `feat(showcase): discover and genre list in the TMDB client`.

### Task 3: Filters on the list's state

```kotlin
sealed interface PopularUiState {
    data object Loading
    data class Loaded(val movies: List<Movie>, val count: Int = movies.size)   // count: listed (popular) or total_results (discover)
    data object Empty          // popular returned nothing (unchanged)
    data object NoMatches      // discover returned nothing
    data class Failed(val failure: TmdbFailure)
}

class PopularViewModel(client: TmdbClient) {
    val filters: StateFlow<FilterState>     // FilterState() initially
    fun setFilters(state: FilterState)      // no-op when equal; else cancels the in-flight load and loads
    fun retry()                             // reloads the current filters (unchanged signature)
}

class FiltersViewModel(client: TmdbClient, val currentYear: Int) {
    val genres: StateFlow<GenresUiState>    // Loading | Loaded(List<Genre>) | Failed(TmdbFailure); loads on init
    fun retry()
}
```

- Tests added to `PopularViewModelTest` (fake records every call): `default_usesPopular_notDiscover`; `setFilters_loadsDiscoverWithThatQuery`; `discoverCount_isTotalResults`; `emptyDiscover_isNoMatches`; `backToDefault_usesPopularAgain`; `lastChangeWins` (fake suspends the first discover; a second change lands; first must not win); `sameFilters_noReload`; `retry_reloadsCurrentFilters`; `discoverFailure_isFailed`. Existing tests stay green (the `Loaded` default keeps them).
- `FiltersViewModelTest`: loads genres; failure; retry after failure.
- [ ] Red, implement, green on both runtimes. **Commit** `feat(showcase): filtered list state`.

### Task 4: Filters screen and the filter row

**Popular screen:** a row above the list in every state: the active-filters text (`filters.activeFiltersText()`) and a `Filters` text button. `PopularScreen` gains `onFilters: () -> Unit`; nothing else in its signature or top bar changes. `NoMatches` shows `No films match this combination`. The `Loaded` count line is `filmCount(count)`.

**Filters screen** (route `filters`, `koinViewModel<PopularViewModel>(viewModelStoreOwner = popular back-stack entry)` plus its own `FiltersViewModel`). Every chip tap calls `setFilters(...)` at once (a live discover call); `Done` and back pop to the list. Sections top to bottom, single-select `FilterChip`s in `FlowRow`s:

| Section heading | Chips |
|---|---|
| `Sort by` | `Most popular`, `Highest rated`, `Most votes`, `Top grossing` |
| `Minimum rating` | `Any rating`, `5+` … `9+` |
| `Release year` | `Any year`, decades `1930s` … `2020s`; once a decade is chosen, its years (`1990` … `1999`) below |
| `Genre` | `Any genre`, then TMDB's genres in TMDB's order; while loading `Loading genres…`; on failure `Genres could not load` + `Retry` |

Top bar: back (`contentDescription` `Back`), title `Filters`, actions `Clear` (→ `FilterState()`) and `Done`.

Copy rules (Review Focus 3): the active-filters text appears only on the popular screen, never on the Filters screen (it contains chip labels); the default text is `All films` and the empty message avoids the word "filters", so the `Filters` button is the only "filters" match on the popular screen; chip labels are unique substrings on the Filters screen (`Any rating` / `Any year` / `Any genre`, not `Any`).

- [ ] **Step 1:** Filter row, `NoMatches`, `onFilters`; Filters screen and route; Koin `viewModel { FiltersViewModel(get(), Clock.System.todayIn(TimeZone.currentSystemDefault()).year) }`.
- [ ] **Step 2:** `./gradlew :shared:testAndroidHostTest :shared:iosSimulatorArm64Test :androidApp:assembleDebug` and #305's `xcodebuild` command.
- [ ] **Step 3: Chip selected state (ask before device work).** On each platform, open Filters, select `Drama`, run `node bin/mauto.js elements` and record what the `Drama` chip element carries (text, label, type) against an unselected chip. The normalised element model (`src/device/element-model.js`) keeps only `text`, `accessibility_label`, `type` and bounds, so the expected answer is "not exposed" unless a platform folds the state into the label; the device says. Post the answer on PRD #304 as a comment. Also report whether any label is missing or content hidden on the default engine (#379).
- [ ] **Step 4: By-hand check** through `mauto` verbs only, on whichever device is free: the two scenario paths below, plus Clear → `All films` and the popular count line.
- [ ] **Step 5:** On the same device, confirm every Filters-screen chip a scenario taps is in `mauto elements` without scrolling. If not, tighten spacing/section order until it is; scenarios never scroll.
- [ ] **Commit** `feat(showcase): filters screen and the active-filters row`.

### Task 5: Scenarios

Same shape as the search scenarios (schema 2.1, platform-agnostic, cross-platform, shared `app_package`, descriptions say a TMDB key is needed). No `type` step, so the typed-text rule is vacuous for them.

**`filter_drama_1994.json`** (`tags: ["showcase","filters"]`): `launch` → `wait_list` (`Popular films`, 30 s) → `open_filters` (tap `Filters`, retry policy as `open_search`) → `wait_filters` (`Minimum rating`, 15 s) → `sort_rating` (tap `Highest rated`) → `rating_8` (tap `8+`) → `decade_1990s` (tap `1990s`) → `year_1994` (tap `1994`) → `wait_genres` (`Drama`, 15 s) → `genre_drama` (tap `Drama`) → `done` (tap `Done`) → `wait_filtered` (`Drama · 1994 · Rated 8+ · Highest rated`, 15 s) → `wait_film` (`The Shawshank Redemption`, 15 s).
Assertions after `wait_film`: `element_visible` `Drama · 1994 · Rated 8+ · Highest rated`; `pattern_match` `^\d+ films?$`; `element_visible` `The Shawshank Redemption` (a long-settled fact: a 1994 drama rated far above 8 with tens of thousands of votes, first in that list for years).

**`filter_no_results.json`** (`tags: ["showcase","filters"]`): launch → wait list → open filters → wait filters → `rating_9` (tap `9+`) → `decade_1930s` → `year_1931` → wait genres (`Animation`) → `genre_animation` → done → `wait_empty` (`No films match this combination`, 15 s) → `open_filters_again` → `clear` (tap `Clear`) → `done_again` → `wait_all` (`All films`, 15 s).
Assertions: after `wait_empty`, `element_visible` `No films match this combination` and `element_visible` `Animation · 1931 · Rated 9+` (no 1931 animated film has 200 votes, let alone a 9 average: settled); after `wait_all`, `pattern_match` `^\d+ films$` and `element_not_exists` `No films match this combination`.

- [ ] Write both; `npx jest tests/lint/showcase-scenarios.test.js` green; `node bin/mauto.js validate --strict showcase-app/scenarios/<file>` → `"ok":true` for each.
- [ ] **Commit** `test(showcase): filter scenarios`.

### Task 6: Docs and full verification

- [ ] `showcase-app/README.md`: list the two scenarios.
- [ ] Full verification, output in the PR: `npm test`, `npm run lint`, `npm run lint:guides`, the Gradle and `xcodebuild` commands, `validate --strict` on every scenario, `git ls-files showcase-app | grep tmdb.properties$` (only `.example`).
- [ ] Mutation check: drop the vote floor and the `isDefault` → popular branch; the tests that guard them go red; restore.
- [ ] **Commit** `docs(showcase): filter scenarios in the README`.

---

## Acceptance map (#308)

| Criterion | Task |
|---|---|
| Genre, year, minimum rating and sort each change the list through discover | 1, 2, 3, 4 |
| Active filters and result count are visible text on both platforms | 4 (+ Step 3 on both platforms) |
| Chip selected state on Android and iOS recorded on the PRD | 4 Step 3 |
| Filter state is a pure value with unit tests for its query and text | 1 |
| Long-settled combinations; a no-result filter shows the empty message | 5 |
| No UI test dependency | existing guard |
| Scenarios pass `validate --strict`, mechanical only, no OS id | existing guard, 5 |
