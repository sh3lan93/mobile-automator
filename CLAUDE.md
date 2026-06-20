# CLAUDE.md

Developer guide for maintaining this extension. User-facing docs live in `README.md`; runtime contract for Gemini lives in `GEMINI.md`; debugging recipes live in `TROUBLESHOOTING.md`.

## What this is

Mobile Automator is a **Gemini CLI extension** for mobile QA automation. It is *not* a direct testing tool — it analyzes a mobile project, then generates project-specific testing skills. Production-ready and feature-complete.

## Three-tier architecture

```
Tier 1 — Extension commands (commands/mobile-automator/*.toml)
         Pre-flight: device detection, app install, scenario selection.
Tier 2 — Workspace skills (.gemini/skills/mobile-automator-*)
         Project-customized test generation & execution logic.
Tier 3 — mobile-mcp (bundled via gemini-extension.json)
         Platform-agnostic device automation primitives.
```

Tier 1 wraps Tier 2 so infrastructure concerns are separated from domain logic.

## File layout

```
commands/mobile-automator/    setup, generate, execute, report, list-tags (.toml)
templates/
  mobile-automator-generator/{aware,agnostic}/SKILL.md
  mobile-automator-executor/{aware,agnostic}/SKILL.md
  mobile-automator-recorder/{aware,agnostic}/SKILL.md # gated; both modes (aware + agnostic)
  mobile-automator-generator/references/scenario_schema.json   # v2.1
  mobile-automator-executor/references/result_schema.json
  references/platform-resolutions.md                 # agnostic-mode runtime contract
mobile-automator/             (created in user projects) scenarios/, screenshots/, results/, config.json
```

## Modes

Selected during setup; stored as `mode` in `mobile-automator/config.json`. Configs predating the field are treated as `platform-aware` at runtime.

| Mode | Placeholders | Use for |
|---|---|---|
| `platform-aware` | 13 | Single-OS or OS-specific UI tests |
| `platform-agnostic` | 6 | Cross-platform (Flutter/RN/KMP/CMP) |

Agnostic mode replaces OS-specific primitives with four semantic actions resolved at runtime via `templates/references/platform-resolutions.md`: `press_back`, `dismiss_keyboard`, `grant_permission`, `deny_permission`. Schema 2.1 is additive over 2.0 (adds `mode` field + semantic actions).

Switching modes on re-setup runs an atomic 3-phase migration (carry-forward shared values, drop OS-specifics, re-ask agnostic-only fields, archive prior skills to `.gemini/skills/.archive/`). See TROUBLESHOOTING.md for manual restore.

## Commands

Each command lives in `commands/mobile-automator/<name>.toml` and is namespaced as `/mobile-automator:<name>`.

- **setup** — 7-section workflow: pre-init → platform detect → environment discovery → app package inference → project knowledge (architecture, business domain, loading indicators, protected dirs) → skill installation → scaffolding. Resumable via `mobile-automator/setup_state.json`. Section 6 reads templates from `${extensionPath}/templates/<mode>/`, replaces `{{placeholders}}`, writes to `.gemini/skills/`, and asserts no `{{` remains.
- **generate** — Pre-flight wrapper. Validates config, resolves environment (saved in `mobile-automator/generate_preferences.json`; `--environment=` ephemeral, `--set-environment=` persists), confirms device + app install, delegates to generator skill.
- **execute** — Pre-flight wrapper. Validates config, picks device (`--device` or interactive), resolves scenarios (`--all`, `--tag`, names, or interactive), delegates to executor skill.
- **report**, **list-tags** — see their `.toml` files.

## Placeholder contract

Skill templates use `{{name}}` syntax. Setup gathers values, performs string replacement, writes populated `SKILL.md` to `.gemini/skills/`, then verifies no `{{` remains. Authoritative list of placeholder names lives in `setup.toml` Section 6 — don't re-document here, it'll drift.

Runtime fallback: skills can read `mobile-automator/config.json` if a placeholder wasn't populated.

## Recorder (gated soft-launch, v0.12.0)

