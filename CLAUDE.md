# CLAUDE.md

Developer guide for maintaining the `mauto` CLI. User-facing docs live in `README.md` and the MkDocs site under `docs/` (deployed to GitHub Pages by `.github/workflows/docs.yml`); debugging recipes live in `TROUBLESHOOTING.md`.

## What this is

mobile-automator is a **host-agnostic `mauto` CLI** for AI-driven mobile QA automation. Any AI agent drives a device through `mauto` verbs (which wrap mobile-mcp); reasoning is pulled on demand via `mauto guide`.

**Status: published.** The package is on npm as `mobile-automator` — first published release **v0.23.8** (2026-08-30); the current version is `package.json`'s `version` (`npm view mobile-automator dist-tags` for what the registry serves — not restated here, because a hand-written "latest" goes stale on the next merge). `npm i -g mobile-automator` and `npx mobile-automator <verb>` both work. Publishing is automatic: merge a version bump to `main` and the pipeline tags, releases, and publishes (see [Releasing & version handling](#releasing--version-handling)). The `production-ready` gate ([#168](https://github.com/sh3lan93/mobile-automator/issues/168)) is **closed** (2026-10-25, every tier done); its successor is the 1.0 readiness gate [#267](https://github.com/sh3lan93/mobile-automator/issues/267). User-facing docs (`README.md`, `docs/`) teach `npm i -g mobile-automator`; source install (`git clone` + `npm link`) is kept only as the path for unreleased changes and contributors.

## Modes

Selected during setup; stored as `mode` in `.mobile-automator/config.json`. Configs predating the field are treated as `platform-aware`.

| Mode | Use for |
|---|---|
| `platform-aware` | Single-OS or OS-specific UI tests |
| `platform-agnostic` | Cross-platform (Flutter/RN/KMP/CMP) |

Agnostic mode maps OS gestures to four semantic actions resolved to per-platform mechanics at replay time: `press_back`, `dismiss_keyboard`, `grant_permission`, `deny_permission`. Schema 2.1 is additive over 2.0 (adds `mode` field + semantic actions); `tests/lint/schema-additive.test.js` enforces that. Each guide topic has `.aware.md` and `.agnostic.md` variants in `src/guide/content/`.

## Drift guards

Two catalogs are the source of truth for whether a capability reaches the device / the result file: `src/device/action-catalog.js` and `src/result/capability-catalog.js`; lint tests in `tests/lint/` fail the build when a capability loses its CLI reach. Details of every guard live in `tests/lint/CLAUDE.md` (loads when you work there).

`mauto run` (`src/run/`) replays a scenario in-process through the same `DeviceBridge` and `ResultStore` as the one-shot verbs; `tests/lint/run-action-coverage.test.js` fails when a catalog action that can execute has no runner handler.

When you add an action or a result field, add its catalog entry in the same change. Do not hand-restate these counts in prose; derive them.

## Placeholder contract

