# 🚀 Mobile Automator

> **Turn your AI coding agent into a mobile QA engineer.**

`mauto` is a host-agnostic CLI that lets **any** AI coding agent author and run UI tests on a real device or emulator. The agent decides *what* to do; `mauto` does it — tap, type, swipe, assert — through [mobile-mcp](https://github.com/mobile-next/mobile-mcp). Tests are plain JSON scenarios, **platform-agnostic** by default, so the same scenario runs on Android and iOS.

Claude Code and Cursor have one-command setup (`mauto init --agent …`); any other MCP-capable agent connects via the `mauto mcp` prompts server. See [Using another agent](#-using-another-agent).

[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/Platform-Android%20%7C%20iOS%20%7C%20Flutter%20%7C%20RN%20%7C%20KMP%20%7C%20CMP-green.svg)](#)
[![Node](https://img.shields.io/badge/Node-%E2%89%A518-brightgreen.svg)](#)

---

## ⏱️ Quick start (5 minutes)

**You need:** Node ≥ 18 · an AI coding agent · a running emulator/simulator or a connected device.

> This quick start uses **Claude Code** as the example agent. For Cursor, swap `--agent claude` → `--agent cursor`. For any other agent, see [Using another agent](#-using-another-agent).

**1. Install `mauto`** (from source — not yet on npm):

```bash
git clone https://github.com/sh3lan93/mobile-automator
cd mobile-automator
npm install && npm link        # exposes `mauto` globally
```

**2. Wire it into your project and agent:**

```bash
cd ~/projects/my-app
mauto init --agent claude      # or: --agent cursor
mauto setup                    # scaffolds mobile-automator/ + config
```

`init` writes agent command files and registers the `mauto` MCP server (`.claude/commands/` + `.mcp.json`, or `.cursor/` for Cursor). `setup` creates the `mobile-automator/` workspace. Add `--mode agnostic` to `setup` for cross-platform apps (Flutter/RN/KMP/CMP).

**3. Check your device is visible:**

```bash
mauto devices                  # lists devices; `mauto devices use <id>` to pin one
```

**4. Author and run a test — from inside your agent:**

Open your agent in the project. In **Claude Code**, `init` installs slash commands:

```
/mobile-automator-generate     → describe a flow in plain English; the agent
                                 drives the app and writes a scenario JSON

/mobile-automator-execute      → the agent replays the scenario and reports
                                 pass/fail with diagnostics
```

In **Cursor**, `init` installs a project rule instead — just ask the agent in plain language (e.g. *"generate a login test"* / *"execute the login scenario"*) and it follows the same workflow. **Any other agent:** see [Using another agent](#-using-another-agent) below.

That's it. Scenarios land in `mobile-automator/scenarios/`, results in `mobile-automator/results/`.

---

## 🧠 How it works

`mauto` splits the work into a **brain** and **hands**:

- **The agent (brain)** resolves targets ("the Login button"), judges visual assertions, and assembles scenarios. It reads workflow guidance on demand with `mauto guide <topic>`.
- **`mauto` (hands)** performs deterministic, scriptable actions and mechanical assertions, driving the device via mobile-mcp. Every verb emits a uniform JSON envelope (`{ok, data, error, hint}`); add `--human` for readable output.

Targets are always **visible text + semantic role + coordinates** — never brittle resource-ids — which is what makes scenarios portable across Android and iOS.

```
   Your agent  ──drives──▶  mauto verbs  ──wrap──▶  mobile-mcp  ──▶  device
   (decisions)             (deterministic)        (automation)
```

Because the contract is just verbs + JSON, **no agent is special** — `mauto init` ships first-class adapters for Claude Code and Cursor, but any agent that can run a shell command or speak MCP can drive the same tool.

---

## 🤖 Using another agent

`mauto init` only has built-in adapters for **Claude Code** and **Cursor**. Any other AI agent can drive `mauto` through one of these, no adapter required:

- **MCP (recommended):** point your MCP-capable agent at the prompts server — `mauto mcp` (stdio) — which exposes the `generate` / `execute` / `record` / `setup` workflows as prompts. Register it like any MCP server: command `mauto`, args `["mcp"]`.
- **Plain shell:** have the agent read `mauto bootstrap` once (the verb map + invariants), then read `mauto guide <topic>` for a workflow and call the verbs (`mauto elements`, `tap`, `type`, `assert`, …) directly. Every verb returns the `{ok, data, error, hint}` envelope, so the agent can act on results programmatically.

Either way the workspace, scenarios, and schemas are identical — the agent is just a different driver for the same `mauto` hands.

---

## 🔀 Platform modes

Chosen at `mauto setup` (stored in `mobile-automator/config.json`):

| Mode | Best for | Enable |
|------|----------|--------|
| **platform-aware** (default) | Single-OS / OS-specific UI | `mauto setup` |
| **platform-agnostic** | Cross-platform (Flutter, RN, KMP, CMP) | `mauto setup --mode agnostic` |

In agnostic mode, OS-shaped gestures become four semantic actions — `press_back`, `dismiss_keyboard`, `grant_permission`, `deny_permission` — resolved to the right native primitive at runtime, so one scenario covers both platforms.

---

## 📋 Command reference

Most low-level verbs are called **by the agent**, not by you. The ones you'll run directly are at the top.

| Command | What it does |
|---------|--------------|
| `mauto init --agent <claude\|cursor>` | Install adapter files for a supported agent (commands/rule + MCP entry) |
| `mauto setup [--mode aware\|agnostic]` | Scaffold the `mobile-automator/` workspace + config |
| `mauto devices` · `devices use <id>` · `devices clear` | List / pin / unpin the target device |
| `mauto guide <generate\|execute\|record\|setup>` | Print the workflow guidance for a topic |
| `mauto mcp` | Run the MCP prompts server (for any MCP-capable agent) |
| `mauto bootstrap` | Print the verb map + invariants (onboarding for any agent) |
| `mauto validate <file>` | Validate a scenario JSON against the schema |
| `mauto config get\|set <key> [value]` | Read / update workspace config |
| `mauto record <name>` | Launch the interactive web recorder (experimental) |
| **Agent-driven verbs** | `elements`, `tap`, `type`, `swipe`, `press`, `screenshot`, `assert`, `result`, `schema` |

Run `mauto <command> --help` for full flags.

---

## 🎥 Recording (experimental)

`mauto record <name>` opens a browser GUI that captures live device interaction (taps, typing, swipes, hardware keys) and synthesizes a scenario JSON — the same format `generate` produces and `execute` replays. Requires `ffmpeg` on your `PATH` (and `adb` for Android hardware-key capture). It's feature-complete but still maturing; file rough edges against [#21](https://github.com/sh3lan93/mobile-automator/issues/21).

---

## 📂 Workspace layout

After `mauto setup`:

```
mobile-automator/
├── config.json        # mode, environments, project config
├── scenarios/         # test scenarios (JSON, schema 2.1)
├── screenshots/       # reference screenshots
└── results/           # execution results
```

Scenario and result schemas: `mauto schema scenario` / `mauto schema result`.

---

## 🐛 Troubleshooting

See **[TROUBLESHOOTING.md](TROUBLESHOOTING.md)**.

## 🤝 Contributing

Contributions welcome under Apache 2.0. Good first areas: platform support, assertion types, CI/CD integrations.

## 📄 License

[Apache License 2.0](LICENSE).

## 🙏 Acknowledgments

- **[mobile-mcp](https://github.com/mobile-next/mobile-mcp)** — the device-automation engine `mauto` wraps.
- **[Conductor](https://github.com/gemini-cli-extensions/conductor)** — inspired the structured-workflow approach.

---

<div align="center">

**Built for mobile QA engineers** · [Report a bug](https://github.com/sh3lan93/mobile-automator/issues) · [Request a feature](https://github.com/sh3lan93/mobile-automator/issues)

</div>
