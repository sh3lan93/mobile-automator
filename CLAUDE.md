# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Mobile Automator is a **Gemini CLI extension** that provides intelligent mobile QA automation capabilities. It uses a **3-Tier Architecture**: extension commands handle pre-flight checks, workspace skills contain testing logic, and the mobile-mcp server provides device automation.

**Key Distinction**: This is NOT a direct testing tool. It's a meta-extension that analyzes your mobile project, learns its architecture and domain, then generates customized testing skills tailored specifically to that project.

**Implementation Status**: ✅ **Production-ready and feature-complete.** The extension includes comprehensive project analysis (7-section setup workflow), automatic skill installation with placeholder replacement, and intelligent test generation/execution.

## Architecture

### Three-Tier Design

```
┌─────────────────────────────────────┐
│  TIER 1: Extension Commands         │
│  /mobile-automator:setup                      │
│  /mobile-automator:generate         │
│  /mobile-automator:execute          │
│  (Pre-flight checks, validation)    │
└──────────────┬──────────────────────┘
               │ delegates to
┌──────────────▼──────────────────────┐
│  TIER 2: Workspace Skills           │
│  .gemini/skills/mobile-automator-*/ │
│  (Test generation & execution logic)│
└──────────────┬──────────────────────┘
               │ uses
┌──────────────▼──────────────────────┐
│  TIER 3: Automation Engine          │
│  mobile-mcp                         │
│  (Device control primitives)        │
└─────────────────────────────────────┘
```

**Why this design:**
- **Tier 1** (Extension Commands): Handle infrastructure concerns (device detection, app installation, scenario selection)
- **Tier 2** (Workspace Skills): Contain project-specific testing logic customized with placeholders
- **Tier 3** (MCP Server): Provides platform-agnostic device automation primitives

### File Structure

```
mobile-automator/
├── gemini-extension.json      # Extension manifest + MCP server config
├── GEMINI.md                  # AI context (schema registry, tool mappings, conventions)
├── CLAUDE.md                  # Developer documentation (this file)
├── README.md                  # User-facing documentation
├── MIGRATION.md               # Schema v1 → v2 migration guide
├── commands/
│   └── mobile-automator/
│       ├── setup.toml         # 7-section setup workflow with skill installation
│       ├── generate.toml      # Pre-flight wrapper for generator skill
│       ├── execute.toml       # Pre-flight wrapper for executor skill
│       └── migrate.toml       # Interactive v1→v2 scenario migration tool
└── templates/
    ├── mobile-automator-generator/
    │   ├── SKILL.md          # Generator skill template with {{placeholders}}
    │   └── references/
    │       ├── scenario_schema_v2.json  # Test scenario JSON schema (v2, default)
    │       └── scenario_schema.json     # Test scenario JSON schema (v1, legacy)
    └── mobile-automator-executor/
        ├── SKILL.md          # Executor skill template with {{placeholders}}
        └── references/
            └── result_schema.json    # Test result JSON schema
```

### MCP Server Integration

The extension bundles `mobile-mcp` via `gemini-extension.json`:
```json
"mcpServers": {
  "mobileMcpServer": {
    "command": "npx",
    "args": ["-y", "@mobilenext/mobile-mcp@latest"]
  }
}
```

This provides mobile automation primitives: `mobile_launch_app`, `mobile_click_on_screen_at_coordinates`, `mobile_take_screenshot`, `mobile_type_keys`, `mobile_swipe_on_screen`, `mobile_list_elements_on_screen`, etc.

## Key Workflows

### The Setup Command (7-Section Workflow)

The setup logic is in `commands/mobile-automator/setup.toml`. It performs a comprehensive 7-section analysis:

**Section 1: Pre-Initialization**
- Presents overview to user
- Checks for existing `mobile-automator/setup_state.json` for resume capability

**Section 2: Platform Detection**
- Auto-detects: Android, iOS, Flutter, React Native, Kotlin Multiplatform (KMP), Compose Multiplatform (CMP)
- Uses file pattern matching (`package.json`, `build.gradle`, `pubspec.yaml`, `.xcodeproj`, etc.)
- Fallback: Prompts user if detection fails

