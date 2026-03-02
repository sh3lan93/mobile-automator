# Guides

Comprehensive walkthroughs for each Mobile Automator command and workflow. These guides provide step-by-step instructions for analyzing your mobile project, generating test scenarios, executing tests on real devices, and migrating legacy test scenarios to the modern v2 format.

## Available Guides

- **[Setup Command](setup.md)** — 7-section project analysis and skill installation workflow
- **[Generate Command](generate.md)** — Creating intelligent test scenarios from natural language descriptions
- **[Execute Command](execute.md)** — Running tests on connected devices and reviewing results with observations
- **[Migrate Command](migrate.md)** — Converting legacy v1 test scenarios to the modern v2 format

## Understanding the Commands

Each Mobile Automator command serves a distinct purpose in your testing workflow:

| Command | Purpose | Input | Output |
|---|---|---|---|
| `/mobile-automator:setup` | Learn your project, install customized skills | Mobile project directory | Config file, skills, scaffolding |
| `/mobile-automator:generate` | Create test scenarios using AI | Natural language description | JSON scenario file following v2 schema |
| `/mobile-automator:execute` | Run tests on connected devices | Scenario selection and device choice | Result report with observations |
| `/mobile-automator:migrate` | Update legacy test scenarios | v1 scenario JSON file | v2 scenario JSON file |

## Typical Workflow

The recommended approach to mobile testing with Mobile Automator follows this pattern:

```
1. /mobile-automator:setup
        ↓
   (Run once per project - analyzes your app)
        ↓
2. /mobile-automator:generate
        ↓
   (Run for each test - describe what to test)
        ↓
3. /mobile-automator:execute
        ↓
   (Run to test - review results and observations)
```

## When to Use Each Command

**Setup** is your starting point. Run it once per mobile project to configure Mobile Automator for your specific app. It auto-detects your platform, discovers build configurations, identifies your app's package ID, and analyzes your project architecture. Setup installs customized skills tailored to your project and scaffolds the directories needed for test scenarios and results.

**Generate** creates test scenarios from natural language. After setup, use this command to describe test cases in plain English. The AI generates structured JSON scenarios following the v2 schema, handling all the technical formatting so you can focus on what to test.

**Execute** runs your test scenarios on connected devices. This command performs pre-flight checks to ensure devices are ready, then runs each scenario step-by-step with AI vision-based assertions. Results capture not just pass/fail status, but also observations about flakiness, regressions, and execution context.

**Migrate** converts existing v1 test scenarios to the modern v2 format. If you have legacy test scenarios from earlier Mobile Automator versions, this command handles the conversion automatically.

## Next Steps

Start with [Setup Command](setup.md) to understand the comprehensive project analysis workflow and get your project configured.
