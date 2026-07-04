---
description: "Frequently asked questions and troubleshooting for mobile-automator - setup issues, device detection, test generation, and execution problems."
---

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

**Answer:** mobile-automator is a host-agnostic `mauto` CLI that lets **any** AI coding agent generate and execute mobile tests using natural language. Instead of writing tests manually in Appium, XCTest, or Espresso, you describe what you want to test in simple language; your agent drives the device through `mauto` verbs (which wrap [mobile-mcp](https://github.com/mobile-next/mobile-mcp)) to author JSON test scenarios and replay them automatically.

**Key point:** It's NOT a direct testing tool like Selenium or Appium. It splits the work into a **brain** (your AI agent, which decides *what* to do) and **hands** (`mauto` verbs, which perform deterministic actions). Any agent — Claude Code, Cursor, Gemini CLI, GitHub Copilot, OpenAI Agents, or any MCP-capable agent — can be the brain.

### How is mobile-automator different from Appium/XCTest/Espresso?

| Aspect | mobile-automator | Traditional Frameworks |
|--------|---|---|
| **Test Language** | Natural language descriptions | Code (Java, Python, Swift, Kotlin) |
| **Selector Strategy** | Visible text + role + coordinates | Hard-coded IDs/XPaths |
| **Wait Strategy** | Automatic with intelligent retries | Manual explicit waits |
| **Domain Knowledge** | Auto-detected from project | Embedded in test code |
| **Portability** | One scenario runs on Android & iOS | Per-platform test suites |
| **Learning Curve** | Minimal (describe in words) | Steep (framework-specific) |
| **Maintenance** | Scenarios are plain JSON | Manual test updates |
| **Test Speed** | Optimized for clarity, not performance | Optimized for speed |

### Do I need to write code?

**Answer:** No. Tests are described in plain English. Your agent converts them to JSON scenarios and drives the device through `mauto` verbs. You never touch code unless you want to hand-edit a scenario.

**Example flow:**
```text
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

### When should I use agnostic vs aware mode?

**Answer:** Choose **platform-agnostic** when your app ships to both Android and iOS from a shared codebase (Flutter, React Native, Kotlin Multiplatform, Compose Multiplatform) and you want a single set of test scenarios that run on either platform without modification.

Choose **platform-aware** when:
- Your project targets only one OS (pure Android or pure iOS native app)
- Your tests intentionally exercise OS-specific behaviour or UI patterns
- You have a legacy project already configured in aware mode and you don't need cross-platform portability

In practice: if you are using Flutter, React Native, KMP, or CMP, start with agnostic. For native Android-only or iOS-only apps, use aware.

### How do I choose a mode for a new project?

**Answer:** Set the mode when you scaffold the workspace with `mauto setup`:

```bash
mauto setup                 # platform-aware (default)
mauto setup --mode agnostic # platform-agnostic
```

The chosen mode is stored as `mode` in `mobile-automator/config.json` (read it back with `mauto config get mode`). In agnostic mode, OS-shaped gestures become four semantic actions — `press_back`, `dismiss_keyboard`, `grant_permission`, `deny_permission` — resolved to the right native primitive at runtime, so one scenario covers both platforms.

### What is the `$schema_version` field?

**Answer:** Every test scenario JSON file includes a `$schema_version` field (currently `"2.1"`) as its first field. This enables version detection for schema evolution. All scenarios must include this field.

### Can I use mobile-automator with my existing tests?

**Answer:** Partially. If you have:
- **Appium/Espresso/XCTest tests** → No direct import, but use mobile-automator for *new* tests
- **Custom test infrastructure** → Yes, mobile-automator complements existing tools

Best approach: Run mobile-automator alongside existing tests for new features.

---

## Setup & Installation

### How do I install mobile-automator?

**Answer:** `mauto` is installed from source (not yet on npm):

```bash
git clone https://github.com/sh3lan93/mobile-automator
cd mobile-automator
npm install && npm link        # exposes `mauto` globally
```

Then, from your mobile project, wire it into your agent and scaffold the workspace:

```bash
cd /path/to/mobile-project
mauto init --agent claude      # or: cursor | gemini | copilot | agents | all
mauto setup                    # add --mode agnostic for cross-platform apps
mauto devices                  # confirm a device is visible
```

See the [installation guide](getting-started/installation.md) for full details.

### Setup failed. What do I do?

**Answer:** If `mauto setup` fails:

1. **Check the error message** — Note what went wrong (e.g., a missing package ID, no detectable platform)
2. **Fix the issue** — Provide the value when prompted, or pass it explicitly
3. **Re-run `mauto setup`** — It rescaffolds the workspace
4. **Verify completion** — Check that `mobile-automator/config.json` was created (`mauto config get mode`)

The workspace state lives entirely in `mobile-automator/config.json`; there is no separate resume file to clean up.

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
```text
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

### "Agent skills weren't installed" — Why?

**Cause:** `mauto init` didn't write the Agent Skills into your host's skills directory.

**Solutions:**
1. **Re-run init for your agent** — `mauto init --agent claude` (or `cursor | gemini | copilot | agents | all`)
2. **Check the skills directory** — Confirm the files landed in your host's skills dir:
   ```bash
   # examples per host
   ls -la .claude/skills/
   ls -la .cursor/skills/
   ls -la .gemini/skills/
   ```
3. **Verify the workspace config** — `mauto config get mode` should return your mode
4. **For Claude Code / Cursor**, confirm `init` also wrote the command files and MCP entry:
   ```bash
   ls -la .claude/commands/ .mcp.json
   ```

---

## Test Generation

### How do I generate a test scenario?

**Answer:**
1. Ensure setup is complete: `mobile-automator/config.json` exists
2. Confirm a device is visible: `mauto devices` (pin one with `mauto devices use <id>` if needed)
3. From inside your agent, launch the generate workflow:
   - **Claude Code:** `/mobile-automator-generate`
   - **Cursor:** ask in plain language (e.g. *"generate a login test"*)
   - **Any other agent:** `mauto mcp` (MCP prompts) or `mauto guide generate` + call verbs directly
4. Describe your test in natural language when prompted
5. Review the generated JSON in `mobile-automator/scenarios/`

**Example prompt:**
```text
Describe the test scenario:
> User logs in with email and password, verifies dashboard loads
```

Generated: `mobile-automator/scenarios/login_happy_path.json`

### "Element not found when generating" — What does this mean?

**Cause:** The agent couldn't find an element you described on the current screen.

**Solutions:**
1. **Check app state** — Ensure app is in the right state (logged out for login test)
2. **Be more specific** — Use visible text or position: "Blue login button in bottom right"
3. **Use element labels** — Reference the element's accessibility label if available
4. **Check if element exists** — Take a screenshot manually (`mauto screenshot <path>`) to verify
5. **Use alternative references** — Describe location: "Button below password field"

### "Generator misinterpreted my intent" — How do I fix it?

**Answer:** You can edit the generated JSON directly:

1. **Review generated scenario** — Check `mobile-automator/scenarios/`
2. **Edit JSON manually** — Fix targets, actions, assertions
3. **Validate schema** — Run `mauto validate <file>` (see the [schema reference](reference/schema.md))
4. **Re-execute** — Run the execute workflow with the corrected scenario

**Common edits:**
- Adjust the target's visible text or role
- Add/remove assertions
- Adjust timeout values
- Add wait steps before actions

### Can I generate tests for multiple platforms?

**Answer:** Yes. If you set up in **platform-agnostic** mode (`mauto setup --mode agnostic`), a single scenario runs on both Android and iOS — OS gestures resolve to the four semantic actions at replay time.

In **platform-aware** mode, generate a scenario on each platform separately and mark the `platform` field (`"android"` or `"ios"`) to capture platform-specific behaviors.

### How do I parameterize tests (different data)?

**Answer:** Use the `variables` section in scenarios:

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
      "text": "{{test_email}}"
    }
  }
}
```

For running with different values, manually edit the JSON or wire the values in from your CI pipeline.

---

## Test Execution

### How do I execute a test scenario?

**Answer:** From inside your agent, launch the execute workflow:

- **Claude Code:** `/mobile-automator-execute`
- **Cursor:** ask in plain language (e.g. *"execute the login scenario"*)
- **Any other agent:** `mauto mcp` (MCP prompts) or `mauto guide execute` + call verbs directly

The agent then:
1. **Selects a scenario** — from `mobile-automator/scenarios/`
2. **Confirms the device** — uses the pinned/visible device (`mauto devices`)
3. **Confirms app installation** — builds/installs if needed
4. **Runs the test** — executes all steps and assertions

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
3. **Check the target** — Verify you're using the element's visible text/role
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
4. **Add debug screenshot** — Insert a capture step to see actual state:
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
   mauto devices      # confirm the device is still visible
   adb devices        # Android
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

### How do I integrate with CI/CD?

**Answer:** mobile-automator works in CI/CD pipelines. The agent drives `mauto` verbs directly via `mauto bootstrap` + `mauto guide <topic>`, or you script the verbs yourself:

```bash
#!/bin/bash
# Install mauto from source (first time only)
git clone https://github.com/sh3lan93/mobile-automator
( cd mobile-automator && npm install && npm link )

