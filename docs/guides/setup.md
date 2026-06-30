---
description: "Set up mobile-automator with the mauto CLI - install, init your agent, scaffold the workspace, choose a mode, and analyze your project into config.json."
---

# Setup Guide

Setup is your entry point to mobile-automator. You install the host-agnostic `mauto` CLI, wire it into your AI agent, scaffold the `mobile-automator/` workspace, and let your agent analyze the project into `mobile-automator/config.json` — so later test generation and execution are tailored to your app.

**Key benefit**: You set up once per project, and everything needed for intelligent test generation and execution is configured.

## Quick Start

```bash
# 1. Install the CLI from source
git clone https://github.com/sh3lan93/mobile-automator
cd mobile-automator
npm install
npm link

# 2. Wire mauto into your agent (installs native Agent Skills + slash-commands/rules + .mcp.json)
cd /path/to/your/mobile-app
mauto init --agent claude        # or: cursor | gemini | copilot | agents | all

# 3. Scaffold the workspace + config.json
mauto setup                      # add --mode agnostic for cross-platform apps

# 4. Confirm a device is reachable
mauto devices
```

After this, your agent analyzes the project and persists what it learns to `mobile-automator/config.json`.

---

## Step 1: Install `mauto`

`mauto` is a host-agnostic CLI usable by any AI agent. Install it from source:

```bash
git clone https://github.com/sh3lan93/mobile-automator
cd mobile-automator
npm install
npm link
```

`npm link` exposes the `mauto` (and `mobile-automator`) commands on your PATH. The mobile-mcp engine that drives the device is pinned as a dependency and resolved from `node_modules` — nothing is fetched at runtime.

---

## Step 2: Wire `mauto` into your agent

Run `mauto init` once per project to install the per-host integration:

```bash
cd /path/to/your/mobile-app
mauto init --agent claude
```

`--agent` accepts `claude`, `cursor`, `gemini`, `copilot`, `agents`, or `all`. Init installs a native Agent Skill for the host plus the right invocation surface:

| Host | What init installs | How you invoke a workflow |
|---|---|---|
| Claude Code | Agent Skill + hyphen slash-commands + `.mcp.json` | `/mobile-automator-generate`, `/mobile-automator-execute` |
| Cursor | Agent Skill + project rule + `.mcp.json` | Ask in plain language (the rule routes it) |
| Gemini CLI | Agent Skill in `.gemini/skills/` | `mauto guide <topic>` |
| Any other agent | — | `mauto mcp`, or `mauto bootstrap` + `mauto guide <topic>` |

For any agent, the underlying contract is the same: the agent reads `mauto guide generate` / `mauto guide execute` and drives the device through `mauto` verbs.

---

## Step 3: Scaffold the workspace with `mauto setup`

`mauto setup` is a CLI verb (not an interactive wizard). It is mechanical and idempotent — it creates the workspace tree and a starter config, and re-running never clobbers existing config fields:

```bash
mauto setup
```

This creates:

```
mobile-automator/
├── scenarios/      # generated test JSON files
├── screenshots/    # reference + execution screenshots
├── results/        # execution result reports
└── config.json     # project configuration (starter skeleton)
```

The starter `config.json` written on first run:

```json
{
  "mode": "platform-aware",
  "project_name": null,
  "environments": [],
  "default_environment": null
}
```

### Choosing a mode

The mode is selected with `--mode` and stored in `config.json`. It governs how OS gestures are expressed in scenarios:

```bash
mauto setup --mode aware       # default — single-OS / OS-specific UI tests
mauto setup --mode agnostic    # cross-platform (Flutter / RN / KMP / CMP)
```

| Mode | Use for |
|---|---|
| `platform-aware` | Single-OS or OS-specific UI tests |
| `platform-agnostic` | Cross-platform apps |

Agnostic mode maps OS gestures to four semantic actions — `press_back`, `dismiss_keyboard`, `grant_permission`, `deny_permission` — that resolve to per-platform mechanics at replay time. Re-running `mauto setup --mode <mode>` only updates the stored `mode`, preserving every other field.

---

## Step 4: Confirm a device

```bash
mauto devices
```

This lists connected devices/simulators (id, name, platform, state). Optionally pin one so later verbs don't need a `--device` flag:

```bash
mauto devices use <id>     # persist a selection
mauto devices clear        # remove the selection
```

A zero-device result is valid (it exits cleanly with an empty list) — connect a device or start a simulator and re-run.

---

## Step 5: Analyze the project into `config.json`

Scaffolding is the mechanical half. The valuable half is **project analysis**: your agent inspects the codebase, infers each fact, confirms anything uncertain with you, and persists every finding with `mauto config set <key> <value>`. Read a value back with `mauto config get <key>`.

In Claude Code this runs as the setup skill; with any agent you can drive it directly:

```bash
mauto guide setup
```

The agent works through the following analysis, persisting each result to `config.json`:

### Platform detection

