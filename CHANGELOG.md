# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### ✨ Added

- **Recorder — GUI URL fallback printed from `record.toml`** ([#66](https://github.com/sh3lan93/mobile-automator/issues/66)). After the sidecar is spawned, `commands/mobile-automator/record.toml § 2.0` now reads the `mobile-automator/.recorder/<scenario>/recorder.port` file the HTTP server writes and prints `🌐 Recorder GUI: http://127.0.0.1:<port>/` with a one-line hint to paste the URL into a browser. A bounded retry loop (250ms × 12 = 3s) absorbs the spawn-vs-bind race; if the port file never appears the agent HALTs with a concrete error instead of hanging silently. Gives users a paste-able fallback for SSH sessions, CI/headless runs, `--no-gui`, and reopening a closed GUI tab within the 60s reconnect window.

## [0.12.1] — 2026-05-23

### 🐛 Fixed

- **Recorder GUI — unified tap target quote-wrap contract** ([#40](https://github.com/sh3lan93/mobile-automator/issues/40)). The legacy generic branch in `renderStepRow` and its sibling `applyStepRenamed` now wrap `step.target` in literal `"` characters at render time, matching the `long_press` / `double_tap` branches (slice [#24](https://github.com/sh3lan93/mobile-automator/issues/24)) and the `type` branch (slice [#35](https://github.com/sh3lan93/mobile-automator/issues/35)). Aligns the user-visible rendering with what the live lifecycle producer at `tools/recorder/src/lifecycle.js` actually sends (unquoted `display_name`). Pre-baked-quote test fixtures across the recorder unit suite were corrected accordingly. Bug was latent — the live `step-added` broadcast producer is not yet wired in production.

## [0.12.0] — 2026-05-23

> **Soft-launch graduation of `/mobile-automator:record`** — the cross-platform interactive scenario recorder designed in [PRD #21](https://github.com/sh3lan93/mobile-automator/issues/21) and built across 13 slices. The recorder is feature-complete and stays gated behind `MOBILE_AUTOMATOR_RECORDER=1` so it can collect real-world mileage before the env-var gate is removed in a future release. With the gate off, behaviour is identical to v0.11.0.

### ✨ Added

- **`/mobile-automator:record <scenario_name>` command** — opt-in cross-platform recorder. Pre-flights config / device / app install / environment, then opens a browser GUI hosted by a local Node sidecar. Steps materialise in the GUI as the user interacts with the device; on **Save & Generate**, a recorder skill ingests the artifact bundle and emits a schema-conformant scenario JSON to `mobile-automator/scenarios/<scenario_id>.json`, identical in shape to scenarios produced by `/mobile-automator:generate`. ([PRD #21](https://github.com/sh3lan93/mobile-automator/issues/21))
- **Capture pipeline** — single-touch gestures (`tap`, `long_press` ≥ 500 ms, `double_tap` within 300 ms at same coords, `swipe` with direction), `type` events (keyboard coalescing per focused field — Enter / focus-out / 1500 ms silence / session-end flushes), Android hardware keys (`BACK`, `HOME`, `VOLUMEUP`, `VOLUMEDOWN`, `POWER`) via `adb shell getevent -lt`, and iOS Simulator parity (`xcrun simctl` screenshots, "Show Single Touches" indicator detection, `XCUIElementType*` element resolution). ([#22](https://github.com/sh3lan93/mobile-automator/issues/22), [#35](https://github.com/sh3lan93/mobile-automator/issues/35), [#24](https://github.com/sh3lan93/mobile-automator/issues/24), [#25](https://github.com/sh3lan93/mobile-automator/issues/25), [#26](https://github.com/sh3lan93/mobile-automator/issues/26))
- **Assertion modal + AI classification at Save** — **Add Assertion** button in the GUI header opens a modal with a fresh device screenshot; the user describes the assertion in natural language and the AI applies a two-pass classifier at Save to convert NL → schema-typed assertion (any of the 27 types). Visual-state assertions carry a `reference_screenshot` path. Assertions are anchored to the most-recent step at click time. ([#27](https://github.com/sh3lan93/mobile-automator/issues/27))
- **Edit affordances** — per-step `⋯` menu offering type-filtered actions: **Rename** (any step, regenerates `step_id` slug), **Delete** (with confirm + 3-option re-anchor/cascade/cancel for anchored assertions), **Edit value** (`type` rows only — for typo fixes or `${env.VAR}` substitution), **Edit text** (assertion rows only — refine NL before classification). Reorder, insert, and arbitrary action-type change are deliberately not surfaced. ([#28](https://github.com/sh3lan93/mobile-automator/issues/28))
- **Agnostic-mode semantic action detection** — in `platform-agnostic` projects, the recorder auto-detects `press_back` (Android BACK key release or iOS left-edge right-swipe), `grant_permission` and `deny_permission` (taps on system permission dialogs, identified by Android `permissioncontroller`/`systemui` resource-ids or iOS `_UIAlertController` with exact label match against [`templates/references/platform-resolutions.md`](templates/references/platform-resolutions.md)). The fourth semantic action, `dismiss_keyboard`, is manual-only via a *Mark as dismiss_keyboard* item in the tap-row `⋯` menu. New `templates/mobile-automator-recorder/agnostic/SKILL.md` ships with the 6 agnostic placeholders and schema v2.1 conformance. ([#29](https://github.com/sh3lan93/mobile-automator/issues/29))
- **Sensitive-input caution markers + Save-time confirmation** — `type` events on Android `inputType=textPassword` / iOS `XCUIElementTypeSecureTextField` / `secureTextEntry: true` are flagged with `sensitive: true`. The GUI bullet-masks the value, renders a `⚠` caution marker, and at Save prompts inline if any flagged step still holds its captured literal. `${env.VAR}` substitution is a user-owned runtime convention enforced by the executor. `--allow-sensitive-input` suppresses the markers and Save-time prompt for projects with intentionally-hardcoded fixture credentials (bullet-mask still applies). ([#30](https://github.com/sh3lan93/mobile-automator/issues/30))
- **Failure modes** — three independent watchdogs wired through a single policy orchestrator:
  - **Device disconnect** — `DeviceWatchdog` trips after 3 capture failures within a 5 s rolling window; broadcasts a non-dismissible banner, cleans up, exits **code 2**.
  - **App crash** — `CrashWatchdog` polls `mobile_get_crash` every 5 s; dual-writes the crash log to `<artifacts>/crashes/<ts>.log` (in-bundle, included in save-partial) and `mobile-automator/crash-logs/<scenario_id>-<ts>.log` (persistent, survives discard). A sticky modal offers **Relaunch + resume**, **Save partial**, or **Discard**.
  - **Browser disconnect** — existing 60 s reconnect window; timeout falls through to cancel (exit **130**) with full cleanup. ([#31](https://github.com/sh3lan93/mobile-automator/issues/31))
- **`--overwrite` and `--verify` flags** — `--overwrite` is required when re-recording an existing scenario; on successful Save the prior `mobile-automator/screenshots/<id>/` is moved to `.archive/<id>-<timestamp>/`. `--verify` is opt-in (off by default — non-idempotent flows must not auto-replay); on successful Save, the executor skill replays the just-written scenario against the same device. Verify failure preserves the scenario JSON and never rolls back the Save. ([#32](https://github.com/sh3lan93/mobile-automator/issues/32))
- **C3 protocol v1.0** — TCP-over-loopback contract for future v1.1 instrumentation SDKs (iOS Swift Package, Android AAR). Spec at [`templates/references/c3-protocol.md`](templates/references/c3-protocol.md) covers transport, port-file + env-var discovery (`recorder-c3.port`, `MOBILE_AUTOMATOR_RECORDER_C3_PORT`), the versioned handshake, the six core event kinds (`tap`, `swipe`, `type`, `key`, `lifecycle`, `error`), the sidecar-to-SDK command vocabulary, and additive-fields versioning rules. Reference listener at `tools/recorder/src/c3/tcp-listener.js`. `--mode=c3` waits 10 s for an SDK to connect, then offers a Mode B fallback prompt to the operator. **No SDKs ship in v0.12.0** — they are v1.1 work. ([#33](https://github.com/sh3lan93/mobile-automator/issues/33))
- **System dependency: `ffmpeg`** — pre-flighted by `commands/mobile-automator/record.toml § 0.8` with platform-specific install hints on missing-binary halt, so the failure surfaces before the sidecar spawns.
- **README "Recording scenarios" section** — self-contained walkthrough covering opt-in, requirements, quick start, flags, capture vocabulary, mode awareness, sensitive-input handling, failure modes, verification, and current limitations. ([#34](https://github.com/sh3lan93/mobile-automator/issues/34))

### 🔄 Changed

- `scripts/install-skills.js` now installs the recorder skill in **both** `platform-aware` and `platform-agnostic` modes, alongside generator and executor.
- `commands/mobile-automator/setup.toml` § 6 install loop and § 7 scaffolding reflect the recorder skill in both modes.
- `.gitignore` adds `mobile-automator/.recorder/` (per-session working directory) and `mobile-automator/crash-logs/` (persistent crash logs that survive discard).

### 📝 Notes

- **Soft-launch gate.** The recorder remains hidden unless `MOBILE_AUTOMATOR_RECORDER=1` is set. The env-var gate stays so the feature can mature in real-world use before being removed in a future release; with the gate off, behaviour is identical to v0.11.0.
- **Not in v0.12.0** — iOS physical devices (out of scope per PRD); multi-touch gestures (pinch, rotate, two-finger pan — deferred); C3 instrumentation SDKs (protocol contract only — SDKs ship in v1.1); resume-from-draft after intentional cancel or browser-disconnect timeout (deliberately rejected during design); GUI localisation (English only).

---

## [0.11.0] — 2026-04-29

### ✨ Added

- **Platform-agnostic mode** — scenarios are portable across Android and iOS.
  - New `mode` field in `config.json` (`platform-aware` | `platform-agnostic`).
  - New § 1.5 (Mode Selection) in setup; new agnostic setup flow at §§ A.1–A.7.
  - New `templates/references/platform-resolutions.md` runtime contract for OS-shaped affordances.
  - Four new semantic actions: `press_back`, `dismiss_keyboard`, `grant_permission`, `deny_permission`.
  - Schema 2.1 (additive over 2.0 — adds `mode` metadata field and semantic actions; all 2.0 scenarios are valid 2.1 without changes).
  - Migration sub-flow (§ 1.6) with 3-phase atomicity, archive, and manual restore.

### 🔄 Changed

- `install-skills.js` is now mode-aware via `--mode=<mode>` flag.
- Aware-mode skill templates moved to `templates/mobile-automator-{role}/aware/`; agnostic templates added at `templates/mobile-automator-{role}/agnostic/`.

### 🔁 Migration

- v0.10 projects continue to work without change (config without `mode` field is treated as implicit `platform-aware`).
- To migrate to agnostic mode, re-run `/mobile-automator:setup` and select "Switch to platform-agnostic" at § 1.5.

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

Migrate existing scenarios with `/mobile-automator:migrate <scenario_id>`. See [MIGRATION.md](MIGRATION.md) for the full guide.

---

## [0.1.0] - 2025-02-13

### 🎉 First Beta Release

Mobile Automator's first beta release brings **intelligent mobile QA automation** to Gemini CLI. This isn't just another testing tool—it's an AI-powered extension that learns your app's architecture and generates customized testing skills specifically for your project.

**Note:** This is a pre-1.0 release. Breaking changes may occur in future updates as we refine the extension based on user feedback.

---

### ✨ Core Features

#### Intelligent Project Analysis
- **7-Section Setup Workflow**: Comprehensive project analysis that goes beyond basic configuration
  - Platform detection for Android, iOS, Flutter, React Native, Kotlin Multiplatform, and Compose Multiplatform
  - Environment discovery (production, staging, development, custom flavors)
  - **Environment-specific package ID inference**: Detects `applicationIdSuffix` for Android flavors and bundle ID overrides for iOS configurations
    - Android: Constructs full package IDs per flavor/buildType (e.g., `com.app.demo.staging`)
    - iOS: Detects configuration-specific bundle IDs from `.xcconfig` files and scheme settings
    - Stores mappings: `android_packages: {"demoStaging": "com.app.demo.staging", ...}`
  - **Architecture pattern detection**: Automatically recognizes MVVM, Clean Architecture, BLoC, Redux, MVP, VIPER
  - **Business domain extraction**: Understands what your app does by analyzing README, manifests, and store listings
  - **Loading indicator detection**: Greps source code for your specific progress indicators and shimmer effects
  - **Resume capability**: Interrupted setup can be resumed from the last successful step

#### Automatic Skill Generation
- **Project-specific skills**: Generated skills are customized with 13 placeholders populated from your codebase
- **Zero-configuration deployment**: Skills automatically installed to `.gemini/skills/` with no manual steps
- **Smart template path resolution**: Automatically detects extension installation method
  - Local development (linked): Reads `.gemini-extension-install.json` to find source path
  - GitHub installation: Uses templates directly from extension directory
  - Works seamlessly with both `gemini extensions link` and `gemini extensions install`
- **Placeholder replacement**: Template variables like `{{project_name}}`, `{{architecture}}`, `{{loading_indicators}}` are automatically replaced with detected values
- **Schema distribution**: Test scenario and result schemas automatically copied to workspace
- **Mobile-MCP tools reference**: Self-contained tool mapping documentation (`mobile-mcp-tools.md`) distributed with skills for offline reference

#### Natural Language Test Generation
- **Multi-format input support**: Accepts numbered lists, arrow notation, or conversational descriptions
- **Real device execution**: Tests run on actual devices/emulators, not simulations
- **Screenshot evidence**: Captures reference screenshots at every checkpoint
- **Structured JSON output**: Generates formal test scenarios following a production-grade schema

#### Intelligent Test Execution
- **Automatic precondition handling**: Reads scenario preconditions and handles them intelligently
  - `fresh_install`/`app_uninstalled`: Automatically uninstalls, builds, and reinstalls without prompting
  - `app_not_previously_installed`: Clears all app data before fresh install
  - State preconditions (`user_logged_out`, `dark_mode_enabled`): Configured during test setup
  - No more manual setup steps or redundant questions
- **Environment-aware package selection**: Uses correct package ID based on scenario's environment
  - Reads `metadata.environment` from scenario
  - Selects appropriate package from `android_packages` or `ios_bundle_ids` mapping
  - Ensures tests run against the correct flavor/configuration
- **Flakiness detection**: Automatically detects and flags timing-related test failures
  - Retries once on suspected timing issues
  - Distinguishes real bugs from loading delays
  - Suggests test improvements
- **Regression spotting**: Notices visual changes beyond explicit assertions
  - Detects missing elements that were present in reference
  - Flags new elements that weren't there before
- **State-aware failure analysis**: Provides diagnostic context for failures
  - Dark mode vs light mode mismatches
  - Device differences (Pixel 6 vs Pixel 8)
  - Network state, keyboard visibility, orientation
- **Semantic visual testing**: Uses AI vision for screenshot comparison instead of brittle pixel-matching
  - Focuses on screen purpose and key elements
  - Tolerates minor rendering differences
  - Catches functional regressions while ignoring cosmetic changes

---

### 🏗️ Architecture

#### 3-Tier Command Delegation
- **Tier 1 - Extension Commands**: Pre-flight checks, device detection, validation
  - `/mobile-automator:setup` - One-time project analysis and skill installation
  - `/mobile-automator:generate` - Test scenario generation wrapper
  - `/mobile-automator:execute` - Test execution wrapper
- **Tier 2 - Workspace Skills**: Project-specific testing logic
  - `mobile-automator-generator` - Customized test recorder
  - `mobile-automator-executor` - Intelligent test runner
- **Tier 3 - Automation Engine**: Device control primitives via `mobile-mcp`
  - Platform-agnostic device automation
  - Real device/emulator support
  - Cross-platform compatibility

#### Wrapper Pattern
- Commands handle infrastructure (device connection, app installation)
- Skills contain domain logic (test recording, execution, validation)
- Clean separation of concerns enables maintainability and extensibility

---

### 📱 Platform Support

| Platform | Detection | Build Support | Device Automation |
|----------|-----------|---------------|-------------------|
| **Android Native** | ✅ Gradle patterns | `./gradlew assemble*` | ✅ Emulator + Real Device |
| **iOS Native** | ✅ Xcode patterns | `xcodebuild` | ✅ Simulator + Real Device |
| **Flutter** | ✅ `pubspec.yaml` | `flutter build` | ✅ All platforms |
| **React Native** | ✅ Metro bundler | `npx react-native run-*` | ✅ All platforms |
| **Kotlin Multiplatform** | ✅ KMP structure | Gradle + Xcode | ✅ Android + iOS |
| **Compose Multiplatform** | ✅ CMP structure | Gradle + Xcode | ✅ Android + iOS |

---

### 🎯 Commands

#### `/mobile-automator:setup`
One-time setup command that analyzes your project and installs customized testing skills.

**What it does:**
- Detects platform and build configuration
- Discovers environments (staging, production, etc.)
- Infers app package IDs from build files
- Analyzes architecture patterns and business domain
- Detects project-specific loading indicators
- Generates customized skills with populated placeholders
- Creates test artifact directory structure

**Features:**
- Interactive with smart defaults
- Resume capability if interrupted
- State management for reliability

#### `/mobile-automator:generate`
Generates test scenarios from natural language descriptions.

**Features:**
- Device/emulator auto-detection
- Multi-device selection support
- Optional build and install
- Natural language step parsing (numbered lists, arrows, conversational)
- Real-time device execution with recording
- Reference screenshot capture
- JSON scenario file generation
- Schema validation

#### `/mobile-automator:execute`
Executes saved test scenarios and produces intelligent reports.

**Features:**
- Single scenario, multiple scenarios, or tag-based execution
- Run all scenarios via interactive option (select "All scenarios" when prompted)
- Device/emulator auto-detection
- Step-by-step replay with validation
- Screenshot comparison
- Flakiness detection with automatic retry
- Regression spotting
- State-aware failure diagnostics
- Detailed JSON result reports

---

### 📋 Test Scenario Schema

Production-grade JSON schema for test scenarios:

**Key Fields:**
- `scenario_id` - Unique snake_case identifier
- `platform` - android | ios | cross-platform
- `app_package` - Bundle ID or package name
- `preconditions` - Required state before execution (e.g., "fresh_install")
- `tags` - Categorization (e.g., "smoke", "regression", "authentication")
- `metadata` - Version, device, API level, environment, timestamp
- `steps` - Action sequence with checkpoints and expected states
- `assertions` - Validation rules with types and tolerances

**Supported Actions:**
- `launch_app`, `tap`, `type`, `swipe`, `press_button`, `wait`, `open_url`

**Supported Assertions:**
- `screenshot_match` - Semantic visual comparison
- `element_exists` - UI element presence validation
- `element_text` - Text content verification
- `element_not_exists` - UI element absence validation

---

### 📊 Test Result Schema

Comprehensive result schema with diagnostic data:

**Key Fields:**
- `run_id` - Unique run identifier (format: `run_YYYYMMDD_HHMMSS`)
- `status` - passed | failed | error
- `steps_executed` - Per-step results with retry flags
- `assertion_results` - Detailed pass/fail with context
- `observations` - Structured diagnostic insights
- `duration_seconds` - Execution time
- `metadata` - Execution environment details

**Observation Types:**
- `regression` - Visual changes beyond explicit assertions
- `flakiness` - Timing-related failures with retry behavior
- `state_context` - Device/environment context for failures

---

### 🧠 Advanced Features

#### Architecture Pattern Detection
Automatically recognizes common mobile architecture patterns:
- **MVVM** - ViewModel, LiveData patterns
- **Clean Architecture** - Domain, data, presentation layers
- **BLoC** - Business Logic Component (Flutter)
- **Redux/MVI** - Reducer, store, actions
- **MVP/VIPER** - Presenter, interactor patterns

Skills are customized to understand your specific architecture's naming conventions and structure.

#### Loading Indicator Auto-Detection
Greps source code for platform-specific loading patterns:
- **Android**: CircularProgressIndicator, LinearProgressIndicator, ProgressBar, ShimmerEffect, ContentLoadingProgressBar
- **iOS**: UIActivityIndicatorView, ProgressView, SkeletonView
- **Flutter**: CircularProgressIndicator, LinearProgressIndicator, Shimmer
- **React Native**: ActivityIndicator, SkeletonPlaceholder
- **Custom**: Pattern matching for `*Loading*`, `*Spinner*`, `*Shimmer*`, `*Skeleton*`

Test executor automatically waits for your specific loading indicators during test execution.

#### Flakiness Detection
Intelligent analysis to distinguish bugs from timing issues:
- Automatic retry on suspected timing failures
- Retry behavior flagged in results
- Root cause analysis (loading delay, animation, network dependency)
- Test improvement suggestions

#### Semantic Visual Testing
AI-powered screenshot comparison that focuses on functionality:
- Screen identity verification
- Key element presence/absence checking
- Text content validation
- Layout structure comparison
- Tolerant to minor rendering differences (anti-aliasing, font smoothing)
- Resilient to cosmetic changes while catching functional regressions

---

### 📂 Project Structure

Generated workspace structure after setup:

```
your-mobile-project/
├── mobile-automator/               # Test artifacts
│   ├── config.json                # Auto-generated project config
│   ├── index.md                   # Documentation
│   ├── scenarios/                 # Test scenario JSON files
│   ├── screenshots/               # Reference screenshots
│   └── results/                   # Test execution reports
│
└── .gemini/
    └── skills/                    # Generated testing skills
        ├── mobile-automator-generator/
        │   ├── SKILL.md          # Customized for YOUR project
        │   └── references/
        │       └── scenario_schema.json
        └── mobile-automator-executor/
            ├── SKILL.md          # Customized for YOUR project
            └── references/
                └── result_schema.json
```

---

### 🔧 Technical Details

#### Integration with mobile-mcp
- Automation engine: `@mobilenext/mobile-mcp@latest`
- Delivered via `npx` for zero-install friction
- Provides cross-platform device automation primitives:
  - `mobile_launch_app`, `mobile_click_on_screen_at_coordinates`
  - `mobile_take_screenshot`, `mobile_save_screenshot`
  - `mobile_type_keys`, `mobile_swipe_on_screen`
  - `mobile_list_elements_on_screen`, `mobile_press_button`
  - `mobile_open_url`, `mobile_list_available_devices`

#### Template System
- 13 customizable placeholders for project-specific skills
- Automatic population from codebase analysis
- Verification that no placeholders remain after installation
- Schema files automatically distributed to workspace

#### State Management
- `mobile-automator/setup_state.json` tracks setup progress
- Resume capability at any section
- Rollback protection for safe interruption
- **No automatic git commits**: User maintains full control over version control
  - Setup creates files but doesn't commit them
  - Users can review changes before committing
  - Supports custom commit message conventions and workflows

---

### 📚 Documentation

#### User Documentation
- **README.md**: Comprehensive user guide with quick start, examples, and troubleshooting
- **mobile-automator/index.md**: Generated project-specific documentation

#### Developer Documentation
- **CLAUDE.md**: Architecture, workflows, and development guide
- **GEMINI.md**: AI context with schema registry and tool mappings

#### Schema Documentation
- **scenario_schema.json**: Formal JSON schema for test scenarios
- **result_schema.json**: Formal JSON schema for execution results

---

### 🎨 User Experience

#### Interactive Setup
- Smart defaults based on project detection
- Confirmation prompts for all detected values
- User correction capability for any auto-detected value
- **Sequential question flow**: Questions asked one at a time with explicit wait steps
  - No more simultaneous questions causing confusion
  - Clear "WAIT for response" instructions prevent AI from jumping ahead
  - Two-step process: confirm auto-detected values → then ask for business-critical paths
- Clear progress indicators
- Resumable workflow

#### Multi-Format Input
Test generation accepts various natural language formats:
- **Numbered lists**: `1. open app 2. tap login 3. enter email`
- **Arrow notation**: `fresh install -> open -> validate UI`
- **Conversational**: Full sentences describing the flow

#### Rich Reporting
Execution reports include:
- Pass/fail summary with counts
- Per-step execution details
- Screenshot evidence for every checkpoint
- Flakiness flags with retry information
- Regression observations
- State context for failures
- Suggestions for test improvements

---

### 🔐 Best Practices Built-In

#### Security
- Protected directories detection prevents source code modification
- Read-only operations during test generation
- No credentials or secrets in generated files

#### Reliability
- Automatic retry logic for flaky steps
- State management for resumable operations
- Validation at every stage
- Schema enforcement for data integrity

#### Maintainability
- Clean 3-tier architecture
- Separation of concerns (infrastructure vs domain logic)
- Template-based skill generation for consistency
- Git integration for change tracking

---

### 🚀 Getting Started

```bash
# Install extension
gemini extensions install https://github.com/sh3lan93/mobile-automator

# Navigate to mobile project
cd your-mobile-project

# Run setup (one time)
gemini
> /mobile-automator:setup

# Generate test
> /mobile-automator:generate

# Execute test
> /mobile-automator:execute scenario_name
```

---

### 📦 What's Included

- Extension manifest with MCP server integration
- Three command files (setup, generate, execute)
- Two skill templates with 13 customizable placeholders
- Two JSON schemas (scenario, result)
- Comprehensive documentation (README, CLAUDE.md, GEMINI.md)
- Example scenarios and usage patterns
- Troubleshooting guides

---

### 🙏 Acknowledgments

- **mobile-mcp**: Device automation engine
- **Gemini CLI**: AI-powered CLI platform

---

### 📄 License

Apache License 2.0

---

### 🔗 Links

- **Repository**: https://github.com/sh3lan93/mobile-automator
- **Issues**: https://github.com/sh3lan93/mobile-automator/issues
- **Documentation**: https://github.com/sh3lan93/mobile-automator#readme

---

**Mobile Automator 0.9.0** - Built with ❤️ for mobile QA engineers
