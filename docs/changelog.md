---
description: "Changelog for mobile-automator - version history, new features, breaking changes, and migration notes from v0.1.0 to latest."
---

# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [0.10.0] - 2026-03-30

### 🗑️ Removed

- **Schema v1 Support** — Completely removed legacy v1 schema, migration tooling, and all dual-version routing logic.
  - Deleted `scenario_schema.json` (v1), `migrate.toml`, `MIGRATION.md`, `docs/guides/migrate.md`
  - Removed deprecation phase checks from `generate.toml` and `execute.toml`
  - Removed v1 detection/routing from executor skill template
  - Removed `/mobile-automator:migrate` command

### 🔄 Changed

- **Schema Rename** — Renamed `scenario_schema_v2.json` → `scenario_schema.json` and `docs/reference/schema-v2.md` → `docs/reference/schema.md` (the `_v2` suffix was vestigial with only one schema version).
- **Result Schema** — `step_id` and `assertion_id` are now `string`-only (previously accepted both `integer` and `string` for v1 backward compatibility). `schema_version` changed from `enum: ["1.0", "2.0"]` to `const: "2.0"`.
- **Install Script** — `scripts/install-skills.js` no longer copies the v1 schema to workspace.
- **CI Validation** — `.github/workflows/validate-schemas.js` updated to reference `scenario_schema.json` instead of `scenario_schema_v2.json`.
- **Documentation** — Removed all v1/v2/legacy/deprecated/migration references across 30+ files. All "v2" qualifiers dropped — the schema is now just "the schema".

### ✅ Kept

- `$schema_version: "2.0"` field preserved in all schemas for future extensibility.
- `CHANGELOG.md` historical entries unchanged — they are a record of what happened.

---

## [0.9.0] - 2026-03-28

### ✨ Added

- **Auto-Detect Business-Critical Paths** — Setup Section 5.0 now uses the `@codebase_investigator` subagent to automatically identify critical user paths from the codebase before asking the user.
  - Analyzes navigation graphs, route definitions, screen/Activity/Fragment definitions, feature modules, and README documentation
  - Presents detected paths for user confirmation (`yesno` prompt) instead of requiring manual input
  - Falls back to manual text input if auto-detection finds nothing or the user rejects the detected paths
  - Reduces setup friction — users confirm instead of typing

---

## [0.8.1] - 2026-03-28

### 🐛 Fixed

- **Deterministic Skill Installation** — Replaced the AI-mediated file copy/replace in setup Section 6.0 with a Node.js script (`scripts/install-skills.js`) that handles all template operations deterministically.
  - Fixes silent file corruption (truncation, missing sections, garbled schemas) during skill installation
  - Placeholder replacement now uses `split().join()` in Node.js instead of in-memory AI reproduction
  - Schema files copied byte-perfect with `fs.copyFileSync` instead of AI read/write
  - Runtime placeholders (`{{capture_to}}`, `{{variable_name}}`) in executor skill are now correctly preserved
  - Added `scenario_schema_v2.json` to template verification (was previously missing)
  - Verification now checks file existence, non-zero size, and setup-placeholder absence
  - Setup Section 6.0 reduced from ~100 lines to ~30 lines

---

## [0.8.0] - 2026-03-27

### 🗑️ Removed

- **TestRail Integration** — Removed all TestRail MCP server configuration, environment variables, and integration code.
  - Removed `testrail-mcp` MCP server from `gemini-extension.json`
  - Removed `TESTRAIL_API_KEY` and `TESTRAIL_DOMAIN` environment variables
  - Removed `testrail` metadata field from scenario schema
  - Removed TestRail result syncing from executor
  - Updated documentation to remove TestRail references
  - Migration path: scenarios without TestRail metadata continue to work unchanged

---

## [0.7.0] - 2026-03-27

### ✨ Added

- **Execute Command Enhancements** — Major UX and structural improvements to the `/mobile-automator:execute` command.
  - Added `--device="ID"` flag to bypass the interactive device selection menu and target a specific device.
  - Added `--all` flag to unconditionally execute all available scenarios without manual selection prompts.
  - Fully integrated structured `ask_user` tool calls natively for all interactive prompts (device selection, execution menu, confirmations).
  - Refined deprecation logic to evaluate v1 schema warnings early, *before* establishing device connections or running preconditions.

---

## [0.6.0] - 2026-03-20

### ✨ Added

- **Environment Persistence** — The generate command now remembers your last-used environment and skips the prompt on subsequent runs.
  - First run (or after clearing preferences): interactive prompt asks for environment and saves the selection to `mobile-automator/generate_preferences.json`
  - Subsequent runs: saved environment is used automatically with an `ℹ️` notice
  - `--set-environment="X"` — use environment X **and** save it as the new default preference
  - `--environment="X"` — one-time override, uses X for this run only without changing the saved preference
  - Stale preferences (environment removed from config) are detected automatically with a `⚠️` warning and the prompt re-appears
  - Single-environment projects skip the prompt entirely (always has, now also ignores flags cleanly)

