# CLAUDE.md

Developer guide for maintaining the `mauto` CLI. User-facing docs live in `README.md` and the MkDocs site under `docs/` (deployed to GitHub Pages by `.github/workflows/docs.yml`); debugging recipes live in `TROUBLESHOOTING.md`.

## What this is

mobile-automator is a **host-agnostic `mauto` CLI** for AI-driven mobile QA automation. Any AI agent drives a device through `mauto` verbs (which wrap mobile-mcp); reasoning is pulled on demand via `mauto guide`.

**Status: published.** The package is on npm as `mobile-automator` — first published release **v0.23.8** (2026-08-30); the current version is `package.json`'s `version` (`npm view mobile-automator dist-tags` for what the registry serves — not restated here, because a hand-written "latest" goes stale on the next merge). `npm i -g mobile-automator` and `npx mobile-automator <verb>` both work. Publishing is automatic: merge a version bump to `main` and the pipeline tags, releases, and publishes (see [Releasing & version handling](#releasing--version-handling)). The `production-ready` gate ([#168](https://github.com/sh3lan93/mobile-automator/issues/168)) is **closed** (2026-10-25, every tier done); its successor is the 1.0 readiness gate [#267](https://github.com/sh3lan93/mobile-automator/issues/267). User-facing docs (`README.md`, `docs/`) teach `npm i -g mobile-automator`; source install (`git clone` + `npm link`) is kept only as the path for unreleased changes and contributors.

## Architecture

```
AI agent (any) → pulls reasoning via `mauto guide` / `bootstrap` / MCP prompts
               → drives the device through `mauto` verbs (uniform JSON envelope)
               → `src/device/` wraps mobile-mcp via one persistent session daemon
               → real device / emulator

Artifacts live in the `mobile-automator/` workspace (created in the user's project).
```

## File layout

```
bin/
  mauto.js                    # entry point for `mauto` and `mobile-automator` bin aliases
  mauto-session-daemon.js     # entry point for `mauto-session-daemon`
src/
  cli.js                      # verb registration + handlers (commander)
  assertion/  config/  guide/  init/  mcp/  output/  result/  scenario/  setup/
  device/
    action-catalog.js         # schema action → execution contract (drift guard, see below)
    session-daemon.js         # persistent mobile-mcp session behind a Unix socket
    session-client.js  session-spawn.js  session-paths.js  session-protocol.js  session-log.js
    bridge.js  mobile-mcp-client.js  semantic-press/  device-resolver.js  selection.js
    host-support.js           # supported host OSes (package.json os) + the unsupported-host error
  result/
    capability-catalog.js     # result field → verb → store method → schema pointer (drift guard)
    store.js                  # ResultStore, mutations serialized per runId
  memory/                     # cross-session memory store (run-history, app-knowledge, preferences)
  util/
    lock.js                   # advisory file lock shared by memory + result stores
    atomic.js                 # atomic file writes
  guide/content/
    <topic>.aware.md          # guide prose for platform-aware mode
    <topic>.agnostic.md       # guide prose for platform-agnostic mode
    <topic>.invariants.md     # placeholder-free, OS-free prose for installed Agent Skills
  schemas/
    scenario_schema.json      # $schema_version "2.0" | "2.1"
    result_schema.json
    config_schema.json
tests/
  unit/  integration/  lint/  fixtures/
  unit/e2e-harness/           # unit tests for sample-app/scripts/lib
sample-app/                   # Flutter fixture app (see sample-app/README.md)
  scenarios/                  # agnostic scenarios the real-device E2E runs
    golden/                   # golden normalized results + known-failures.json
  scripts/
    run-e2e.mjs               # real-device E2E entry: drives the shipped `mauto` (MAUTO_BIN)
    lib/                      # harness logic (CommonJS); no package.json, no own deps
mobile-automator/             # created in user's project by `mauto setup`
  config.json  scenarios/  screenshots/  results/  .session/
  memory/                     # cross-session memory (run-history.md, …)
```

## Modes

Selected during setup; stored as `mode` in `mobile-automator/config.json`. Configs predating the field are treated as `platform-aware`.

| Mode | Use for |
|---|---|
| `platform-aware` | Single-OS or OS-specific UI tests |
| `platform-agnostic` | Cross-platform (Flutter/RN/KMP/CMP) |

Agnostic mode maps OS gestures to four semantic actions resolved to per-platform mechanics at replay time: `press_back`, `dismiss_keyboard`, `grant_permission`, `deny_permission`. Schema 2.1 is additive over 2.0 (adds `mode` field + semantic actions); `tests/lint/schema-additive.test.js` enforces that. Each guide topic has `.aware.md` and `.agnostic.md` variants in `src/guide/content/`.

## Verbs

