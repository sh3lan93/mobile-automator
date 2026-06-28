# Design: `mauto init` installs native Agent Skills

- **Date:** 2026-06-28
- **Status:** Approved (design phase)
- **Related:** PRD [#69](https://github.com/sh3lan93/mobile-automator/issues/69) (CLI migration), supersedes one locked invariant therein (see §1)
- **Precedent:** `docs/superpowers/specs/2026-03-27-deterministic-skill-installation-design.md` established the principle that skill installation must be a **deterministic Node script, never AI-mediated** (the prior AI-mediated approach silently corrupted files via in-memory placeholder replacement). This design inherits that principle and, by inlining only placeholder-free invariants (§5), eliminates the placeholder-replacement failure modes at the source.

## Problem

In the Gemini-extension era, the `generate` / `execute` workflows were forced on
the agent by two eagerly-loaded layers: a slash-command (`*.toml`) carrying a
"SYSTEM DIRECTIVE", which handed off to a `SKILL.md` holding the detailed
disciplines. Invoking the command pushed all of that into context.

The CLI migration (PRD #69) inverted this to a **pull** model. `mauto init`
writes a one-line slash-command whose entire body is:

> `Run `mauto guide execute` and follow it. Drive the device only through `mauto` verbs (never assume resource-ids).`

The detailed disciplines (persona, "follow the scenario exactly — no
improvisation", observer traits, full workflow) were ported to
`src/guide/content/<topic>.<mode>.md` and are delivered only when the agent
chooses to run `mauto guide <topic>`.

**The gap:** forcing is now *soft*. The slash-command does not even cause the
host to surface the workflow on its own — and the disciplines only enter context
if the agent voluntarily runs the guide. If an agent runs `mauto tap` / `assert`
without first pulling the guide, nothing structurally enforces the QA discipline.

## Goal

Make `mauto init --agent <name>` **install native Agent Skills** into each
host's skill directory, so that:

1. The host **always discovers** the skill (Level-1 metadata in its system
   prompt) and surfaces it at the right moment.
2. On activation, the **non-negotiable disciplines are already in context**
   (Level-2 body) — before, and independent of, whether the agent pulls the full
   guide.
3. Context stays lean (progressive disclosure: the body loads only on
   activation; the heavy interpolated workflow is still pulled via `mauto guide`).
4. Works across **claude, cursor, gemini, copilot**, and the generic
   **agentskills.io** standard.

## §1. Architectural decision: reverse one PRD #69 invariant

PRD #69 locked: *"reasoning is delivered via `mauto guide <topic>` at explicit
invocation, never an ambient always-loaded skill."*

This design **deliberately reverses the "never an ambient always-loaded skill"
clause.** Rationale: that invariant was locked (2026-06-14) before the **Agent
Skills open standard** existed. The reason ambient skills were rejected —
always-on context bloat — no longer applies: the standard's **progressive
disclosure** keeps only ~100 tokens of metadata always-loaded and defers the
body to activation. We therefore gain the strong-forcing property the original
design sacrificed, without the cost that motivated sacrificing it.

Everything else in PRD #69 stands: platform-agnostic (no resource-ids), uniform
JSON envelope, one-shot verbs, device driven only through `mauto` verbs, and
`mauto guide` remains the live single source of truth for the full workflow.

## §2. One artifact, five destinations

All five targets implement the same open standard: a `<skill-name>/SKILL.md`
folder with required `name` + `description` YAML frontmatter and progressive
disclosure. Only the install directory differs.

| `--agent` | Destination (project-level)                |
|-----------|--------------------------------------------|
| `claude`  | `.claude/skills/<name>/SKILL.md`           |
| `cursor`  | `.cursor/skills/<name>/SKILL.md`           |
| `gemini`  | `.gemini/skills/<name>/SKILL.md`           |
| `copilot` | `.github/skills/<name>/SKILL.md`           |
| `agents`  | `.agents/skills/<name>/SKILL.md`           |

`--agent all` writes every destination. The existing per-vendor **MCP server
merge** (`.mcp.json` for Claude, `.cursor/mcp.json` for Cursor) is preserved so
`mauto mcp` / `mauto guide` stay reachable; other agents get the MCP entry where
they have a known config location (deferred detail — see §10 open question).

## §3. Skills installed

Three skills, mirroring the existing guide topics:

- `mobile-automator-generate`
- `mobile-automator-execute`
- `mobile-automator-setup`

The skill folder name equals the `name` frontmatter value (Cursor requires the
match; harmless elsewhere).

## §4. `SKILL.md` contents (option C: hybrid)

Example (`execute`):

```markdown
---
name: mobile-automator-execute
description: Execute a saved mobile QA scenario on a device and produce a
  pass/fail report. Use when the user asks to run, replay, or verify a
  mobile test scenario.
---

# Mobile Automator — Execute

## Non-negotiable directives (always apply)
- Follow the scenario **exactly as written** — no improvisation, no skipped steps.
- Drive the device **only** through `mauto` verbs; never assume resource-ids or
  OS-specific element IDs (use the semantic actions in agnostic projects).
- Every assertion is backed by a screenshot; record observations via
  `mauto result add-step`.

## Full workflow
Load the complete, project-configured playbook and follow it step by step:

    mauto guide execute
```

- **Frontmatter** is generic and placeholder-free. It satisfies the standard
  plus Claude's stricter rules: `name` ≤64 chars, lowercase letters/numbers/
  hyphens only, no reserved words (`anthropic`, `claude`); `description`
  non-empty, ≤1024 chars, no XML tags. Our names (`mobile-automator-*`) pass.
- **Body** = inlined invariants (placeholder-free *by construction*, see §5) +
  a pointer to `mauto guide <topic>` for the live, mode-aware, interpolated
  detail.

## §5. Placeholder mitigation & single source of truth

The inlined invariants are **placeholder-free by nature**: in the existing guide
content, every `{{placeholder}}` sits on a project-*fact* line
(`{{project_name}}`, `{{architecture}}`, `{{platform_details}}`,
`{{build_command}}`, `{{app_package}}`, `{{environments}}`,
`{{loading_indicators}}`, `{{protected_directories}}`,
`{{additional_resources}}`). The discipline lines ("follow exactly, no
improvisation", "every assertion backed by a screenshot", "device only via
`mauto` verbs", "record via `mauto result add-step`") contain **no
placeholders**. Disciplines are universal; facts are project-specific.

Consequently:

- `init` inlines only invariant lines → **no interpolation needed**, and `init`
  never reads `config.json`. This also dodges the ordering hazard where `init`
  runs *before* `mauto setup` (no config yet): there is nothing to interpolate,
  so nothing can render as fallback junk.
- Project facts stay in the guide body, pulled and interpolated at runtime by
  `mauto guide` (unchanged), so they remain fresh and mode-aware.

**Source of truth:** new per-topic snippet files
`src/guide/content/<topic>.invariants.md` — **mode-agnostic, placeholder-free,
OS-name-free** (so a single snippet is safe in both aware and agnostic installs).
The skill renderer reads these. Anti-drift is enforced by a lint guard
asserting each invariant line also appears in the corresponding guide content
file (§7), rather than refactoring the six existing content files now.

*Alternative considered:* physically extract the invariant lines out of the
content files and have `emitGuide` compose `invariants + body`. Cleaner DRY but
churns all content files. Deferred as a follow-up; the lint-substring guard
gives drift safety now with minimal change.

## §6. Modules

```
src/init/
  skill-renderer.js   # NEW: (topic, projectRoot) -> SKILL.md string; defensive assert no '{{' survives
  skill-meta.js       # NEW: shared catalog { generate|execute|setup: {name, description} }
  adapters.js         # REWRITTEN: per-agent skill destination(s) + existing MCP merge; adds gemini/copilot/agents
src/guide/content/
  generate.invariants.md
  execute.invariants.md
  setup.invariants.md   # NEW (3 files)
src/cli.js            # init: accept claude|cursor|gemini|copilot|agents|all; update --agent hint + error text
```

`init` is **fully mode-independent**: the skill body resolves mode at *runtime*
via `mauto guide` (which reads `config.json` then), so nothing mode-specific is
baked at install time.

Idempotency is preserved via `writeIfChanged`. Adapters only write/overwrite
files inside the skill folders they own; they never touch foreign skills or
unrelated files. The MCP-config merge keeps owning only the `mauto` key.

## §7. Lint guards (`tests/lint/`)

- `skill-no-placeholder-leak` — no `{{` in invariants sources or rendered skills.
- `skill-no-mcp-tool-leak` — no `mobile_*` tool names (reuse existing pattern).
- `skill-frontmatter-valid` — name/description meet the standard + Claude's
  reserved-word/length rules; folder name == `name`.
- `skill-invariants-in-guide` — every invariant line is a substring of the
  matching `<topic>.<mode>.md` guide content (drift guard).
- `skill-agnostic-no-os` — invariants name no OS (safe for agnostic installs).

## §8. Testing

- **Unit:** renderer output shape (frontmatter + body), placeholder-free
  assertion, per-agent path map, `--agent all`, idempotency (re-run yields
  byte-identical files), foreign-skill non-clobber, unknown-agent error.
- **Lint:** the five guards in §7.
- **Packaging:** the new `src/` files ship via the existing npm `files`
  allowlist; assert in the packaging test.

## §9. Versioning & docs

- The CI "Verify version is bumped" gate fires (touches `src/`). Under
  gate-then-graduate, bump `package.json` to a new release-candidate semver
  (next `-rc.N`); append an entry under `## [Unreleased]` in `CHANGELOG.md`.
- Update `README.md` and `CLAUDE.md`: the `mauto init` description, the supported
  `--agent` values, and the "Adding a verb or guide topic" steps (now also: add
  the topic's invariants snippet + register it for skill install).
- Refresh the `cli-migration-design` memory note to record the §1 invariant
  reversal.

## §10. Out of scope (YAGNI) & open questions

Out of scope:

- User-level/global installs (`~/.claude/skills/`, `~/.agents/skills/`, etc.).
- Removing the existing thin slash-commands — kept. They are the *explicit
  user-typed* trigger (`/mobile-automator-execute`); skills are the
  *model-auto-discovered* forcing layer. They coexist.
- The physical invariant-extraction refactor from §5.

Open question (resolve during planning):

- MCP-server config merge for `gemini` / `copilot` / `agents`: Claude and Cursor
  have known config paths today. Decide whether to write an MCP entry for the new
  agents (and where) or limit `init`'s MCP merge to claude/cursor and only
  install skills for the others. Skills do not require the MCP entry to function
  (the body calls the `mauto` CLI directly), so limiting MCP merge to the two
  known hosts is the likely default.
