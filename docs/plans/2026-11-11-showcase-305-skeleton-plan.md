# Showcase App Skeleton (#305) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Compose Multiplatform app in `showcase-app/` that builds for Android and iOS, reads a bring-your-own TMDB key, shows the popular films list, explains a missing or rejected key, carries the TMDB attribution, and ships one scenario plus the build-time guard over showcase scenarios.

**Architecture:** One shared Kotlin module holds all UI and logic; thin Android and iOS app shells host it. Every remote call goes through one `TmdbClient` interface that maps transport and HTTP outcomes to four app-level failures; screens only see `TmdbResult`. The TMDB key is turned into a generated Kotlin constant at build time from a git-ignored properties file, so both platforms get it the same way.

**Tech Stack:** Kotlin Multiplatform, Compose Multiplatform, Ktor client (+ `ktor-client-mock` in tests), kotlinx.serialization, Koin, navigation-compose, Coil 3, kotlinx-coroutines-test; Jest for the repo-side guard. Versions: start from the template's version catalog (the spike built with Compose Multiplatform 1.11.1, Kotlin 2.4.10, AGP 9.1.1, Gradle 9.6.1, JDK 17).

**Spec:** `docs/plans/2026-11-11-movie-tracker-showcase-design.md`, PRD #304, issue #305. Read all three first.

## Global Constraints