# Wire into the project + scaffold the workspace (first time only)
mauto init --agent agents
mauto setup

# Confirm a device is visible
mauto devices

# Validate a scenario before running it
mauto validate mobile-automator/scenarios/login_flow.json

# (Your agent replays the scenario via mauto guide execute + verbs.)

# Check results
cat mobile-automator/results/latest.json | jq '.status'
```

**CI/CD tips:**
- Cache `node_modules` so `npm install` is fast on subsequent runs
- Connect a device or boot an emulator/simulator in the CI environment
- Run `mauto` verbs with `--human` off (the default JSON envelope is machine-readable)
- Archive result files as CI artifacts

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

      - name: Install mauto from source
        run: |
          git clone https://github.com/sh3lan93/mobile-automator /tmp/mobile-automator
          cd /tmp/mobile-automator
          npm install && npm link

      - name: Wire into project & scaffold workspace
        run: |
          mauto init --agent agents
          mauto setup

      - name: Check device is visible
        run: mauto devices

      - name: Validate scenarios
        run: mauto validate mobile-automator/scenarios/login_flow.json

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

1. **Reduce waits** — Use shorter timeouts for fast-responding apps (e.g., `"timeout_seconds": 3` instead of 10)
2. **Remove unnecessary assertions** — Only assert critical checks
3. **Optimize element selection** — Use unique, visible targets
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

3. **Reduce screenshot resolution** — Configure in the workspace config
4. **Use lightweight assertions** — Text checks > visual analysis
5. **Close background apps** — Limit system load

---

## Troubleshooting

### "mauto: command not found"

**Cause:** `mauto` isn't on your PATH.

**Solutions:**
```bash
# Re-run the link from the cloned repo
cd /path/to/mobile-automator
npm install && npm link

