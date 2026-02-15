# 🚀 Mobile Automator

> **The intelligent mobile QA extension that learns your app and writes tests for you.**

<div align="center">

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Android%20%7C%20iOS%20%7C%20Flutter%20%7C%20React%20Native-green.svg)](#)
[![Powered by](https://img.shields.io/badge/Powered%20by-mobile--mcp-orange.svg)](https://github.com/mobile-next/mobile-mcp)

</div>

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
| **`/mobile-automator:generate`** | **Record** test scenarios from natural language (do this once per test) | `> /mobile-automator:generate` | • Connects to your device/emulator<br>• Prompts for test steps in natural language<br>• Executes steps on device while recording<br>• Captures reference screenshots<br>• Generates JSON scenario file<br>**Output:** `mobile-automator/scenarios/<scenario_id>.json` |
| **`/mobile-automator:execute`** | **Replay** saved test scenarios (run repeatedly for regression testing) | `> /mobile-automator:execute <scenario_id>`<br><br>Examples:<br>• Single: `execute login_flow`<br>• Multiple: `execute login_flow checkout_flow`<br>• All: `execute` (interactive) | • Replays scenario steps on connected device<br>• Captures actual screenshots for comparison<br>• Validates assertions (element exists, text matches, visual state)<br>• Detects flakiness and retries automatically<br>• Generates detailed pass/fail report with diagnostics<br>**Output:** `mobile-automator/results/<run_id>.json` |

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
│   │   │   ├── step_1.png
│   │   │   └── step_2.png
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
        │       └── scenario_schema.json
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

Test scenarios are JSON files stored in `mobile-automator/scenarios/` with the following structure:

- **scenario_id**: Unique identifier (snake_case)
- **name**: Human-readable description
- **platform**: "android" | "ios" | "cross-platform"
- **app_package** / **app_bundle_id**: Target app identifier
- **preconditions**: Array (e.g., `["fresh_install"]`, `["user_logged_in"]`)
- **steps**: Array of actions
  - `launch_app`, `tap`, `type`, `swipe`, `wait`, `take_screenshot`
  - Each step maps to mobile-mcp tools
- **assertions**: Validation rules
  - `element_exists`, `element_not_exists`, `text_matches`, `screenshot_matches`

Generated scenarios are project-specific and include your app's context (business domain, key features).

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
