# Getting Started with mobile-automator

Welcome! This section will help you get up and running with mobile-automator in just a few minutes.

## What is mobile-automator?

mobile-automator is a **Gemini CLI extension** that intelligently generates and executes mobile tests for your app. Instead of writing tests manually, it:

1. **Analyzes your project** — Understands your app's architecture, platform, and domain
2. **Generates test skills** — Creates customized testing logic tailored to your project
3. **Executes tests** — Runs tests with semantic understanding and intelligent retry logic
4. **Reports results** — Provides detailed execution reports with observations and context

## Why Use mobile-automator?

- **No manual test writing** — Describe flows in plain English, tests are generated automatically
- **Intelligent retries** — Handles timing issues and loading indicators automatically
- **Platform-aware** — Works with Android, iOS, Flutter, React Native, KMP, and CMP
- **Customized for YOUR app** — Learns your architecture patterns and loading indicators
- **Visual regression detection** — Spots UI changes semantically, not pixel-by-pixel
- **Context-aware debugging** — Includes device state, environment, and network info in failures

## Three Simple Steps to Get Started

### 1. Install the Extension

```bash
gemini extensions install https://github.com/sh3lan93/mobile-automator
```

[Full installation guide →](installation.md)

### 2. Run Setup

```bash
cd /path/to/your/mobile-app
gemini
> /mobile-automator:setup
```

The interactive wizard analyzes your project and installs customized testing skills.

### 3. Generate & Execute Tests

```bash
gemini
> /mobile-automator:generate
> /mobile-automator:execute
```

## The Workflow

```
1. Generate (once)     → Describe test in plain English
2. Execute (many times) → Replay automatically across devices and builds
```

## Quick Start

Get your first test running in **5 minutes**:

[Complete walkthrough →](quick-start.md)

## Requirements

Before you begin, ensure you have:

- ✅ **Gemini CLI** installed ([Get Gemini CLI](https://geminicli.com))
- ✅ **Node.js** v16+ (for mobile-mcp automation engine)
- ✅ **Mobile project** (Android, iOS, Flutter, React Native, KMP, or CMP)
- ✅ **Connected device or simulator** (physical device or emulator)

### Platform-Specific Setup

**Android:**
- Android SDK with API 21+ (Android 5.0+)
- ADB (Android Debug Bridge) available in PATH
- Device or emulator connected

**iOS:**
- Xcode Command Line Tools installed
- iOS 12.0+ simulator or physical device
- Device trusted on your computer

[Detailed installation guide →](installation.md)

## What You'll Learn

In this Getting Started section:

- [**Installation**](installation.md) — How to install and verify the extension
- [**Quick Start**](quick-start.md) — Your first test in 5 minutes
- Overview of the complete workflow
- Where to go next for deeper learning

## Next Steps

1. **New to mobile-automator?** → Start with [Installation](installation.md)
2. **Ready to test?** → Jump to [Quick Start](quick-start.md)
3. **Want to understand more?** → Read [Core Concepts](../concepts/architecture.md)
4. **Looking for detailed guides?** → Check out [Full Guides](../guides/setup.md)

## Key Features Preview

### Platform Auto-Detection
Setup automatically identifies your tech stack: Android, iOS, Flutter, React Native, KMP, or CMP.

### Architecture Pattern Recognition
Scans your codebase to understand: MVVM, Clean Architecture, BLoC, Redux, MVP, VIPER.

### Loading Indicator Detection
Finds your app's loading patterns: progress indicators, shimmer effects, spinners, skeleton screens.

### Intelligent Test Execution
- Automatically retries on timing issues
- Detects flakiness and provides diagnostics
- Includes device state in failure reports
- Semantic visual testing (not pixel-matching)

### Result Observations
Execution results include:
- ✅ Pass/fail status
- 🔍 Regression detection (UI changes)
- ⚡ Flakiness detection (timing issues)
- 🧠 Context awareness (device, environment, network)

## Supported Platforms

| Platform | Status | Build System |
|----------|--------|--------------|
| **Android** | ✅ Full Support | Gradle |
| **iOS** | ✅ Full Support | Xcode |
| **Flutter** | ✅ Full Support | Flutter CLI |
| **React Native** | ✅ Full Support | React Native CLI |
| **Kotlin Multiplatform (KMP)** | ✅ Full Support | Gradle |
| **Compose Multiplatform (CMP)** | ✅ Full Support | Gradle + Xcode |

## Getting Help

- **[Troubleshooting Guide](../faq.md)** — Common issues and solutions
- **[Full Documentation](../index.md)** — Complete reference
- **[GitHub Issues](https://github.com/sh3lan93/mobile-automator/issues)** — Report bugs or request features

---

**Ready to get started?** Head to the [Installation Guide](installation.md)!
