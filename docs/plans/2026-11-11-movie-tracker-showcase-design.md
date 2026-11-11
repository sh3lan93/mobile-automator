# Movie tracker showcase app — design

Date: 2026-11-11 · Status: draft for approval · Milestone: `sample-app`

Lines marked **(decided)** are the maintainer's decisions. Lines marked **(my call)** were chosen by the design author and may be overruled. Lines marked **(unverified)** must be checked before they are relied on.

## Intent

mauto exists to remove manual regression testing on mobile: record a flow once on one platform, then replay it on Android or iOS whenever needed. The maintainer built it after living with this problem on a large food delivery app, where one flow multiplied into many variants through feature flags and every variant had to be re-tested by hand on two platforms.

The repo's current fixture, Sample Shop (`sample-app/`), cannot show that. It is small on purpose: hard-coded data, three tabs, no network. It is a predictable target for CI, not a demonstration.

The showcase is a second app that looks like a real product, so an engineer recognises their own regression problem in it and then watches mauto remove it.

## What success looks like (decided)

An engineer clones the repo, runs the showcase, and comes away feeling that the app is tested on both platforms:

- without having written a UI test for either platform;
- without setting up the dependencies UI tests normally need;
- having seen one recorded flow replay on both Android and iOS;
- having seen how the same recordings replay in CI.

## Goals

1. A real app: real network calls, several flows worth regression-testing.
2. The whole loop is demonstrated: record once, replay many times, on both platforms, and in CI.
3. A different UI stack from Sample Shop, to show mauto does not care what the app is built with.
4. Short setup. If setup feels like the hassle the engineer came to avoid, the showcase has failed.

## Non-goals

- Replacing Sample Shop. It stays the small deterministic app the required-adjacent Android E2E drives. **(decided)**
- Becoming a required CI check.
- A TMDB account sign-in flow inside the app.
- Desktop, web, or tablet layouts. Store publishing.
- A backend owned by this project. **(decided: free public API)**

## Anti-goals

- **UI test code in the app.** No Espresso, XCUITest or Compose UI test dependency anywhere in the showcase. Their absence is the proof, and the README points at it. Plain unit tests of non-UI logic are fine. **(my call, from the success statement)**
- **A committed API key.** **(decided)**
- **Per-platform scenario copies.** Every scenario exists once.
- **Scenarios that pass only on the day they were recorded** because they depend on which films are popular today.

## Decisions