**Section 3: Environment Discovery**
- Scans build configurations for environments (production, staging, development, etc.)
- Platform-specific detection:
  - Android/KMP/CMP: `productFlavors`, `buildTypes`
  - iOS: Xcode schemes, `xcconfig` files
  - Flutter: `--dart-define`, flavor configs, `.env` files
  - React Native: `.env.*` files, `react-native-config`

**Section 4: App Package Inference**
- Extracts Android `applicationId` from `build.gradle`
- Extracts iOS `PRODUCT_BUNDLE_IDENTIFIER` from Xcode project or `Info.plist`
- Prompts user if auto-detection fails

**Section 5: Project Knowledge** (⭐ This is where the magic happens)
Auto-detects from codebase:
- **Project name** - from build files or directory name
- **Platform details** - SDK versions, deployment targets
- **Build system** - Gradle, Xcode, Flutter CLI, Metro
- **Build command** - Inferred from flavors and build types
- **Architecture pattern** - Scans for MVVM, Clean Architecture, BLoC, Redux, MVP, VIPER patterns
- **Business domain** - Extracted from README, app manifests, store listings
- **Loading indicators** - Greps source code for `CircularProgressIndicator`, `Shimmer`, `ActivityIndicator`, `SkeletonView`, etc.
- **Protected directories** - Identifies source code directories to avoid modification

Asks user for:
- Corrections to auto-detected values
- Business-critical user paths (e.g., "onboarding, login, checkout, payment")

**Section 6: Skill Installation** (⭐ Fully automated)
- Creates `.gemini/skills/mobile-automator-generator/` and `.../mobile-automator-executor/`
- Reads skill templates from `${extensionPath}/templates/`
- **Replaces ALL 13 placeholders** with detected/gathered values:
  - `{{project_name}}`, `{{platform_details}}`, `{{build_system}}`, `{{build_command}}`
  - `{{app_package}}`, `{{environments}}`, `{{automation_extras}}`
  - `{{architecture}}`, `{{business_domain}}`, `{{business_critical_paths}}`
  - `{{loading_indicators}}`, `{{protected_directories}}`, `{{additional_resources}}`
- Copies schema files from templates to workspace
- Verifies no `{{` placeholders remain in generated skills

**Section 7: Directory Scaffolding & Finalization**
- Creates `mobile-automator/scenarios/`, `screenshots/`, `results/`
- Generates `mobile-automator/config.json` with all collected data
- Generates `mobile-automator/index.md` documentation
- Commits to git if repository exists

**Resume Capability**: If setup is interrupted, run `/mobile-automator:setup` again and it will resume from the last successful section using `mobile-automator/setup_state.json`.

### The Generate Command (Wrapper Pattern)

`commands/mobile-automator/generate.toml` is a **pre-flight wrapper** that:
1. Verifies `mobile-automator/config.json` exists
2. Checks that `.gemini/skills/mobile-automator-generator/SKILL.md` is installed
3. Detects connected devices via `mobile_list_available_devices()`
4. Confirms app installation (offers to build/install if needed)
5. Delegates to the generator skill at `.gemini/skills/mobile-automator-generator/SKILL.md`

**Why the wrapper?** Separates infrastructure concerns (device detection, config validation) from domain logic (test generation).

### The Execute Command (Wrapper Pattern)

`commands/mobile-automator/execute.toml` is a **pre-flight wrapper** that:
1. Verifies `mobile-automator/config.json` exists
2. Checks that `.gemini/skills/mobile-automator-executor/SKILL.md` is installed
3. Detects connected devices
4. Confirms app installation
5. Resolves which scenarios to execute (by name, ID, or tag)
6. Delegates to the executor skill at `.gemini/skills/mobile-automator-executor/SKILL.md`

### Modifying Skill Templates

Skill templates are in `templates/mobile-automator-generator/SKILL.md` and `templates/mobile-automator-executor/SKILL.md`.

