---
description: "Get started with mobile-automator - install the mauto CLI, wire it into your project and agent, and run your first automated test in minutes."
---

# Getting Started with mobile-automator

Welcome! This section will help you get up and running with mobile-automator in just a few minutes.

## What is mobile-automator?

mobile-automator is a **host-agnostic `mauto` CLI** that turns **any** AI coding agent into a mobile QA engineer. The agent decides *what* to test; `mauto` performs the deterministic actions — tap, type, swipe, assert — by driving a real device or emulator through [mobile-mcp](https://github.com/mobile-next/mobile-mcp). Instead of writing tests manually, you:

1. **Wire it into your project** — `mauto init` installs native Agent Skills for your agent; `mauto setup` scaffolds the workspace
2. **Generate tests** — Describe flows in plain English; the agent drives the app and writes JSON scenarios
3. **Execute tests** — The agent replays scenarios with semantic understanding and intelligent retry logic
4. **Review results** — Detailed execution reports with observations and context

## Why Use mobile-automator?

- **No manual test writing** — Describe flows in plain English, tests are generated automatically
- **Any agent** — Claude Code, Cursor, Gemini CLI, GitHub Copilot, OpenAI Agents, or any MCP-capable agent
- **Intelligent retries** — Handles timing issues and loading indicators automatically
- **Platform-agnostic by default** — One scenario runs on Android and iOS (Flutter, React Native, KMP, CMP)
- **Visual regression detection** — Spots UI changes semantically, not pixel-by-pixel
- **Context-aware debugging** — Includes device state, environment, and network info in failures
- **Portable targets** — Visible text + role + coordinates, never brittle resource-ids

## Three Simple Steps to Get Started

### 1. Install `mauto` from Source

```bash
git clone https://github.com/sh3lan93/mobile-automator
cd mobile-automator
npm install && npm link        # exposes `mauto` globally
```

[Full installation guide →](installation.md)

### 2. Wire It Into Your Project

```bash
cd /path/to/your/mobile-app
mauto init --agent claude      # or: cursor | gemini | copilot | agents | all
mauto setup                    # add --mode agnostic for cross-platform apps
mauto devices                  # confirm a device is visible
```

`init` installs native Agent Skills and (for Claude Code/Cursor) slash-commands/rules + the `mauto` MCP entry. `setup` scaffolds the `mobile-automator/` workspace.

### 3. Generate & Execute Tests

Open your agent in the project. In **Claude Code**, `init` installs slash commands:

```
/mobile-automator-generate     → describe a flow; the agent drives the app and writes a scenario
/mobile-automator-execute      → the agent replays the scenario and reports pass/fail
```

In **Cursor**, ask the agent in plain language. Any other agent: use `mauto mcp` or `mauto bootstrap` + `mauto guide <topic>` and call the verbs directly.

## The Workflow

```
1. Generate (once)      → Describe test in plain English
2. Execute (many times) → Replay automatically across devices and builds
```

## Quick Start

Get your first test running in **5 minutes**:

[Complete walkthrough →](quick-start.md)

## Requirements

Before you begin, ensure you have:

- ✅ **Node.js** v18+ (for the mobile-mcp automation engine)
- ✅ **An AI coding agent** (Claude Code, Cursor, Gemini CLI, GitHub Copilot, OpenAI Agents, or any MCP-capable agent)
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

- [**Installation**](installation.md) — How to install `mauto` and wire it into your project
- [**Quick Start**](quick-start.md) — Your first test in 5 minutes
- Overview of the complete workflow
- Where to go next for deeper learning

## Next Steps

1. **New to mobile-automator?** → Start with [Installation](installation.md)
2. **Ready to test?** → Jump to [Quick Start](quick-start.md)
3. **Want to understand more?** → Read [Core Concepts](../concepts/architecture.md)
4. **Looking for detailed guides?** → Check out [Full Guides](../guides/setup.md)

## Key Features Preview

### Brain / Hands Split
The agent (brain) resolves targets and judges visual assertions; `mauto` (hands) performs deterministic actions via mobile-mcp. Every verb emits `{ok, data, error, hint, schema_version}`; add `--human` for readable output.

### Platform Modes
Choose **platform-aware** (default) for single-OS apps, or **platform-agnostic** (`mauto setup --mode agnostic`) for cross-platform apps. In agnostic mode, OS gestures map to four semantic actions — `press_back`, `dismiss_keyboard`, `grant_permission`, `deny_permission` — resolved to the right native primitive at runtime.

### Loading Indicator Handling
The generate and execute workflows account for your app's loading patterns: progress indicators, shimmer effects, spinners, skeleton screens.

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
