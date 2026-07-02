---
description: "Core concepts behind mobile-automator - the agent/mauto/mobile-mcp layering and how pulled-on-demand guides power intelligent test automation."
---

# Core Concepts

Understand the architecture, design patterns, and key concepts behind mobile-automator.

## What is mobile-automator?

mobile-automator is a **host-agnostic `mauto` CLI** that gives any AI agent intelligent mobile QA automation capabilities. But it's not a direct testing tool.

**Key Distinction**: mobile-automator is a **meta-tool**. The agent analyzes your mobile project, learns its architecture and domain, then generates test scenarios **tailored specifically to your project** — driving the device entirely through `mauto` verbs.

This is a fundamentally different approach than traditional test frameworks:

| Traditional | mobile-automator |
|---|---|
| You write tests in code or DSLs | AI generates tests from your description |
| Hard-coded selectors and waits | Learned from your project structure |
| Brittle selectors break with UI changes | Semantic understanding tolerates UI changes |
| Generic across projects | Customized for YOUR app's architecture |

## The Layered Architecture

mobile-automator separates judgment from mechanics with a clear contract:

```
agent (brain)        decides what to do, reads guidance
  ↓ drives
mauto verbs          deterministic actions + mechanical assertions
  ↓ wraps
mobile-mcp engine    cross-platform device primitives
  ↓ controls
Device/App
```

### The agent (brain)
Any AI host — Claude Code, Cursor, Gemini CLI, Copilot, and more — pulls reasoning on demand and decides *what* to do: resolving "the Login button," judging visual assertions, and assembling scenarios.

**Reasoning is pulled, not always loaded:**
- `mauto guide generate` — convert natural language to test scenarios
- `mauto guide execute` — execute scenarios, collect results
- `mauto guide setup` — workspace setup reasoning
- `mauto bootstrap` — verb map + invariants
- `mauto schema <scenario|result>` — the JSON schemas

`mauto init --agent <host>` installs native Agent Skills per host. In Claude Code these arrive as the hyphen slash-commands `/mobile-automator-generate` and `/mobile-automator-execute`.

### The `mauto` verbs
The deterministic surface the agent drives. Every verb emits the uniform JSON envelope `{ok,data,error,hint,schema_version}` (a `--human` flag is opt-in). Verbs cover device actions (`elements`, `tap`, `type`, `swipe`, `press`, `screenshot`), authoring/verification (`validate`, `assert`, `result add-step`, `result finalize`), workspace (`setup`, `config`), and device sessions.

### The mobile-mcp engine
`mobile-mcp` provides 20+ platform-agnostic device automation primitives. It is the **internal engine that `mauto` wraps**, not an agent-facing API — the agent never calls `mobile_*` tools directly.

**Primitives:** device detection, app launch, screen interaction (tap, swipe, type), screenshot capture, element inspection, orientation control, and more.

## Key Design Principles

### Separation of Concerns
- The **agent (brain)** owns judgment — element resolution, visual assertions, scenario assembly
- **`mauto` verbs** own determinism — one mechanical action per verb, predictable JSON envelope
- **mobile-mcp** owns platform mechanics — translating a tap into the right device command

### Project-Specific Customization
During setup, project knowledge is captured into `mobile-automator/config.json`:
- Architecture pattern (MVVM, Clean Architecture, BLoC, etc.)
- Business domain (what your app does)
- Loading indicators (how to detect async operations)
- Critical user flows (business-critical paths)

Guide content carries `{{placeholder}}` tokens that are filled from this config when a guide is emitted, so the agent's reasoning is specific to YOUR app.

### Two Modes
A mode is chosen at `mauto setup` and stored in `config.json`:
- **platform-aware** (default) — single-OS or OS-specific UI tests
- **platform-agnostic** (`--mode agnostic`) — cross-platform tests that map OS gestures to four semantic actions (`press_back`, `dismiss_keyboard`, `grant_permission`, `deny_permission`) resolved per platform at replay time

### No Source Code Modification
Tests live in the `mobile-automator/` directory, never in your source code. Scenarios and results are version-controlled separately.

### Semantic Testing
Instead of brittle selectors and pixel-by-pixel comparisons, the agent uses AI vision to understand:
- Does this screen fulfill its purpose?
- Are key elements visible and interactive?
- Does content match expectations?
- Tolerates minor rendering differences

## Key Ideas

- **No source modification** — Tests live in `mobile-automator/`, never in your source code
- **Project learning** — Setup captures your codebase context into `config.json`
- **Pull-on-demand reasoning** — The agent reads guidance via `mauto guide <topic>`, never an ambient always-loaded skill
- **Semantic testing** — AI vision understands your app, not just pixel values
- **Schema-based** — Test scenarios and results follow JSON schemas for validation and IDE support
- **Observational debugging** — Results capture flakiness, regressions, and execution context
- **Device through verbs only** — The agent drives the device exclusively through `mauto` verbs that wrap mobile-mcp

## Main Topics

- **[Architecture Overview](architecture.md)** — Detailed system design and components
- **[Brain/Hands Layering](three-tier-design.md)** — In-depth explanation of each layer and rationale
- **[How Skills Work](skills.md)** — Native Agent Skills, guide content, and customization

## Why This Design?

**Benefits:**
1. **Separation of Concerns** — Each layer has a single responsibility
2. **Customization** — Guidance is interpolated specifically for your project
3. **Maintainability** — Changes to one layer don't affect others
4. **Host-agnostic** — Any AI agent drives the same `mauto` verbs
5. **Lean context** — Reasoning is pulled only when needed

## Next Steps

- Start with [Architecture Overview](architecture.md) for system components
- Then explore [Brain/Hands Layering](three-tier-design.md) for detailed rationale
- Finally, learn about [How Skills Work](skills.md) for skill mechanics
