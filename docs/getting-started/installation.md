---
description: "Install the host-agnostic mauto CLI from source, wire it into your project and agent, and verify your device is visible."
---

# Installation

`mauto` is a host-agnostic CLI. You install it once from source, then wire it into each mobile project with `mauto init` and `mauto setup`.

## Prerequisites

Before installing mobile-automator, ensure you have:

- **Node.js** v18 or higher (required for mobile-mcp automation engine)
- **An AI coding agent** — Claude Code, Cursor, Gemini CLI, GitHub Copilot, OpenAI Agents, or any MCP-capable agent
- A **mobile project** (Android, iOS, Flutter, React Native, KMP, or CMP)
- A **connected device or simulator** for running tests

### Platform-Specific Requirements

#### Android
- Android SDK installed (API 21 / Android 5.0 or higher)
- ADB (Android Debug Bridge) available in your PATH
- Android Emulator running OR physical device connected via USB
- Device must be in developer mode with USB debugging enabled

#### iOS
- Xcode and Command Line Tools installed
- iOS 12.0 or higher
- iPhone simulator or physical device connected
- Sufficient disk space for simulator images (~10GB)

## Installation Steps

### 1. Install `mauto` from Source

`mauto` is not yet published to npm. Install it from source:

```bash
git clone https://github.com/sh3lan93/mobile-automator
cd mobile-automator
npm install && npm link        # exposes `mauto` globally
```

`npm install` pulls in the pinned mobile-mcp automation engine; `npm link` puts the `mauto` (and `mobile-automator`) command on your PATH.

### 2. Verify the CLI Is Available

```bash
mauto --help
```

You should see the list of `mauto` verbs.

### 3. Wire It Into Your Project and Agent

From the root of any mobile project:

```bash
cd /path/to/your/mobile-app
mauto init --agent claude      # or: cursor | gemini | copilot | agents | all
mauto setup                    # add --mode agnostic for cross-platform apps
```

- `init` installs native Agent Skills into the host's skills directory (`.claude/skills/`, `.cursor/skills/`, `.gemini/skills/`, `.github/skills/`, `.agents/skills/`) and, for Claude Code and Cursor, also writes slash-commands/rules and the `mauto` MCP entry (`.mcp.json`).
- `setup` scaffolds the `mobile-automator/` workspace and writes `mobile-automator/config.json`. Add `--mode agnostic` for cross-platform apps (Flutter/RN/KMP/CMP).

### 4. Verify Your Device Is Visible

```bash
mauto devices                  # lists devices; mauto devices use <id> to pin one
```

If a device or running emulator/simulator appears here, `mauto` can drive it. If more than one is listed, pin the one you want with `mauto devices use <id>` (and `mauto devices clear` to unpin).

## Supported Platforms

| Platform | Detection | Build System | Device Control |
|----------|-----------|--------------|----------------|
| **Android** | ✅ Native, Gradle | Gradle | ✅ Emulator + Real Device |
| **iOS** | ✅ Native, Xcode | Xcode | ✅ Simulator + Real Device |
| **Flutter** | ✅ Cross-platform | Flutter CLI | ✅ All platforms |
| **React Native** | ✅ Metro bundler | React Native CLI | ✅ All platforms |
| **Kotlin Multiplatform** | ✅ KMP structure | Gradle | ✅ Android + iOS |
| **Compose Multiplatform** | ✅ CMP structure | Gradle + Xcode | ✅ Android + iOS |

## Using Another Agent

`mauto init` ships native Agent Skills for Claude Code, Cursor, Gemini CLI, GitHub Copilot (`copilot`), and OpenAI Agents (`agents`). Any other AI agent can drive `mauto` without an adapter:

- **MCP (recommended):** point your MCP-capable agent at the prompts server — `mauto mcp` (stdio) — which exposes the `generate` / `execute` / `setup` workflows as prompts. Register it like any MCP server: command `mauto`, args `["mcp"]`.
- **Plain shell:** have the agent read `mauto bootstrap` once (the verb map + invariants), then read `mauto guide <topic>` for a workflow and call the verbs (`mauto elements`, `tap`, `type`, `assert`, …) directly. Every verb returns the `{ok, data, error, hint, schema_version}` envelope.

## Troubleshooting Installation

### "mauto: command not found"

`npm link` didn't expose the command, or your shell hasn't picked up the new PATH entry.

**Solution:**
1. Re-run `npm link` from inside the cloned `mobile-automator` directory
2. Verify installation: `which mauto`
3. Restart your terminal and try again

### "npm install" fails

The pinned mobile-mcp dependency couldn't be installed.

**Solutions:**
- Check your internet connection and access to the npm registry
- Ensure Node.js is v18 or higher: `node --version`
- Clear the npm cache and retry: `npm cache clean --force && npm install`

### Platform Detection Fails

Setup can't detect your mobile project platform.

**Solutions:**
1. Ensure you're in the **root directory** of your mobile project
2. Supported detection patterns:
   - **Android**: `build.gradle`, `AndroidManifest.xml`, `src/main/`
   - **iOS**: `.xcodeproj/`, `Podfile`, `Info.plist`
   - **Flutter**: `pubspec.yaml`
   - **React Native**: `react-native.config.js`, `package.json` with React Native dependency
3. If detection still fails, setup will prompt you to select manually

### "ADB not found" (Android)

Android Debug Bridge (ADB) is not installed.

**Solutions:**
- Install Android SDK and add it to your PATH
- Or manually add ADB: `export PATH=$PATH:~/Library/Android/sdk/platform-tools`
- Verify: `adb devices`

### Device Not Detected

`mauto devices` shows nothing.

**Android:**
1. Check USB cable connection
2. Enable Developer Mode on device
3. Enable USB Debugging
4. Authorize the computer on your device
5. Run: `adb devices`

**iOS:**
1. Trust the computer on your device
2. Check Xcode can see the device: `xcrun simctl list`
3. For simulators, ensure Xcode is updated

## Next Steps

Once installation is verified:

1. **[Quick Start](quick-start.md)** — Run your first test in 5 minutes
2. **[Setup Guide](../guides/setup.md)** — Understand the setup workflow
3. **[Architecture](../concepts/architecture.md)** — Learn how mobile-automator works

---

**Need more help?** See the [Troubleshooting Guide](../faq.md) for additional solutions.
