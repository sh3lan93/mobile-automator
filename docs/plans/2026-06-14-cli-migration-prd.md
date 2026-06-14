> **Status:** Draft PRD — locked design from a 2026-06-14 design session. Apply normal triage.

## Problem Statement

Mobile Automator today ships as a **Gemini CLI extension**. Its value — the project-aware reasoning that turns natural-language test intent into schema-conformant scenarios, replays them on real devices, and synthesizes recordings — is locked to one host. A developer who uses Claude Code, Cursor, Codex, Cline, Windsurf, or any other AI coding agent cannot use the tool at all. The reasoning lives in Gemini-shaped `SKILL.md` + `.toml` command files, the device layer is wired through Gemini's mobile-mcp connection, and the whole surface is namespaced as `/mobile-automator:*` Gemini commands.

From the developer's perspective: *"I have a mobile app and an AI agent I already use. I want this tool to drive my testing through that agent — whichever vendor it is — and I want it to engage only when I deliberately ask, never to wander into automating my device on its own."*

## Solution

Replace the Gemini extension with **`mauto`, a standalone Node CLI** that any AI agent or vendor can drive, plus a thin MCP **prompts** server that exposes the workflows as explicit, user-invoked slash commands across MCP-capable hosts.

The CLI owns the device (wrapping mobile-mcp), exposes every mechanical operation as a one-shot, JSON-emitting verb, and delivers its reasoning as version-matched **guides** the host agent pulls at invocation time. Because the tool is platform-agnostic and never relies on platform-specific element IDs, the irreducible reasoning (resolving a semantic target to a tap, judging a visual assertion) stays in the host agent; the CLI is the deterministic spine and the hands.

The developer installs `mauto`, registers the MCP server (or just calls the CLI directly), and invokes a workflow **by intention** — e.g. `/mauto:record login_flow` or `/mauto:generate` — which injects the relevant guide and begins the work. Existing `mobile-automator/` workspaces, scenarios, and schemas keep working unchanged.

## User Stories