**Available Placeholders** (automatically populated during setup):
- `{{project_name}}` - Detected app name
- `{{platform_details}}` - Platform SDK versions (e.g., "Android (minSdk 24, targetSdk 34)")
- `{{architecture}}` - Detected or user-provided architecture pattern
- `{{build_system}}` - Gradle, Xcode, Flutter CLI, Metro
- `{{build_command}}` - Platform-specific build command
- `{{app_package}}` - Android applicationId and/or iOS Bundle Identifier
- `{{environments}}` - Comma-separated list of environments
- `{{loading_indicators}}` - Project-specific loading patterns
- `{{protected_directories}}` - Source directories to avoid modification
- `{{automation_extras}}` - Platform-specific automation notes
- `{{business_domain}}` - One-sentence description of app domain
- `{{business_critical_paths}}` - User-provided critical user flows
- `{{additional_resources}}` - Optional extra resource links

**How placeholders work:**
1. Setup detects/gathers values for each placeholder
2. Section 6.0 reads template files
3. Replaces `{{placeholder}}` with actual values
4. Writes populated SKILL.md to `.gemini/skills/`
5. Verifies no placeholders remain

### Adding New Skills

To add a third skill (e.g., `mobile-automator-debugger`):

1. **Create template directory**: `templates/mobile-automator-debugger/`
2. **Create SKILL.md** with frontmatter:
   ```markdown
   ---
   name: mobile-automator-debugger
   description: Debug failed tests for {{project_name}}
   ---

   # Mobile Automator — Test Debugger

   [Skill prompt content with {{placeholders}}]
   ```
3. **Add schema if needed**: `references/debug_report_schema.json`
4. **Update setup.toml Section 6.0** to include the new skill in the copy loop
5. **Update GEMINI.md** to reference the new schema location
6. **Create command wrapper** (optional): `commands/mobile-automator/debug.toml`

### Test Scenario & Result Schemas

**Schema Locations:**

- **Test Scenario Schema v2** (default): `templates/mobile-automator-generator/references/scenario_schema_v2.json`
  - Defines format for all new test scenarios
  - Required root field: `$schema_version: "2.0"`
  - Named string step IDs (snake_case) and assertion IDs — not integers
  - Supports 14 action types: `launch_app`, `tap`, `long_press`, `double_tap`, `type`, `swipe`, `scroll_to_element`, `press_button`, `open_url`, `wait_for_element`, `wait_for_element_gone`, `wait_for_loading_complete`, `capture_value`, `clear_app_data`
  - Supports 27 assertion types across 8 categories:
    - **Element State:** `element_exists`, `element_not_exists`, `element_visible`, `element_state`
    - **Text & Content:** `element_text`, `text_contains`, `text_not_empty`, `element_hint`, `pattern_match`, `text_changed`, `content_description`
    - **Count & Collections:** `element_count`, `list_item_count`, `list_is_empty`
    - **Visual & Layout:** `screenshot_match`, `visual_state`, `element_fully_visible`, `color_style`
    - **Navigation & Screen:** `screen_title`, `alert_present`, `alert_text`, `toast_visible`, `keyboard_visible`
    - **Accessibility:** `has_accessibility_label`
    - **Data & Variables:** `value_matches_variable`
    - **Platform-Specific:** `permission_dialog_shown`, `dark_mode_active`
  - New step-level fields: `optional`, `condition`, `on_failure`, `retry_policy`, `capture_to`, `sub_steps`, `wait_config`
  - New root-level fields: `variables`, `preconditions` (structured object, not string array)

- **Test Scenario Schema v1** (legacy, deprecated): `templates/mobile-automator-generator/references/scenario_schema.json`
  - v1 scenarios use integer step IDs and `after_step_id` integer references
  - 12-month deprecation: warning (months 0–6), blocked (months 7–11), hard fail (month 12+)
  - Migrate with `/mobile-automator:migrate <scenario_id>`

- **Test Result Schema**: `templates/mobile-automator-executor/references/result_schema.json`
  - Defines format for execution result reports
  - Key fields: `run_id`, `schema_version`, `status`, `steps_executed`, `assertion_results`, `observations`, `captured_variables`
  - `steps_executed[].step_id` accepts both integer (v1) and string (v2)
  - v2 step fields: `retry_count`, `step_duration_ms`, `condition_evaluated`, `sub_steps_executed`
  - **Advanced feature**: `observations` array with typed categories:
    - `regression` - Spots visual changes beyond assertions
    - `flakiness` - Detects timing issues, flags retry behavior
    - `state_context` - Provides device/environment context for failures

