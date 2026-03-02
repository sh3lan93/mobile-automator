# Guides

Detailed walkthroughs for each command and workflow.

## Available Guides

- **[Setup Command](setup.md)** — 7-section project analysis and skill installation
- **[Generate Command](generate.md)** — Creating test scenarios from natural language
- **[Execute Command](execute.md)** — Running tests and reviewing results
- **[Migrate Command](migrate.md)** — Converting v1 scenarios to v2 format

## Overview

Each command has a specific purpose in the testing workflow:

| Command | Purpose | Input | Output |
|---|---|---|---|
| `/mobile-automator:setup` | Learn your project, install skills | Mobile project directory | Config, skills, scaffolding |
| `/mobile-automator:generate` | Create test scenarios | Natural language description | JSON scenario file |
| `/mobile-automator:execute` | Run tests on device | Scenario selection | Result report with observations |
| `/mobile-automator:migrate` | Update legacy scenarios | v1 scenario file | v2 scenario file |

## Typical Workflow

```
1. /mobile-automator:setup
        ↓
   (One time per project)
        ↓
2. /mobile-automator:generate
        ↓
   (Repeat for each test)
        ↓
3. /mobile-automator:execute
        ↓
   (Review results)
```

## Next Steps

Start with [Setup Command](setup.md) to understand the comprehensive project analysis workflow.