1. As a mobile QA developer, I want to drive Mobile Automator from my own AI agent (Claude Code, Cursor, Codex, Cline, Windsurf, etc.), so that I am not forced onto Gemini.
2. As a developer on an agent with no skill system, I want to run `mauto` commands directly in my shell, so that I can still use the tool with zero host integration.
3. As a developer, I want the tool to engage only when I explicitly invoke a command, so that my agent never starts automating my device because I happened to mention "test".
4. As a developer, I want a single `mauto bootstrap`/`mauto guide` command that prints how to use the tool, so that any agent can be taught the workflow on demand.
5. As an AI agent, I want every `mauto` command to return a uniform JSON envelope, so that I can parse results reliably regardless of vendor.
6. As an AI agent, I want failures to carry a corrective `hint` and a meaningful exit code, so that I can recover (e.g. re-resolve a target) without extra prompting.
7. As an AI agent, I want `mauto elements` to return on-screen elements with text, accessibility label, bounds, and a precomputed center — and never a platform-specific resource id — so that target resolution stays portable across Android and iOS.
8. As an AI agent, I want one-shot device verbs (`tap`, `type`, `swipe`, `press`, `screenshot`), so that I can drive the device without an interactive protocol my harness may not support.
9. As an AI agent generating a scenario, I want `mauto validate` to check my JSON against the scenario schema, so that I catch shape errors before saving.
10. As an AI agent executing a scenario, I want to own the step loop while calling the CLI for all mechanical work (`mauto assert`, `mauto result`), so that results are schema-correct and retry/flake logic is consistent across runs.
11. As an AI agent, I want `mauto assert <type>` to evaluate the mechanical assertion types and return pass/fail, so that I only have to judge the genuinely visual/semantic ones myself.
12. As an AI agent, I want `mauto result add-step` and `mauto result finalize` to assemble the run report, so that I do not re-derive the result schema in prose each run.
13. As a developer, I want a web recorder I can launch with `mauto record <name>`, so that I can tap through my app and capture a scenario.
14. As a developer, I want to add assertions in between steps in the recorder GUI by describing them in natural language, so that I can specify expectations without writing JSON.
15. As a developer, I want to record without any AI agent attached, so that capture works as a standalone human tool.
16. As a developer, I want my recording persisted as a bundle on Save, so that synthesis into a scenario can happen later, by any agent.
17. As an AI agent, I want `mauto record-bundle <id>` to stream a persisted recording's artifacts, so that I can synthesize a schema-conformant scenario from it following `mauto guide record`.
18. As a developer, I want recorded sensitive inputs masked and flagged, so that captured credentials are not silently written in cleartext.
19. As a developer, I want the recorder to detect device disconnects and app crashes, so that a failed session does not corrupt or silently drop my recording.
20. As a developer, I want `mauto setup` to scaffold the `mobile-automator/` workspace, so that I have the standard directory layout and a config skeleton.
21. As an AI agent, I want `mauto guide setup` to tell me to analyze the codebase and write findings (business domain, critical paths, app package, loading indicators) via `mauto config set`, so that project knowledge is captured without a monolithic interactive command.
22. As a developer, I want `mauto init --agent <x>` to register the tool for my host (MCP server registration and/or dedicated command files), so that the workflows appear as explicit slash commands.
23. As a developer on an MCP-capable host, I want the `mauto` workflows to appear as user-invoked MCP prompts, so that I get `/`-commands across the MCP ecosystem from one server without per-vendor files.
24. As a developer, I want `init` to never modify a file I authored (no edits to a shared `AGENTS.md` or instructions file), so that the tool stays within its own namespace.
25. As a developer with an existing `mobile-automator/` workspace from the Gemini extension, I want my scenarios, screenshots, results, and config to keep working, so that migrating to the CLI loses no data.
26. As an AI agent, I want `mauto guide <topic>` to emit the reasoning for generate/execute/record/setup tuned to my project's mode (platform-aware vs platform-agnostic), so that I get the right instructions for cross-platform vs single-OS projects.
27. As an AI agent in an agnostic project, I want the guides and scenarios to use the four semantic actions (`press_back`, `dismiss_keyboard`, `grant_permission`, `deny_permission`), so that scenarios remain portable across Android and iOS.
28. As a developer, I want `mauto schema <name>` to print the scenario/result JSON schema, so that my agent always references the schema bundled with the installed CLI version.
29. As a maintainer, I want the guide content ported from the existing `SKILL.md` templates rather than rewritten, so that the tool's hard-won testing IP is preserved.
30. As a maintainer, I want lint guards on the emitted guides (no leftover `{{placeholders}}`, no leaked `mobile_*` tool names, agnostic guides naming no OS), so that the port does not silently regress behavior.
31. As a developer running CI, I want `mauto` to be installable via `npx`/`npm`, so that I can use it in pipelines without a Gemini runtime.
32. As a human running a `mauto` command directly, I want an optional `--human` flag for readable output, so that JSON-by-default does not hurt occasional interactive use.
33. As a maintainer, I want the Gemini extension surface (`.toml` commands, `gemini-extension.json`, `GEMINI.md`) removed, so that there is a single source of truth and no dual maintenance.

## Implementation Decisions

**Foundational constraint.** The tool is platform-agnostic and never uses platform-specific element identifiers (`resource-id` / `accessibilityIdentifier`). The only portable anchors are visible text and semantic role, and many controls are icon-only — so deterministic selector-based replay is impossible. Tap-target resolution and visual/semantic assertion judgment are therefore irreducibly LLM work performed by the host agent at replay time ("Model A"). The CLI provides the deterministic spine and the device hands; it is not a deterministic test runner.

**Distribution / runtime.** Node, distributed via `npx mobile-automator` / `npm i -g`. mobile-mcp is bundled and spawned by the CLI.

**Device ownership (Approach 1).** The CLI spawns and owns a single mobile-mcp instance and exposes device primitives as one-shot, JSON-emitting verbs (`elements`, `tap`, `type`, `swipe`, `press`, `screenshot`, `launch`). The recorder reuses this same owned connection. Any agent — MCP-capable or not — drives the device through the shell, so MCP support is never required to use the tool.