- Android and iOS targets only. No desktop, web, JVM, JS or Wasm target.
- **No UI test dependency anywhere in `showcase-app/`**: no Espresso, `androidx.test`, XCUITest target, or Compose `ui-test`. No `androidTest` or `*UITests` directory. Unit tests of non-UI logic only.
- No TMDB key is committed. The key lives only in `showcase-app/tmdb.properties`, which is git-ignored.
- Android `applicationId` and iOS bundle id are the same string: `io.github.sh3lan93.mobileautomator.showcase` (no underscore: iOS bundle ids do not allow one). One scenario file must launch the app on both platforms.
- App display name: `Reel Tracker`. Kotlin package: `io.github.sh3lan93.mobileautomator.showcase`.
- TMDB is called with the v3 `api_key` query parameter, never a bearer token (guest-session calls in #309 depend on this).
- Scenarios: schema `2.1`, `"mode": "platform-agnostic"`, `"platform": "cross-platform"`, mechanical assertion types only, targets are visible text or accessibility labels, never a `testTag`.
- The app shows every fact a scenario asserts as visible text.
- Drive devices only through `mauto` verbs. On-device replay is **not** an acceptance criterion for this slice (maintainer decision).
- Nothing under `src/`, `bin/` or `package.json` changes, so there is no version bump and no CHANGELOG entry.
- Per-task commits ending with the repo's `Co-Authored-By` line; work only in the worktree `sample-app-305-showcase-skeleton` on branch `sample-app/305-showcase-skeleton` (subagents: `cd` there and verify with `git branch --show-current` before any commit). Open a draft PR after Task 1 with `Closes #305` on its own line and `Refs #304`.
- The pre-commit hook runs `npm test`; run `npm ci` in the worktree once before the first commit.

## Review Focus

1. **A key file with stray whitespace, quotes or an empty value.** A person pasting `TMDB_API_KEY = "abc" ` expects it to work; an empty value expects the add-your-key screen, not a rejected-key screen. → Tasks 2 and 3.
2. **TMDB rate-limits or returns an unexpected status (429, 404).** Expect the server-error message with Retry, not a crash or an endless spinner. → Task 3.
3. **A film with no release date or no poster.** Expect it listed with its title, not dropped and not shown as "null". → Tasks 3 and 4.
4. **An empty result page.** Expect "No films found", not a blank screen. → Task 4.
5. **Leaving the screen mid-load.** Expect the cancellation to propagate, not be recorded as "No connection". → Task 3.

---

## File Structure

```
showcase-app/
  .gitignore                       # build output, local.properties, tmdb.properties
  tmdb.properties.example          # committed template: TMDB_API_KEY=
  README.md                        # key, build, install (the full walkthrough is #312)
  settings.gradle.kts  build.gradle.kts  gradle.properties  gradlew  gradle/
  androidApp/                      # Android shell (MainActivity, manifest)
  iosApp/                          # Xcode project + Swift shell; Configuration/Config.xcconfig
  scenarios/browse_popular.json
  shared/
    build.gradle.kts               # targets, deps, generateTmdbKey task
    src/commonMain/kotlin/io/github/sh3lan93/mobileautomator/showcase/
      App.kt                       # navigation: popular ↔ about
      di/Koin.kt
      data/Movie.kt
      data/TmdbClient.kt           # TmdbClient, TmdbResult, TmdbFailure
      data/KtorTmdbClient.kt
      screens/popular/PopularViewModel.kt
      screens/popular/PopularScreen.kt
      screens/key/KeyProblemScreen.kt   # missing-key and rejected-key
      screens/about/AboutScreen.kt
    src/commonMain/composeResources/drawable/tmdb_logo.*   # official TMDB logo
    src/commonTest/kotlin/.../data/KtorTmdbClientTest.kt
    src/commonTest/kotlin/.../screens/popular/PopularViewModelTest.kt
    src/iosMain/kotlin/.../MainViewController.kt
tests/lint/showcase-scenarios.test.js
.github/workflows/showcase-app.yml
CLAUDE.md                          # file layout, milestone row, guard paragraph
```

---

### Task 0: TMDB terms gate

No code. This task can stop the slice.

- [ ] **Step 1:** Read the current TMDB API Terms of Use in full at `https://www.themoviedb.org/api-terms-of-use` and the logo/attribution page it links to.
- [ ] **Step 2:** Post a comment on #304 recording: (a) whether a free, non-commercial, open-source demonstration app with bring-your-own keys is permitted; (b) the exact required attribution notice; (c) the logo rules and the URL of the approved logo file.
- [ ] **Step 3:** If (a) is "no" or unclear, **stop** and report to the maintainer; do not start Task 1. Otherwise continue. If the notice in (b) differs from the one in Task 5, use the terms' wording there and in the scenario.

### Task 1: Scaffold the two-platform app

**Files:** Create everything under `showcase-app/` except `scenarios/`, `tmdb.properties.example`, `README.md` and the files later tasks name.

**Interfaces:**
- Produces: Gradle modules `:shared` and `:androidApp`; Xcode scheme `iosApp`; composable `App()` in package `io.github.sh3lan93.mobileautomator.showcase`; `fun initKoin()` in `di/Koin.kt`.

- [ ] **Step 1:** Copy `https://github.com/Kotlin/KMP-App-Template` (Apache-2.0) into `showcase-app/` without its `.git`. Delete `desktopApp/`, `webApp/`, `kotlin-js-store/`, `images/`, `list.json`, the template `README.md`, and every other template `.md` file. Keep its `LICENSE` as `showcase-app/LICENSE-template` with one line in the README (Task 6) crediting the template.
- [ ] **Step 2:** In `settings.gradle.kts` keep only `include(":shared")` and `include(":androidApp")`, and set `rootProject.name = "showcase-app"`. In `shared/build.gradle.kts` remove `jvm()`, `js {}`, `wasmJs {}` and the `jvmMain` / `webMain` dependency blocks. Remove now-unused entries from `gradle/libs.versions.toml`.
- [ ] **Step 3:** Rename the package `com.jetbrains.kmpapp` → `io.github.sh3lan93.mobileautomator.showcase` in sources, directory names, the Android `namespace` (shared: `….showcase.shared`), and the iOS Swift import of the framework. Set Android `applicationId = "io.github.sh3lan93.mobileautomator.showcase"`. In `iosApp/Configuration/Config.xcconfig` set `BUNDLE_ID=io.github.sh3lan93.mobileautomator.showcase` and `APP_NAME=Reel Tracker`. Set the Android app label to `Reel Tracker`.
- [ ] **Step 4:** Delete the museum code (`data/Museum*`, `screens/list`, `screens/detail`, `EmptyScreenContent`, `PlaceholderColor`). Make `App()` show a single `Text("Reel Tracker")` and `initKoin()` start Koin with no modules.
- [ ] **Step 5:** Replace `showcase-app/.gitignore` with the template's entries plus a `tmdb.properties` line.
- [ ] **Step 6: Verify Android.** Run from `showcase-app/` with JDK 17: `./gradlew :androidApp:assembleDebug`. Expected: `BUILD SUCCESSFUL` and `androidApp/build/outputs/apk/debug/androidApp-debug.apk` exists. (A fresh machine needs `local.properties` with `sdk.dir`, or `ANDROID_HOME`.)
- [ ] **Step 7: Verify iOS.** Run: `xcodebuild -project iosApp/iosApp.xcodeproj -scheme iosApp -configuration Debug -sdk iphonesimulator -derivedDataPath build/ios CODE_SIGNING_ALLOWED=NO build`. Expected: `** BUILD SUCCEEDED **`.
- [ ] **Step 8:** `grep -rn "jetbrains.kmpapp\|KMP App" showcase-app --include='*' -I` returns nothing outside `LICENSE-template`.
- [ ] **Step 9: Commit** (`feat(showcase): scaffold Compose Multiplatform app for Android and iOS`), push, open the draft PR.

### Task 2: Bring-your-own key, generated at build time

**Files:**
- Modify: `showcase-app/shared/build.gradle.kts`
- Create: `showcase-app/tmdb.properties.example`

**Interfaces:**
- Produces: `internal const val TMDB_API_KEY: String` in package `io.github.sh3lan93.mobileautomator.showcase`, generated into `shared/build/generated/tmdbKey/commonMain/kotlin/` and registered as a `commonMain` source directory. Empty string when no key is configured.

- [ ] **Step 1:** Create `tmdb.properties.example` containing a comment line pointing to `https://www.themoviedb.org/settings/api` and the line `TMDB_API_KEY=`.
- [ ] **Step 2:** Add a `generateTmdbKey` task to `shared/build.gradle.kts` and make every Kotlin compilation depend on it by adding its output directory to `commonMain`'s `kotlin.srcDir(...)` via the task provider. Value resolution, in order: `TMDB_API_KEY` from `rootProject.file("tmdb.properties")`; else the `TMDB_API_KEY` environment variable; else `""`. Then: trim whitespace, strip one pair of surrounding single or double quotes, trim again. If the result is non-empty and does not match `^[A-Za-z0-9._-]+$`, fail the build with `tmdb.properties: TMDB_API_KEY contains characters a TMDB key cannot have`. Declare the properties file and the environment value as task inputs so a changed key regenerates.
- [ ] **Step 3: Verify each case** by running `./gradlew :shared:generateTmdbKey` and reading the generated file:
  - no `tmdb.properties` → `TMDB_API_KEY = ""`
  - `TMDB_API_KEY = "abc123" ` (spaces and quotes) → `"abc123"`
  - `TMDB_API_KEY=` → `""`
  - `TMDB_API_KEY=a"b` → build fails with the message above
- [ ] **Step 4:** `git status --short showcase-app` does not list `tmdb.properties` while one exists. Delete any test key file.
- [ ] **Step 5: Commit** (`feat(showcase): read the TMDB key from a git-ignored properties file`).

### Task 3: TMDB client with failure mapping

**Files:**
- Create: `shared/src/commonMain/kotlin/…/data/Movie.kt`, `data/TmdbClient.kt`, `data/KtorTmdbClient.kt`
- Test: `shared/src/commonTest/kotlin/…/data/KtorTmdbClientTest.kt`
- Modify: `shared/build.gradle.kts`, `gradle/libs.versions.toml` (add `kotlin("test")`, `ktor-client-mock`, `kotlinx-coroutines-test` to `commonTest`; enable Android host tests with `withHostTestBuilder {}` inside `androidLibrary {}`)

**Interfaces:**
- Produces:

```kotlin
data class Movie(val id: Int, val title: String, val releaseYear: String?, val posterUrl: String?)

enum class TmdbFailure { MissingKey, RejectedKey, NoConnection, ServerError }

sealed interface TmdbResult<out T> {
    data class Ok<T>(val value: T) : TmdbResult<T>
    data class Failed(val failure: TmdbFailure) : TmdbResult<Nothing>
}

interface TmdbClient {
    suspend fun popularMovies(): TmdbResult<List<Movie>>
}

class KtorTmdbClient(private val http: HttpClient, apiKey: String) : TmdbClient
```

- Request: `GET https://api.themoviedb.org/3/movie/popular?api_key=<key>&language=en-US&page=1`.
- Mapping: `releaseYear` = first four characters of `release_date`, or `null` when it is missing, blank or shorter than four characters. `posterUrl` = `https://image.tmdb.org/t/p/w342` + `poster_path`, or `null` when `poster_path` is null or blank. Unknown JSON fields are ignored.
- Outcomes: key blank after `trim()` → `Failed(MissingKey)` with **no** request sent; HTTP 401 → `RejectedKey`; any other non-2xx → `ServerError`; a 2xx body that does not parse → `ServerError`; an I/O failure from the engine → `NoConnection`; `CancellationException` is rethrown.

- [ ] **Step 1: Write the failing tests** in `KtorTmdbClientTest`, each building `KtorTmdbClient(HttpClient(MockEngine { … }) { install(ContentNegotiation) { json(Json { ignoreUnknownKeys = true }) } }, key)` and using `runTest`:

| Test | Arrange | Assert |
|---|---|---|
| `blankKey_returnsMissingKey_withoutCallingNetwork` | key `"  "`, engine counts calls | result `Failed(MissingKey)`; call count `0` |
| `sendsApiKeyAsQueryParameter` | key `"k1"`, 200 with `{"results":[]}` | request host `api.themoviedb.org`, path `/3/movie/popular`, parameter `api_key` = `k1`, no `Authorization` header |
| `ok_parsesTitleYearAndPoster` | 200 with `{"page":1,"results":[{"id":603,"title":"The Matrix","release_date":"1999-03-31","poster_path":"/m.jpg","extra":1}]}` | `Ok(listOf(Movie(603,"The Matrix","1999","https://image.tmdb.org/t/p/w342/m.jpg")))` |
| `ok_keepsFilmWithNoDateAndNoPoster` | result `{"id":7,"title":"Untitled","release_date":"","poster_path":null}` | `Ok(listOf(Movie(7,"Untitled",null,null)))` |
| `http401_returnsRejectedKey` | 401 with TMDB's error JSON | `Failed(RejectedKey)` |
| `http429_returnsServerError` | 429 | `Failed(ServerError)` |
| `http500_returnsServerError` | 500 | `Failed(ServerError)` |
| `malformedBody_returnsServerError` | 200 with `not json` | `Failed(ServerError)` |
| `ioFailure_returnsNoConnection` | handler throws `kotlinx.io.IOException("offline")` | `Failed(NoConnection)` |
| `cancellation_isRethrown` | handler throws `CancellationException()` | `assertFailsWith<CancellationException>` |

- [ ] **Step 2: Run to verify they fail.** `./gradlew :shared:testAndroidHostTest`. Expected: compilation fails on the missing types. (If the pinned AGP names the host-test task differently, find it with `./gradlew :shared:tasks --all | grep -i test` and use that one name everywhere below, in the workflow and in the README.)
- [ ] **Step 3: Implement** `Movie.kt`, `TmdbClient.kt` and `KtorTmdbClient.kt` to the Interfaces block. Use private `@Serializable` DTOs inside `KtorTmdbClient.kt`; do not expose them.
- [ ] **Step 4: Run to verify they pass** on both runtimes: `./gradlew :shared:testAndroidHostTest :shared:iosSimulatorArm64Test`. Expected: 10 tests pass on each.
- [ ] **Step 5: Commit** (`feat(showcase): TMDB client with failure mapping for popular films`).

### Task 4: Popular list state

**Files:**
- Create: `shared/src/commonMain/kotlin/…/screens/popular/PopularViewModel.kt`
- Test: `shared/src/commonTest/kotlin/…/screens/popular/PopularViewModelTest.kt`

**Interfaces:**
- Consumes: `TmdbClient`, `TmdbResult`, `TmdbFailure`, `Movie` (Task 3).
- Produces:

```kotlin
sealed interface PopularUiState {
    data object Loading : PopularUiState
    data class Loaded(val movies: List<Movie>) : PopularUiState
    data object Empty : PopularUiState
    data class Failed(val failure: TmdbFailure) : PopularUiState
}

class PopularViewModel(private val client: TmdbClient) : ViewModel() {
    val state: StateFlow<PopularUiState>   // starts Loading, loads on init
    fun retry()                            // sets Loading, loads again
}
```

- [ ] **Step 1: Write the failing tests** with a fake `TmdbClient` whose next result is settable, `Dispatchers.setMain(StandardTestDispatcher())` and `runTest`:
  - `startsLoading_thenLoaded` — fake returns `Ok(listOf(movie))` → first value `Loading`, after `advanceUntilIdle()` `Loaded(listOf(movie))`
  - `emptyResult_isEmpty` — `Ok(emptyList())` → `Empty`
  - `failure_isFailedWithThatFailure` — for each of the four `TmdbFailure` values → `Failed(thatValue)`
  - `retry_afterFailure_loadsAgain` — `Failed(NoConnection)`, then fake set to `Ok(listOf(movie))`, `retry()` → `Loading` then `Loaded`
- [ ] **Step 2: Run to verify they fail.** `./gradlew :shared:testAndroidHostTest`. Expected: unresolved `PopularViewModel`.
- [ ] **Step 3: Implement** `PopularViewModel` to the Interfaces block.
- [ ] **Step 4: Run to verify they pass.** `./gradlew :shared:testAndroidHostTest :shared:iosSimulatorArm64Test`.
- [ ] **Step 5: Commit** (`feat(showcase): popular list state with empty, failure and retry`).

### Task 5: Screens, navigation and attribution

**Files:**
- Create: `screens/popular/PopularScreen.kt`, `screens/key/KeyProblemScreen.kt`, `screens/about/AboutScreen.kt`, `composeResources/drawable/tmdb_logo.*`
- Modify: `App.kt`, `di/Koin.kt`

**Interfaces:**
- Consumes: `PopularViewModel`, `PopularUiState` (Task 4); `KtorTmdbClient`, `TMDB_API_KEY` (Tasks 2–3).
- Produces: routes `popular` (start) and `about`; the exact strings below, which Task 6's scenario and later slices target.

Exact visible copy (these strings are contracts for scenarios):

| Where | Text |
|---|---|
| Popular top bar title | `Popular films` |
| Popular top bar action (text button) | `About` |
| Loading | `Loading films…` |
| Count line above the list when loaded | `<n> films`, e.g. `20 films` |
| Each row | the film title; below it the release year when present |
| Poster image `contentDescription` | the film title |
| Empty | `No films found` |
| `NoConnection` | `No connection` and a `Retry` button |
| `ServerError` | `Something went wrong` and a `Retry` button |
| `MissingKey` heading / body | `Add your TMDB key` / `Create showcase-app/tmdb.properties containing TMDB_API_KEY=<your key>, then rebuild the app.` |
| `RejectedKey` heading / body | `TMDB rejected your key` / `Check TMDB_API_KEY in showcase-app/tmdb.properties, then rebuild the app.` |
| About top bar title | `About` |
| About back button `contentDescription` | `Back` |
| About body | `Reel Tracker is a demonstration app for mobile-automator.` |
| About notice | `This product uses the TMDB API but is not endorsed or certified by TMDB.` (or Task 0's wording) |
| TMDB logo `contentDescription` | `TMDB logo` |

- [ ] **Step 1:** Register in Koin: one `HttpClient` with `ContentNegotiation` + `Json { ignoreUnknownKeys = true }` (platform engines as in the template), `single<TmdbClient> { KtorTmdbClient(get(), TMDB_API_KEY) }`, and `PopularViewModel`.
- [ ] **Step 2:** Implement `PopularScreen(onAbout: () -> Unit)`: one branch per `PopularUiState`. `Failed(MissingKey)` and `Failed(RejectedKey)` render `KeyProblemScreen`; the other two failures render their message with `Retry` wired to `viewModel.retry()`. A missing year renders nothing, never the word `null`.
- [ ] **Step 3:** Implement `KeyProblemScreen(heading: String, body: String)` and `AboutScreen(onBack: () -> Unit)`. Add the approved TMDB logo from the URL recorded in Task 0, displayed smaller than the `Reel Tracker` heading. No `testTag` anywhere.
- [ ] **Step 4:** `App()` hosts a `NavHost` with `popular` and `about`.
- [ ] **Step 5: Verify builds.** Task 1's Android and iOS build commands both succeed; `./gradlew :shared:testAndroidHostTest :shared:iosSimulatorArm64Test` still passes.
- [ ] **Step 6: Verify by hand on one platform** (any emulator or simulator, no scenario): with no key file the app opens on `Add your TMDB key`; with a real key it shows `Popular films`, a count line and film titles, and `About` shows the notice and logo. Say in the PR which of these were checked and on which platform; if no TMDB key is available, say so instead.
- [ ] **Step 7: Commit** (`feat(showcase): popular list, key-problem and About screens`).

### Task 6: First scenario and the showcase scenario guard

**Files:**
- Create: `tests/lint/showcase-scenarios.test.js`, `showcase-app/scenarios/browse_popular.json`

**Interfaces:**
- Consumes: `ScenarioValidator` (`src/scenario/validator.js`), `findReplayWarnings` + `isBlocking` (`src/scenario/replayability.js`), `MECHANICAL_TYPES` (`src/assertion/evaluator.js`), `REPO_ROOT` (`tests/lint/docs-corpus.js`). Import them; restate none.

- [ ] **Step 1: Write the guard** with these tests:
  - `showcase-app/scenarios holds at least one scenario (the rules below are not vacuous)`
  - per scenario file: `passes schema validation` (`validate(...).valid === true`, errors printed on failure)
  - per file: `has no finding that would fail validate --strict` (`findReplayWarnings(s).filter(isBlocking)` is `[]`)
  - per file: `is schema 2.1, platform-agnostic and cross-platform` (`$schema_version`, `mode`, `platform`)
  - per file: `uses only mechanical assertion types` (every `assertions[].type` is in `MECHANICAL_TYPES`)
  - per file: `launches the app id both platforms build` — `app_package` equals the `applicationId` literal in `showcase-app/androidApp/build.gradle.kts` **and** the `BUNDLE_ID` in `showcase-app/iosApp/Configuration/Config.xcconfig`
  - `the Android applicationId and the iOS bundle id are the same string`
  - `no scenario target or expected value equals a testTag literal in the app source` — collect `testTag("…")` literals under `showcase-app/shared/src`; check the same step and assertion fields `tests/lint/e2e-agnostic.test.js` checks. Zero tags in the app is the expected state and passes.
  - `the showcase declares no UI test dependency` — no line in any `showcase-app/**/*.gradle.kts` or `showcase-app/gradle/libs.versions.toml` matches `/espresso|androidx\.test|ui-test|uiTest|XCUITest/i`, and no directory named `androidTest`, `androidInstrumentedTest` or ending `UITests` exists under `showcase-app/`.
- [ ] **Step 2: Run to verify it fails.** `npx jest tests/lint/showcase-scenarios.test.js`. Expected: the first test fails (no scenario yet); the app-id and dependency tests pass.
- [ ] **Step 3: Write `browse_popular.json`.** Take exact field names from `mauto schema scenario`. `scenario_id` `browse_popular`, `app_package` the shared id, tags `["showcase","browse"]`. Steps: `launch` (`launch_app`); `wait_list` (`wait_for_element`, target `Popular films`, 30000 ms); `open_about` (`tap`, target `About`); `wait_about` (`wait_for_element`, target `TMDB logo`); `back` (`press_back`); `wait_list_again` (`wait_for_element`, target `Popular films`). Assertions, all mechanical: after `wait_list`, `element_text` that `Popular films` reads `Popular films`, and `pattern_match` that an element matches `^\d+ films$`; after `wait_about`, `text_contains` the notice sentence from Task 5; after `wait_list_again`, `element_visible` for `Popular films`. The description states that it needs a configured TMDB key.
- [ ] **Step 4: Run to verify it passes.** `npx jest tests/lint/showcase-scenarios.test.js` → all pass. If a `mauto` is on PATH: `mauto validate --strict showcase-app/scenarios/browse_popular.json` → `"ok":true` with no blocking warning.
- [ ] **Step 5: Commit** (`test(lint): guard showcase scenarios; add browse_popular`).

### Task 7: CI build workflow, README, CLAUDE.md

**Files:**
- Create: `.github/workflows/showcase-app.yml`, `showcase-app/README.md`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Workflow** `Showcase App`, triggered on `pull_request` with `paths: ['showcase-app/**', '.github/workflows/showcase-app.yml']`, modelled on `.github/workflows/sample-app.yml` (same `actions/checkout` and `actions/setup-java` versions, Temurin 17), `working-directory: showcase-app`, no secrets, no key. Two jobs:
  - `android` on `ubuntu-latest`, name `Showcase: Android build and unit tests`: `./gradlew :shared:testAndroidHostTest :androidApp:assembleDebug`.
  - `ios` on `macos-latest`, name `Showcase: iOS build and unit tests`: `./gradlew :shared:iosSimulatorArm64Test`, then Task 1's `xcodebuild` command.
  Do not add either name to `.github/required-checks.json`.
- [ ] **Step 2: README** (`showcase-app/README.md`), short: what the app is and that it sits beside Sample Shop; getting a free TMDB key and copying `tmdb.properties.example` to `tmdb.properties`; build and install commands for an emulator and a simulator; the unit-test command; that the app has no UI test code by design; the scenario directory and `mauto validate --strict`; the TMDB attribution notice; a credit line for `Kotlin/KMP-App-Template` (Apache-2.0); "the full walkthrough arrives with #312". Do not state a Node version, and do not name an unsupported scenario action.
- [ ] **Step 3: CLAUDE.md:** add `showcase-app/` to the file layout; add a `sample-app` milestone note that PRD #304 (slices #305–#313) is the showcase and uses the same branch prefix; add one drift-guard paragraph for `tests/lint/showcase-scenarios.test.js` listing what it fails on.
- [ ] **Step 4: Full verification, output shown in the PR:**
  - `npm test` → all suites pass
  - `npm run lint` → clean
  - `npm run lint:guides` → all guards pass, including the doc guards over the new README
  - `./gradlew :shared:testAndroidHostTest :shared:iosSimulatorArm64Test :androidApp:assembleDebug` → success
  - Task 1's `xcodebuild` command → `** BUILD SUCCEEDED **`
  - `git grep -n "api_key=[A-Za-z0-9]" -- showcase-app` and `git ls-files showcase-app | grep tmdb.properties$` → no committed key, only the `.example` file
- [ ] **Step 5: Commit** (`ci(showcase): build workflow; docs: showcase README and CLAUDE.md`), push, update the PR description with the test plan and the Task 0 outcome, and confirm both workflow jobs pass on the PR.

---

## Acceptance map (#305)

| Criterion | Task |
|---|---|
| Terms read and recorded on the PRD | 0 |
| Builds and launches on both platforms; no desktop/web targets | 1, 5 |
| Add-your-key screen; rejected-key message | 3, 4, 5 |
| Key file git-ignored, no key committed | 1, 2, 7 |
| Popular list through the single client, unit-tested against a fake engine | 3, 4, 5 |
| About shows the TMDB notice and logo | 0, 5 |
| Path-filtered, non-required build workflow | 7 |
| Scenario guard in the lint suite; `npm run lint:guides` passes | 6, 7 |
| Short README passing the shipping-doc guards | 7 |
| No UI test dependency | 6 (guard), all |
