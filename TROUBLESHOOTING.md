# 🐛 Troubleshooting

## Setup Issues

### ❌ "Platform could not be detected"
- Ensure you're in the root directory of a mobile project
- The extension supports: Android, iOS, Flutter, React Native, KMP, CMP
- If your project structure is non-standard, setup will ask you to specify manually

### ❌ "Package ID not found"
- **For Android:** Check `app/build.gradle` for `applicationId`
- **For iOS:** Check Xcode project or `Info.plist` for bundle identifier
- Setup will prompt you to enter it manually if auto-detection fails

### ❌ "Skills not installed"
- Check that `.gemini/skills/mobile-automator-*/SKILL.md` files exist
- Re-run `/mobile-automator:setup` - it has resume capability and will continue from where it left off

---

## Device Connection Issues

### ❌ "No devices found"

**Android:**
```bash
# Check connected devices
adb devices

# Start emulator
emulator -avd Pixel_6_API_33
```

**iOS:**
```bash
# List available simulators
xcrun simctl list devices

# Boot simulator
xcrun simctl boot "iPhone 15 Pro"
```

### ❌ "App not installed"
- The generate/execute commands will offer to build and install
- Or install manually before running tests

---

## Test Execution Issues

### ❌ "Test is flaky"
- Mobile Automator automatically detects and flags flaky tests
- Check the observations in the result report for root cause
- **Common causes:** loading delays, animations, network dependencies

### ❌ "Screenshot mismatch"
- Check device differences (was reference captured on different device?)
- Check display settings (dark mode, font size)
- Review the similarity score - minor rendering differences are acceptable

---

## Template/Schema Issues

### ❌ "Template file not found"
- Ensure the extension is properly installed
- For local development: `gemini extensions link .` in the extension directory
- For GitHub: `gemini extensions install https://github.com/sh3lan93/mobile-automator`

### ❌ "Placeholder not replaced in skill"
- This indicates setup didn't complete properly
- Re-run `/mobile-automator:setup` to regenerate skills with correct values
- Check `mobile-automator/setup_state.json` for setup status

---

## Getting More Help

If you encounter an issue not listed here:
1. Check the [GitHub Issues](https://github.com/sh3lan93/mobile-automator/issues)
2. Review the [CLAUDE.md](CLAUDE.md) for architectural details
3. Open a new issue with:
   - Error message
   - Setup configuration (`mobile-automator/config.json`)
   - Steps to reproduce
