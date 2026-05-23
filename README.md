# 🚀 Mobile Automator

> **The intelligent mobile QA extension that learns your app and writes tests for you.**

<div align="center">

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Android%20%7C%20iOS%20%7C%20Flutter%20%7C%20React%20Native-green.svg)](#)
[![Powered by](https://img.shields.io/badge/Powered%20by-mobile--mcp-orange.svg)](https://github.com/mobile-next/mobile-mcp)

</div>

---

## 🔀 Two Modes: Platform-Aware & Platform-Agnostic

Mobile Automator ships with two operating modes so you can match your testing strategy to your tech stack:

| Mode | Best for | How to enable |
|------|----------|---------------|
| **Platform-aware** (default) | Single-OS apps or tests that exercise OS-specific UI | Default — just run `/mobile-automator:setup` |
| **Platform-agnostic** | Cross-platform apps (Flutter, React Native, KMP, CMP) shipping to both Android and iOS | Select "platform-agnostic" at the Mode Selection step during setup |

### Platform-agnostic quick start

```bash
cd ~/projects/my-cross-platform-app
gemini

> /mobile-automator:setup
# When prompted at § 1.5 "Mode Selection", choose: platform-agnostic
```

Agnostic scenarios are portable — the same JSON runs on Android and iOS without modification. OS-shaped gestures (back navigation, keyboard dismissal, permission dialogs) are expressed as four semantic actions (`press_back`, `dismiss_keyboard`, `grant_permission`, `deny_permission`) that the executor resolves to the correct native primitive at runtime.

**Switching modes later:** Re-run `/mobile-automator:setup` and pick a different mode at § 1.5. Your previous skills are archived to `.gemini/skills/.archive/` and can be restored manually if needed (see [TROUBLESHOOTING.md](TROUBLESHOOTING.md)).

---

## 💡 Why Mobile Automator?

**The story behind this tool:**

Every Monday, I had **4 hours blocked on my calendar** for manual regression testing. Four hours. Every single week.

That's **208 hours a year** tapping through the same flows, checking the same screens, validating the same features. Over and over again.

I realized something had to change. **I refuse to repeat myself.** My time is too valuable to waste on tasks that can be automated.

So I built Mobile Automator—not just to run tests, but to **learn from my manual testing sessions** and replay them automatically. Now, those 4 hours are spent building features instead of repeating the same test flows.

**If you're tired of manual regression testing eating your calendar, this tool is for you.** 🎯

---

## ✨ What Makes This Special?

**Mobile Automator doesn't just run tests—it understands your app.**

When you run setup, it analyzes your codebase and automatically detects:
- 📱 **Platform & Architecture** - Android, iOS, Flutter, React Native, KMP, CMP
- 🏗️ **Architecture Pattern** - MVVM, Clean Architecture, BLoC, Redux, MVP
- 🎯 **Business Domain** - What your app actually does
- ⚡ **Loading Patterns** - Your specific progress indicators and shimmer effects
- 🔧 **Build Configuration** - Commands, flavors, environments
- 📦 **Package IDs** - Android applicationId, iOS Bundle Identifier

Then it generates **AI-powered testing skills** customized specifically for your project.

---

## 🎬 See It In Action

### 📝 Generate Test Scenarios

https://github.com/user-attachments/assets/6be4adce-4b30-45b1-a025-0e3373e30348

**What you see:**
- 🎮 Describe user flows in plain English
- 🤖 AI controls your device/emulator automatically
- 📸 Captures reference screenshots at each step
- ✍️ Generates structured JSON test scenarios

---

### ▶️ Execute Tests & Get Intelligent Reports

https://github.com/user-attachments/assets/fbc69108-0736-402c-846c-faca237fe4ca

**What you get:**
- ✅ Pass/fail status with detailed results
- 🔍 Regression detection (spots UI changes)
- ⚡ Flakiness detection (retries on transient failures)
- 🧠 Contextual insights (device differences, environment details)

---

## 🎯 Quick Start

### Prerequisites
- **Gemini CLI** installed ([Get it here](https://geminicli.com))
- **Mobile project** (Android, iOS, Flutter, React Native, KMP, or CMP)
- **Node.js** v16+ (for mobile-mcp automation engine)

### Installation

**From GitHub:**
```bash
gemini extensions install https://github.com/sh3lan93/mobile-automator
```

**Local Development:**
```bash
git clone https://github.com/sh3lan93/mobile-automator
cd mobile-automator
gemini extensions link .
```

### Setup Your Project

```bash
# Navigate to your mobile project
cd ~/projects/my-awesome-app

# Launch Gemini CLI
gemini

# Run setup
> /mobile-automator:setup
```

The setup wizard will guide you through:
1. ✅ **Platform Detection** - Identifies your tech stack
2. ✅ **Environment Discovery** - Finds staging, prod, dev configs
3. ✅ **App Package Inference** - Extracts bundle IDs
4. ✅ **Project Knowledge** - Learns your architecture and domain
5. ✅ **Skill Installation** - Generates customized testing skills
6. ✅ **Directory Scaffolding** - Creates test artifact structure

**After setup completes, reload skills:**
```bash
> /skills reload
```

**Output:**
```
mobile-automator/
├── config.json              # Project configuration
├── index.md                 # Documentation
├── scenarios/               # Generated test scenarios
├── screenshots/             # Reference screenshots
└── results/                 # Test execution reports

.gemini/skills/
├── mobile-automator-generator/   # Your custom test generator
└── mobile-automator-executor/    # Your custom test runner
```

### Generate Your First Test

```bash
> /mobile-automator:generate
```

When prompted, describe the test in natural language:

**Example 1: Login Flow**
```
1. Launch the app
2. Tap on "Login" button
3. Enter email: test@example.com
4. Enter password: Test123!
5. Tap "Sign In"
6. Validate user is logged in (shows profile icon)
```

**Example 2: Conversational Style**
```
fresh install -> user opens app -> wait for splash screen ->
validate bottom navigation shows 4 tabs: home, orders, offers, more
```

**What you get:**
- 📄 `mobile-automator/scenarios/login_flow.json` - Structured test scenario
- 📸 `mobile-automator/screenshots/login_flow/` - Reference screenshots
- ✅ Ready to execute on any device

### Execute Your Test

```bash
> /mobile-automator:execute login_flow
```

**You'll see:**
- ▶️ Real-time step execution on your device
- 📊 Pass/fail status for each assertion
- 🔍 Flakiness detection and retry logic
- 📸 Screenshot comparison with visual analysis
- 📝 Detailed failure reports with context

---

## 🏗️ Supported Platforms

| Platform | Detection | Build Commands | Device Control |
|----------|-----------|----------------|----------------|
| **Android** | ✅ Native, Gradle | `./gradlew assembleDebug` | ✅ Emulator + Real Device |
| **iOS** | ✅ Native, Xcode | `xcodebuild -scheme MyApp` | ✅ Simulator + Real Device |
| **Flutter** | ✅ Cross-platform | `flutter build apk/ios` | ✅ All platforms |
| **React Native** | ✅ Metro bundler | `npx react-native run-android/ios` | ✅ All platforms |
| **Kotlin Multiplatform** | ✅ KMP structure | `./gradlew assembleDebug` | ✅ Android + iOS |
| **Compose Multiplatform** | ✅ CMP structure | Gradle + Xcode | ✅ Android + iOS |

---

## 🧠 Intelligent Features

### 1. Architecture Pattern Detection
Mobile Automator scans your codebase and recognizes:
- **MVVM** (ViewModel, LiveData patterns)
- **Clean Architecture** (domain, data, presentation layers)
- **BLoC** (Flutter - Business Logic Component)
- **Redux/MVI** (reducer, store, actions)
- **MVP/VIPER** (presenter, interactor patterns)

**Why it matters:** Skills are tailored to your architecture's naming conventions.

### 2. Loading Indicator Auto-Detection
Greps your source code for:
- Android: `CircularProgressIndicator`, `ShimmerEffect`, `ProgressBar`
- iOS: `UIActivityIndicatorView`, `ProgressView`, `SkeletonView`
- Flutter: `CircularProgressIndicator`, `Shimmer`
- React Native: `ActivityIndicator`, `SkeletonPlaceholder`

**Why it matters:** Tests automatically wait for your specific loading patterns.

### 3. Flakiness Detection & Diagnosis
When tests fail, the executor:
- 🔄 **Retries once** on suspected timing issues
- 📊 **Flags flaky tests** with retry count
- 🧪 **Analyzes root cause**: loading delay, animation, network dependency
- 💡 **Suggests fixes**: "Consider adding explicit wait for this step"

### 4. State-Aware Failure Analysis
Failed assertions include context:
- 🌓 Dark mode vs light mode mismatch
- 📱 Device differences (Pixel 6 vs Pixel 8)
- 🌐 Network state (WiFi vs cellular)
- ⌨️ Keyboard visibility
- 🔄 Orientation differences

### 5. Semantic Visual Testing
Instead of brittle pixel-matching:
> "Does this screen fulfill the same purpose as the reference?"

Uses AI vision to compare screenshots semantically, not pixel-by-pixel.

---

## 📋 Commands Reference

| Command | Description | Usage | What It Does |
|---------|-------------|-------|--------------|
| **`/mobile-automator:setup`** | One-time setup - analyzes project and installs testing skills | `> /mobile-automator:setup` | • Detects platform (Android/iOS/Flutter/React Native/KMP/CMP)<br>• Discovers build environments (staging, production, etc.)<br>• Infers app package IDs from build files<br>• Analyzes architecture patterns and business domain<br>• Installs customized QA skills<br>• Creates `mobile-automator/` test directory<br>• **Resume support:** If interrupted, run again to resume |
| **`/mobile-automator:generate`** | **Record** test scenarios from natural language (do this once per test) | `> /mobile-automator:generate`<br><br>Options:<br>• `--set-environment="X"` (use X and save as default)<br>• `--environment="X"` (one-time override, no save) | • Connects to your device/emulator<br>• Asks for environment once, saves preference for future runs<br>• Prompts for test steps in natural language<br>• Executes steps on device while recording<br>• Captures reference screenshots<br>• Generates JSON scenario file<br>**Output:** `mobile-automator/scenarios/<scenario_id>.json` |
| **`/mobile-automator:execute`** | **Replay** saved test scenarios (run repeatedly for regression testing) | `> /mobile-automator:execute <scenario_id>`<br><br>Examples:<br>• Single: `execute login_flow`<br>• Multiple: `execute login_flow checkout_flow`<br>• All: `execute --all`<br>• Interactive: `execute`<br><br>Options:<br>• `--device="id"` (specify device) | • Replays scenario steps on connected device<br>• Captures actual screenshots for comparison<br>• Validates assertions (element exists, text matches, visual state)<br>• Detects flakiness and retries automatically<br>• Generates detailed pass/fail report with diagnostics<br>**Output:** `mobile-automator/results/<run_id>.json` |
| **`/mobile-automator:list-tags`**| Lists all tags currently used in test scenarios | `> /mobile-automator:list-tags` | • Scans all JSON scenarios<br>• Displays tag counts<br>• Differentiates standard vs custom tags |
| **`/mobile-automator:report`** | Generate aggregated test reports | `> /mobile-automator:report`<br><br>Options:<br>• `--last N` (default 10)<br>• `--format table\|json\|html`<br>• `--junit` (JUnit XML) | • Aggregates all test results<br>• Shows pass rate, flaky steps, failures<br>• Exports to JSON, HTML, or JUnit XML<br>**Output:** `mobile-automator/results/report.{json,html,xml}` |

## 🏷️ Tag-Based Filtering

Mobile Automator supports tagging scenarios logically (e.g. `smoke`, `regression`, `critical`) so you can execute specific subsets of your test suite.

### Adding Tags
During scenario generation (`/mobile-automator:generate`), the agent will ask you what tags describe the scenario before saving it. You can also manually add tags to the `scenario.json` file:

```json
{
  "$schema_version": "2.0",
  "scenario_id": "login_flow",
  "tags": ["smoke", "auth", "p0"],
  // ...
}
```

### Filtering Executions
Use the `--tag` parameter with `/mobile-automator:execute` to filter runs:

- **Single tag:** `/mobile-automator:execute --tag smoke`
- **Multiple tags (AND):** `/mobile-automator:execute --tag smoke,critical` (matches scenarios with BOTH tags)
- **Multiple tags (OR):** `/mobile-automator:execute --tag smoke|regression` (matches scenarios with ANY tag)
- **Exclude tags (NOT):** `/mobile-automator:execute --tag !flaky` (excludes scenarios with this tag)

If you run `/mobile-automator:execute` without arguments, the interactive menu will automatically group your scenarios by their primary tag.

### Selecting a Specific Device
Use the `--device` parameter if you have multiple devices connected and want to bypass the interactive device selection prompt:
```bash
> /mobile-automator:execute login_flow --device="emulator-5554"
```

### Standard Tag Registry
We recommend standardizing on these common tags:
- `smoke`: Quick validation of critical paths
- `regression`: Full feature validation
- `critical`, `p0`, `p1`: Priority levels
- `fast`, `slow`: Execution time indicators
- `flaky`: Network/timing dependent tests
- `wip`: Under development

---

### 📝 The Workflow

1. **Generate once** - Use `/mobile-automator:generate` to record test scenarios by performing actions on your device
2. **Execute many times** - Use `/mobile-automator:execute` to replay those scenarios automatically across devices/builds

---

## 📂 Project Structure

After setup, your project will have:

```
your-mobile-project/
├── mobile-automator/                    # Test artifacts directory
│   ├── config.json                     # Auto-generated project config
│   ├── index.md                        # Documentation
│   ├── scenarios/                      # Test scenario JSON files
│   │   ├── login_flow.json
│   │   └── checkout_flow.json
│   ├── screenshots/                    # Reference screenshots
│   │   ├── login_flow/
│   │   │   ├── step_launch_app.png
│   │   │   └── step_tap_login.png
│   │   └── checkout_flow/
│   └── results/                        # Test execution results
│       ├── run_20250212_143022.json
│       └── run_20250212_143022/
│           └── screenshots/
│
└── .gemini/
    └── skills/                         # Generated testing skills
        ├── mobile-automator-generator/
        │   ├── SKILL.md               # Customized for YOUR project
        │   └── references/
        │       └── scenario_schema.json     # Test scenario schema
        └── mobile-automator-executor/
            ├── SKILL.md               # Customized for YOUR project
            └── references/
                └── result_schema.json
```

---

## 🔬 How It Works

### The 3-Tier Architecture

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

**Why this design?**
- ✅ **Separation of concerns** - infrastructure vs domain logic
- ✅ **Project-specific skills** - tailored to your app
- ✅ **Portable automation** - works across platforms

---

## 🎨 Test Scenario Schema

Test scenarios are JSON files stored in `mobile-automator/scenarios/`. Key fields:

- **`$schema_version`**: `"2.0"` — required, enables version routing
- **`scenario_id`**: Unique identifier (snake_case)
- **`name`**: Human-readable description
- **`platform`**: `"android"` | `"ios"` | `"cross-platform"`
- **`variables`**: Named variables for capturing dynamic values across steps
- **`preconditions`**: Structured object — `app_state`, `device_actions`, `device_properties`
- **`steps`**: Array of actions — each step has a **named string `id`** (e.g., `"tap_login"`), plus:
  - 14 action types: `launch_app`, `tap`, `long_press`, `double_tap`, `type`, `swipe`, `scroll_to_element`, `press_button`, `open_url`, `wait_for_element`, `wait_for_element_gone`, `wait_for_loading_complete`, `capture_value`, `clear_app_data`
  - `optional: true` + `on_failure: "skip"` — for non-deterministic UI elements (dialogs, banners)
  - `condition` — execute step only when a device property or runtime condition is met
  - `retry_policy` — retry on transient failures before marking the step as failed
  - `capture_to` — store a dynamic value for later assertion
  - `sub_steps` — nested conditional sub-flow
  - `wait_config` — smart wait parameters (`type`, `indicator`, `timeout_ms`)
- **`assertions`**: Validation rules — each has a **named string `id`** and references its step by name (`after_step`):
  - 9 types: `element_exists`, `element_not_exists`, `element_text`, `screenshot_match`, `pattern_match`, `value_matches_variable`, `element_count`, `visual_state`, `text_changed`

Generated scenarios are project-specific and include your app's context (business domain, key features).

---

## 🧪 Recording scenarios (experimental)

> 🧪 **Feature-complete, gated as experimental.** The recorder shipped in v0.12.0 as a soft launch — every slice of [PRD #21](https://github.com/sh3lan93/mobile-automator/issues/21) is on `main`, but the command stays behind an opt-in env var while it gets real-world mileage. File rough edges against [#21](https://github.com/sh3lan93/mobile-automator/issues/21).

### What is recording?

Instead of describing each step in natural language for `/mobile-automator:generate`, the recorder lets you **capture user interactions on a device and have the AI synthesize a scenario JSON from the captured trace**. You drive the app the way a real user would; an in-browser GUI shows the steps materialising in real time; on **Save & Generate** the AI synthesises a schema-conformant scenario JSON to `mobile-automator/scenarios/<scenario_name>.json` — the same format that `/mobile-automator:generate` produces and that `/mobile-automator:execute` replays.

### Opt in

The command is hidden until you set the env-var gate:

```bash
export MOBILE_AUTOMATOR_RECORDER=1
```

With the gate off, behaviour is identical to v0.11.0 — `/mobile-automator:record` is not registered, the setup install loop skips the recorder skill, and nothing else changes.

### Requirements

- **Node ≥ 18** — required by the local sidecar (`commander`, `ws`, `pngjs` are installed by `gemini extensions install`).
- **`ffmpeg` on your `PATH`** — used to extract per-frame PNGs from the screen recording captured during a session. The command halts cleanly with an install hint before spawning the sidecar if `ffmpeg` is missing.
- **A connected device** — Android emulator, Android physical device, or iOS Simulator. iOS physical devices are out of scope.
- **`adb` on your `PATH`** (Android only, optional) — used to capture hardware-key events (`BACK`, `HOME`, `VOLUMEUP`, `VOLUMEDOWN`, `POWER`). The recorder degrades gracefully if `adb` is absent: a one-line warning prints and hardware-key capture is disabled for the session; gesture capture is unaffected.

```bash
# macOS (Homebrew)
brew install ffmpeg

# Debian / Ubuntu
sudo apt-get install ffmpeg

# Arch Linux
sudo pacman -S ffmpeg

# Other / manual
# https://ffmpeg.org/download.html
```

Confirm with `ffmpeg -version`.

### Quick start

```bash
MOBILE_AUTOMATOR_RECORDER=1 gemini

> /mobile-automator:record login_flow
```

A typical session looks like:

1. The command pre-flights config, device, app install, and environment, then opens your default browser to a localhost recorder GUI.
2. You interact with the device. Each tap, type, long-press, double-tap, swipe, and hardware-key press appears in the GUI's step list as it's captured.
3. At any moment you can click **Add Assertion** to capture a verification — a fresh device screenshot is taken, you describe the expected outcome in natural language (*"welcome message appears"*), and the assertion is anchored to the most-recent step.
4. You can **rename**, **delete** (with confirm), **edit a typed value**, or **edit an assertion text** on any step before Save. Reorder, insert, and arbitrary action-type changes are deliberately not allowed — every step's element identity comes from the hierarchy snapshot taken at capture time.
5. Click **Save & Generate**. The recorder skill ingests the artifact bundle, applies the existing generator skill's rules, and writes the scenario JSON. **Cancel** discards everything.

The resulting scenario runs via `/mobile-automator:execute` exactly like one produced by `/mobile-automator:generate`.

### Flags

| Flag | Default | Effect |
|------|---------|--------|
| `--mode=b\|c3` | `b` | Capture mechanism. **Mode B** (default) uses screen recording + UI hierarchy polling + `adb getevent` for hardware keys. **Mode C3** waits 10 s for an instrumentation SDK to connect over loopback TCP, then falls back to Mode B if none does. The C3 protocol contract is documented at [`templates/references/c3-protocol.md`](templates/references/c3-protocol.md); SDKs ship in v1.1. |
| `--preconditions-modal` | off | Opens a modal before recording begins so you can declare the initial app state (e.g. *"fresh install"*, *"logged out"*) as a structured precondition on the resulting scenario. |
| `--allow-sensitive-input` | off | Suppresses the inline caution markers and Save-time confirmation for sensitive fields. Useful when fixture credentials are intentionally hardcoded. The bullet-mask on display still applies. |
| `--verify` | off | After a successful Save, immediately replays the scenario via `/mobile-automator:execute`. Off by default because non-idempotent flows (login OTPs, payments) must not auto-replay. Verify failure preserves the scenario JSON and points you back at `/mobile-automator:execute`. |
| `--overwrite` | off | Required when re-recording an existing scenario name. Prior screenshots are archived to `mobile-automator/screenshots/.archive/<name>-<timestamp>/` on Save; the new screenshots only promote when Save succeeds. |

### What gets captured

**Gesture vocabulary (Mode B, v1.0):**

- `tap` — primary single-touch.
- `long_press` — touch held ≥ 500 ms.
- `double_tap` — two taps within 300 ms at the same coordinates.
- `swipe` — path with displacement > 50 px; direction (`up`/`down`/`left`/`right`) is carried in the scenario step's `value` field.
- `type` — keyboard input coalesced per focused field. Tabs out of focus, an Enter press, 1500 ms of silence, or session-end all flush the buffer into a single `type` event.
- `press_button` — Android hardware keys via `adb shell getevent -lt` (`BACK`, `HOME`, `VOLUMEUP`, `VOLUMEDOWN`, `POWER`). iOS hardware keys are not supported (no equivalent stream).

Multi-touch gestures (pinch, rotate, two-finger pan) are out of scope.

**Assertions:**

The **Add Assertion** modal opens with a fresh device screenshot. You type the assertion in natural language; on Save the AI runs the same two-pass classifier used by `/mobile-automator:generate` to convert your text into a schema-typed assertion (any of the 27 assertion types). Visual-state assertions also carry a `reference_screenshot` path pointing at the captured PNG.

**Edit affordances:**

Each step row has a `⋯` menu offering type-filtered actions:

- **Rename** (any step) — change the display label; the underlying `step_id` slug is regenerated.
- **Delete** (any step, with confirm) — anchored assertions get a 3-option prompt: re-anchor to next surviving step (default), cascade-delete with the step, or cancel.
- **Edit value** (`type` steps only) — fix typos or replace literal credentials with a `${env.VAR}` reference.
- **Edit text** (assertion rows only) — refine ambiguous NL phrasing before classification runs at Save.

### Mode awareness

The recorder respects the `mode` set in `mobile-automator/config.json`:

- **Platform-aware** — captures OS-literal actions. iOS nav-bar back is a literal tap on the Back button. Android BACK key is a literal `press_button` step.
- **Platform-agnostic** — semantic actions are auto-detected so the resulting scenario works on both OSs:
  - **`press_back`** — Android BACK key release or iOS left-edge right-swipe.
  - **`grant_permission`** / **`deny_permission`** — taps on system permission-dialog Allow/Deny buttons, identified by the Android `permissioncontroller`/`systemui` resource-ids or iOS `_UIAlertController` class with exact-label match against [`templates/references/platform-resolutions.md`](templates/references/platform-resolutions.md).
  - **`dismiss_keyboard`** — **manual only**. The agnostic-mode GUI surfaces a *Mark as dismiss_keyboard* item in any tap row's `⋯` menu. Auto-detection heuristics for keyboard dismiss are too lossy to ship.

A banner in the agnostic-mode GUI reminds you that element names must work on both OSs.

### Sensitive input handling

The recorder detects password fields (Android `inputType=textPassword` / iOS `XCUIElementTypeSecureTextField`, `accessibility_traits` containing `secureTextField`, or `secureTextEntry: true`) and marks captured `type` events with `sensitive: true`. In the GUI:

- The typed value is **masked with bullet characters** in the step list, never the literal — even before Save.
- A **⚠ caution marker** sits next to the masked value with the tooltip *"Sensitive input. Click to edit value before Save."*
- On **Save & Generate**, if any flagged step still holds its captured literal, the GUI prompts inline: *"N sensitive step(s) captured as literal value(s). Save anyway?"* You must confirm or cancel before the scenario is generated.
- Clicking **Edit value** on a flagged step's `⋯` menu clears its caution marker. The typical replacement is `${env.PASSWORD}` (or any `${env.VAR}`) syntax.

`${env.VAR}` is a **runtime convention enforced by the executor**, not a schema construct — the recorder neither validates nor substitutes references; whether your test runner resolves `${env.PASSWORD}` at replay time is your responsibility.

For users with intentionally-hardcoded test fixtures, `--allow-sensitive-input` suppresses both the marker and the Save-time prompt (the value-masking is unaffected — that always applies once `sensitive: true` reaches the renderer).

### Failure modes

| Failure | Behaviour |
|---------|-----------|
| **Device disconnect** | Hard fail after 3 consecutive capture failures within a 5 s rolling window. Sidecar broadcasts a non-dismissible banner, runs cleanup, exits **code 2**. Recording is purely apparatus — no salvage. |
| **App crash** | Detected by `mobile_get_crash` polling every 5 s. The crash log is dual-written to `<artifacts>/crashes/<ts>.log` (included in save-partial) and `mobile-automator/crash-logs/<scenario_id>-<ts>.log` (persists across discard). A sticky modal offers three choices: **Relaunch + resume**, **Save partial**, **Discard**. |
| **Browser disconnect** | 60 s reconnect window. Reattaching the tab resumes the session unchanged; timing out is treated as cancel (exit **130**) and artifacts are cleaned up. |
| **Cancel** | Intentional Cancel deletes the entire `mobile-automator/.recorder/<scenario_id>/` tree — no draft files accumulate. |

### Verifying a recording

`--verify` is opt-in:

```bash
> /mobile-automator:record checkout_flow --verify
```

After Save, the executor skill replays the just-written scenario against the same device. **Do not pass `--verify` for non-idempotent flows** — login OTPs, one-shot payment links, and email-send actions cannot safely auto-replay. Verify failure preserves the scenario JSON and points you at `/mobile-automator:execute` for diagnosis; it never rolls back the Save.

### Current limitations

- **iOS physical devices** — not supported in v0.12.0. iOS Simulator is fully supported.
- **Multi-touch gestures** (pinch, rotate, two-finger pan) — deferred. Mode B's single touch indicator can't see two simultaneous touches as two paths.
- **C3 instrumentation SDKs** — the protocol contract ships in v0.12.0 (see [`templates/references/c3-protocol.md`](templates/references/c3-protocol.md)); the iOS Swift Package and Android AAR are v1.1 work.
- **Resume-from-draft** after intentional cancel or browser-disconnect timeout — device state moves on between sessions and a half-recording can't be cleanly re-attached.
- **Reorder / insert / arbitrary action-type change** — deliberately not surfaced. Every step's element identity is tied to its hierarchy snapshot at capture time.
- **First-run tutorial inside the GUI** — v0.12.0 ships this README plus a CLI tip; an in-product tutorial is not included.
- **Localization** — the GUI is English-only in v0.12.0.

---

## 🐛 Troubleshooting

For common issues and solutions, see **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)**.

---

## 🤝 Contributing

Contributions are welcome! This project is open source under Apache 2.0 license.

**Areas for contribution:**
- Additional platform support
- Enhanced architecture pattern detection
- More assertion types
- CI/CD integrations
- Visual regression testing improvements

---

## 📄 License

Apache License 2.0 - See [LICENSE](LICENSE) for details.

---

## 🙏 Acknowledgments

- **[Conductor](https://github.com/gemini-cli-extensions/conductor)** - Inspired the generator pattern and structured workflow approach
- **[mobile-mcp](https://github.com/mobile-next/mobile-mcp)** - The automation engine powering device control
- **Gemini CLI** - The AI-powered CLI platform

---

<div align="center">

**Built with ❤️ for mobile QA engineers**

[Report Bug](https://github.com/sh3lan93/mobile-automator/issues) · [Request Feature](https://github.com/sh3lan93/mobile-automator/issues) · [Documentation](https://github.com/sh3lan93/mobile-automator)

</div>
