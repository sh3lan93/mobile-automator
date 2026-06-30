---
description: "Step-by-step guides for mobile-automator - setup, generate, and execute workflows with detailed walkthroughs."
---

# Guides

Comprehensive walkthroughs for each Mobile Automator workflow. These guides provide step-by-step instructions for scaffolding your workspace, generating test scenarios, and executing tests on real devices.

## Available Guides

- **[Setup Guide](setup.md)** — Scaffolding the `mobile-automator/` workspace with `mauto setup`
- **[Generate Guide](generate.md)** — Creating intelligent test scenarios from natural language descriptions
- **[Execute Guide](execute.md)** — Running tests on connected devices and reviewing results with observations

## Understanding the Workflow

`mauto` is a host-agnostic CLI. After installing it and running `mauto init --agent <host>`, your AI agent pulls reasoning on demand via `mauto guide <topic>` and drives the device through `mauto` verbs. Each stage serves a distinct purpose:

| Stage | How you invoke it | Purpose | Output |
|---|---|---|---|
| Setup | `mauto setup` (CLI verb) | Scaffold the `mobile-automator/` workspace and write `config.json` | Config file + workspace directories |
| Generate | `/mobile-automator-generate` (Claude Code) or `mauto guide generate` | Create test scenarios from natural language | JSON scenario file |
| Execute | `/mobile-automator-execute` (Claude Code) or `mauto guide execute` | Run scenarios on a connected device | Result report with observations |

In Claude Code, `mauto init` installs the hyphen slash-commands `/mobile-automator-generate` and `/mobile-automator-execute`. In Cursor it installs a project rule (ask in plain language). For any other agent, run `mauto mcp`, or use `mauto bootstrap` + `mauto guide <topic>` and call the verbs directly.

## Typical Workflow

The recommended approach to mobile testing with `mauto` follows this pattern:

```
1. mauto setup
        ↓
   (Run once per project - scaffolds the workspace + config.json)
        ↓
2. /mobile-automator-generate   (or: mauto guide generate)
        ↓
   (Run for each test - describe what to test)
        ↓
3. /mobile-automator-execute    (or: mauto guide execute)
        ↓
   (Run to test - review results and observations)
```

## When to Use Each Stage

**Setup** is your starting point. Run `mauto setup` once per mobile project to scaffold the `mobile-automator/` workspace (`scenarios/`, `screenshots/`, `results/`) and write `config.json`. Choose a mode with `--mode aware` (single-OS) or `--mode agnostic` (cross-platform). Then run `mauto devices` to confirm a device is reachable.

**Generate** creates test scenarios from natural language. After setup, the agent reads `mauto guide generate` and drives the device through `mauto` verbs to describe test cases in plain English. It generates structured JSON scenarios, handling all the technical formatting so you can focus on what to test.

**Execute** runs your test scenarios on connected devices. The agent reads `mauto guide execute`, performs pre-flight checks to ensure a device is ready, then runs each scenario step-by-step with AI vision-based assertions. Results capture not just pass/fail status, but also observations about flakiness, regressions, and execution context.


## Next Steps

Start with the [Setup Guide](setup.md) to scaffold your workspace and get your project configured.