| Topic | Decision |
|---|---|
| Domain | Movie tracker **(decided)** |
| Data source | TMDB API, free non-commercial tier **(decided)** |
| UI stack | Compose Multiplatform, Android and iOS targets only **(decided; "only" is my call)** |
| API key | Each person brings their own free TMDB key, in a local file git ignores. No fallback key. **(decided)** |
| Relationship to Sample Shop | Sits beside it **(decided)** |
| How people meet it | They clone the repo and run the flows themselves **(decided)** |
| CI | A workflow file shipped with the showcase that engineers copy into their own app's repo **(decided)** |
| Ordering | Start now; the CI workflow is the last piece, added when agent-free `mauto run` (#271) ships **(decided)** |
| Location | A new top-level directory beside `sample-app/`, for example `showcase-app/` **(my call)** |
| App name | Left to the builder; must not use TMDB's name or logo as its own identity |

## The app

### Flows

1. **Browse.** A list of popular films loaded from TMDB. **(my guess, not objected to)**
2. **Search.** Type a title, see matching films. **(my guess, not objected to)**
3. **Filters.** Narrow the list by genre, release year and minimum rating, and change the sort order. Each change is a real network call (TMDB's discover endpoint). **(decided: filters are in; the exact set is my call)**
4. **Details.** Open a film and see its details. **(my guess, not objected to)**
5. **Rate.** Give a film a score that TMDB stores, using a TMDB guest session so no account is needed. A "My ratings" list reads the ratings back from the server. **(my guess, not objected to)** If guest-session rating turns out to be unreliable, or the read-back lags too much to assert on, rating falls back to being stored on the device like the watchlist. If the terms of use rule out an open-source demonstration app, stop and return to the maintainer: the data source is a decision the builder may not change. **(my call)**
6. **Watchlist.** Add and remove films and view the list. Stored on the device. **(my call; see unverified items)**
7. **Flag switches.** A settings screen with switches that change how a flow behaves, such as an old versus new details layout. This carries over the maintainer's flag-variant problem. Which flags exist is left to the builder, with one rule: each flag must visibly change a flow. **(my guess, not objected to)**

   The demonstration is **variant coverage, not an intentionally failing run**: each setting of a flag has its own scenario, the scenario sets the flag through the settings screen as its first steps, and every shipped scenario passes. The "every scenario exists once" anti-goal is about per-platform copies; one scenario per flow variant is the point, because variants are what multiply manual regression work. **(my call, from the maintainer's flag-variant story)**
8. **Failure states.** No connection, a server error, a search or filter with no results, a missing key, and a rejected key. The missing-key state is a clear "add your key" screen that says which file to create. **(my call)**

   **No connection and server error must be replayable (decided).** mauto cannot turn wifi off (`enable_wifi` / `disable_wifi` are unsupported actions), so the settings screen carries "simulate offline" and "simulate server error" switches beside the flag switches, implemented in the networking layer, and scenarios cover both flows. The missing-key and rejected-key states need a rebuild to reach, so they exist as screens with ordinary unit tests and no scenario. **(the split is my call)**
9. **About.** Carries the TMDB attribution: the notice that the app uses the TMDB API but is not endorsed or certified by TMDB, with the TMDB logo shown less prominently than the app's own. **(required by TMDB's terms)**

### Reset to a known state (my call)

mauto cannot clear an app's data: `clear_app_data` is one of the actions the action catalog marks unsupported. Flags, the watchlist and the guest session all persist between launches, so a replay would inherit whatever the last run left behind. The settings screen therefore needs a visible "Reset app data" control that scenarios can tap as their first steps. Server-side ratings need the same care: a rating scenario should end by removing the rating it added, or assert only on the rating it has just set.

## What the spike established

A throwaway build of JetBrains' Compose Multiplatform template (Compose Multiplatform 1.11.1, Kotlin 2.4.10), with a search field, a filter chip and a button added, was driven through `mauto` 0.38.0 on a Pixel 9 Pro emulator (Android 16) and an iPhone 17 Pro simulator, on the default engine.

Worked on both platforms: reading all visible text, tapping, typing, dismissing the keyboard, opening a network-loaded detail screen, and going back (`press_back` resolved to the system back button on Android and an edge swipe on iOS).

The text field's label was readable on both platforms. Flutter loses it on the default engine (#251), so the showcase should not need `engine: legacy`.

Constraints for scenario authors:

- **Do not assert a text field's contents.** Android exposes the typed text; iOS keeps exposing only the field's label. Assert the effect of typing instead, such as a result count.
- **Target list items by the film title.** iOS additionally merges each card into one button whose label joins all its texts; Android exposes only the separate texts. The title alone matches on both.
- **Chip selected state was not checked.** Filters depend on it. Verify it first; if the state is not exposed, the screen must also show the active filters as visible text.
- **One unexplained event:** the first `mauto launch` on iOS straight after install reported success while the simulator stayed on the home screen. A second launch worked. Watch for it.

## Scenarios

- Platform-agnostic mode, scenario schema 2.1, targeting only what a user can perceive: visible text and accessibility labels.
- Shipped with the showcase, one file per flow, covering at least: search and open a film, filter the list, rate a film, add to and remove from the watchlist, and one flow run under two settings of a flag.
- **Mechanical from day one (decided).** Scenarios use only assertion types mauto checks without an agent (the mechanical column of `docs/reference/assertions.md`), so the same files replay under `mauto run` unchanged when #271 ships. The app therefore shows the facts scenarios need as visible text: result counts, the active filters, the current rating, watchlist membership. A scenario that would need an agent's judgement is a signal to add visible text to the app, not to relax this rule.
- **Stable against live data (my call).** Scenarios must not depend on today's popular list. Search for a fixed, long-established title; use filter combinations whose top results are unlikely to move; assert on text the scenario itself caused or on long-settled facts (the title searched for, a release year), never on live values such as today's vote average or the order of the popular list.
- Recording is part of the showcase, not only replay. The walkthrough has the engineer record one flow themselves on one platform and replay it on the other.

## How it is run

Today a scenario is recorded and replayed by an AI agent following `mauto guide generate` and `mauto guide execute`. The showcase's instructions are written for that. When agent-free `mauto run` ships (#271), the replay instructions switch to it. **(my call, not objected to)**

README walkthrough, in order: clone → get a TMDB key and place it → build and install on an emulator and a simulator → `mauto setup` → replay a shipped scenario on Android → replay the same file on iOS → record a flow of your own → replay it on the other platform → the CI section.

## Proof before the CI piece (decided)

No on-device proof is required per piece of work before the CI workflow lands. The maintainer chose this over a manual agent run per pull request and over extending Sample Shop's E2E script. The accepted consequence: until the CI piece, shipped scenarios are validated only by `mauto validate --strict` and by whoever chooses to replay them, so they can drift against live TMDB data unnoticed, and the CI piece should expect to repair some.

## CI (last piece, blocked on #271)

- A workflow file that replays the showcase's scenarios with `mauto run` on an Android emulator and an iOS simulator, written to be copied into another app's repo. **(decided)**
- It also runs in this repo, on a schedule or by hand, never as a required check. A workflow nobody has run is not one people will copy. **(my call)**
- The TMDB key comes from a repository secret. Secrets are not given to pull requests from forks, which is one more reason it cannot be required.
- It depends on a live third-party API. Its failures must be distinguishable from a mauto regression.

## Constraints from this repo

- Belongs to the `sample-app` milestone, under a **new PRD issue with its own slice issues**, written after this design is approved. It does not extend PRD #44, whose locked decisions (Flutter, deterministic data) describe Sample Shop, and it does not wait on #44's open slices. **(my call)**
- Follows the milestone workflow in `CLAUDE.md`: issue plus PRD context first, a dedicated worktree on a `sample-app/<issue>-<slug>` branch, a plan approved before code, subagent implementation, per-task commits and an early draft PR.
- The locked invariants apply, in particular platform-agnostic selectors and driving the device only through `mauto` verbs.
- The showcase's Markdown files join the shipping-doc corpus (`tests/lint/docs-corpus.js`) the moment they are tracked, so the Node-version, capability-count, unsupported-action and stale-extension guards will scan them.
- `tests/lint/e2e-agnostic.test.js` currently guards Sample Shop's scenarios. Extend its "no OS element ids, no target equal to an app semantics id" rules to the showcase's scenarios. **(my call)**
- `package.json` `files` ships only `bin/` and `src/`, so the showcase adds nothing to the npm package and, touching neither `src/`, `bin/` nor `package.json`, needs no version bump.

## Left to the builder

- App name, visual design, navigation structure, architecture and library choices within Compose Multiplatform.
- Exact dependency versions. The spike's versions are a known-working starting point, not a requirement.
- Which flags exist and what each changes, within the rule above.
- The exact filter controls and scenario list, within the rules above.
- How the work is sliced. A suggested order: skeleton app with key handling, the popular list and one scenario passing on both platforms; search and details; filters; rating; watchlist; flags; the README walkthrough including record-your-own; the CI workflow.

## Unverified — check before relying on

1. **Watchlist and guest sessions.** The design assumes TMDB's watchlist needs a signed-in account, which is why the watchlist is local. Not confirmed from the official reference.
2. **Guest rating authentication.** Forum threads report guest-session ratings only attach correctly when the call uses the API key, not the bearer token. Confirm against the current API.
3. **TMDB API Terms of Use.** Only search excerpts were read. Read the current terms in full for the attribution wording and for use in an open-source demonstration app.
4. **Rate limits.** The only statement found (limits are per IP, not per key) dates from 2017.
5. **Chip selected state** on both platforms, as above.