**Schema Distribution:**
During setup Section 6.0, schemas are copied from:
- `${extensionPath}/templates/mobile-automator-generator/references/scenario_schema_v2.json` (primary)
- `${extensionPath}/templates/mobile-automator-generator/references/scenario_schema.json` (legacy)
- `${extensionPath}/templates/mobile-automator-executor/references/result_schema.json`

To workspace:
- `.gemini/skills/mobile-automator-generator/references/scenario_schema_v2.json`
- `.gemini/skills/mobile-automator-generator/references/scenario_schema.json`
- `.gemini/skills/mobile-automator-executor/references/result_schema.json`

GEMINI.md acts as a registry pointing to these workspace-level schema locations.

## Development Commands

### Testing the Extension Locally

```bash
# Link the extension for local development
cd /path/to/mobile-automator
gemini extensions link .

# In a test mobile project
cd /path/to/test-mobile-app
gemini

# Verify commands are available
> /mobile-automator:setup
> /mobile-automator:generate
> /mobile-automator:execute
```

### Testing the Full Workflow

1. **Setup**: Run `/mobile-automator:setup` in a test mobile project
2. **Verify**: Check that `.gemini/skills/mobile-automator-*/SKILL.md` exist and have no `{{` placeholders
3. **Generate**: Connect a device and run `/mobile-automator:generate` with test steps
4. **Execute**: Run `/mobile-automator:execute` on the generated scenario
5. **Validate**: Check that `mobile-automator/results/<run_id>.json` contains observations and context

### Updating the MCP Server Version

The `mobile-mcp` version is pinned to `@latest` in `gemini-extension.json`. To use a specific version:
```json
"args": ["-y", "@mobilenext/mobile-mcp@1.2.3"]
```

### Releasing

Follow `RELEASE.md` checklist. Key steps:
1. Update version in `gemini-extension.json`
2. Update `CHANGELOG.md`
3. Test full workflow in a real mobile project
4. Commit and push to GitHub
5. Users install via `gemini extensions install https://github.com/sh3lan93/mobile-automator`

## Important Conventions

### Namespace Usage

All commands use the `mobile-automator:` namespace to prevent conflicts with other extensions:

- **Setup command**: `/mobile-automator:setup` — Invokes `commands/mobile-automator/setup.toml`
- **Generate command**: `/mobile-automator:generate` — Invokes `commands/mobile-automator/generate.toml`
- **Execute command**: `/mobile-automator:execute` — Invokes `commands/mobile-automator/execute.toml`
- **Migrate command**: `/mobile-automator:migrate` — Invokes `commands/mobile-automator/migrate.toml`

**Skill names** match the command namespace:
- `.gemini/skills/mobile-automator-generator/` - Used by generate command
- `.gemini/skills/mobile-automator-executor/` - Used by execute command

This naming convention makes it clear which extension provides these capabilities.

### Placeholder Replacement

Skill templates use double-brace syntax: `{{placeholder_name}}`.

**Replacement happens automatically** during setup Section 6.0:
1. Setup gathers all placeholder values (13 total)
2. Reads template SKILL.md files
3. Performs string replacement for each `{{placeholder}}`
4. Writes populated files to `.gemini/skills/`
5. Verifies no `{{` remains in the output

**Runtime fallback**: If a placeholder wasn't populated during setup (rare edge case), skills can read `mobile-automator/config.json` for project configuration.

### Directory Paths in Skills

Generated skills reference workspace paths:
- `mobile-automator/scenarios/` - Test scenario JSON files
- `mobile-automator/screenshots/` - Reference screenshots
- `mobile-automator/results/` - Execution result reports
- `mobile-automator/config.json` - Project configuration

These are relative to the user's mobile project root, NOT the extension directory. The directory name matches the extension name for clear ownership.

### GEMINI.md vs CLAUDE.md

- **GEMINI.md**: Loaded by Gemini CLI when executing skills. Contains schema registry, tool mappings, file resolution protocol. Audience: Gemini AI during test generation/execution.
- **CLAUDE.md**: This file. For developers maintaining the extension. Contains architecture, development workflows, implementation details.

## Troubleshooting Extension Development

### Setup Issues

