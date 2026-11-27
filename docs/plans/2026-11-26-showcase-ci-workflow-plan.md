# Showcase CI workflow (#313, PRD #304 slice 9): plan

Branch `sample-app/313-ci-workflow`, on top of `main` at 5f20b2b0. The walkthrough's step 8 waits for PR #384.

## Settled before this plan (orchestrator's context notes, 2026-11-26)

- Every shipped scenario is replayed with agent-free `mauto run` on an Android emulator and an iOS simulator.
- The workflow runs in this repo on `schedule` and `workflow_dispatch` only. It is never a required check and never runs on `pull_request`.
- The TMDB key comes from a repository secret. Where the secret is missing (forks), the job skips cleanly.
- A TMDB outage or live-data drift is reported so that it reads differently from a mauto failure.
- Scenarios that drifted are repaired in this PR and listed in it.
- The workflow is written to be copied into another app's repo. The walkthrough's CI step explains how.
- Default engine. Legacy only with evidence (#379).
- Account for #378 (iOS cannot clear a field) and #385 (engine debug log next to the envelope on a device switch). Do not fix them.
- No version bump unless `src/`, `bin/` or `package.json` is touched (none planned).

## HITL: repository secret

**`TMDB_API_KEY`**: a TMDB v3 API key. This is the same name as the key in `tmdb.properties` and the env var `shared/build.gradle.kts` already reads. Needed before the first `workflow_dispatch` run on GitHub. The workflow and its guards do not need it.

## Files

| File | What |
|---|---|
| `.github/workflows/showcase-replay.yml` | The copyable workflow. Each step is marked either **generic** (mauto, devices, replay, report) or **app-specific** (build, TMDB). Per-app values sit in one top-level `env:` block: `APP_DIR`, `SCENARIOS`, `ANDROID_APK`, `IOS_APP`, `MAUTO_VERSION` |
| `showcase-app/ci/replay.sh` | Generic. Usage: `replay.sh <device-id> <out-dir> <scenario>...`. One `mauto run <file> --device <id> --junit <out>/<id>.xml` per scenario. Records each scenario's exit code, classifies it and writes a Markdown table to `$GITHUB_STEP_SUMMARY` plus `::error title=…::` annotations. Exits non-zero if any scenario did not pass. Reads only exit codes and files, never stdout, so #385's extra log line cannot break it. An optional `REPLAY_PROBE` command runs after a failed scenario (see below) |
| `showcase-app/ci/tmdb-check.sh` | App-specific. Uses `curl` + `jq` against `api.themoviedb.org/3` with the key. Exit 0 healthy, 10 outage (network error, timeout, 5xx), 11 data drift (a fact the scenarios rely on has changed), 12 key rejected (401, status_code 7). `--reachability` runs only the outage probe |
| `tests/lint/showcase-replay-workflow.test.js` | Wiring guard (below) |
| `tests/unit/showcase-ci/replay.test.js` | Runs `replay.sh` under bash with a fake `mauto` on `PATH`, one case per exit code and class |
| `showcase-app/README.md` step 8 | After #384 merges: what the workflow does, the secret, how to copy it, and what each class means |
| `tests/lint/showcase-walkthrough.test.js` | After #384: step 8 links the workflow file, names `TMDB_API_KEY`, and names the three classes |
| `tests/lint/CLAUDE.md` | One paragraph for the new guard |

## Workflow shape

```
on: schedule (weekly, Mon 04:23 UTC) + workflow_dispatch
concurrency: showcase-replay, cancel-in-progress: false
permissions: contents: read

jobs:
  key:        ubuntu. Output has_key from `secrets.TMDB_API_KEY != ''`. Never prints the key
  tmdb:       needs key, if has_key. Runs tmdb-check.sh. Job name "TMDB live data (outage or drift, not mauto)"
  android:    needs [key, tmdb], if has_key. Java 17 → ./gradlew :androidApp:assembleDebug (TMDB_API_KEY env)
              → npm i -g mobile-automator@$MAUTO_VERSION → KVM → android-emulator-runner (API 36, x86_64)
              script: adb install … && mauto setup --mode agnostic && bash ci/replay.sh emulator-5554 …
              → upload artifacts (JUnit, results, screenshots), if: always()
  ios:        needs [key, tmdb], if has_key. macos-latest. Java 17 → xcodebuild (as in showcase-app.yml)
              → boot the newest available iPhone simulator (simctl list -j) → simctl install
              → mauto setup → replay.sh <udid> → upload artifacts, if: always()
```

If the key is missing, `tmdb`, `android` and `ios` report *skipped* and the run is green. If `tmdb` fails, both device jobs are skipped, so an outage never shows up as a red replay job.

## Classification (reported per scenario in the step summary)

| Class | When | Reads as |
|---|---|---|
| passed | exit 0 | |
| **TMDB outage** | exit 6 and `REPLAY_PROBE` (`tmdb-check.sh --reachability`) now fails | TMDB, not mauto |
| scenario failed | exit 6 and TMDB reachable | the app or the scenario (screenshots in artifacts) |
| needs agent | exit 7 | authoring bug: a shipped scenario must never need an agent |
| mauto or device error | any other exit (2, 3, 5, …) | mauto, the engine or the runner |

Drift is caught before any device boots: the `tmdb` job fails with `::error title=TMDB data drift::<fact>`.

## The facts `tmdb-check.sh` checks (taken from the shipped scenarios)

- id 278 is "The Shawshank Redemption", release date 1994, runtime 142.
- Search `Shawshank` returns 278 on the first page. Search `xqzvbnmkw` returns 0 results.
- Discover with Drama, 1994, `vote_average.gte=8`, the app's minimum vote count, sorted `vote_average.desc`, has 278 on page 1. Discover with Animation, 1931, rated 9+ returns 0.
- `/movie/popular` returns at least one film.
- A guest session can be created. Rating is not exercised; the replay does that.

## Decisions I recommend (open; please confirm or overrule)

1. **One workflow file, in `.github/workflows/`**, written so it can be copied, with no second template copy under `showcase-app/`. Two copies would have to be kept in sync. The walkthrough links the file and says which steps to keep and which to replace.
2. **mauto from npm** (`npm i -g mobile-automator@$MAUTO_VERSION`, default `latest`), not this repo's packed tarball. It is what someone who copies the workflow gets. Sample Shop's E2E already proves the unreleased source on every relevant PR.
3. **Weekly schedule.** It keeps live-API traffic and guest sessions low. Daily is a one-line change if you prefer it.
4. **The drift check restates TMDB queries in shell.** The discover parameters (`with_genres`, `primary_release_year`, `vote_average.gte`, `vote_count.gte`, `sort_by`) are a second copy of `FilterState.kt`'s query. To keep that copy from drifting, the lint guard reads the `put("…")` keys and `MIN_VOTES_FOR_RATING` from `FilterState.kt` and fails if `tmdb-check.sh` does not use the same ones. The alternative, a live-API JVM test that reuses `FilterState`, would put Gradle in the preflight and is harder to copy.
5. **Each job runs `mauto setup --mode agnostic`.** After #384, `showcase-app/.mobile-automator/` is git-ignored, so the workspace is created in CI. The walkthrough tells people who copy the workflow to commit their workspace instead (FAQ recipe) and to drop this step.
6. **Android device id `emulator-5554`**, read back from `mauto devices` once and failed loudly if it is missing. This avoids guessing the AVD name.

## Lint guard (`showcase-replay-workflow.test.js`)

Each rule is shown red before it ships:

- The triggers are exactly `schedule` + `workflow_dispatch`. No `pull_request`, `pull_request_target` or `push`.
- No job name appears in `.github/required-checks.json`.
- `TMDB_API_KEY` appears only as `secrets.TMDB_API_KEY`, only in `env:`, never in a `run:` that echoes it. The `key` job gates both device jobs and `tmdb` through `needs` + `if`.
- Both device jobs call `replay.sh` with `$SCENARIOS`, which is the `showcase-app/scenarios/*.json` glob. This means every shipped scenario runs, with no hand list to fall behind.
- `replay.sh` runs `mauto run` with `--junit` and `--device`, and never sets `MAUTO_REPLAY` (the existing retired-gates rule).
- Artifact upload has `if: always()` in both device jobs.
- Rule 4 of the decisions: the discover parameter names match between `tmdb-check.sh` and `FilterState.kt`.
- Action refs are already covered by `docs-ci-recipe.test.js` rule 1.

## Order of work (per-task commits, subagents, TDD where it applies)

1. `replay.sh` + its unit test (red first).
2. `tmdb-check.sh`, checked by hand against live TMDB with the local key (the key is never printed).
3. The workflow + its lint guard, including the mutation checks.
4. **Device run (asks you first):** `replay.sh` locally on the Pixel 9 Pro AVD and the iPhone 17 Pro simulator, all 13 scenarios. Repair any drifted scenario, one commit each, listed in the PR.
5. Draft PR. You add `TMDB_API_KEY`. I get a real CI run on the branch (see the dispatch note below).
6. After #384 merges: `node scripts/sync-branch.js`, then fill in step 8 and its guard.

**Dispatch note:** GitHub only offers `workflow_dispatch` for a workflow file that exists on the default branch. The first real CI run is therefore possible only after merge, unless the PR temporarily adds a `push` trigger limited to this branch. That would break the "never on pull_request" rule only in spirit, and the guard would have to allow it for one commit. I recommend that temporary branch-only `push` trigger, removed in a later commit before ready-for-review, so the PR carries a real run link.

## Verification

`npm test`, `npm run lint`, `npm run lint:guides`, both output shown. `actionlint` on the workflow if it is installed. Local device run output for all 13 × 2 runs. A link to the workflow run.
