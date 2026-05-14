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
  mobile-automator-recorder/aware/SKILL.md          # gated; agnostic in slice #29
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

## Recorder (gated experimental)

PRD [#21](https://github.com/sh3lan93/mobile-automator/issues/21). The entire recorder surface (`/mobile-automator:record`, sidecar, GUI, recorder skill) is hidden unless `MOBILE_AUTOMATOR_RECORDER=1`.

- Aware-mode recorder skill installs at `.gemini/skills/mobile-automator-recorder/SKILL.md`. Uses 10 of 13 aware placeholders (skips `build_command`, `automation_extras`, `business_domain` — not load-bearing for synthesis from a captured trace).
- Agnostic-mode recorder is **skipped** during install; lands in slice [#29](https://github.com/sh3lan93/mobile-automator/issues/29).
- The recorder skill synthesises scenario JSON from sidecar artifacts under `mobile-automator/.recorder/<session>/`. It defers to the generator skill for scenario shape — generator stays single source of truth.

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

Follow `RELEASE.md`. Users install via `gemini extensions install https://github.com/sh3lan93/mobile-automator`.

**Gate-then-graduate** for multi-PR features: ship behind an opt-in env var (e.g. `MOBILE_AUTOMATOR_RECORDER=1`) so partial states are invisible. Append slice entries under `## [Unreleased]`.

**CI version-bump gate.** The `Verify version is bumped` workflow fails any PR touching extension paths (`gemini-extension.json`, `GEMINI.md`, `templates/`, `commands/`, `scripts/`) without bumping `gemini-extension.json` to a value not yet in `git tag`. Under the gate, **the first slice PR bumps to a release-candidate semver** (e.g. `0.12.0-rc.0`); each subsequent slice increments the rc counter (`-rc.1`, `-rc.2`, …). The `vX.Y.Z` tag namespace is reserved for graduated releases — rc.N values are never tagged.

**Graduation PR** removes the env-var gate, bumps `vX.Y.Z-rc.N` → `vX.Y.Z`, collapses `[Unreleased]` into the new release section, and creates the tag. Keeps `main` mergeable and preserves the "fully-formed feature per release" pattern (see v0.10/v0.11).

## Local development

```bash
gemini extensions link .                              # in this repo
cd /path/to/test-mobile-app && gemini                 # then /mobile-automator:setup, etc.
```

Pin a specific `mobile-mcp` version by editing `args` in `gemini-extension.json` (default is `@latest`).

## Conventions

- All commands and skill names use the `mobile-automator` / `mobile-automator-*` namespace to avoid extension collisions.
- Workspace paths in skills (`mobile-automator/scenarios/`, etc.) are relative to the user's project root, not this extension's directory.
- **GEMINI.md vs CLAUDE.md**: GEMINI.md = runtime context for Gemini executing skills (schema registry, tool mappings). CLAUDE.md = this file, for humans maintaining the extension.

## Metadata

Repo: https://github.com/sh3lan93/mobile-automator · Version: see `gemini-extension.json` · License: Apache 2.0 · Status: production-ready.