# Verify
which mauto
mauto --help
```

### Device-Related Issues

**No device shown by `mauto devices`:**
```bash
# Android: check ADB connection
adb devices
adb kill-server && adb start-server

# iOS: list simulators/devices
xcrun simctl list devices
```

Pin a specific device once it appears:
```bash
mauto devices use <id>     # mauto devices clear to unpin
```

### App Installation Failures

**"App not installed" error:**
1. **Check build succeeded** — Try building manually first
2. **Check device space** — Free up device storage
3. **Check ADB permissions** — For Android, authorize device
4. **Check app signing** — For iOS, verify signing certificate
5. **Clear previous install** — Uninstall old version first

### MCP / Automation Engine Issues

**"mobile-mcp not loading":**

mobile-mcp is pinned as a dependency of `mauto` and resolved from `node_modules` at runtime — it is never fetched on the fly.

```bash
# Reinstall dependencies from the cloned repo
cd /path/to/mobile-automator
npm install

# Confirm the pinned engine is present
ls node_modules/@mobilenext/mobile-mcp

# Re-verify the device path end-to-end
mauto devices
```

If you need a newer engine, bump the `@mobilenext/mobile-mcp` pin in the repo's `package.json` and re-run `npm install`.

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
# Re-scaffold the workspace if directories are missing
mauto setup

# Check the workspace exists
ls -la mobile-automator/
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
| **Element** | A UI component (button, text field, list, etc.) targeted by visible text + role + coordinates |
| **Verb** | A `mauto` command (`tap`, `type`, `swipe`, `assert`, …) that performs a deterministic action and emits the `{ok,data,error,hint,schema_version}` envelope |
| **MCP** | Model Context Protocol — standard for tool integration; `mauto mcp` exposes the workflows as prompts |
| **Agent Skill** | A native skill `mauto init` installs into a host's skills directory so the agent knows the generate/execute/setup workflows |
| **Mode** | `platform-aware` (default) or `platform-agnostic`, chosen at `mauto setup` and stored in `mobile-automator/config.json` |
| **Semantic action** | One of `press_back`, `dismiss_keyboard`, `grant_permission`, `deny_permission` — resolved to a native primitive at replay time (agnostic mode) |
| **Placeholder** | Template variable replaced when guide content is emitted (e.g., `{{app_package}}`) |
| **Precondition** | Setup actions required before a test runs |
| **Variable** | Named value that can be referenced in steps and assertions |

[Back to Docs →](index.md)
