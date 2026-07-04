# 🐛 Troubleshooting

## Setup Issues

### ❌ "Platform could not be detected"
- Ensure you're in the root directory of a mobile project
- `mauto` supports: Android, iOS, Flutter, React Native, KMP, CMP
- If your project structure is non-standard, setup will ask you to specify manually

### ❌ "Package ID not found"
- **For Android:** Check `app/build.gradle` for `applicationId`
- **For iOS:** Check Xcode project or `Info.plist` for bundle identifier
- Setup will prompt you to enter it manually if auto-detection fails

### ❌ "Skills not installed"
- Skills are installed per host by `mauto init`. Check that the skill files for your
  agent exist — e.g. `.claude/skills/mobile-automator-*/SKILL.md` for Claude Code,
  `.gemini/skills/mobile-automator-*/SKILL.md` for Gemini CLI, and likewise under
  `.cursor/skills/`, `.github/skills/`, or `.agents/skills/`.
- Re-run `mauto init --agent <claude|cursor|gemini|copilot|agents|all>` to (re)install them.

---

## Device Connection Issues

### ❌ "No devices found"

First, ask `mauto` what it can see:

```bash
mauto devices              # lists connected devices/emulators
mauto devices use <id>     # pin a specific device
```

If the list is empty, bring a device up:

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

Then re-run `mauto devices` to confirm it now appears.

### ❌ "App not installed"
- The generate/execute workflows will offer to build and install
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

## Scenario / Schema Issues

### ❌ "Scenario fails to validate"
- Run `mauto validate <file>` to check a scenario JSON against the schema; the error
  envelope's `error`/`hint` fields point at the offending field.
- Print the current schemas with `mauto schema scenario` / `mauto schema result`.

### ❌ "Setup didn't complete properly"
- Re-run `mauto setup` to (re)scaffold the `mobile-automator/` workspace and config.
- Inspect the workspace config with `mauto config get <key>` (the config lives at
  `mobile-automator/config.json`).

---

## Tag Filtering Issues

### ❌ "Invalid tag format" error
- **Cause:** Tags must contain only lowercase letters, numbers, and hyphens (a-z0-9-), and be under 20 characters. Spaces, underscores, and uppercase letters are not allowed.
- **Fix:** Update your `scenario.json` file to fix the invalid tag (e.g. change `"Smoke_Test"` to `"smoke-test"`).

### ❌ Scenario doesn't show up in tag groups
- **Cause:** The scenario does not have a `tags` array in its JSON, or the array is empty.
- **Fix:** Manually add `"tags": ["some-tag"]` to the scenario's JSON file.

---

## Getting More Help

If you encounter an issue not listed here:
1. Check the [GitHub Issues](https://github.com/sh3lan93/mobile-automator/issues)
2. Review the [CLAUDE.md](CLAUDE.md) for architectural details
3. Open a new issue with:
   - Error message
   - Setup configuration (`mobile-automator/config.json`)
   - Steps to reproduce
