# CLAUDE.md

Developer guide for maintaining the `mauto` CLI. User-facing docs live in `README.md` and the MkDocs site under `docs/` (deployed to GitHub Pages by `.github/workflows/docs.yml`); debugging recipes live in `TROUBLESHOOTING.md`.

## What this is

mobile-automator is a **host-agnostic `mauto` CLI** for AI-driven mobile QA automation. Any AI agent drives a device through `mauto` verbs (which wrap mobile-mcp); reasoning is pulled on demand via `mauto guide`.

**Status (v0.24.0): published.** The package is on npm as `mobile-automator` — first published release **v0.23.8** (2026-08-30), `latest` is **v0.24.0**. `npm i -g mobile-automator` and `npx mobile-automator <verb>` both work. Publishing is automatic: merge a version bump to `main` and the pipeline tags, releases, and publishes (see [Releasing & version handling](#releasing--version-handling)). Milestone `production-ready` (gate issue [#168](https://github.com/sh3lan93/mobile-automator/issues/168)) tracks the remaining work; its Tier 0 ("not distributable") is now clear. User-facing docs (`README.md`, `docs/`) teach `npm i -g mobile-automator`; source install (`git clone` + `npm link`) is kept only as the path for unreleased changes and contributors.

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

- **Device actions:** `elements`, `tap`, `long-press`, `double-tap`, `type <text>`, `swipe`, `press <button>`, `screenshot <path>`, `launch <appId>`, `install <path>`, `uninstall <appId>`, `open-url <url>`, `orientation <orientation>`
- **Author & verify:** `validate <file>`, `assert <type>`, `result add-step`, `result add-assertion`, `result finalize`
- **Workspace:** `setup`, `config get <key>`, `config set <key> <value>`
- **Reasoning** (agent pulls on demand): `guide <topic>` (topics: `generate`, `execute`, `setup`); `bootstrap` (verb map + invariants); `schema <name>` (names: `scenario`, `result`, `config`)
- **Agent integration:** `init --agent <claude|cursor|gemini|copilot|agents|all>` (installs native Agent Skills per host + writes slash-commands/rules + MCP entry for claude/cursor); `mcp` (runs an MCP prompts server exposing guide topics)
- **Device session:** `session start|status|end`; `devices` (list); `devices use <id>`; `devices clear`
- **Memory:** `memory show` (read), `memory add <text> --kind <app-knowledge|preferences>` / `memory forget --kind <k> --match <substr>` (agent-authored); run-history is auto-harvested on `result finalize`

## Drift guards (read before touching actions or result fields)

Two catalogs are the single source of truth for "does this capability actually reach the device / the result file". Both are consumed by lint tests, so a capability that loses its CLI reach **fails the build** instead of silently degrading.

**`src/device/action-catalog.js`** (#117) binds all **23** scenario-schema actions to *how* they execute, via a `resolution` field. Guard: `tests/lint/action-coverage.test.js`.

| resolution | count | meaning |
|---|---|---|
| `verb` | 11 | dedicated one-shot `mauto` verb → DeviceBridge → one mobile-mcp primitive |
| `semantic` | 4 | invoked as `mauto press <action>`, resolved per-platform by `src/device/semantic-press/` |
| `composed` | 5 | no verb; the agent composes it from existing verbs (the execute guide documents how) |
| `unsupported` | 3 | mobile-mcp 0.0.55 exposes no primitive (`clear_app_data`, `enable_wifi`, `disable_wifi`) — guides must **not** promise a verb |

**`src/result/capability-catalog.js`** (#140) binds every fact a result file can carry to the result schema, the `ResultStore` method that writes it, and the `mauto result` flag that supplies it. Guard: `tests/lint/result-coverage.test.js`. This exists because `assertion_results` silently stayed empty for months — the schema had a home for it and no verb could fill it.

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
| `production-ready` | gate issue [#168](https://github.com/sh3lan93/mobile-automator/issues/168) | `fix/<issue>-<slug>`, `feat/…`, `docs/…`, `chore/…` | **active** — 13 open |
| `sample-app` | PRD [#44](https://github.com/sh3lan93/mobile-automator/issues/44), slices #45–#49 | `sample-app/<issue-number>-<short-slug>` | active — slices 4–5 open |
| `cli` | PRD [#69](https://github.com/sh3lan93/mobile-automator/issues/69), slices #70–#78 | — | **complete** (all 23 closed) |
| `interactive-recording` | — | — | **dead** — recorder excised in v0.20.0 (PR #110) |

**Any agent picking up a milestone issue MUST follow this workflow in order — it is not optional:**

1. **Load full context first.** Fetch the issue **and** its PRD/gate issue together (`gh issue view <issue>` + `gh issue view 44|168`) before doing anything. Issue bodies are deliberately thin; the PRD holds the locked decisions, the slice ladder, and cross-issue constraints. Never act on a slice issue alone.
2. **Isolate the workspace.** Before any edit, create a dedicated worktree on a new branch using the prefix above. Do not work directly in an existing checkout or on a shared branch. (Dispatched subagents start at the repo root, not the worktree — force `cd` into the worktree and verify before any commit.)
3. **Plan before code.** Produce a written implementation plan (file structure, deps, module interfaces, CI changes, test list) and surface it for explicit user approval. No implementation before the user confirms the plan.
4. **Implement via subagents (TDD for non-trivial work).** Dispatch implementation through subagents so the main agent's context stays lean. The main agent orchestrates and reviews; it does not hand-write the bulk of the work.
5. **Honor the locked invariants** above.
6. **Guide changes must pass the lint guards** (see Placeholder contract). Add or extend the lint tests alongside the change.
7. **Verify before claiming done.** Run the test suite and the lint guards and **show the output** before any success claim or PR.
8. **Per-task commits; open a draft PR early** with a full description (what/why, test plan). Put `Closes #<issue>` on its own line with no intervening words; reference a PRD as `Refs #<prd>` — never `Closes` a PRD, which closes only when its last slice merges.

This workflow lives here (not in per-issue bodies) so it applies uniformly and survives issue edits.

## Schemas

- Scenario: `src/schemas/scenario_schema.json` (`$schema_version` `"2.0"` or `"2.1"`; **18** step actions + **6** precondition device actions, **27** assertion types, named string IDs, root-level `variables`/`preconditions`). Print with `mauto schema scenario`; validate a file with `mauto validate <file>`. Note: `validate` accepts actions the action-catalog marks `unsupported` — known gap, issue #166.
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

The package is **published on npm**; installs come from the registry. mobile-mcp is pinned as a dependency (`@mobilenext/mobile-mcp@0.0.55`) and spawned from `node_modules` — never fetched at runtime. `package.json` `files` ships only `bin/` and `src/`.

**The pipeline, as it actually behaves:**

1. Merge to `main` → `auto-tag.yml` mints a **GitHub App installation token** (repo secrets `RELEASE_APP_ID` / `RELEASE_APP_PRIVATE_KEY`), reads `package.json` `version`, and pushes tag `v<version>` if it does not already exist. The App identity is load-bearing, not incidental: Actions does not start workflow runs from events raised with the default `GITHUB_TOKEN`, so a `GITHUB_TOKEN`-pushed tag lands and reaches nobody — that was [#170](https://github.com/sh3lan93/mobile-automator/issues/170), which silently killed every release between v0.22.0 and v0.23.7. Missing App secrets **hard-fail** the job rather than falling back.
2. Tag push → `release.yml` cuts a GitHub Release with the matching `CHANGELOG.md` section. It has two other entry points: `release: [published]` (a Release created by hand in the UI, which pushes no tag and so emits no tag-push event) and `workflow_dispatch` (pick the **tag**, not a branch, in the ref dropdown). A `resolve` job rejects any ref that is not `refs/tags/vX.Y.Z`, so a manual run on a branch cannot publish `refs/heads/main` as a version.
3. `release.yml`'s `publish-npm` job runs `npm ci` → `npm test` → `scripts/pack-smoke.sh` → `npm publish --provenance --access public` via **trusted publishing (OIDC)** — there is no `NPM_TOKEN` anywhere, the workflow's `id-token` is the credential. It upgrades npm in-job because trusted publishing needs `npm >= 11.5.1` and Node 22 ships 10.x. Only graduated tags publish (`if: !contains(needs.resolve.outputs.version, '-')` — the *resolved version*, not `github.ref`, so a hyphen elsewhere in the ref cannot fool it), so `-rc.N` tags are never published.

**Four things worth knowing:**

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
npm run lint:guides       # guide + skill + coverage lint guards
npm run lint:schema-additive
./scripts/pack-smoke.sh   # install the packed tarball and exercise the bin — CI gates on this
```

The mobile-mcp version is pinned in `package.json` (`@mobilenext/mobile-mcp`) and resolved from `node_modules` at runtime (see `src/device/mobile-mcp-client.js`). Bump the pin there if you need a newer engine.

Note: `jest.config` `testPathIgnorePatterns` must stay `<rootDir>`-anchored — an unanchored pattern makes `npm test` silently match zero tests inside a worktree checkout.

## Known rough edges

Tracked under the `production-ready` milestone; worth knowing before you debug something.

- Windows is silently unsupported: the session daemon binds a Unix domain socket — #165.
- No JavaScript linter is configured (no ESLint config, dep, or script) — #164.
- Production dependencies carry high-severity advisories; no audit gate, no Dependabot — #161.

## Conventions

- The `mobile-automator` namespace is used for workspace paths and the npm package.
- Workspace paths (`mobile-automator/scenarios/`, etc.) are relative to the user's project root, not this repo.
- CLAUDE.md is for humans maintaining the CLI.

## Metadata

Repo: https://github.com/sh3lan93/mobile-automator · Version: see `package.json` (0.24.0 at last edit) · License: Apache 2.0 (note: `LICENSE` currently ships a stub, not the full text — #160) · Status: published on npm since v0.23.8 (2026-08-30).
