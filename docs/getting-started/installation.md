# Installation

## Prerequisites

Before installing mobile-automator, ensure you have:

- **Gemini CLI** installed and authenticated ([Get Gemini CLI](https://geminicli.com))
- **Node.js** v16 or higher (required for mobile-mcp automation engine)
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

### 1. Install the Extension

The easiest way to install mobile-automator is through the Gemini CLI:

```bash
gemini extensions install https://github.com/sh3lan93/mobile-automator
```

This downloads the extension and automatically configures the mobile-mcp server for device automation.

### 2. Verify Installation

Check that the extension commands are available:

```bash
gemini /mobile-automator:setup --help
```

You should see help text for the setup command.

### 3. Local Development Setup (Optional)

If you're contributing to mobile-automator or want to test the latest development version:

```bash
git clone https://github.com/sh3lan93/mobile-automator
cd mobile-automator
gemini extensions link .
```

This links the extension from your local directory instead of installing from GitHub.

## Supported Platforms

| Platform | Detection | Build System | Device Control |
|----------|-----------|--------------|----------------|
| **Android** | ✅ Native, Gradle | Gradle | ✅ Emulator + Real Device |
| **iOS** | ✅ Native, Xcode | Xcode | ✅ Simulator + Real Device |
| **Flutter** | ✅ Cross-platform | Flutter CLI | ✅ All platforms |
| **React Native** | ✅ Metro bundler | React Native CLI | ✅ All platforms |
| **Kotlin Multiplatform** | ✅ KMP structure | Gradle | ✅ Android + iOS |
| **Compose Multiplatform** | ✅ CMP structure | Gradle + Xcode | ✅ Android + iOS |

## Verify Your Setup

To confirm everything is installed correctly, run the setup wizard on any mobile project:

```bash
cd /path/to/your/mobile-app
gemini
> /mobile-automator:setup
```

The wizard will validate:
- ✅ Gemini CLI is functioning
- ✅ mobile-mcp server is accessible
- ✅ Platform is detected (Android/iOS/Flutter/etc.)
- ✅ Build tools are available
- ✅ Connected devices are detected

## Troubleshooting Installation

### "gemini: command not found"

The Gemini CLI is not installed or not in your PATH.

**Solution:**
1. Install Gemini CLI from [geminicli.com](https://geminicli.com)
2. Verify installation: `which gemini`
3. Restart your terminal and try again

### "Failed to install extension"

The extension couldn't be downloaded from GitHub.

**Solutions:**
- Check your internet connection
- Verify you have access to GitHub
- Try again with: `gemini extensions install https://github.com/sh3lan93/mobile-automator --force`

### "Setup command not found after installation"

The extension didn't install completely.

**Solutions:**
1. Restart your terminal
2. Try installing again: `gemini extensions install https://github.com/sh3lan93/mobile-automator --force`
3. Check for error messages: `gemini extensions list`

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

Your device isn't showing in the connected devices list.

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
2. **[Setup Guide](../guides/setup.md)** — Understand the 7-section setup wizard
3. **[Architecture](../concepts/architecture.md)** — Learn how mobile-automator works

---

**Need more help?** See the [Troubleshooting Guide](../faq.md) for additional solutions.
