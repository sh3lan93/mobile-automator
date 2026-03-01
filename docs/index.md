# mobile-automator

Intelligent mobile QA automation for Gemini CLI. Analyze your mobile app, auto-generate test scenarios, and execute them with AI-powered assertions.

## Why mobile-automator?

Testing mobile apps manually is **tedious and error-prone**. Cross-platform testing doubles the pain: iOS, Android, Flutter, React Native, Kotlin Multiplatform—all with different build systems, package managers, and ecosystem conventions.

**mobile-automator** changes this. It's a Gemini CLI extension that:

- **Learns your app**: Auto-detects platform, architecture, build system, and business domain
- **Generates tests**: Creates realistic test scenarios from natural language descriptions
- **Executes intelligently**: Runs tests with AI vision that understands your app, not just pixel matching
- **Stays focused**: Works only within your test project—no modifications to your source code

## Key Features

- **3-Tier Architecture**: Separation of concerns between CLI commands (pre-flight), workspace skills (test logic), and the MCP automation server
- **Platform Detection**: Auto-discovers Android, iOS, Flutter, React Native, Kotlin Multiplatform, and Compose Multiplatform projects
- **Smart Setup**: 7-section interactive workflow that learns your project and installs customized skills
- **Schema v2**: Next-gen test scenario format with 14 action types, 27 assertion types, and advanced retry/condition logic
- **Result Observations**: Captures flakiness, regressions, and state context for smarter debugging
- **Semantic Vision**: AI-powered visual assertions that tolerate cosmetic changes
- **Built-in Schemas**: Test scenario and result schemas included in workspace for validation and IDE autocomplete

## Quick Start

### 1. Install

```bash
gemini extensions install https://github.com/sh3lan93/mobile-automator
```

### 2. Setup

Navigate to your mobile project and run:

```bash
/mobile-automator:setup
```

This 7-section workflow:
1. Detects your platform
2. Discovers environments
3. Infers app package
4. Analyzes project knowledge
5. Installs customized skills
6. Scaffolds directories
7. Commits to git (optional)

### 3. Generate Tests

Create test scenarios from natural language:

```bash
/mobile-automator:generate
```

Describe what you want to test. The AI generates structured JSON scenarios following Schema v2.

### 4. Execute Tests

Run scenarios on connected devices:

```bash
/mobile-automator:execute
```

Select which scenarios to run. Tests execute with AI vision and capture observations (flakiness, regressions, etc.).

### 5. View Results

Check execution results:

```bash
mobile-automator/results/<run_id>.json
```

Results include step details, assertion outcomes, captured variables, and observations for debugging.

## How It Works

```
┌─────────────────────────────────────┐
│  Tier 1: CLI Commands               │
│  /mobile-automator:setup            │
│  /mobile-automator:generate         │
│  /mobile-automator:execute          │
│  (Pre-flight validation)            │
└──────────────┬──────────────────────┘
               │ delegates to
┌──────────────▼──────────────────────┐
│  Tier 2: Workspace Skills           │
│  .gemini/skills/mobile-automator-*  │
│  (Test generation & execution)      │
└──────────────┬──────────────────────┘
               │ uses
┌──────────────▼──────────────────────┐
│  Tier 3: Automation Engine          │
│  mobile-mcp                         │
│  (Device primitives)                │
└─────────────────────────────────────┘
```

**Why this design?** Clear separation:
- **Tier 1** handles infrastructure (device detection, config validation)
- **Tier 2** contains project-specific test logic
- **Tier 3** provides platform-agnostic device automation

## Supported Platforms

- ✅ **Android** (native, Kotlin, Java)
- ✅ **iOS** (native, Swift, Objective-C)
- ✅ **Flutter**
- ✅ **React Native**
- ✅ **Kotlin Multiplatform** (KMP)
- ✅ **Compose Multiplatform** (CMP)

## What's Included

- **7-Section Setup Workflow**: Platform detection, environment discovery, package inference, project analysis
- **Customized Skills**: Automatically installed and configured for your project
- **Schema v2**: 14 action types, 27 assertion types, advanced retry/condition logic
- **Result Observations**: Captures flakiness, regressions, and execution context
- **Resume Capability**: Setup can resume if interrupted
- **Schema Migration**: Tools to migrate v1 scenarios to v2

## Next Steps

- [Quick Start Guide](getting-started/quick-start.md) — Get up and running in 5 minutes
- [Core Concepts](concepts/architecture.md) — Understand the architecture
- [Setup Guide](guides/setup.md) — Detailed setup workflow documentation
- [Examples](examples/android.md) — Real-world examples for Android and iOS

## Support

- **Documentation**: Full guides and reference at [mobile-automator.github.io](https://mobile-automator.github.io)
- **Issues**: Report bugs at [GitHub Issues](https://github.com/sh3lan93/mobile-automator/issues)
- **Contributing**: See [Contributing Guide](contributing.md)

---

**Ready to automate?** Start with `/mobile-automator:setup` in your mobile project!