**Platform detection failing**:
- Check that you're in the root of a mobile project
- Supported platforms: Android, iOS, Flutter, React Native, KMP, CMP
- For non-standard project structures, setup will prompt for manual selection

**Package ID not found**:
- Setup will prompt user to enter manually
- This is expected behavior for some project configurations

**Skills not installed after setup**:
- Check `.gemini/skills/mobile-automator-*/SKILL.md` exist
- Verify no `{{` placeholders remain (means replacement failed)
- Re-run `/mobile-automator:setup` - it will resume from Section 6.0

**Placeholders not replaced**:
- Check `mobile-automator/setup_state.json` for gathered knowledge
- Verify template paths in setup.toml Section 6.2 point to `${extensionPath}/templates/`
- Common issue: Path mismatch (should be `templates/` not `skill-templates/`)

### Command Issues

**Generate/execute command fails pre-flight**:
- Check `mobile-automator/config.json` exists (run setup first)
- Verify device connected: `adb devices` (Android) or `xcrun simctl list` (iOS)
- Check app installed or allow commands to build/install

**Wrapper commands can't find skills**:
- Verify `.gemini/skills/mobile-automator-generator/SKILL.md` exists
- Verify `.gemini/skills/mobile-automator-executor/SKILL.md` exists
- These should be created automatically by Section 6.0 of setup

### MCP Server Issues

**mobile-mcp not loading**:
- Check `npx` is available and can fetch `@mobilenext/mobile-mcp`
- Test manually: `npx -y @mobilenext/mobile-mcp@latest --version`

**Device automation failing**:
- Android: Ensure ADB is installed and device authorized
- iOS: Ensure Xcode command-line tools installed
- Check device shows in `mobile_list_available_devices()` output

## Advanced Features

### Architecture Pattern Detection (Section 5.0)

Setup scans your codebase for common patterns:
- **MVVM**: Looks for `viewmodel/`, `ViewModel` classes, `LiveData`
- **Clean Architecture**: Looks for `repository/`, `usecase/`, `domain/`, `data/` layers
- **BLoC**: Looks for `bloc/`, `cubit/` (Flutter)
- **Redux/MVI**: Looks for `reducer/`, `store/`, `action/`
- **MVP/VIPER**: Looks for `presenter/`, `interactor/`

Combines findings intelligently: e.g., "MVVM with Clean Architecture"

**Why this matters**: Skills are customized to understand your app's structure and naming conventions.

### Loading Indicator Detection (Section 5.0)

Setup greps source code for platform-specific loading patterns:
- Android: `CircularProgressIndicator`, `LinearProgressIndicator`, `ProgressBar`, `ShimmerEffect`, `ContentLoadingProgressBar`
- iOS: `UIActivityIndicatorView`, `ProgressView`, `SkeletonView`
- Flutter: `CircularProgressIndicator`, `LinearProgressIndicator`, `Shimmer`
- React Native: `ActivityIndicator`, `SkeletonPlaceholder`
- Custom: Any class matching `*Loading*`, `*Spinner*`, `*Shimmer*`, `*Skeleton*`

**Why this matters**: Test executor knows exactly what to wait for during test execution.

### Flakiness Detection (Result Schema)

The result schema includes:
```json
{
  "steps_executed": [{
    "retried": true,
    "observations": "Loading indicator still visible on first attempt"
  }],
  "observations": [{
    "type": "flakiness",
    "message": "Step 4 failed initially, passed on retry after 2s wait"
  }]
}
```

**Why this matters**: Distinguishes real bugs from timing issues, suggests test improvements.

### Semantic Visual Testing (Executor Skill)

Instead of pixel-by-pixel comparison, uses AI vision to answer:
> "Does this screen fulfill the same purpose as the reference?"

Focuses on: screen identity, key elements present/absent, text content, layout structure.
Tolerates: minor rendering differences (anti-aliasing, font smoothing).

**Why this matters**: Tests are resilient to cosmetic changes while catching functional regressions.

## Extension Metadata

- **Repository**: https://github.com/sh3lan93/mobile-automator
- **Version**: 1.0.0 (see `gemini-extension.json`)
- **License**: Apache 2.0
- **Context File**: `GEMINI.md` (specified in `gemini-extension.json`)
- **Status**: Production-ready, feature-complete
