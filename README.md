# Mobile Automator - Gemini CLI Extension

> **A streamlined Mobile QA automation extension for Gemini CLI. One command to setup your project, infinite possibilities for testing.**

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Commands Reference](#commands-reference)
- [Workspace Skills](#workspace-skills)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Overview

Mobile Automator simplifies mobile testing by generating project-specific QA skills tailored to your application's tech stack and platform. By running a single setup command, your workspace is equipped with the tools needed to generate and execute end-to-end tests using real device automation.

## Architecture

The extension uses a **Generator Pattern** similar to advanced workspace managers:
- **Extension Level**: Provides the `/mobile:setup` command and the `mobile-mcp` automation engine.
- **Workspace Level**: Host the actual testing skills (`/generate-test`, `/run-test`) specialized for *your* specific app.

---

## Installation

### Prerequisites

- **Node.js** (v16 or higher)
- **Gemini CLI** ([Install guide](https://geminicli.com))
- **Mobile device/emulator** connected and accessible (`adb devices` or Simulator)

### Install via Git

```bash
gemini extensions install https://github.com/your-org/mobile-automator
```

### Local Development

```bash
git clone https://github.com/your-org/mobile-automator
cd mobile-automator
npm install
gemini extensions link .
```

---

## Quick Start

### 1. Initialize Your Project

Navigate to your mobile project root and run:

```bash
/mobile:setup
```

**What it does**:
- Analyzes your tech stack (React Native, Flutter, Native).
- Detects package IDs and platform specifics.
- **Generates customized skills** in `.gemini/skills/mobile/`.

### 2. Generate a Test

Once initialized, use the new workspace-local command:

```bash
/generate-test "verify user can login with valid credentials"
```

### 3. Run the Test

Execute the generated JSON scenario:

```bash
/run-test testscenarios/login_flow/login_flow.json
```

---

## Commands Reference

### `/mobile:setup`
The primary command to configure your project.
- **Target**: Run once in a new mobile repository.
- **Action**: Detects project metadata and scaffolds the `.gemini/skills/` directory.

---

## Workspace Skills

After running `/mobile:setup`, the following skills are added to your project:

### `/generate-test`
Generates structured JSON test scenarios using your project's specific context.
- **Input**: A natural language description of a user flow.
- **Output**: A JSON file in `testscenarios/` mapping steps to `mobile-mcp` tools.

### `/run-test`
The execution engine for your scenarios.
- **Input**: Path to a test scenario JSON.
- **Action**: Iterates through steps, uses `mobile-mcp` to control the device, and validates results.

---

## Troubleshooting

- **Command not found**: Ensure you have linked the extension and restarted Gemini CLI.
- **Device not found**: Check `adb devices` (Android) or `xcrun simctl list` (iOS).
- **Setup failed**: Ensure you are in the root directory of a valid mobile project.

---

## License

Apache License 2.0 - See [LICENSE](LICENSE) for details.