PRD [#21](https://github.com/sh3lan93/mobile-automator/issues/21). Feature-complete across 13 slices (see `CHANGELOG.md` `## [0.12.0]`). The entire recorder surface (`/mobile-automator:record`, sidecar at `tools/recorder/`, GUI, recorder skill) is hidden unless `MOBILE_AUTOMATOR_RECORDER=1` is set in the environment — the env-var gate remains in v0.12.0 so the feature can mature in real-world use before being removed.

- Aware-mode recorder skill installs at `.gemini/skills/mobile-automator-recorder/SKILL.md` from the `aware/` template. Uses 10 of 13 aware placeholders (skips `build_command`, `automation_extras`, `business_domain`).
- Agnostic-mode recorder installs from the `agnostic/` template. It uses only the 6 agnostic placeholders; per-OS facts resolve at runtime via `templates/references/platform-resolutions.md`. The sidecar reinterprets OS gestures into the four semantic actions; `dismiss_keyboard` is a manual GUI mark.
- The recorder skill synthesises scenario JSON from sidecar artifacts under `mobile-automator/.recorder/<scenario_id>/` — `metadata.json`, `events.jsonl`, `hierarchy/<t>.json`, `screenshots/`, `assertions.json`, `edits.jsonl`, and optional `crashes/`. The bundle is deleted on successful Save and on Cancel; persistent crash logs survive at `mobile-automator/crash-logs/` (separate from the bundle). The skill defers to the generator skill for scenario shape — generator stays single source of truth.
- The C3 protocol contract for future v1.1 instrumentation SDKs lives at `templates/references/c3-protocol.md` (TCP-over-loopback, line-delimited JSON, versioned handshake, six event kinds). The reference listener is `tools/recorder/src/c3/tcp-listener.js`. No SDKs ship in v0.12.0.

## Sample-app milestone workflow (mandatory for any agent)

PRD [#44](https://github.com/sh3lan93/mobile-automator/issues/44) · milestone `sample-app` · slices #45–#49. **Any agent picking up a `sample-app`-milestone issue MUST follow this workflow in order — it is not optional:**

1. **Load full context first.** Fetch the slice issue **and** PRD #44 together (`gh issue view <slice>` + `gh issue view 44`) before doing anything. Slice bodies are deliberately thin; the PRD holds the locked decisions, the slice ladder, and cross-slice constraints. Never act on a slice issue alone.
2. **Isolate the workspace.** Before any edit, create a dedicated worktree on a new branch named `sample-app/<issue-number>-<short-slug>` (mirrors the recorder branch convention). Do not work directly in an existing checkout or on a shared branch.
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

- Scenario: `templates/mobile-automator-generator/references/scenario_schema.json` (v2.1, 14 actions, 27 assertions, named string IDs, root-level `variables`/`preconditions`).
- Result: `templates/mobile-automator-executor/references/result_schema.json` (includes typed `observations`: `regression`, `flakiness`, `state_context`).

Setup copies both to `.gemini/skills/mobile-automator-{generator,executor}/references/`. `GEMINI.md` is the registry that points skills at the workspace copies.

## Adding a new skill

1. Create `templates/mobile-automator-<name>/{aware,agnostic}/SKILL.md` with frontmatter + `{{placeholders}}`.
2. Add any new schema under `references/`.
3. Wire it into `setup.toml` Section 6's install loop.
4. Reference new schema paths from `GEMINI.md`.
5. Optionally add a `commands/mobile-automator/<name>.toml` wrapper.

## Releasing & version handling

Follow `RELEASE.md`. Users install via `npm i -g mobile-automator` (or run ad-hoc with `npx mobile-automator <verb>`). mobile-mcp ships as a pinned dependency (`@mobilenext/mobile-mcp@0.0.55`) and is spawned from `node_modules` — never fetched at runtime.

**Gate-then-graduate** for multi-PR features: ship behind an opt-in env var (e.g. `MOBILE_AUTOMATOR_RECORDER=1`) so partial states are invisible. Append slice entries under `## [Unreleased]`.

**CI version-bump gate.** The `Verify version is bumped` workflow fails any PR touching CLI paths (`src/`, `bin/`, `tools/`, `package.json`) without bumping `package.json`'s `version` to a value not yet in `git tag` (tags are `vX.Y.Z`). Under the gate, **the first slice PR bumps to a release-candidate semver** (e.g. `0.12.0-rc.0`); each subsequent slice increments the rc counter (`-rc.1`, `-rc.2`, …). The `vX.Y.Z` tag namespace is reserved for graduated releases — rc.N values are never tagged.

**Graduation PR** removes the env-var gate, bumps `vX.Y.Z-rc.N` → `vX.Y.Z`, collapses `[Unreleased]` into the new release section, and creates the tag. Keeps `main` mergeable and preserves the "fully-formed feature per release" pattern (see v0.10/v0.11).

## Local development

```bash
npm install                                           # in this repo (installs the pinned mobile-mcp)
npm link                                              # exposes `mauto` / `mobile-automator` on PATH
cd /path/to/test-mobile-app && mauto <verb>           # drive a device, e.g. mauto list-devices
```

The mobile-mcp version is pinned in `package.json` (`@mobilenext/mobile-mcp`) and resolved from `node_modules` at runtime (see `src/device/mobile-mcp-client.js`). Bump the pin there if you need a newer engine.

## Conventions

- All commands and skill names use the `mobile-automator` / `mobile-automator-*` namespace to avoid extension collisions.
- Workspace paths in skills (`mobile-automator/scenarios/`, etc.) are relative to the user's project root, not this extension's directory.
- **GEMINI.md vs CLAUDE.md**: GEMINI.md = runtime context for Gemini executing skills (schema registry, tool mappings). CLAUDE.md = this file, for humans maintaining the extension.

## Metadata

Repo: https://github.com/sh3lan93/mobile-automator · Version: see `package.json` · License: Apache 2.0 · Status: production-ready.
