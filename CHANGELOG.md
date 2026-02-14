# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

**Mobile Automator 1.0.0** - Built with ❤️ for mobile QA engineers
