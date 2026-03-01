# Core Concepts

Understand the architecture, design patterns, and key concepts behind mobile-automator.

## What is mobile-automator?

mobile-automator is a **Gemini CLI extension** that provides intelligent mobile QA automation capabilities. But it's not a direct testing tool.

**Key Distinction**: mobile-automator is a **meta-extension** that analyzes your mobile project, learns its architecture and domain, then **generates customized testing skills tailored specifically to your project**.

This is a fundamentally different approach than traditional test frameworks:

| Traditional | mobile-automator |
|---|---|
| You write tests in code or DSLs | AI generates tests from your description |
| Hard-coded selectors and waits | Learned from your project structure |
| Brittle selectors break with UI changes | Semantic understanding tolerates UI changes |
| Generic across projects | Customized for YOUR app's architecture |

## The Three-Tier Architecture

mobile-automator uses a **3-tier architecture** to separate concerns and enable customization:

```
Tier 1: Extension Commands
  ↓ (pre-flight checks, infrastructure)
Tier 2: Workspace Skills
  ↓ (project-specific test generation & execution)
Tier 3: MCP Server
  ↓ (device automation primitives)
Device/App
```

### Tier 1: Extension Commands
CLI entry points that validate setup, detect devices, and delegate to skills.

**Commands:**
- `/mobile-automator:setup` — 7-section analysis, skill installation, project learning
- `/mobile-automator:generate` — Convert natural language to test scenarios
- `/mobile-automator:execute` — Execute scenarios, collect results
- `/mobile-automator:migrate` — Convert v1 scenarios to v2 format

### Tier 2: Workspace Skills
AI-powered prompt templates installed in `.gemini/skills/`, customized with your project knowledge.

**Skills:**
- **Generator Skill** — Parses user input, generates test scenarios with project awareness
- **Executor Skill** — Executes tests, detects patterns (flakiness, regressions), syncs to TestRail

### Tier 3: Automation Engine
The `mobile-mcp` server provides 20+ platform-agnostic device automation primitives.

**Primitives:** device detection, app launch, screen interaction (tap, swipe, type), screenshot capture, element inspection, orientation control, and more.

## Key Design Principles

### Separation of Concerns
- **Tier 1** handles infrastructure (device detection, config validation)
- **Tier 2** contains domain logic (test generation, execution)
- **Tier 3** provides automation primitives (device control)

### Project-Specific Customization
During setup, skills are populated with knowledge about your project:
- Architecture pattern (MVVM, Clean Architecture, BLoC, etc.)
- Business domain (what your app does)
- Loading indicators (how to detect async operations)
- Critical user flows (business-critical paths)

This allows skills to make intelligent decisions specific to YOUR app.

### No Source Code Modification
Tests live in `mobile-automator/` directory, never in your source code. Skills are version-controlled separately.

### Semantic Testing
Instead of brittle selectors and pixel-by-pixel comparisons, mobile-automator uses AI vision to understand:
- Does this screen fulfill its purpose?
- Are key elements visible and interactive?
- Does content match expectations?
- Tolerates minor rendering differences

## Key Ideas

- **No source modification** — Tests live in `mobile-automator/`, never in your source code
- **Project learning** — Setup analyzes your codebase to customize skills automatically
- **Semantic testing** — AI vision understands your app, not just pixel values
- **Schema-based** — Test scenarios and results follow JSON schemas for validation and IDE support
- **Observational debugging** — Results capture flakiness, regressions, and execution context
- **Meta-extension** — Generates testing tools tailored to your specific project

## Main Topics

- **[Architecture Overview](architecture.md)** — Detailed system design and components
- **[3-Tier Design](three-tier-design.md)** — In-depth explanation of each tier and rationale
- **[How Skills Work](skills.md)** — Understanding skill generation, customization, and execution

## Why This Design?

**Benefits:**
1. **Separation of Concerns** — Each tier has a single responsibility
2. **Customization** — Skills are generated specifically for your project
3. **Maintainability** — Changes to one tier don't affect others
4. **Reusability** — Tier 3 primitives work with any MCP-compatible tool
5. **Learning** — Setup analyzes your project to provide context to AI

## Next Steps

- Start with [Architecture Overview](architecture.md) for system components
- Then explore [3-Tier Design Deep Dive](three-tier-design.md) for detailed rationale
- Finally, learn about [How Skills Work](skills.md) for skill mechanics
