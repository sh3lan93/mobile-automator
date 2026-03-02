# FAQ & Troubleshooting

Comprehensive guide to common questions, issues, and solutions when using mobile-automator.

## Table of Contents

1. [General Questions](#general-questions)
2. [Setup & Installation](#setup-installation)
3. [Test Generation](#test-generation)
4. [Test Execution](#test-execution)
5. [Integration](#integration)
6. [Performance & Optimization](#performance-optimization)
7. [Troubleshooting](#troubleshooting)
8. [Getting Help](#getting-help)
9. [Glossary](#glossary)

---

## General Questions

### What is mobile-automator?

**Answer:** Mobile Automator is a **Gemini CLI extension** that intelligently generates and executes mobile tests using natural language. Instead of writing tests manually in Appium, XCTest, or Espresso, you describe what you want to test in simple language, and the extension generates JSON test scenarios and executes them automatically.

**Key point:** It's NOT a direct testing tool like Selenium or Appium. It's a *meta-extension* that analyzes your project architecture and creates customized testing skills tailored to your specific app.

### How is mobile-automator different from Appium/XCTest/Espresso?

| Aspect | mobile-automator | Traditional Frameworks |
|--------|---|---|
| **Test Language** | Natural language descriptions | Code (Java, Python, Swift, Kotlin) |
| **Selector Strategy** | AI-powered fuzzy matching | Hard-coded IDs/XPaths |
| **Wait Strategy** | Automatic with intelligent retries | Manual explicit waits |
| **Domain Knowledge** | Auto-detected from project | Embedded in test code |
| **Customization** | Per-project skills with placeholders | Shared framework approach |
| **Learning Curve** | Minimal (describe in words) | Steep (framework-specific) |
| **Maintenance** | Skills auto-update with project | Manual test updates |
| **Test Speed** | Optimized for clarity, not performance | Optimized for speed |

### Do I need to write code?

**Answer:** No. Tests are described in plain English. The generator converts them to JSON. The executor handles all automation using MCP tools. You never touch code unless you want to customize skills.

**Example flow:**
```
Natural Language: "User logs in with email and password"
↓
Generated JSON: scenario_login_happy_path.json
↓
Executed Automatically: Tap fields, type text, verify dashboard
```

### What platforms does mobile-automator support?

**Answer:** Currently supported:
- ✅ **Android** (via mobile-mcp)
- ✅ **iOS** (via mobile-mcp)
- ✅ **Flutter** (Android & iOS cross-platform)
- ✅ **React Native** (Android & iOS cross-platform)
- ✅ **Kotlin Multiplatform (KMP)** (Android & iOS)
- ✅ **Compose Multiplatform (CMP)** (Android & iOS)

See our [examples](examples/index.md) for Android and iOS patterns.

### What's the difference between v1 and v2 scenarios?

**v1 (Legacy):**
- Integer step IDs (step 0, 1, 2)
- Integer after_step_id references
- Deprecated (12-month transition period)

**v2 (Current):**
- Named string step IDs (tap_login, wait_for_home)
- 14 action types, 27 assertion types
- Variables and capture_value support
- Retry policies and conditional steps
- TestRail integration
- **Recommended for all new tests**

**Migration:** Use `/mobile-automator:migrate <scenario_id>` to upgrade v1 → v2.

### Can I use mobile-automator with my existing tests?

**Answer:** Partially. If you have:
- **Appium/Espresso/XCTest tests** → No direct import, but use mobile-automator for *new* tests
- **v1 mobile-automator scenarios** → Yes, migrate to v2 with `/mobile-automator:migrate`
- **Custom test infrastructure** → Yes, mobile-automator complements existing tools

Best approach: Run mobile-automator alongside existing tests for new features.

---

## Setup & Installation

### How do I install mobile-automator?

**Answer:**
```bash
cd /path/to/mobile-project
gemini extensions install https://github.com/sh3lan93/mobile-automator
```

Then run:
```bash
gemini /mobile-automator:setup
```

This analyzes your project and creates customized skills.

### Setup command failed. What do I do?

**Answer:** Setup is resumable. The `/mobile-automator:setup` command saves progress in `mobile-automator/setup_state.json`. If it fails:

1. **Check the error message** — Note which section failed
2. **Fix the issue** — If it's a missing package ID, you'll be prompted
3. **Re-run setup** — It will resume from the last successful section
4. **Verify completion** — Check that `mobile-automator/config.json` was created

If stuck, delete `setup_state.json` and restart fresh.

### "Platform detection failed" — What should I do?

**Cause:** Your project structure doesn't match recognized patterns.

**Solutions:**
1. **Manually select your platform** when prompted
2. **Ensure build files exist:**
   - Android: `build.gradle` or `build.gradle.kts`
   - iOS: `Xcode.xcodeproj` or `.xcworkspace`
   - Flutter: `pubspec.yaml`
3. **Provide platform details manually** if auto-detection fails

**Example:** If setup can't detect iOS, you'll be prompted:
```
Platform detection failed.
Supported: android, ios, flutter, react-native, kmp, cmp
Enter your platform: ios
```

### "Package ID not found" — How do I fix this?

**Cause:** Auto-detection can't find your app's package ID.

**Solutions:**

**For Android:**
- Check `app/build.gradle` for `applicationId`:
  ```gradle
  defaultConfig {
    applicationId "com.example.myapp"  // ← This one
  }
  ```
- Or check `AndroidManifest.xml` for `package` attribute

**For iOS:**
- Check Xcode project General tab > Bundle Identifier
- Or check `Info.plist` for `CFBundleIdentifier`
- Or check `${PROJECT_DIR}/project.pbxproj` for `PRODUCT_BUNDLE_IDENTIFIER`

When setup prompts, enter the full package ID (e.g., `com.example.app` for Android, `com.example.MyApp` for iOS).

### "Placeholders not replaced in generated skills" — Why?

**Cause:** The skill templates couldn't be populated with project info.

**Solutions:**
1. **Check that setup completed** — Verify `mobile-automator/setup_state.json` has section 6.0 completed
2. **Check `mobile-automator/config.json`** — Ensure all fields are populated
3. **Verify template paths** — Extension should copy from `${extensionPath}/templates/`
4. **Re-run setup** — It will retry template replacement in section 6.0

If still failing:
```bash
# Check if skills were created
ls -la .gemini/skills/mobile-automator-*/SKILL.md

# Check for remaining placeholders
grep "{{" .gemini/skills/mobile-automator-*/SKILL.md
```

---

## Test Generation

### How do I generate a test scenario?

**Answer:**
1. Ensure setup is complete: `mobile-automator/config.json` exists
2. Connect a device via ADB (Android) or Xcode (iOS)
3. Run the generate command:
   ```bash
   gemini /mobile-automator:generate
   ```
4. Describe your test in natural language when prompted
5. Review the generated JSON in `mobile-automator/scenarios/`

**Example prompt:**
```
Describe the test scenario:
> User logs in with email and password, verifies dashboard loads
```

Generated: `mobile-automator/scenarios/android_login_happy_path.json`

### "Element not found when generating" — What does this mean?

**Cause:** The generator couldn't find an element you described on the current screen.

**Solutions:**
1. **Check app state** — Ensure app is in the right state (logged out for login test)
2. **Be more specific** — Use visible text or position: "Blue login button in bottom right"
3. **Use element labels** — Reference element's accessibility label if available
4. **Check if element exists** — Take a screenshot manually to verify
5. **Use alternative references** — Instead of internal ID, describe location: "Button below password field"

### "Generator misinterpreted my intent" — How do I fix it?

**Answer:** You can edit the generated JSON directly:

1. **Review generated scenario** — Check `mobile-automator/scenarios/`
2. **Edit JSON manually** — Fix element IDs, actions, assertions
3. **Validate schema** — Ensure it matches [schema v2 reference](reference/schema-v2.md)
4. **Re-execute** — Run `/mobile-automator:execute` with corrected scenario

**Common edits:**
- Change element IDs to correct ones
- Add/remove assertions
- Adjust timeout values
- Add wait steps before actions

### Can I generate tests for multiple platforms?

**Answer:** Yes, but separately:
1. **Android test** — Generate on Android device
2. **iOS test** — Generate on iOS device
3. **Mark platform field** — Set `"platform": "android"` or `"platform": "ios"`

For cross-platform apps, generate scenario on each platform to capture platform-specific behaviors.

### How do I parameterize tests (different data)?

**Answer:** Use the `variables` section in v2 scenarios:

```json
{
  "variables": {
    "test_email": {
      "type": "string",
      "value": "user@example.com"
    },
    "test_password": {
      "type": "string",
      "value": "SecurePassword123"
    }
  },
  "steps": {
    "enter_email": {
      "type": "type",
      "element": "email_input",
      "text": "{{test_email}}"  // ← Use variable reference
    }
  }
}
```

For running with different values, manually edit the JSON or use a test management integration.

---

## Test Execution

### How do I execute a test scenario?

**Answer:**
```bash
gemini /mobile-automator:execute
```

This prompts you to:
1. **Select a scenario** — Choose from `mobile-automator/scenarios/`
2. **Select a device** — Pick from connected devices
3. **Confirm app installation** — Will build/install if needed
4. **Run the test** — Executes all steps and assertions

Results saved to: `mobile-automator/results/<run_id>.json`

### "Step failed: Element not found" during execution

**Cause:** Element isn't on screen when the step tries to use it.

**Solutions:**
1. **Add explicit wait** — Insert a wait step before the action:
   ```json
   {
     "wait_for_element": {
       "type": "wait_for_element",
       "element": "button_id",
       "timeout_seconds": 5
     }
   }
   ```

2. **Verify app state** — Ensure app is in expected state before executing
3. **Check element name** — Verify you're using correct element ID
4. **Increase timeout** — Slow devices may need longer waits
5. **Add screenshot assertion** — Debug what's actually on screen:
   ```json
   {
     "verify_screen": {
       "type": "screenshot_match",
       "reference_file": "expected_screen.png"
     }
   }
   ```

### "Assertion failed: Expected X, got Y"

**Cause:** Assertion condition wasn't met during test.

**Solutions:**
1. **Check assertion syntax** — Verify `expected_text`, `expected_exact`, `expected_substring`
2. **Verify actual app data** — Manually check what value is displayed
3. **Handle dynamic content** — If value changes, use `text_contains` instead of `text_matches`
4. **Add debug screenshot** — Insert screenshot assertion to see actual state:
   ```json
   {
     "capture_state": {
       "type": "capture_value",
       "element": "title",
       "capture_to": "actual_title"
     }
   }
   ```

### "Test timed out" error

**Cause:** Step took too long or app is hung.

**Solutions:**
1. **Increase timeout** — Default is 10s, try 15-30s:
   ```json
   {
     "type": "wait_for_loading_complete",
     "timeout_seconds": 30
   }
   ```

2. **Check device state** — Is device frozen or unresponsive?
   ```bash
   adb devices  # Android
   xcrun simctl list  # iOS
   ```

3. **Simplify steps** — Break into smaller scenarios
4. **Add intermediate waits** — Between rapid actions:
   ```json
   {
     "wait_before_next": {
       "type": "wait_for_loading_complete",
       "timeout_seconds": 2
     }
   }
   ```

5. **Reduce app complexity** — Close other apps, reduce network load

### How do I debug a failed test?

**Answer:** Check the result JSON for detailed info:

```bash
cat mobile-automator/results/run_20260301_143022.json
```

Look for:
- **`observations`** — AI insights about failure (flakiness, regression, state context)
- **`steps_executed`** — Which step failed and why
- **`assertion_results`** — Which assertion failed
- **`captured_variables`** — What values were captured
- **`screenshots`** — Screenshots of failure state

Example output:
```json
{
  "observations": [
    {
      "type": "flakiness",
      "message": "Step 4 failed due to loading indicator still visible",
      "suggestion": "Increase wait timeout or add explicit wait_for_loading_complete"
    }
  ],
  "steps_executed": [
    {
      "step_id": "tap_login",
      "status": "passed"
    },
    {
      "step_id": "wait_for_dashboard",
      "status": "failed",
      "error": "Element not found after 5 seconds"
    }
  ]
}
```

### Can I run tests in parallel?

**Answer:** Not yet, but you can:
1. **Run sequential scenarios** — Execute multiple scenarios one after another
2. **Use different test jobs** — Run tests in CI/CD on different devices
3. **Separate data** — Ensure tests don't share data between runs
4. **Use variables** — Parameterize tests to avoid conflicts

Parallel execution is on the roadmap.

---

## Integration

### How do I sync results to TestRail?

**Answer:** Mobile Automator integrates with TestRail v1+. Setup during test generation:

```json
{
  "testrail": {
    "case_id": 1001,
    "project_id": 1,
    "case_url": "https://testrail.example.com/index.php?/cases/view/1001"
  }
}
```

**Requirements:**
- TestRail API enabled
- Test case exists in TestRail
- Run ID provided during execution
- Executor skill has TestRail credentials

After test execution, results are synced automatically if TestRail settings are configured in skill.

### What if TestRail sync fails?

**Cause:** API configuration or network issue.

**Solutions:**
1. **Verify API key** — Check executor skill has correct TestRail API key
2. **Check case exists** — Verify case ID in TestRail
3. **Check run exists** — Verify run ID is active
4. **Check network** — Ensure connectivity to TestRail server
5. **Check result format** — Ensure result JSON is valid

**Debug:**
```bash
# Check result structure
cat mobile-automator/results/run_*.json | jq '.testrail'

# Look for sync errors in skill output
```

### How do I integrate with CI/CD?

**Answer:** Mobile Automator works in CI/CD pipelines:

```bash
#!/bin/bash
# Setup (first time only)
gemini /mobile-automator:setup

# Generate scenarios (from natural language)
gemini /mobile-automator:generate

# Execute scenarios
gemini /mobile-automator:execute

# Check results
cat mobile-automator/results/latest.json | jq '.status'
```

**CI/CD Integration:**
- Install extension: `gemini extensions install <url>`
- Connect device in CI environment
- Run commands with proper error handling
- Archive result files as CI artifacts
- Sync to TestRail for reporting

### Can I use mobile-automator with GitHub Actions?

**Answer:** Yes! Example workflow:

```yaml
name: Mobile Tests
on: [push]

jobs:
  test:
    runs-on: macos-latest  # For iOS simulator
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'

      - name: Install Gemini CLI
        run: npm install -g @google-cloud/gemini-cli

      - name: Install mobile-automator
        run: gemini extensions install https://github.com/sh3lan93/mobile-automator

      - name: Setup
        run: gemini /mobile-automator:setup

      - name: Generate & Execute
        run: gemini /mobile-automator:execute

      - name: Upload Results
        uses: actions/upload-artifact@v3
        with:
          name: test-results
          path: mobile-automator/results/
```

---

## Performance & Optimization

### How do I make tests run faster?

**Answer:** Test execution speed depends on app, network, and device:

1. **Reduce waits** — Use shorter timeouts for fast-responding apps:
   ```json
   "timeout_seconds": 3  // Instead of 10
   ```

2. **Remove unnecessary assertions** — Only assert critical checks
3. **Optimize element selection** — Use unique, visible elements
4. **Test on faster device** — High-end device > low-end device
5. **Improve network** — Fast connection > slow connection
6. **Parallelize if possible** — Run multiple tests on different devices

**Benchmark:** Typical test scenario takes 10-60 seconds depending on app complexity.

### Are tests slower than manual testing?

**Answer:** Yes, typically 2-5x slower. Why?
- Screenshot analysis and AI vision
- Safe waits to avoid flakiness
- Detailed logging and assertions
- Result collection and reporting

**Trade-off:** Slower execution but:
- ✅ 100% reproducible
- ✅ Zero human error
- ✅ 24/7 availability
- ✅ Easy to scale to many tests

### How do I optimize for mobile devices with low memory?

**Answer:**
1. **Run tests individually** — Not in parallel
2. **Clear app cache** between tests:
   ```json
   {
     "preconditions": {
       "setup_actions": [
         {"type": "clear_app_data"}
       ]
     }
   }
   ```

3. **Reduce screenshot resolution** — Configure in executor skill
4. **Use lightweight assertions** — Text checks > visual analysis
5. **Close background apps** — Limit system load

---

## Troubleshooting

### General: "Extension not found" or command not available

**Cause:** Extension not installed or linked.

**Solutions:**
```bash
# Install extension
gemini extensions install https://github.com/sh3lan93/mobile-automator

# Or link local development version
cd /path/to/mobile-automator
gemini extensions link .

# Verify installation
gemini extensions list
```

### Device-Related Issues

**Android device not detected:**
```bash
# Check ADB connection
adb devices

# Authorize device if needed
adb devices  # Then tap "Allow" on device

# Kill and restart ADB
adb kill-server && adb start-server
```

**iOS device not detected:**
```bash
# Check Xcode setup
xcode-select --install

# List iOS devices/simulators
xcrun simctl list devices

# Ensure pairing if using real device
xcode-select -p
```

### App Installation Failures

**"App not installed" error:**
1. **Check build succeeded** — Try building manually first
2. **Check device space** — Free up device storage
3. **Check ADB permissions** — For Android, authorize device
4. **Check app signing** — For iOS, verify signing certificate
5. **Clear previous install** — Uninstall old version first

### MCP Server Issues

**"mobile-mcp not loading":**
```bash
# Test MCP server directly
npx -y @mobilenext/mobile-mcp@latest --version

# Check network connectivity
curl https://registry.npmjs.org/@mobilenext/mobile-mcp

# Update MCP version in gemini-extension.json
"args": ["-y", "@mobilenext/mobile-mcp@latest"]
```

### Connection & Network Issues

**"Connection timeout" or "Network error":**
1. **Check device connectivity** — Enable WiFi/USB debugging
2. **Check network speed** — Fast network needed for screenshots
3. **Check for proxy** — Configure if behind corporate proxy
4. **Restart device** — Sometimes helps with connectivity
5. **Use wired connection** — USB more stable than WiFi

### Memory & Performance Issues

**"Out of memory" or "Process killed":**
1. **Run one test at a time** — Not parallel
2. **Reduce screenshot resolution** — Smaller files
3. **Clear device cache** — Between test runs
4. **Close background apps** — Reduce system load
5. **Use smaller scenarios** — Fewer steps per test

### File & Path Issues

**"File not found" errors:**
```bash
# Check required directories exist
mkdir -p mobile-automator/{scenarios,results,screenshots}

# Check permissions
ls -la mobile-automator/

# Check git repo initialized (optional)
git init
```

**"Permission denied":**
```bash
# Fix directory permissions
chmod -R 755 mobile-automator/

# Fix file permissions
chmod 644 mobile-automator/scenarios/*.json
```

---

## Getting Help

Still stuck? We're here to help:

- **[Guides](guides/index.md)** — Step-by-step walkthroughs
- **[Examples](examples/index.md)** — Real-world test scenarios
- **[Reference Docs](reference/index.md)** — Complete specifications
- **[GitHub Issues](https://github.com/sh3lan93/mobile-automator/issues)** — Report bugs or ask questions

---

## Glossary

| Term | Definition |
|------|-----------|
| **Scenario** | A test definition in JSON format describing steps and assertions |
| **Step** | A single action (tap, type, wait, etc.) in a test scenario |
| **Assertion** | A verification check that passes/fails based on app state |
| **Element** | A UI component (button, text field, list, etc.) |
| **MCP** | Model Context Protocol — standard for tool integration |
| **Executor** | The skill that runs test scenarios and collects results |
| **Generator** | The skill that creates test scenarios from natural language |
| **Skill** | A Gemini CLI module with domain-specific logic |
| **Placeholder** | Template variable replaced during setup (e.g., `{{app_package}}`) |
| **Precondition** | Setup actions required before test runs |
| **Variable** | Named value that can be referenced in steps and assertions |

[Back to Docs →](index.md)