---

## [0.5.0] - 2026-03-13

### ✨ Added

- **Test Report Command** — New `/mobile-automator:report` command generates aggregated test execution reports.
  - Supports multiple output formats: table (terminal), JSON, HTML
  - JUnit XML export for CI integration
  - Shows pass rate, failed scenarios, flaky steps, average duration
  - Filter by recent runs with `--last N` option (default: 10)

---

## [0.3.1] - 2026-02-25

### 🔄 Changed

- **Native Prompts** — Migrated user interaction prompts across `setup` and `generate` flows to use the structured `ask_user` tool natively.

---

## [0.3.0] - 2026-02-24


### ✨ Added

- **Tag-Based Filtering** — Organize, filter, and execute specific subsets of your scenarios using tags.
  - Added interactive prompt for tags during test scenario generation.
  - Added `--tag` filter to `execute` command with support for AND (`smoke,critical`), OR (`smoke|regression`), and NOT (`!flaky`).
  - Added new `/mobile-automator:list-tags` command to view the tag registry and counts across the testing suite.
  - Interactive execution menu now groups scenarios by primary tags when run without arguments.
  - Strict format validation enforcing lowercase alphanumeric + hyphens across schemas and commands.

---

## [0.2.0] - 2026-02-23

### ✨ Added

- **Expanded Assertion Types** — Supported assertion types increased to 27, organized with tiered categorization to handle simpler and complex edge cases.
- **New `!=` Comparison Operator** — Added support for the non-equality (`!=`) operator in assertion comparisons.
- **Two-Pass Semantic Intent Model** — Introduced a two-pass workflow for parsing test generation instructions to yield more reliable test assertions.
- **Schema Validation CI Workflow** — Added a GitHub Actions workflow that automatically validates the JSON syntax of all schemas, ensures Draft-07 conformance, and validates prototype scenarios against `scenario_schema_v2.json`.
- **TestRail Integration** — Bi-directional sync with TestRail test case management
  - Fetch test cases from TestRail via natural language step format with automation hints
  - Auto-convert TestRail steps to mobile-automator scenario JSON
  - Automatically sync test execution results back to TestRail
  - Includes device info, observations, and screenshots in TestRail test runs
- New MCP server: `testrail-mcp` for TestRail API access
- Optional `testrail` metadata field in scenario_schema_v2.json for 1:1 case mapping
- Environment variables `TESTRAIL_API_KEY` and `TESTRAIL_DOMAIN` for project-scoped configuration

### 🔄 Changed

- **Clarified Assertion Behaviors** — Improved documentation and instructions around `element_visible` and `list_item_count` assertions.
- **Skill Categories** — Reindexed skill categories within the project framework.
- **Documentation Updates** — Updated Gemini CLI installation source instructions in `CONTRIBUTING.md` and refreshed the "Last updated" date in `ROADMAP.md`.
- **Generator Skill Enhanced** — Detects and handles TestRail URLs for automated test case fetching
- **Executor Skill Enhanced** — Syncs results back to TestRail when scenario has testrail metadata

### ✅ Backward Compatible

- Manual test generation unchanged — TestRail is entirely optional
- Existing scenarios without `testrail` metadata work exactly as before

---

## [0.1.1] - 2026-02-18

### ✨ Added

#### Schema v2 — Smarter, More Reliable Test Scenarios
- **New default scenario format** — all generated scenarios now use schema v2 with `$schema_version: "2.0"` as a required root field
- **Named step IDs** — steps use descriptive snake_case string IDs (e.g., `"id": "tap_login"`) instead of integers; screenshots are now named accordingly (`step_tap_login.png` vs `step_3.png`)
- **Smart wait actions** — `wait_for_element`, `wait_for_element_gone`, `wait_for_loading_complete` replace fixed-time `wait`; eliminates the #1 source of test flakiness
- **Optional steps** — `optional: true` + `on_failure: "skip"` handles non-deterministic UI elements (promotional dialogs, permission prompts) without failing the test
- **Conditional steps** — `condition` field allows steps to be skipped based on device API level, runtime state, or whether a previous step was skipped
- **Retry logic** — `on_failure: "retry"` + `retry_policy: {max_attempts, backoff_ms}` distinguishes real bugs from transient failures
- **Variable capture** — `capture_value` action + `variables` root block captures dynamic values (prices, IDs, amounts) for cross-step verification
- **Nested conditional sub-flows** — `sub_steps` array expresses branching flows (e.g., "add address only if none exists") without requiring separate scenario files
- **New assertion types** — `pattern_match` (regex), `value_matches_variable`, `element_count` (with operators), `visual_state`, `text_changed` (state transitions like "Redeem" → "Redeemed")
- **Structured preconditions** — `preconditions` object with `app_state`, `device_actions`, `device_properties` enables automated pre-test setup
- **Clean metadata** — execution-time fields (`device_model`, `api_level`, `timestamp`) removed from scenario metadata; they belong in the result JSON