The agent inspects project files (honoring `.gitignore`) to determine the platform — Flutter, React Native, Kotlin Multiplatform, Compose Multiplatform, Android Native, or iOS Native — and persists it:

```bash
mauto config set platform <platform>
```

### Environment discovery

It scans build configuration for named environments (Gradle `productFlavors` × `buildTypes`, Xcode schemes/configs, Flutter flavors / `--dart-define`, React Native `.env*` files), deduplicates, and persists a comma-separated list:

```bash
mauto config set environments <env1,env2,...>
```

### App package inference

It reads the application identifier from build files and persists it per platform:

```bash
mauto config set android_package <id>     # e.g. com.example.myapp
mauto config set ios_bundle_id <id>       # e.g. com.example.MyApp
```

### Project knowledge

The agent infers and persists the deeper context that makes generated tests project-aware:

| Key | What it captures |
|---|---|
| `project_name` | App / project name |
| `platform_details` | e.g. `Android (minSdk 24, targetSdk 34)` |
| `build_system` | e.g. `Gradle (AGP)`, `Xcode`, `Flutter CLI + Gradle + Xcode` |
| `build_command` | Default debug/dev build command |
| `architecture` | e.g. `MVVM with Clean Architecture`, `BLoC` |
| `business_domain` | One-sentence description of what the app does |
| `business_critical_paths` | Most important user flows (login, checkout, …) |
| `loading_indicators` | Progress/spinner/shimmer/skeleton patterns to wait on |
| `protected_directories` | Source dirs the tooling must never modify |

Each is persisted with `mauto config set <key> <value>` (comma-separated values for list keys), confirming uncertain values with you first.

### Confirm the config

When analysis is done, the agent reads each value back with `mauto config get <key>` and presents a summary. The workspace is now configured: `mauto guide generate` and `mauto guide execute` read these values to drive authoring and execution.

---

## Configuration File (config.json)

After analysis, `mobile-automator/config.json` looks something like:

```json
{
  "mode": "platform-aware",
  "project_name": "MyShoppingApp",
  "platform": "android",
  "android_package": "com.example.myapp",
  "environments": ["debug", "release", "staging"],
  "default_environment": "staging",
  "platform_details": "Android (minSdk 24, targetSdk 34)",
  "architecture": "MVVM with Clean Architecture",
  "build_system": "Gradle (AGP)",
  "build_command": "./gradlew assembleDebug",
  "business_domain": "E-commerce mobile shopping app with checkout flow",
  "business_critical_paths": ["onboarding", "login", "checkout", "payment"],
  "loading_indicators": ["CircularProgressIndicator", "ShimmerEffect"],
  "protected_directories": ["app/src/", "lib/"]
}
```

Read or update any field directly:

```bash
mauto config get platform
mauto config set default_environment staging
```

Configs that predate the `mode` field are treated as `platform-aware`.

---

## Troubleshooting

### `mauto: command not found`

**Problem:** The CLI isn't on your PATH.

**Solution:** Re-run `npm install && npm link` inside the cloned `mobile-automator` repo. Confirm with `mauto devices`.

### No devices listed

**Problem:** `mauto devices` shows an empty list.

**Solution:** Connect a physical device or start a simulator/emulator, then re-run `mauto devices`. Pin one with `mauto devices use <id>` so later verbs don't need `--device`.

### Platform detection inconclusive

**Problem:** The agent can't determine your project's platform.

**Solution:** Confirm you're in the project root and that platform-distinctive files exist (e.g. `pubspec.yaml` for Flutter, `build.gradle` for Android). Then set it explicitly: `mauto config set platform <platform>`.

### Package ID not found

**Problem:** The agent can't extract your app's bundle ID / package name.

**Solution:** Set it manually — `mauto config set android_package com.example.myapp` (Android, from `applicationId`) or `mauto config set ios_bundle_id com.example.MyApp` (iOS, from `PRODUCT_BUNDLE_IDENTIFIER` / `CFBundleIdentifier`).

### Wrong mode

**Problem:** You scaffolded in the wrong mode.

**Solution:** Re-run `mauto setup --mode aware` or `mauto setup --mode agnostic`. It only updates the stored `mode`, preserving every other field.

### Re-running setup

`mauto setup` is idempotent — re-run it any time. It never clobbers existing config fields; it only ensures the requested mode is set and that the workspace directories exist.

---

## After Setup

Once setup and analysis are complete:

1. **Review configuration**: `mobile-automator/config.json`
2. **Generate your first test**: `/mobile-automator-generate` (or `mauto guide generate`)
3. **Execute the test**: `/mobile-automator-execute` (or `mauto guide execute`)

See the [Generate Guide](generate.md) for next steps.

---

## See Also

- [Generate Guide](generate.md) — Next step after setup
- [Architecture: 3-Tier Design](../concepts/three-tier-design.md) — How setup fits in the overall system
- [FAQ: Setup Issues](../faq.md#setup-installation)