Guide content in `src/guide/content/<topic>.<aware|agnostic>.md` carries `{{placeholder}}` tokens filled by `src/guide/placeholders.js` (`interpolate`) from `.mobile-automator/config.json` at emit time. Unset placeholders render per slot kind rather than emitting a bare token, and the emitted output is guarded so nothing `{{`-shaped survives (#143). Lint guards in `tests/lint/` enforce: no surviving `{{placeholders}}`, no leaked `mobile_*` tool names, agnostic files name no OS, skill invariants stay placeholder-free, and skill frontmatter stays valid.

## Locked invariants — non-negotiable, all work

These were locked by PRD #69 and outlive it. Any change that breaks one is wrong regardless of what it fixes.

- **Platform-agnostic selectors.** Never use `resource-id` or OS-specific element IDs.
- **Uniform envelope.** Every verb emits `{ok,data,error,hint,schema_version}`; `--human` is opt-in only.
- **One-shot verbs only.** Every verb, including batch `mauto run <scenario>`, starts, finishes and exits in a single invocation with one envelope. There is no interactive co-routine: no verb waits for the agent mid-run, and the agent never drives a step *through* `run`; it picks up where `run` stopped (`incomplete`) with the ordinary one-shot verbs.
- **Reasoning is pulled, never ambient.** Delivered via `mauto guide <topic>` at explicit invocation, never an always-loaded skill.
- **The device is driven only through `mauto` verbs** (which wrap mobile-mcp). Never call mobile-mcp tools directly.
- **Backwards compatibility.** Preserve the `.mobile-automator/` workspace layout, scenario schema 2.0/2.1, and the result schema — existing data must keep working.

There is also a **three-layer model** worth keeping straight: (1) the CLI contract, (2) the per-host invocation surface (slash commands, rules, skills — host-specific, e.g. `$ARGUMENTS` is Claude-only), (3) the guide prose. Never put a contract in layer 2.

## Milestone workflow

| Milestone | PRD / gate | Branch prefix | State |
|---|---|---|---|
| `production-ready` | gate issue [#168](https://github.com/sh3lan93/mobile-automator/issues/168) | `fix/<issue>-<slug>`, `feat/…`, `docs/…`, `chore/…` | **complete** (gate closed 2026-10-25) |
| `sample-app` | PRD [#44](https://github.com/sh3lan93/mobile-automator/issues/44), slices #45–#49 | `sample-app/<issue-number>-<short-slug>` | active — slices 4–5 open |
| `cli` | PRD [#69](https://github.com/sh3lan93/mobile-automator/issues/69), slices #70–#78 | — | **complete** (all 23 closed) |
| `interactive-recording` | — | — | **dead** — recorder excised in v0.20.0 (PR #110) |
| `replay` | PRD [#271](https://github.com/sh3lan93/mobile-automator/issues/271), slices #272–#284 + follow-ups; plan `docs/plans/2026-10-27-replay-plan.md` | `replay/<issue-number>-<short-slug>` | **graduated** in v0.40.0 (#284): `mauto run` is ungated; follow-ups stay on Project #4 |

**Picking the next issue in a milestone.** Milestones with a pick order (today: `replay`) track it in [Project #4](https://github.com/users/sh3lan93/projects/4). Take the milestone issue with Status `Ready`, no open "blocked by" issue (GitHub's native issue dependencies), and the lowest `Order`, and set it to `In progress` before step 1 below. When it merges, move to `Ready` every issue whose blockers are now all closed. Priority (`P0`/`P1`/`P2`) follows `Order`; never pick an `In progress` or `In review` item. The rule is also in the milestone's description.

When you pick up a milestone issue, follow these steps in order:

1. **Load full context first.** Fetch the issue **and** the PRD/gate issue its milestone's row names in the table above, together (`gh issue view <issue>` + `gh issue view <prd-or-gate>`), before doing anything. Issue bodies are deliberately thin; the PRD holds the locked decisions, the slice ladder, and cross-issue constraints. Never act on a slice issue alone.
2. **Isolate the workspace.** Before any edit, create a dedicated worktree on a new branch using the prefix above. Do not work directly in an existing checkout or on a shared branch. (Dispatched subagents start at the repo root, not the worktree — force `cd` into the worktree and verify before any commit.)
3. **Plan before code.** Produce a written implementation plan (file structure, deps, module interfaces, CI changes, test list) and surface it for explicit user approval. No implementation before the user confirms the plan.
4. **Implement via subagents (TDD for non-trivial work).** Dispatch implementation through subagents so the main agent's context stays lean. The main agent orchestrates and reviews; it does not hand-write the bulk of the work.
5. **Honor the locked invariants** above.
6. **Guide changes must pass the lint guards** (see Placeholder contract). Add or extend the lint tests alongside the change.
7. **Verify before claiming done.** Run the test suite and the lint guards and **show the output** before any success claim or PR.
8. **Self-check for the two recurring blockers before opening the PR, and state the result in it.** Reviews keep stopping PRs for these, so catch them first:
   - **A second copy.** For each new helper, parser, reader or path builder, search for an existing one and reuse it. Do not leave two implementations that must agree.
   - **A guard that cannot fail.** Mutate the code each new guard or test protects and watch it go red, then restore it. Green proves nothing until it has been seen red (#264: `if: false` on the `Test` job left its guard passing 61/61).
9. **Per-task commits; open a draft PR early** with a full description (what/why, test plan). Put `Closes #<issue>` on its own line with no intervening words; reference a PRD as `Refs #<prd>` — never `Closes` a PRD, which closes only when its last slice merges.

This workflow lives here (not in per-issue bodies) so it applies uniformly and survives issue edits.

## Adding a verb or guide topic

1. Register the verb handler in `src/cli.js`.
2. If it executes a scenario action, add the entry to `src/device/action-catalog.js`; if it writes a result field, add it to `src/result/capability-catalog.js`. The coverage lint tests derive from these.
3. For a new guide topic, add `src/guide/content/<topic>.aware.md` and `<topic>.agnostic.md`.
4. Register the topic in `src/guide/emitter.js`, `src/mcp/prompts.js`, and `src/init/adapters.js`.
5. For a topic exposed as a skill, add `src/guide/content/<topic>.invariants.md` (placeholder-free, OS-free) and register the topic in `src/init/skill-meta.js` + `src/init/skill-renderer.js`.
6. Extend the lint guards in `tests/lint/`.

## Releasing & version handling

Merge to `main` with a bumped `package.json` `version` and the pipeline tags, releases and publishes automatically; the CI version-bump gate fails any PR touching `src/`, `bin/` or `package.json` without a bump. Single-PR bugfix: bump straight to graduated `vX.Y.Z`; multi-PR feature: `-rc.N` slices, graduate at the end. Full pipeline, ruleset and trusted-publishing notes: `.github/CLAUDE.md`.

## Local development

Standard scripts are in `package.json` (`npm test`, `npm run lint`, `npm run lint:guides`, `./scripts/pack-smoke.sh`); `node scripts/sync-branch.js` merges `origin/main` locally and settles changelog/version/lockfile conflicts without pushing. Real-device E2E: `MAUTO_BIN=$(command -v mauto) node sample-app/scripts/run-e2e.mjs` (see `sample-app/README.md`).

The mobile-mcp version is pinned in `package.json` (`@mobilenext/mobile-mcp`, 1.0.15) and resolved from `node_modules` at runtime (see `src/device/mobile-mcp-client.js`). Bump the pin there if you need a newer engine, then run `npm run test:integration` — `mobile-mcp-contract.test.js` fails if the new engine's tool schemas no longer match what `DeviceBridge` sends. The session daemon keeps one mobile-mcp process alive and mobile-mcp caches its robot per device for that process's life, so after changing any `MOBILEMCP_*` env var run `mauto session end` before the next verb. The `engine` config key needs no such step: the daemon handle records its engine, and the next device verb restarts a daemon running a stale one (`session status` reports `engine` vs `resolved_engine`).

Note: `jest.config` `testPathIgnorePatterns` must stay `<rootDir>`-anchored — an unanchored pattern makes `npm test` silently match zero tests inside a worktree checkout.

## Known rough edges

The upstream-dependent ones have exit plans tracked under the 1.0 readiness gate ([#267](https://github.com/sh3lan93/mobile-automator/issues/267)); worth knowing before you debug something.

- Windows is unsupported by declaration — two deliberate enforcement layers (#165): `package.json` `os` (`darwin`, `linux`) refuses the install (npm's `EBADPLATFORM` carries no WSL2 hint — accepted, it is the only gate npm actually enforces), and `src/device/host-support.js` fails device/session verbs with a rich `environment` envelope for what slips past (`--force`, `npm link`). Device-free verbs already installed on a forced Windows machine keep working; real support would need named pipes plus replacements for `ps`, process-group kill and signals.
- iOS simulators need the engine's on-device agent (a "Device Kit" app). Since mobile-mcp 1.0.11 the engine installs it automatically ([mobile-mcp#459](https://github.com/mobile-next/mobile-mcp/issues/459) fixed in practice, still open upstream; verified 2026-10-25 by uninstalling the agent). When that install fails, every verb fails with `Command failed: … agent install --device <udid>` / `failed to install agent: …` and `src/device/engine-hints.js` prints the manual `npx -y mobilecli@<pinned> agent install --device <udid>`. Separately, the engine starts that agent lazily, on the first call that needs it (an element list or screenshot, not launch/terminate), and starting it sends the simulator to the home screen; `DeviceBridge#_startAgentBeforeLaunch` (`src/device/bridge.js`) therefore lists elements before every launch on an iOS simulator (#326).
- On the default engine (mobilecli), Flutter TextField labels are dropped and offstage `IndexedStack` content leaks into `elements` — [#251](https://github.com/sh3lan93/mobile-automator/issues/251), upstream [mobilecli#534](https://github.com/mobile-next/mobilecli/issues/534). Workaround: the opt-in workspace key `engine: legacy` (`src/device/engine.js`) — it hides offstage content on every level tested, but recovers TextField labels (uiautomator `hint`) only on recent Android (verified API 36; not API 33, whose dump has no hint; the floor between is unverified), which is why the E2E emulator is API 36; the default stays affected until mobilecli#534 lands. The E2E runs both engines and `golden_search_empty` is a known failure on the mobilecli leg only (`engines` in `known-failures.json`); `smoke_nav` still targets the Home tab as `Tab 1 of 3`.
- On Android, mobilecli's on-device `DeviceServer` holds UiAutomation (kills `uiautomator dump` with exit 137, Appium, legacy `elements` → `reading 'node'`). [mobilecli#470](https://github.com/mobile-next/mobilecli/issues/470) is only partly fixed (mobilecli#476, in mobile-mcp 1.0.7): the DeviceServer now exits when the host-side `mobilecli daemon` exits or after a 30-min idle timeout (`--idle-timeout-ms=1800000`) — but that host daemon is detached (re-parented to pid 1) and outlives the engine and the session, so right after a default-engine session the device is still held. Release: `pkill -f 'mobilecli.* daemon'` on the host (the DeviceServer then exits by itself), or `adb shell pkill -f com.mobilenext.mobilecli.DeviceServer`, or wait 30 min.
- On an iOS simulator on macOS 27 hosts, the pinned mobilecli's `mobile_list_crashes` returns `[]` even right after a crash — its filter requires `is_simulated` in the `.ips` header, which those reports replace with `"platform":7` (upstream [mobilecli#539](https://github.com/mobile-next/mobilecli/issues/539), filed by us). Guard: `DeviceBridge#listCrashes` (`src/device/bridge.js`) throws when the list is **empty** and the device is an iOS simulator, so `mauto crash list` fails `device` (exit 2) with a hint citing #539, and the failure probe leaves `crashes` absent ("could not check") instead of a false "app is alive". Non-empty lists and Android / real-iOS empty lists are unchanged; a genuinely crash-free simulator also reads "could not check" — deliberately conservative. Remove when the pinned mobilecli fixes #539: re-capture `ios-sim.crashes.txt` with a real crash, then drop the guard and its tests.

## Conventions

- The `mobile-automator` namespace is used for workspace paths and the npm package.
- Workspace paths (`.mobile-automator/scenarios/`, etc.) are relative to the user's project root, not this repo. That root is discovered once, in `run()`, by `src/workspace/discover.js` (walk up to the nearest `.mobile-automator/config.json`, stop at `.git`); verbs that need a workspace are wrapped in `requireWorkspace` and fail `environment` when none is found (#188).
- CLAUDE.md is for humans maintaining the CLI.

## Metadata

Repo: https://github.com/sh3lan93/mobile-automator · Version: see `package.json` · License: Apache 2.0 · Status: published on npm since v0.23.8 (2026-08-30).