**Agent↔CLI contract.** Every verb emits a uniform JSON envelope `{ ok, data, error, hint, schema_version }`. Exit codes are meaningful: `0` success, `2` device/environment fault, `3` invalid input, `4` target-not-found, `130` cancel. Errors carry a `hint` describing the corrective action. `mauto elements` output carries `{ text, accessibility_label, bounds, center, type }` and never a resource id. JSON is the default; `--human` is an opt-in.

**Execute model (agent owns the loop).** There is no interactive `mauto run` co-routine — one-shot shell is the portable primitive. The agent orchestrates the scenario loop, calling `mauto elements` and reasoning to resolve targets, then `mauto tap`/etc.; all mechanical work is discrete verbs: `mauto assert <type>` evaluates the mechanical assertion subset, and `mauto result add-step|finalize` owns result-schema assembly plus retry/flake bookkeeping. The agent's only irreducible jobs are target resolution and visual/semantic assertion judgment.

**Reasoning delivery.** Reasoning is injected at explicit invocation via `mauto guide <topic>` (generate/execute/record/setup), with `mauto schema <name>` and `mauto bootstrap` as the runtime floor. Guides read `config.json` and emit the variant matching `config.mode` (platform-aware vs platform-agnostic). No always-loaded ambient skill — the tool engages only on deliberate invocation.

**Invocation surface (MCP prompts).** `mauto mcp` runs a thin MCP server exposing the workflows as **prompts only** (user-controlled by spec), which surface as explicit `/`-commands across MCP hosts. Device primitives are deliberately not exposed as MCP tools (tools are model-controlled and could fire unintentionally). Non-MCP hosts use the runtime floor.

**Recorder (decoupled).** Capture is LLM-free and remains a standalone service launched by `mauto record`. On Save the artifact bundle is persisted (not deleted) under the workspace; synthesis becomes a separate, later agent step that reads the bundle via `mauto record-bundle <id>` and follows `mauto guide record`; cleanup occurs after successful synthesis. The existing `tools/recorder/` capture stack is reused; the live tap-source (currently a TODO) is implemented against mobile-mcp frame streaming + the existing video-tap detector.

**Setup.** Split into `mauto init --agent <x>` (per-vendor registration: MCP server entry and/or dedicated command files; idempotent; never mutates user-owned shared files), `mauto setup` (mechanical workspace scaffold + config skeleton with mode), `mauto guide setup` (agent reads the codebase and writes analysis fields), and `mauto config get|set`.

**Gemini deprecation.** Same repo, evolved in place. Remove `commands/mobile-automator/*.toml`, `gemini-extension.json`, `GEMINI.md`, and the `/mobile-automator:*` surface. Preserve the `mobile-automator/` workspace layout, scenario schema 2.1, and result schema so existing data keeps working. Repurpose `templates/*/SKILL.md` reasoning prose into guide content.

**Modules.** Deep, isolatable modules: DeviceBridge (owns mobile-mcp, injectable call), ElementModel (agnostic element shape + center computation, strips resource id), AssertionEvaluator (mechanical assertion subset), ResultStore (result schema + retry/flake), ScenarioValidator (schema 2.1), GuideEmitter (config-aware, per-mode guide/schema/bootstrap emission), ConfigManager (config read/write + mode resolution), VendorAdapters (per-adapter behind one interface), McpPromptsServer (thin shim over GuideEmitter), OutputEnvelope (envelope + exit-code mapping), RecorderService (decoupled save + bundle reader + tap source). Shallow glue: the CLI router (commander entry, JSON output, `--human`). DeviceBridge, ElementModel, ConfigManager extend existing recorder modules.

## Testing Decisions

Good tests assert **external behavior, not implementation details**: given inputs, the module returns the documented output/JSON shape; refactors that preserve behavior should not break them. The codebase already has prior art for this: the `tests/lint/` suite asserts properties of generated text (e.g. `placeholder-leak`, `agnostic-no-platform-words`, `schema-additive`), and `tests/integration/` covers migration paths; the recorder suite injects fakes (`deps.mcpCall`, `deps.tapSource`) to exercise pipelines without a device.