All verbs emit `{ok,data,error,hint,schema_version}`; `--human` is an opt-in readable flag. Commander parse failures are routed through the same envelope (#146) — a bad flag must never print bare text.

- **Device actions:** `elements`, `tap`, `long-press`, `double-tap`, `type <text>`, `swipe`, `press <button>`, `screenshot <path>`, `launch <appId>` (cold start; `--resume` keeps state), `terminate <appId>`, `install <path>`, `uninstall <appId>`, `open-url <url>`, `orientation <orientation>`
- **Author & verify:** `validate <file>`, `assert <type>`, `result add-step`, `result add-assertion`, `result finalize`
- **Workspace:** `setup`, `config get <key>`, `config set <key> <value>` (`config set engine` clears the device pin when the engine changes)
- **Reasoning** (agent pulls on demand): `guide <topic>` (topics: `generate`, `execute`, `setup`); `bootstrap` (verb map + invariants); `schema <name>` (names: `scenario`, `result`, `config`)
- **Agent integration:** `init --agent <claude|cursor|gemini|copilot|agents|all>` (installs native Agent Skills per host + writes slash-commands/rules + MCP entry for claude/cursor); `mcp` (runs an MCP prompts server exposing guide topics); `doctor` (reports installed hosts whose init-written files are missing or out of date; `guide` prepends a notice for the same condition)
- **Device session:** `session start|status|end`; `devices` (list); `devices use <id>`; `devices clear`
- **Memory:** `memory show` (read), `memory add <text> --kind <app-knowledge|preferences>` / `memory forget --kind <k> --match <substr>` (agent-authored); run-history is auto-harvested on `result finalize`

## Drift guards (read before touching actions or result fields)

Two catalogs are the single source of truth for "does this capability actually reach the device / the result file". Both are consumed by lint tests, so a capability that loses its CLI reach **fails the build** instead of silently degrading.

**`src/device/action-catalog.js`** (#117) binds all **23** scenario-schema actions to *how* they execute, via a `resolution` field. Guard: `tests/lint/action-coverage.test.js`.

| resolution | count | meaning |
|---|---|---|
| `verb` | 11 | dedicated one-shot `mauto` verb → DeviceBridge → one or more mobile-mcp primitives (`launch` is terminate + launch, #255) |
| `semantic` | 4 | invoked as `mauto press <action>`, resolved per-platform by `src/device/semantic-press/` |
| `composed` | 5 | no verb; the agent composes it from existing verbs (the execute guide documents how) |
| `unsupported` | 3 | mobile-mcp 1.0.13 exposes no primitive (`clear_app_data`, `enable_wifi`, `disable_wifi`) — guides must **not** promise a verb |

**`tests/integration/mobile-mcp-contract.test.js`** (#199) is the engine-side counterpart of `tests/lint/mobile-mcp-tool-coverage.test.js`. That lint guard pins our tool-name list to what `bridge.js` calls — both sides are our code, so it cannot see the engine move. The contract test spawns the pinned mobile-mcp, sends only `listTools` (no device needed), and fails when a tool we call disappears, a key we send is no longer accepted, or a newly required key appears that we do not send. The keys are derived by driving every `DeviceBridge` method through production's `makeCall`, not hand-restated. It exists because mobile-mcp's argument schemas are non-strict: an unknown key is dropped and the call still reports success — `bridge.screenshot` once sent `path` instead of `saveTo`, and every screenshot was a silent no-op.

**`src/result/capability-catalog.js`** (#140) binds every fact a result file can carry to the result schema, the `ResultStore` method that writes it, and the `mauto result` flag that supplies it. Guard: `tests/lint/result-coverage.test.js`. This exists because `assertion_results` silently stayed empty for months — the schema had a home for it and no verb could fill it.

**`package.json` `engines.node`** (#162) is the single source of truth for the supported Node range, and must stay a bare `>=X.Y.Z` floor — the guard rejects a compound range like `^20 || ^22` outright, because there is no single floor to check prose against. Guard: `tests/lint/node-version-agreement.test.js` — derives the floor and fails when the README badge, any prose claim in a shipping doc, `test.yml`'s matrix, or any workflow's literal `node-version` disagrees. It matches *any* Node-adjacent major rather than an enumerated list of phrasings, so a newly-written claim is caught by default; the rare sentence that names a Node version without claiming support goes in `NOT_A_CLAIM`.

**`package.json` `os`** (#165) is the single source of truth for which host OSes run mauto (`darwin`, `linux`) — npm enforces it at install (`EBADPLATFORM`), and `src/device/host-support.js` derives `SUPPORTED_HOSTS` from it to fail device/session verbs on anything that slips past (`--force`, `npm link`). Guard: `tests/lint/host-support-agreement.test.js` — fails when `os` is empty or claims `win32`, when `SUPPORTED_HOSTS` disagrees with it, when `README.md` or `docs/getting-started/installation.md` fails to name every host (via a map keyed on `os`, so a new host forces a doc update) plus Windows/WSL2, or when `TROUBLESHOOTING.md` loses the heading the runtime hint cites.

**`package-lock.json`** must mirror `package.json`'s `name`, `version`, `engines.node` and `os`. Guard: `tests/lint/lockfile-in-sync.test.js`. CI installs with `npm ci`, which installs *from the lockfile*, so a stale root entry is invisible until something downstream reads the wrong value — it has drifted twice.

**`LICENSE`** (#160) must be the verbatim Apache-2.0 text from apache.org — it shipped a 644-byte stub for months. Guard: `tests/lint/license-full-text.test.js` restores the appendix copyright line to its `[yyyy] [name of copyright owner]` template and compares the SHA-256 against the canonical file, so the copyright line is the only line that may differ. To change the text, re-fetch it rather than re-pin the hash.

**Production-dependency advisories** (#161) are gated by `scripts/audit-gate.js`, which runs `npm audit --omit=dev` and fails on any high/critical advisory not listed in `scripts/audit-allowlist.json`. Every allowlist entry carries a reason, the issue that removes it, and an `expires` date. An expired entry fails, and so does a *stale* one (its advisory is no longer reported), so accepted risk can't outlive its reason. It runs in `audit.yml` (PR, main, weekly — a signal) and in `release.yml`'s `publish-npm` before `npm publish` (the actual gate). Wiring guard: `tests/lint/supply-chain-gate.test.js`. Dependabot is `lockfile-only` on purpose: a `package.json` change would trip the version-bump gate, and users resolve our ranges fresh anyway.

**ESLint** (#164) runs `npm run lint` (`eslint.config.js`) in `lint.yml` (PR, main — a required check since #249) and in `release.yml`'s `publish-npm` before `npm publish` (the actual gate). Its point is the type-aware block over `src/`, `bin/` and `scripts/`: `no-floating-promises` and `no-misused-promises` catch the async callback whose rejection nobody observes — on its first run it found the session daemon exiting on a `null` frame. Guard: `tests/lint/eslint-gate.test.js` pins the script, both rules at `error`, and both CI runs. Those rules need TypeScript's types, and TS 6 no longer auto-loads `@types/*`, so the `@types/node` devDependency plus `"types": ["node"]` in `tsconfig.eslint.json` are load-bearing: without them every Node API is untyped, and the rules silently report nothing (they missed the daemon bug that way). It lives in its own workflow because `node-version-agreement.test.js` requires every `test.yml` job to run the Node matrix.

**`release.yml`'s job order** (#186) is the release gate, because the required PR checks prove the PR, not the tag `auto-tag.yml` pushes (see [Releasing & version handling](#releasing--version-handling)). Guard: `tests/lint/release-gate.test.js` — fails when the `verify` job's Node matrix stops deep-equalling *every* `test.yml` job's (read from `test.yml`, never restated, so the floor is covered transitively by the Node guard above — and test.yml's own two restatements, `test` and `pack-smoke`, are pinned to each other by the same sweep), when `verify` stops running the same suite command `test.yml`'s test job runs (`npm run test:all`) plus `./scripts/pack-smoke.sh` on `${{ matrix.node-version }}` with `fail-fast: false`, when `verify` stops needing `resolve` (the needs line is what keeps a rejected manual ref from reaching the release job with an empty tag), when an `if:` or `continue-on-error` neutralises any of it, when `publish-npm` stops needing `verify`, when `publish-npm`'s `if` stops being exactly the rc guard (the `|| skipped` clause in the `release` job's `if` is only sound while that guard is the one thing that can skip publish), or when the `release` job's `needs` or its exact `if:` changes.

**`.github/required-checks.json`** (#249) is the whole `main-branch` ruleset policy — `repo`, `ruleset_id`, `enforcement`, `integration_id`, `strict`, `required_approving_review_count`, `bypass_actors` and the required `checks` — and the ruleset itself, which lives outside git, is applied from it by `scripts/apply-ruleset.js` (dry run by default; see [Releasing & version handling](#releasing--version-handling)). The script's transform is unit-tested in `tests/unit/apply-ruleset.test.js`, and the guard reads the file through the script's own `loadPolicy`, so both share one parser. Guard: `tests/lint/required-checks.test.js` — fails when a listed name is produced by zero or more than one workflow job (job `name`s are expanded over their matrix, so the `test` job yields one `Test (…)` name per entry in its `node-version` matrix; a renamed job or a changed matrix fails here instead of leaving a check that never reports and blocks every PR forever), when the producing workflow's `pull_request` trigger has a `paths`/`paths-ignore` filter (no run means no check run, so the check stays pending forever — unlike a job-level `if:` skip, which counts as success), when a job a required job `needs` is not itself required (a failed needed job *skips* its dependent, and a skipped check satisfies a required one — why `Detect CLI code changes` sits next to `Verify version is bumped`), or when the producing job is neutralised: a job-level `if:` other than the one pinned in `ALLOWED_JOB_IFS` (`version-check.yml#check-version`'s, exact expression), any step `if:`, or `continue-on-error` on the job or any step. Only workflows with a `pull_request` trigger are searched for producers, so a tag-only workflow's matrix cannot break it.

**`tests/lint/workflow-guard.js`** is the shared helper module for the workflow-parsing guards (`supply-chain-gate`, `eslint-gate`, `release-gate`, `required-checks`): `loadWorkflow`, `runs`, `findStep`, `findJobWithRun`, `findProducer` (the one job reporting a check name; throws naming every producer unless there is exactly one), `asList`, `expandJobNames` (a job's check-run names, matrix-expanded; throws on anything GitHub would compute rather than the YAML spell out). It is to those guards what `tests/lint/docs-corpus.js` is to the prose guards — #161, #164 and #186 had each grown a private copy of the same helpers, one rename apart, and three hand-maintained copies is the drift threshold #162's corpus extraction already taught us. The next wiring guard consumes this module; it does not grow another private copy.

**Schema validity** (#191): every `src/schemas/*.json` must be valid Draft-07, compile under Ajv strict mode (which catches misspelled keywords like `"requird"` that `strict: false` silently accepts), and compile with the CLI's own Ajv — `createCliAjv()` from `src/schemas/cli-ajv.js`, the single construction site; the guard imports the factory rather than mirroring its options, and fails on any other `new Ajv(` in `src/` or `bin/`, so the options cannot drift back into hand-copied literals. Guard: `tests/lint/schemas-valid.test.js`. It replaced the path-filtered `validate-schemas.yml` workflow, which installed `ajv` outside the lockfile.

**The shipping-doc corpus** is `tests/lint/docs-corpus.js`: every tracked `.md` minus historical records (`CHANGELOG.md`, `docs/changelog.md`, `docs/plans/**`), enumerated with `git ls-files` so `.gitignore` never has to be restated. Four guards scan it — `docs-counts.test.js` (capability counts vs the schema), `docs-no-stale-extension.test.js` (the removed Gemini-extension model), the Node guard above, and the unsupported-action rule below. A new doc-scanning guard consumes `shippingDocs()`; do not hand-maintain a second file list, which is how `sample-app/README.md` kept teaching removed slash-command syntax for months.

**The real-device E2E** (#94) is `sample-app/scripts/run-e2e.mjs`, run by `sample-app-e2e-android.yml` on an API 36 emulator (not 33: there even the legacy engine cannot recover TextField labels, #251). It drives the **shipped** `mauto` binary (`MAUTO_BIN`; in CI the packed tarball) through one-shot verbs and resolves targets with `findFirst` from that same install's `src/assertion/evaluator.js` — never a private MCP client, engine pin or matcher, which is what the harness it replaced had. `sample-app/scenarios/golden/known-failures.json` excuses a scenario only when its first failed step is the entry's `failing_step` (XFAIL); failing elsewhere is FAIL and passing is XPASS, both job failures. Guard: `tests/lint/e2e-agnostic.test.js` — no OS element-id tokens in the harness, no own matcher, no scenario target equal to an app Semantics id, no `sample-app/scripts/package.json`, every known failure pinned to an issue, reason and existing step, and the golden gate keyed on the scenario's `golden` tag (`sample-app/scripts/lib/golden.js`, loud in both directions), never a `golden_` id prefix.

**Docs vs unsupported actions** (#166): a rule in `tests/lint/action-coverage.test.js` scans the shipping-doc corpus and fails when a line names an `unsupported` action (`clear_app_data`, `enable_wifi`, `disable_wifi`) without also saying it is unsupported. **Assertion split**: `tests/lint/assertion-split-docs.test.js` pins `MECHANICAL_TYPES` to the mechanical-vs-agent-judged table in `docs/reference/assertions.md`, so a new assertion type must be placed in one column.

When you add an action or a result field, add its catalog entry in the same change. Do not hand-restate these counts in prose; derive them.

## Placeholder contract

Guide content in `src/guide/content/<topic>.<aware|agnostic>.md` carries `{{placeholder}}` tokens filled by `src/guide/placeholders.js` (`interpolate`) from `mobile-automator/config.json` at emit time. Unset placeholders render per slot kind rather than emitting a bare token, and the emitted output is guarded so nothing `{{`-shaped survives (#143). Lint guards in `tests/lint/` enforce: no surviving `{{placeholders}}`, no leaked `mobile_*` tool names, agnostic files name no OS, skill invariants stay placeholder-free, and skill frontmatter stays valid.

## Locked invariants — non-negotiable, all work

These were locked by PRD #69 and outlive it. Any change that breaks one is wrong regardless of what it fixes.

- **Platform-agnostic selectors.** Never use `resource-id` or OS-specific element IDs.
- **Uniform envelope.** Every verb emits `{ok,data,error,hint,schema_version}`; `--human` is opt-in only.
- **One-shot verbs only.** No interactive `run` co-routine.
- **Reasoning is pulled, never ambient.** Delivered via `mauto guide <topic>` at explicit invocation, never an always-loaded skill.
- **The device is driven only through `mauto` verbs** (which wrap mobile-mcp). Never call mobile-mcp tools directly.
- **Backwards compatibility.** Preserve the `mobile-automator/` workspace layout, scenario schema 2.0/2.1, and the result schema — existing data must keep working.

There is also a **three-layer model** worth keeping straight: (1) the CLI contract, (2) the per-host invocation surface (slash commands, rules, skills — host-specific, e.g. `$ARGUMENTS` is Claude-only), (3) the guide prose. Never put a contract in layer 2.

## Milestone workflow (mandatory for any agent)

| Milestone | PRD / gate | Branch prefix | State |
|---|---|---|---|
| `production-ready` | gate issue [#168](https://github.com/sh3lan93/mobile-automator/issues/168) | `fix/<issue>-<slug>`, `feat/…`, `docs/…`, `chore/…` | **complete** (gate closed 2026-10-25) |
| `sample-app` | PRD [#44](https://github.com/sh3lan93/mobile-automator/issues/44), slices #45–#49 | `sample-app/<issue-number>-<short-slug>` | active — slices 4–5 open |
| `cli` | PRD [#69](https://github.com/sh3lan93/mobile-automator/issues/69), slices #70–#78 | — | **complete** (all 23 closed) |
| `interactive-recording` | — | — | **dead** — recorder excised in v0.20.0 (PR #110) |

**Any agent picking up a milestone issue MUST follow this workflow in order — it is not optional:**

1. **Load full context first.** Fetch the issue **and** the PRD/gate issue its milestone's row names in the table above, together (`gh issue view <issue>` + `gh issue view <prd-or-gate>`), before doing anything. Issue bodies are deliberately thin; the PRD holds the locked decisions, the slice ladder, and cross-issue constraints. Never act on a slice issue alone.
2. **Isolate the workspace.** Before any edit, create a dedicated worktree on a new branch using the prefix above. Do not work directly in an existing checkout or on a shared branch. (Dispatched subagents start at the repo root, not the worktree — force `cd` into the worktree and verify before any commit.)
3. **Plan before code.** Produce a written implementation plan (file structure, deps, module interfaces, CI changes, test list) and surface it for explicit user approval. No implementation before the user confirms the plan.
4. **Implement via subagents (TDD for non-trivial work).** Dispatch implementation through subagents so the main agent's context stays lean. The main agent orchestrates and reviews; it does not hand-write the bulk of the work.
5. **Honor the locked invariants** above.
6. **Guide changes must pass the lint guards** (see Placeholder contract). Add or extend the lint tests alongside the change.
7. **Verify before claiming done.** Run the test suite and the lint guards and **show the output** before any success claim or PR.
8. **Per-task commits; open a draft PR early** with a full description (what/why, test plan). Put `Closes #<issue>` on its own line with no intervening words; reference a PRD as `Refs #<prd>` — never `Closes` a PRD, which closes only when its last slice merges.

This workflow lives here (not in per-issue bodies) so it applies uniformly and survives issue edits.

## Schemas

- Scenario: `src/schemas/scenario_schema.json` (`$schema_version` `"2.0"` or `"2.1"`; **18** step actions + **6** precondition device actions, **27** assertion types, named string IDs, root-level `variables`/`preconditions`). Print with `mauto schema scenario`; validate a file with `mauto validate <file>`. Note: `validate` still accepts actions the action-catalog marks `unsupported` (schema compatibility) but reports each as a `data.warnings[]` entry with `code: 'unsupported_action'`; `--strict` turns them into `invalid_input`. A lint guard in `tests/lint/action-coverage.test.js` fails the build if a shipping doc presents one as working (#166).
- Result: `src/schemas/result_schema.json` (typed root-level `observations`: `regression`, `flakiness`, `state_context`). Print with `mauto schema result`.
- Config: `src/schemas/config_schema.json`. Print with `mauto schema config`.

## Adding a verb or guide topic

1. Register the verb handler in `src/cli.js`.
2. If it executes a scenario action, add the entry to `src/device/action-catalog.js`; if it writes a result field, add it to `src/result/capability-catalog.js`. The coverage lint tests derive from these.
3. For a new guide topic, add `src/guide/content/<topic>.aware.md` and `<topic>.agnostic.md`.
4. Register the topic in `src/guide/emitter.js`, `src/mcp/prompts.js`, and `src/init/adapters.js`.
5. For a topic exposed as a skill, add `src/guide/content/<topic>.invariants.md` (placeholder-free, OS-free) and register the topic in `src/init/skill-meta.js` + `src/init/skill-renderer.js`.
6. Extend the lint guards in `tests/lint/`.

## Releasing & version handling

The package is **published on npm**; installs come from the registry. mobile-mcp is pinned as a dependency (`@mobilenext/mobile-mcp@1.0.13`, bundling mobilecli 1.0.21) and spawned from `node_modules` — never fetched at runtime. Since 1.0 it drives every device through `mobilecli`, a native binary shipped as per-platform optional dependencies (`@mobilenext/mobilecli-<os>-<arch>`, no postinstall); the workspace `engine: legacy` key (or an exported `MOBILEMCP_LEGACY_ROBOT=1`, which wins) restores the previous adb / WDA+go-ios robots for Android and real iOS devices (#199, #251). `package.json` `files` ships only `bin/` and `src/`.

**The pipeline, as it actually behaves:**

1. Merge to `main` → `auto-tag.yml` mints a **GitHub App installation token** (repo secrets `RELEASE_APP_CLIENT_ID` / `RELEASE_APP_PRIVATE_KEY` — the App's **Client ID** `Iv23li…`, not its numeric App ID), reads `package.json` `version`, and pushes tag `v<version>` if it does not already exist. The App identity is load-bearing, not incidental: Actions does not start workflow runs from events raised with the default `GITHUB_TOKEN`, so a `GITHUB_TOKEN`-pushed tag lands and reaches nobody — that was [#170](https://github.com/sh3lan93/mobile-automator/issues/170), which silently killed every release between v0.22.0 and v0.23.7. Missing App secrets **hard-fail** the job rather than falling back.
2. Tag push → `release.yml` verifies, publishes, and cuts a GitHub Release with the matching `CHANGELOG.md` section. It has two other entry points: `release: [published]` (a Release created by hand in the UI, which pushes no tag and so emits no tag-push event) and `workflow_dispatch` (pick the **tag**, not a branch, in the ref dropdown). A `resolve` job rejects any ref that is not `refs/tags/vX.Y.Z`, so a manual run on a branch cannot publish `refs/heads/main` as a version.
3. Inside `release.yml` the jobs run `resolve` → `verify` → `publish-npm` → `release`:
   - **`verify`** runs `npm ci` → `npm run test:all` → `scripts/pack-smoke.sh` (which ends with `mauto devices` from the packed tarball — the only step that starts the pinned engine and resolves its `mobilecli` binary) on every Node in `test.yml`'s matrix (22 and 24), for every tag including rc. The suite command and the matrix are mirrored from `test.yml` and pinned by `tests/lint/release-gate.test.js`.
   - **`publish-npm`** needs `verify`. It upgrades npm in-job because trusted publishing needs `npm >= 11.5.1` and Node 22 ships 10.x, then runs `npm ci` → `node scripts/audit-gate.js` → `npm run lint` → `npm publish --provenance --access public` (whose `prepublishOnly` re-runs jest) via **trusted publishing (OIDC)** — there is no `NPM_TOKEN` anywhere, the workflow's `id-token` is the credential. Only graduated tags publish (`if: !contains(needs.resolve.outputs.version, '-')` — the *resolved version*, not `github.ref`, so a hyphen elsewhere in the ref cannot fool it), so `-rc.N` tags are never published.
   - **`release`** needs both and is created only after `publish-npm` succeeds, or, for rc tags (publish skipped), after `verify` passes. Its body says `npm i -g`, so a gate-stopped publish no longer leaves a Release for a version npm never had (v0.27.0 did).

**Five things worth knowing:**

- **PR checks are binding; the release still re-proves.** The `main-branch` ruleset (id `13197042`) requires every check in `.github/required-checks.json` (#249), reported by GitHub Actions only (`integration_id` 15368, so a commit status with the same name from anywhere else does not count), with the branch up to date with `main` (`strict`), zero required approvals, and **no bypass actor** — the maintainer is held to the same rule as everyone else. The escape hatch is disabling the ruleset: rulesets do not govern their own editing, and the change is audit-logged. The policy owns `enforcement: active`, so the next `--apply` re-enables it rather than verifying a disabled ruleset as applied. Strict costs a rebase: after each merge, every open PR needs "Update branch" (Dependabot: comment `@dependabot rebase`), and a stacked PR can only update once the PR beneath it merges. Deliberately *not* required: `Production dependency audit` (a newly disclosed advisory turns it red on PRs that touched nothing; `publish-npm` gates it) and every path-filtered workflow (Vale, Sample App, the Android E2E, docs). `auto-tag.yml` still does not wait for the post-merge `test.yml` run, so `release.yml`'s `verify` matrix plus `publish-npm`'s audit and lint remain the gate for what ships. The ruleset lives outside git; `.github/required-checks.json` is the whole policy, and `scripts/apply-ruleset.js` applies it. After changing the JSON, dry-run with `node scripts/apply-ruleset.js` (prints the body it would PUT and whether the live ruleset already matches), then apply (needs admin) with `node scripts/apply-ruleset.js --apply`, which re-fetches the ruleset and exits non-zero unless it matches the policy. A PUT replaces the whole ruleset, which is why the script builds its body from a fresh GET rather than a hand-written one: every rule the policy does not own is carried over as GitHub has it.
- **rc versions *are* tagged.** `auto-tag.yml` has no prerelease guard, so `v0.21.0-rc.13` and 20 other rc tags exist in the repo. Only *npm publishing* is gated on graduation, not tagging.
- **`release.yml`'s `release` job must keep `GITHUB_TOKEN`.** The same suppression rule that caused #170 is what stops the Release it creates from re-triggering the workflow through its own `release: [published]` trigger. Handing that step the App token would loop forever.
- **Trusted publishing names this workflow file.** The trust relationship lives on the npm package and names both this repo and `release.yml`. Renaming that file, or moving the publish step into another workflow, breaks publishing until the trusted publisher is updated — check with `npm trust list mobile-automator`.
- **The GitHub Releases list looks patchy on purpose.** Tags `v0.23.1`–`v0.23.6` have no Release: they predate the #170 fix and were deliberately not backfilled (never published, their content is in `CHANGELOG.md`). Also, `release.yml` marks every `0.x` version `prerelease: true`, so nothing is flagged "Latest" until 1.0.

**CI version-bump gate.** The `Verify version is bumped` workflow fails any PR touching `src/`, `bin/`, or `package.json` without bumping `package.json`'s `version` to a value not yet in `git tag`.

- **Single-PR bugfix:** bump straight to a graduated `vX.Y.Z` and rename `[Unreleased]` to that release in `CHANGELOG.md`.
- **Multi-PR feature (gate-then-graduate):** ship behind an opt-in env var so partial states are invisible; the first slice PR bumps to `X.Y.Z-rc.0` and each subsequent slice increments the rc counter. Append slice entries under `## [Unreleased]`. The **graduation PR** removes the env-var gate, bumps `X.Y.Z-rc.N` → `X.Y.Z`, and collapses `[Unreleased]` into the new release section. This keeps `main` mergeable and preserves the "fully-formed feature per release" pattern (see v0.10/v0.11).

## Local development

```bash
npm install                                           # in this repo (installs the pinned mobile-mcp)
npm link                                              # exposes `mauto` / `mobile-automator` on PATH
cd /path/to/test-mobile-app && mauto <verb>           # drive a device, e.g. mauto devices
```

```bash
npm test                  # full jest suite (also runs on prepublishOnly)
npm run test:unit         # tests/unit
npm run test:integration  # tests/integration (CLI smoke over the real binary)
npm run lint              # ESLint over src/bin/scripts/tests (type-aware async rules on src/bin/scripts)
npm run lint:guides       # every lint guard in tests/lint (guide, skill, coverage, drift)
npm run lint:schema-additive
./scripts/pack-smoke.sh   # install the packed tarball and exercise the bin, incl. `mauto devices` against the real engine — CI gates on this
MAUTO_BIN=$(command -v mauto) node sample-app/scripts/run-e2e.mjs   # real-device E2E against an emulator with the sample app installed (see sample-app/README.md)
```

The mobile-mcp version is pinned in `package.json` (`@mobilenext/mobile-mcp`, 1.0.13) and resolved from `node_modules` at runtime (see `src/device/mobile-mcp-client.js`). Bump the pin there if you need a newer engine, then run `npm run test:integration` — `mobile-mcp-contract.test.js` fails if the new engine's tool schemas no longer match what `DeviceBridge` sends. The session daemon keeps one mobile-mcp process alive and mobile-mcp caches its robot per device for that process's life, so after changing any `MOBILEMCP_*` env var run `mauto session end` before the next verb. The `engine` config key needs no such step: the daemon handle records its engine, and the next device verb restarts a daemon running a stale one (`session status` reports `engine` vs `resolved_engine`).

Note: `jest.config` `testPathIgnorePatterns` must stay `<rootDir>`-anchored — an unanchored pattern makes `npm test` silently match zero tests inside a worktree checkout.

## Known rough edges

The upstream-dependent ones have exit plans tracked under the 1.0 readiness gate ([#267](https://github.com/sh3lan93/mobile-automator/issues/267)); worth knowing before you debug something.

- Windows is unsupported by declaration — two deliberate enforcement layers (#165): `package.json` `os` (`darwin`, `linux`) refuses the install (npm's `EBADPLATFORM` carries no WSL2 hint — accepted, it is the only gate npm actually enforces), and `src/device/host-support.js` fails device/session verbs with a rich `environment` envelope for what slips past (`--force`, `npm link`). Device-free verbs already installed on a forced Windows machine keep working; real support would need named pipes plus replacements for `ps`, process-group kill and signals.
- iOS simulators need the engine's on-device agent (a "Device Kit" app). Since mobile-mcp 1.0.11 the engine installs it automatically ([mobile-mcp#459](https://github.com/mobile-next/mobile-mcp/issues/459) fixed in practice, still open upstream; verified 2026-10-25 by uninstalling the agent). When that install fails, every verb fails with `Command failed: … agent install --device <udid>` / `failed to install agent: …` and `src/device/engine-hints.js` prints the manual `npx -y mobilecli@<pinned> agent install --device <udid>`.
- On the default engine (mobilecli), Flutter TextField labels are dropped and offstage `IndexedStack` content leaks into `elements` — [#251](https://github.com/sh3lan93/mobile-automator/issues/251), upstream [mobilecli#534](https://github.com/mobile-next/mobilecli/issues/534). Workaround: the opt-in workspace key `engine: legacy` (`src/device/engine.js`) — it hides offstage content on every level tested, but recovers TextField labels (uiautomator `hint`) only on recent Android (verified API 36; not API 33, whose dump has no hint; the floor between is unverified), which is why the E2E emulator is API 36; the default stays affected until mobilecli#534 lands. The E2E runs both engines and `golden_search_empty` is a known failure on the mobilecli leg only (`engines` in `known-failures.json`); `smoke_nav` still targets the Home tab as `Tab 1 of 3`.
- On Android, mobilecli's on-device `DeviceServer` holds UiAutomation (kills `uiautomator dump` with exit 137, Appium, legacy `elements` → `reading 'node'`). [mobilecli#470](https://github.com/mobile-next/mobilecli/issues/470) is only partly fixed (mobilecli#476, in mobile-mcp 1.0.7): the DeviceServer now exits when the host-side `mobilecli daemon` exits or after a 30-min idle timeout (`--idle-timeout-ms=1800000`) — but that host daemon is detached (re-parented to pid 1) and outlives the engine and the session, so right after a default-engine session the device is still held. Release: `pkill -f 'mobilecli.* daemon'` on the host (the DeviceServer then exits by itself), or `adb shell pkill -f com.mobilenext.mobilecli.DeviceServer`, or wait 30 min.
- On an iOS simulator on macOS 27 hosts, the pinned mobilecli's `mobile_list_crashes` returns `[]` even right after a crash — its filter requires `is_simulated` in the `.ips` header, which those reports replace with `"platform":7` (upstream [mobilecli#539](https://github.com/mobile-next/mobilecli/issues/539), filed by us). Guard: `DeviceBridge#listCrashes` (`src/device/bridge.js`) throws when the list is **empty** and the device is an iOS simulator, so `mauto crash list` fails `device` (exit 2) with a hint citing #539, and the failure probe leaves `crashes` absent ("could not check") instead of a false "app is alive". Non-empty lists and Android / real-iOS empty lists are unchanged; a genuinely crash-free simulator also reads "could not check" — deliberately conservative. Remove when the pinned mobilecli fixes #539: re-capture `ios-sim.crashes.txt` with a real crash, then drop the guard and its tests.

## Conventions

- The `mobile-automator` namespace is used for workspace paths and the npm package.
- Workspace paths (`mobile-automator/scenarios/`, etc.) are relative to the user's project root, not this repo. That root is discovered once, in `run()`, by `src/workspace/discover.js` (walk up to the nearest `mobile-automator/config.json`, stop at `.git`); verbs that need a workspace are wrapped in `requireWorkspace` and fail `environment` when none is found (#188).
- CLAUDE.md is for humans maintaining the CLI.

## Metadata

Repo: https://github.com/sh3lan93/mobile-automator · Version: see `package.json` · License: Apache 2.0 · Status: published on npm since v0.23.8 (2026-08-30).
