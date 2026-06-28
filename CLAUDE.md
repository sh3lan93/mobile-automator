# CLAUDE.md

Developer guide for maintaining the `mauto` CLI. User-facing docs live in `README.md`; debugging recipes live in `TROUBLESHOOTING.md`.

## What this is

mobile-automator is a **host-agnostic `mauto` CLI** for AI-driven mobile QA automation. Any AI agent drives a device through `mauto` verbs (which wrap mobile-mcp); reasoning is pulled on demand via `mauto guide`. Production-ready.

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
  cli.js                      # verb registration + handlers
  assertion/  config/  device/  guide/  init/  mcp/  output/  result/  scenario/  schemas/  setup/
  guide/content/
    <topic>.aware.md          # guide prose for platform-aware mode
    <topic>.agnostic.md       # guide prose for platform-agnostic mode
  schemas/
    scenario_schema.json      # v2.1
    result_schema.json
mobile-automator/             # created in user's project by `mauto setup`
  config.json  scenarios/  screenshots/  results/  .session/
```

## Modes

Selected during setup; stored as `mode` in `mobile-automator/config.json`. Configs predating the field are treated as `platform-aware`.

| Mode | Use for |
|---|---|
| `platform-aware` | Single-OS or OS-specific UI tests |
| `platform-agnostic` | Cross-platform (Flutter/RN/KMP/CMP) |

Agnostic mode maps OS gestures to four semantic actions resolved to per-platform mechanics at replay time: `press_back`, `dismiss_keyboard`, `grant_permission`, `deny_permission`. Schema 2.1 is additive over 2.0 (adds `mode` field + semantic actions). Each guide topic has `.aware.md` and `.agnostic.md` variants in `src/guide/content/`.

## Verbs

All verbs emit `{ok,data,error,hint,schema_version}`; `--human` is an opt-in readable flag.

- **Device actions:** `elements`, `tap`, `type <text>`, `swipe`, `press <button>`, `screenshot <path>`
- **Author & verify:** `validate <file>`, `assert <type>`, `result add-step`, `result finalize`
- **Workspace:** `setup`, `config get <key>`, `config set <key> <value>`
- **Reasoning** (agent pulls on demand): `guide <topic>` (topics: `generate`, `execute`, `setup`); `bootstrap` (verb map + invariants); `schema <name>` (names: `scenario`, `result`)
- **Agent integration:** `init --agent <claude|cursor|gemini|copilot|agents|all>` (installs native Agent Skills per host + writes slash-commands/rules + MCP entry for claude/cursor); `mcp` (runs an MCP prompts server exposing guide topics)
- **Device session:** `session start|status|end`; `devices` (list); `devices use <id>`; `devices clear`

## Placeholder contract

Guide content in `src/guide/content/<topic>.<aware|agnostic>.md` carries `{{placeholder}}` tokens filled by `src/guide/placeholders.js` (`interpolate`) from `mobile-automator/config.json` at emit time. A fallback ensures no `{{` survives in emitted output. Lint guards in `tests/lint/guide-*.test.js` enforce: no surviving `{{placeholders}}`, no leaked `mobile_*` tool names, and (agnostic files) no OS names.

## Sample-app milestone workflow (mandatory for any agent)

PRD [#44](https://github.com/sh3lan93/mobile-automator/issues/44) · milestone `sample-app` · slices #45–#49. **Any agent picking up a `sample-app`-milestone issue MUST follow this workflow in order — it is not optional:**

1. **Load full context first.** Fetch the slice issue **and** PRD #44 together (`gh issue view <slice>` + `gh issue view 44`) before doing anything. Slice bodies are deliberately thin; the PRD holds the locked decisions, the slice ladder, and cross-slice constraints. Never act on a slice issue alone.
2. **Isolate the workspace.** Before any edit, create a dedicated worktree on a new branch named `sample-app/<issue-number>-<short-slug>`. Do not work directly in an existing checkout or on a shared branch.
3. **Plan before code.** Produce a written implementation plan (file structure, deps, screen/widget tree, CI changes, test list) and surface it for explicit user approval. No implementation before the user confirms the plan.
4. **Implement via subagents.** After plan approval, dispatch the implementation through subagents so the main agent's context window stays unbloated. The main agent orchestrates and reviews; it does not hand-write the bulk of the slice itself.
5. **Open a draft PR.** When implementation is complete, open a GitHub PR in **draft** status with a full description (what/why, test plan). Put `Closes #<slice-issue>` on its own line with no intervening words; reference the PRD as `Refs #44` (never `Closes #44` — the PRD closes only when slice 5 merges).

This workflow lives here (not in per-slice issue bodies) so it applies uniformly and survives issue edits.

## CLI migration milestone workflow (mandatory for any agent)

PRD [#69](https://github.com/sh3lan93/mobile-automator/issues/69) · milestone `cli` · slices #70–#78. This milestone migrates the tool from a Gemini extension to a host-agnostic **`mauto` CLI** usable by any AI agent. **Any agent picking up a `cli`-milestone issue MUST follow this workflow in order — it is not optional:**

1. **Load full context first.** Fetch the slice issue **and** PRD #69 together (`gh issue view <slice>` + `gh issue view 69`) before doing anything. Slice bodies are deliberately thin; the PRD holds the locked design decisions and cross-slice constraints. Never act on a slice issue alone.
2. **Isolate the workspace.** Before any edit, create a dedicated worktree on a new branch named `cli/<issue-number>-<short-slug>`. Do not work directly in an existing checkout or on a shared branch. (Dispatched subagents start at the repo root, not the worktree — force `cd` into the worktree and verify before any commit.)
3. **Plan before code.** Produce a written implementation plan (file structure, deps, module interfaces, test list) and surface it for explicit user approval. No implementation before the user confirms the plan.
4. **Implement via subagents (TDD for non-trivial work).** Dispatch implementation through subagents so the main agent's context stays lean. The main agent orchestrates and reviews; it does not hand-write the bulk of the slice.
5. **Honor the locked invariants — non-negotiable.** Platform-agnostic; **never** use `resource-id` / OS-specific element IDs. Every CLI verb emits the uniform JSON envelope `{ok,data,error,hint,schema_version}` (a `--human` flag is opt-in). One-shot verbs only — no interactive `run` co-routine. Reasoning is delivered via `mauto guide <topic>` at explicit invocation, never an ambient always-loaded skill. The device is driven **only** through `mauto` verbs (which wrap mobile-mcp). Preserve the `mobile-automator/` workspace layout + scenario schema 2.1 + result schema (existing data must keep working).
6. **Guide ports must pass lint guards.** When porting `SKILL.md` prose into `mauto guide` content: no surviving `{{placeholders}}`, no leaked `mobile_*` tool names, agnostic guides name no OS. Add/extend the lint tests alongside the port.
7. **Verify before claiming done.** Run the test suite and the lint guards and show the output before any success claim or PR.
8. **Per-task commits; open a draft PR early** with a full description (what/why, test plan). Put `Closes #<slice-issue>` on its own line with no intervening words; reference the PRD as `Refs #69` (never `Closes #69` — the PRD closes only when slice #78 merges). Re-point the CI version-bump gate from extension paths to the CLI package where a slice touches it.

This workflow lives here (not in per-slice issue bodies) so it applies uniformly and survives issue edits.

## Schemas

- Scenario: `src/schemas/scenario_schema.json` (v2.1, 14 actions, 27 assertions, named string IDs, root-level `variables`/`preconditions`). Print with `mauto schema scenario`; validate a file with `mauto validate <file>`.
- Result: `src/schemas/result_schema.json` (typed `observations`: `regression`, `flakiness`, `state_context`). Print with `mauto schema result`.

## Adding a verb or guide topic

1. Register the verb handler in `src/cli.js`.
2. For a new guide topic, add `src/guide/content/<topic>.aware.md` and `<topic>.agnostic.md`.
3. Register the topic in `src/guide/emitter.js`, `src/mcp/prompts.js`, and `src/init/adapters.js`.
4. For a topic exposed as a skill, add `src/guide/content/<topic>.invariants.md` (placeholder-free, OS-free) and register the topic in `src/init/skill-meta.js` + `src/init/skill-renderer.js`.
5. Extend the lint guards in `tests/lint/`.

## Releasing & version handling

Users install via `npm i -g mobile-automator` (or run ad-hoc with `npx mobile-automator <verb>`). mobile-mcp is pinned as a dependency (`@mobilenext/mobile-mcp@0.0.55`) and spawned from `node_modules` — never fetched at runtime.

**Gate-then-graduate** for multi-PR features: ship behind an opt-in env var so partial states are invisible. Append slice entries under `## [Unreleased]`.

**CI version-bump gate.** The `Verify version is bumped` workflow fails any PR touching `src/`, `bin/`, or `package.json` without bumping `package.json`'s `version` to a value not yet in `git tag` (tags are `vX.Y.Z`). Under the gate, **the first slice PR bumps to a release-candidate semver** (e.g. `0.12.0-rc.0`); each subsequent slice increments the rc counter (`-rc.1`, `-rc.2`, …). The `vX.Y.Z` tag namespace is reserved for graduated releases — rc.N values are never tagged.

**Graduation PR** removes the env-var gate, bumps `vX.Y.Z-rc.N` → `vX.Y.Z`, collapses `[Unreleased]` into the new release section, and creates the tag. Keeps `main` mergeable and preserves the "fully-formed feature per release" pattern (see v0.10/v0.11).

## Local development

```bash
npm install                                           # in this repo (installs the pinned mobile-mcp)
npm link                                              # exposes `mauto` / `mobile-automator` on PATH
cd /path/to/test-mobile-app && mauto <verb>           # drive a device, e.g. mauto devices
```

The mobile-mcp version is pinned in `package.json` (`@mobilenext/mobile-mcp`) and resolved from `node_modules` at runtime (see `src/device/mobile-mcp-client.js`). Bump the pin there if you need a newer engine.

## Conventions

- The `mobile-automator` namespace is used for workspace paths and the npm package.
- Workspace paths (`mobile-automator/scenarios/`, etc.) are relative to the user's project root, not this repo.
- CLAUDE.md is for humans maintaining the CLI.

## Metadata

Repo: https://github.com/sh3lan93/mobile-automator · Version: see `package.json` · License: Apache 2.0 · Status: production-ready.