Modules to be tested (correctness-critical and pure/near-pure, plus adapters):

- **AssertionEvaluator** — fixture-driven: an elements snapshot + assertion spec → expected pass/fail, across the mechanical assertion types.
- **ElementModel** — element normalization, center computation, and the invariant that no resource id appears in agnostic output.
- **ScenarioValidator** — valid/invalid scenarios against schema 2.1, including the additive 2.0→2.1 cases.
- **OutputEnvelope** — envelope shape and exit-code mapping for success and each error class.
- **GuideEmitter** — lint guards mirroring the existing suite: no surviving `{{placeholders}}`, no leaked `mobile_*` tool names, agnostic guides name no OS, and correct variant selected per `config.mode`.
- **ConfigManager** — read/write round-trips, mode resolution (legacy configs default to platform-aware), schema preservation.
- **VendorAdapters** — golden-file output per adapter, idempotency on re-run, and the guarantee that no user-authored shared file is modified.
- **ResultStore** — result assembly and retry/flake bookkeeping.
- **RecorderService** — extended tests for the decoupled save (bundle persisted on Save, cleanup only after synthesis) and the `record-bundle` reader.

Smoke-tested only (thin I/O glue): **DeviceBridge** (with an injected fake `call`) and the **CLI router**.

## Out of Scope

- Deterministic selector-based replay or any move away from semantic-description targets (ruled out by the agnostic / no-resource-id constraint).
- iOS physical-device recording (Apple exposes no external touch stream; inherited limitation).
- Exposing device primitives as MCP tools (kept as CLI verbs to preserve intentional, shell-portable invocation).
- A self-contained agentic CLI that bundles its own LLM — the tool is driven by the host agent, not its own model.
- C3 instrumentation SDKs (iOS Swift Package, Android AAR) — future work; the C3 protocol contract is unchanged.
- New assertion types or scenario-schema changes beyond what already exists in 2.1.
- A backward-compatibility shim that keeps the `/mobile-automator:*` Gemini commands alive — Gemini is deprecated outright.

## Further Notes

- The largest execution risk is **time, not decision**: porting the reasoning prose from the six `SKILL.md` templates (generator/executor/recorder × aware/agnostic) into guides. Each file is entangled with Gemini on several axes (placeholders → config lookups, mobile-mcp tool names → `mauto` verbs including the action-mapping table, `ask_user`/Gemini framing, `.gemini/` paths + `GEMINI.md` references → `mauto schema`/inlined protocol) and additionally needs a brain/hands re-partition (mechanical bits become verbs, reasoning stays in the guide). This is correctness-critical — a botched guide silently yields bad scenarios — and likely warrants 2–3 dedicated slices with the new lint guards.
- The CI version-bump gate and release flow currently key off extension paths and `gemini-extension.json`; they must be re-pointed at the CLI package.
- Suggested slicing follows the repo's tracer-bullet convention: a thin end-to-end vertical (CLI router + OutputEnvelope + DeviceBridge + one device verb + `validate`) first, then execute verbs + AssertionEvaluator/ResultStore, the guide port (per skill-pair), VendorAdapters + McpPromptsServer, and finally the recorder decoupling, with the Gemini removal as a clearly-scoped cleanup slice.

## Slices

Tracer-bullet vertical slices (tracked as sub-issues, milestone `cli`):

1. #70 — CLI spine: router + JSON envelope + DeviceBridge + `elements` + `validate`
2. #71 — execute verbs + AssertionEvaluator + ResultStore
3. #72 — config + setup scaffold + guide/schema/bootstrap floor + lint harness
4. #73 — guide port: generator (aware + agnostic)
5. #74 — guide port: executor (aware + agnostic)
6. #75 — guide port: recorder + setup guides
7. #76 — VendorAdapters (`init`) + MCP prompts server
8. #77 — recorder decoupling: persist bundle + `record-bundle` + live tap source
9. #78 — Gemini removal + CI/release re-point
