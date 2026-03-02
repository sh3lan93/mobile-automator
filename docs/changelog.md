# Changelog

All notable changes to mobile-automator are documented here. Follow [Semantic Versioning](https://semver.org/).

---

## [1.0.0] - 2026-03-01

### ✨ Added

#### Core Features
- **Natural Language Test Generation** — Describe tests in plain English, generator creates JSON scenarios
- **3-Tier Architecture** — Extension commands → Workspace skills → Mobile MCP server
- **7-Section Setup Workflow** — Comprehensive project analysis and skill installation
  - Pre-initialization and overview
  - Platform auto-detection (Android, iOS, Flutter, React Native, KMP, CMP)
  - Environment discovery (production, staging, development, custom)
  - App package inference (Android applicationId, iOS bundle identifier)
  - Project knowledge gathering (architecture, domain, loading indicators, protected directories)
  - Automatic skill installation with 13 placeholder replacements
  - Directory scaffolding and finalization with git commit

#### Test Scenario Schema v2
- **Named string step IDs** — Human-readable step identifiers (tap_login, wait_for_home)
- **14 Action Types**:
  - Navigation: `launch_app`, `open_url`, `press_button`
  - Interaction: `tap`, `long_press`, `double_tap`, `type`, `swipe`, `scroll_to_element`
  - Waiting: `wait_for_element`, `wait_for_element_gone`, `wait_for_loading_complete`
  - Data capture: `capture_value`, `clear_app_data`

- **27 Assertion Types**:
  - Element State: `element_exists`, `element_not_exists`, `element_visible`, `element_state`
  - Text & Content: `element_text`, `text_contains`, `text_not_empty`, `element_hint`, `pattern_match`, `text_changed`, `content_description`
  - Count & Collections: `element_count`, `list_item_count`, `list_is_empty`
  - Visual & Layout: `screenshot_match`, `visual_state`, `element_fully_visible`, `color_style`
  - Navigation & Screen: `screen_title`, `alert_present`, `alert_text`, `toast_visible`, `keyboard_visible`
  - Accessibility: `has_accessibility_label`
  - Data & Variables: `value_matches_variable`
  - Platform-Specific: `permission_dialog_shown`, `dark_mode_active`

- **Advanced Features**:
  - Variables and dynamic value capture
  - Preconditions with setup actions
  - Optional steps with `optional: true`
  - Conditional execution with `condition` field
  - Retry policies with `retry_policy` configuration
  - Sub-steps for complex interactions
  - Wait configuration with timeout customization
  - Structured error handling with `on_failure` callbacks

#### Test Result Schema
- Comprehensive result reporting with:
  - Execution metadata (`run_id`, `duration_ms`, `timestamp`)
  - Step-by-step execution tracking
  - Assertion pass/fail status
  - Variable capture tracking
  - Screenshot collection
  - **Advanced Observations**:
    - Flakiness detection (timing issues, retry behavior)
    - Regression detection (visual changes beyond assertions)
    - State context (device state, app version, environment data)

#### Test Execution Engine
- Automatic element fuzzy matching and resolution
- Intelligent wait strategies with exponential backoff
- Screenshot analysis and visual comparison
- Step-by-step failure diagnostics
- Semantic visual testing (not pixel-perfect)
- Concurrent assertion validation
- Detailed execution logging

#### Platform Support
- ✅ Android (minSdk 21+)
- ✅ iOS (iOS 12+)
- ✅ Flutter (Dart 2.18+)
- ✅ React Native (0.66+)
- ✅ Kotlin Multiplatform (1.7+)
- ✅ Compose Multiplatform (1.0+)

#### Command-Line Interface
- `/mobile-automator:setup` — Interactive project analysis and skill installation
- `/mobile-automator:generate` — Natural language test generation
- `/mobile-automator:execute` — Test execution with result collection
- `/mobile-automator:migrate` — v1 → v2 scenario migration tool

#### MCP Server Integration
- **Bundled mobile-mcp** — Device automation primitives:
  - Device management: `mobile_list_available_devices`, `mobile_get_screen_size`, `mobile_get_orientation`
  - App management: `mobile_launch_app`, `mobile_install_app`, `mobile_uninstall_app`, `mobile_terminate_app`
  - Interaction: `mobile_click_on_screen_at_coordinates`, `mobile_long_press_on_screen_at_coordinates`, `mobile_double_tap_on_screen`, `mobile_type_keys`
  - Navigation: `mobile_swipe_on_screen`, `mobile_press_button`
  - UI analysis: `mobile_list_elements_on_screen`, `mobile_take_screenshot`
  - System: `mobile_open_url`, `mobile_set_orientation`

#### Documentation
- Comprehensive user guides:
  - Quick start guide
  - Installation instructions
  - Setup workflow walkthrough
  - Test generation guide
  - Test execution guide
  - Migration guide (v1 → v2)

- Reference documentation:
  - Complete schema v2 specification
  - Action types catalog
  - Assertion types catalog
  - MCP tools reference
  - Architecture overview
  - Skills documentation

- Example scenarios:
  - 5 Android examples (login, list scrolling, permissions, toast, errors)
  - 5 iOS examples (biometric auth, tab navigation, swipe gestures, alerts, background sync)
  - Full JSON for each with explanations

- Additional resources:
  - FAQ with 30+ Q&A
  - Contributing guide
  - Architecture documentation (3-tier design)
  - Concepts guide (skills, schema, workflow)
  - Changelog (this document)

#### Extension Configuration
- Manifest: `gemini-extension.json` with:
  - Extension metadata (name, version, description)
  - Context file reference (`GEMINI.md`)
  - MCP server bundling
  - Command definitions

- AI Context: `GEMINI.md` with:
  - Schema registry pointing to workspace locations
  - Tool mappings for generation/execution
  - Prompt guidance for AI skills
  - Reference documentation

- Developer Context: `CLAUDE.md` with:
  - Architecture explanation
  - Implementation details
  - Development workflows
  - Troubleshooting guide

#### Project Analysis Features
- **Architecture Pattern Detection**:
  - MVVM, Clean Architecture, BLoC, Redux/MVI, MVP, VIPER
  - Combined patterns (e.g., "MVVM with Clean Architecture")
  - Custom pattern recognition

- **Loading Indicator Detection**:
  - Android: CircularProgressIndicator, LinearProgressIndicator, ProgressBar, ShimmerEffect, ContentLoadingProgressBar
  - iOS: UIActivityIndicatorView, ProgressView, SkeletonView
  - Flutter: CircularProgressIndicator, LinearProgressIndicator, Shimmer
  - React Native: ActivityIndicator, SkeletonPlaceholder
  - Custom patterns matching *Loading*, *Spinner*, *Shimmer*, *Skeleton*

- **Environment Discovery**:
  - Android: productFlavors, buildTypes
  - iOS: Xcode schemes, xcconfig files
  - Flutter: flavor configs, .env files
  - React Native: .env.* files, react-native-config

### 🎯 Features

#### Test Generation
- Natural language parsing with AI context
- Element fuzzy matching (visible text, labels, positions)
- Automatic timeout calibration
- Step validation before scenario completion
- Visual feedback with screenshots
- Scenario preview and editing

#### Test Execution
- Device detection and validation
- Pre-flight checks (app installation, device state)
- Step-by-step execution with retries
- Visual assertion support
- Result collection and reporting
- Error diagnostics with suggestions

#### TestRail Integration
- Automatic result syncing to TestRail
- Case ID mapping in scenarios
- Test run linking
- Result status updates
- Case linking in scenario JSON

#### Workspace Organization
```
mobile-automator/
├── config.json              # Project configuration
├── setup_state.json         # Resume capability state
├── index.md                 # Auto-generated documentation
├── scenarios/               # Generated test scenarios
│   ├── *.json              # v2 scenarios (default)
│   └── *_v1.json           # v1 scenarios (legacy)
├── results/                 # Execution results
│   └── run_*.json          # Result reports with observations
├── screenshots/             # Reference screenshots
│   └── scenario_*.png       # Test screenshots
```

#### Resume Capability
- Setup can be interrupted and resumed
- State saved after each section
- Automatic recovery on re-run
- No data loss between sessions

### 🔧 Technical Improvements

- **Robust Error Handling**:
  - Graceful fallbacks for failed detection
  - User prompts for missing information
  - Detailed error messages with solutions
  - Logging for debugging

- **Performance**:
  - Efficient element resolution (no exhaustive search)
  - Optimized screenshot capture
  - Smart timeout strategies
  - Caching of project metadata

- **Reliability**:
  - Automatic retry on transient failures
  - Flakiness detection and reporting
  - State validation between steps
  - Device health checks

---

## [0.1.0] - 2026-02-01

### ✨ Initial Release

First production release of mobile-automator with core functionality:

- Basic test scenario generation
- Test execution engine
- Schema v1 support (legacy)
- 12 action types
- 12 assertion types
- MCP server integration
- Setup command (basic version)
- Android and iOS support
- Documentation skeleton

---

## [0.0.1] - 2026-01-15

### 🎬 Project Inception

- Initial development started
- Architecture designed (3-tier pattern)
- Gemini CLI integration explored
- MCP server communication established

---

## Unreleased (Upcoming)

### 🚀 Planned Features

#### Short Term (0-3 months)
- [ ] Parallel test execution
- [ ] Test flakiness analysis and reporting
- [ ] Custom assertion library support
- [ ] Advanced visual regression testing
- [ ] Performance benchmarking assertions

#### Medium Term (3-6 months)
- [ ] Cloud device farm support (BrowserStack, Sauce Labs)
- [ ] Extended video recording and analysis
- [ ] Accessibility testing assertions
- [ ] API mocking integration
- [ ] Database state assertions

#### Long Term (6-12 months)
- [ ] AI-powered test recommendations
- [ ] Intelligent test case generation from user behavior
- [ ] Cross-platform scenario optimization
- [ ] Advanced CI/CD pipeline integration
- [ ] Test impact analysis

### 🐛 Known Issues

- Performance testing not yet supported (planned)
- Cannot test network calls directly (workaround: use TestRail observations)
- Limited WebView testing (only basic navigation)
- No native code instrumentation (alternative: use Appium alongside)

### 🔄 Migration Path

#### v1 → v2 Scenarios
- Automatic migration available: `/mobile-automator:migrate`
- 12-month deprecation timeline:
  - Months 0-6: Warning on v1 scenario execution
  - Months 7-11: Execution blocked with migration instructions
  - Month 12+: v1 scenarios no longer supported
- No data loss during migration

---

## Contributing to Changelog

When submitting PRs:

1. **Add entry to "Unreleased"** section with your change
2. **Use categories**:
   - ✨ Added (new features)
   - 🎯 Features (enhancements)
   - 🔧 Improved (improvements to existing)
   - 🐛 Fixed (bug fixes)
   - 📚 Documentation
   - 🔄 Changed (breaking changes)
   - ⚠️ Deprecated
   - 🗑️ Removed

3. **Be specific**: Include concrete examples
4. **Link to issues**: Reference GitHub issues when relevant

---

## Release Checklist

Before releasing, ensure:

- [ ] All tests pass
- [ ] No `console.warn` or `console.error` statements
- [ ] Documentation updated
- [ ] Examples tested in real projects
- [ ] Version bumped in `gemini-extension.json`
- [ ] Changelog updated
- [ ] GitHub release created with notes
- [ ] Extension tested via `gemini extensions install`

---

## Version Support

### Current Version
- **v1.0.0** — Fully supported, production-ready

### Legacy Versions
- **v0.x.x** — No longer supported, recommend upgrade

### Supported Node.js Versions
- Node.js 20.x (LTS)
- Node.js 22.x (Latest)

### Supported Gemini CLI Versions
- Gemini CLI 1.0.0+
- Recommend latest version for best compatibility

### Supported Mobile Platforms
- Android 8.0 (API 26) - 15.0 (API 35)
- iOS 12.0 - 17.x
- Flutter 2.18+
- React Native 0.66+
- KMP 1.7+
- CMP 1.0+

---

## Security & Maintenance

### Security Policy
- Report security issues privately to maintainers
- No public disclosure until patch released
- Security patches released as patch versions

### Maintenance
- Monthly patch releases (bug fixes)
- Quarterly minor releases (new features)
- Annual major releases (breaking changes)
- Security updates as needed

### Dependencies
- Mobile MCP: Latest version (auto-updated)
- Node.js: Recommend 20+ LTS
- Gemini CLI: 1.0.0+

---

## Feedback & Bug Reports

Found an issue or have a feature request?

- **Bug Report** → [GitHub Issues](https://github.com/sh3lan93/mobile-automator/issues)
- **Feature Request** → [GitHub Issues](https://github.com/sh3lan93/mobile-automator/issues) (add 'enhancement' label)
- **General Questions** → [GitHub Issues](https://github.com/sh3lan93/mobile-automator/issues) (add 'question' label)

---

## License

Mobile Automator is licensed under Apache 2.0. See LICENSE file for details.

---

[Back to Docs →](index.md) | [View on GitHub →](https://github.com/sh3lan93/mobile-automator)