#### `/mobile-automator:migrate` — Interactive v1 → v2 Migration
- New command to upgrade existing v1 scenarios with a guided, human-supervised process
- Automatically converts: `$schema_version`, integer step IDs → named strings, assertion IDs, `after_step_id` references, metadata cleanup, preconditions restructuring
- Interactively handles ambiguous cases (fixed-time `wait` actions — asks what to wait *for*)
- Always creates a `.v1.bak` backup before writing any changes
- Lists what must be added manually after migration (intent the tool can't infer)

#### `MIGRATION.md` — Institutional Migration Guide
- 6 before/after JSON examples covering every major v1 → v2 change
- Clear breakdown of what the tool handles automatically vs. what requires human review
- Deprecation timeline table

#### `scenario_schema_v2.json` — Formal JSON Schema
- JSON Schema Draft-07 definition for all new scenario fields
- Validated against both prototype scenarios with zero errors

### 🔄 Changed

- **Generator SKILL.md** — updated to always produce v2 scenarios; expanded step translation guide (14 actions), pattern detection guide for smart waits, optional steps, conditional steps, retry, data capture, and nested sub-flows
- **Executor SKILL.md** — updated with full v2 execution path: condition evaluation, variable capture, sub-flow execution, retry logic, all 9 assertion types
- **Result schema** — extended additively with optional v2 fields (`schema_version`, `captured_variables`, step-level `retry_count`, `step_duration_ms`, `condition_evaluated`); `step_id` accepts both integer (v1) and string (v2)
- **`generate.toml`** — deprecation check when `--schema-version 1.0` flag is used
- **`execute.toml`** — deprecation check when a v1 scenario is detected
- **`setup.toml`** — copies `scenario_schema_v2.json` to workspace alongside v1 schema
- **`GEMINI.md`** — dual schema registry (v2 default + v1 legacy), expanded tool mapping table with all 14 action types
- **`README.md`** — updated schema section to describe v2, added `/mobile-automator:migrate` to commands table, updated project structure tree with named screenshot IDs and `scenario_schema_v2.json`
- **`CLAUDE.md`** — updated file structure, schema documentation, and namespace list to reflect all new files

### ⚠️ Deprecation Notice

Schema v1 is deprecated as of **2026-02-17**. The 12-month deprecation timeline:

| Phase | Period | Behavior |
|-------|--------|----------|
| Phase 1 | Now → 2026-08-17 | Non-blocking warning on v1 generate/execute |
| Phase 2 | 2026-08-17 → 2027-01-17 | New v1 generation blocked; execution requires acknowledgment |
| Phase 3 | 2027-01-17+ | Hard fail — v1 scenarios will not execute |

Migrate existing scenarios with `/mobile-automator:migrate <scenario_id>`. See [MIGRATION.md](https://github.com/sh3lan93/mobile-automator/blob/main/MIGRATION.md) for the full guide.

---

## [0.1.0] - 2025-02-13

### 🎉 First Beta Release

Mobile Automator's first beta release brings **intelligent mobile QA automation** to Gemini CLI.

#### Core Features
- **7-Section Setup Workflow** — Comprehensive project analysis with platform detection, environment discovery, package inference, and automatic skill installation
- **Natural Language Test Generation** — Describe tests in plain English, generator creates structured JSON scenarios
- **Intelligent Test Execution** — AI-powered test runner with flakiness detection, regression spotting, and semantic visual testing
- **3-Tier Architecture** — Extension commands, workspace skills, and mobile-mcp automation engine

#### Platform Support
- Android (native, Kotlin, Java)
- iOS (native, Swift, Objective-C)
- Flutter
- React Native
- Kotlin Multiplatform (KMP)
- Compose Multiplatform (CMP)

#### Test Capabilities
- 7 action types (`launch_app`, `tap`, `type`, `swipe`, `press_button`, `wait`, `open_url`)
- 4 assertion types (`screenshot_match`, `element_exists`, `element_text`, `element_not_exists`)
- Automatic precondition handling
- Environment-aware package selection
- Flakiness detection with automatic retry
- Semantic visual testing (AI vision, not pixel matching)

---

[Back to Docs](index.md) | [View on GitHub](https://github.com/sh3lan93/mobile-automator)
