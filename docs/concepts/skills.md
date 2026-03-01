# How Skills Work

Understanding workspace skills: how they're installed, customized, and executed.

## What Are Skills?

Skills are prompt templates that contain project-specific testing logic. They're installed into your workspace (`.gemini/skills/`) during the setup process and customized with knowledge about your specific project.

Two main skills:
- **Generator Skill** — Converts natural language to test scenarios
- **Executor Skill** — Executes test scenarios and reports results

## Installation and Customization

### The Setup Process

During `/mobile-automator:setup`, Section 6:

1. **Gather project knowledge** (sections 1-5)
   - Detect platform
   - Discover environments
   - Infer package ID
   - Analyze codebase for architecture, domain, patterns

2. **Read skill templates**
   - Load from `${extensionPath}/templates/mobile-automator-generator/SKILL.md`
   - Load from `${extensionPath}/templates/mobile-automator-executor/SKILL.md`

3. **Replace placeholders**
   - Find all `{{placeholder}}` patterns
   - Replace with detected/gathered values
   - 13 placeholders total

4. **Write customized skills**
   - Save to `.gemini/skills/mobile-automator-generator/SKILL.md`
   - Save to `.gemini/skills/mobile-automator-executor/SKILL.md`

5. **Verify completion**
   - Check no `{{` remains in output
   - Copy schema files to workspace

### The 13 Placeholders

| Placeholder | Example Value | Used By |
|---|---|---|
| `{{project_name}}` | "My Shopping App" | Both |
| `{{platform_details}}` | "Android (minSdk 24, targetSdk 34)" | Generator |
| `{{build_system}}` | "Gradle" | Executor |
| `{{build_command}}` | "gradle assembleStaging" | Executor |
| `{{app_package}}` | "com.example.shopping" | Both |
| `{{environments}}` | "production, staging, development" | Generator |
| `{{loading_indicators}}` | "CircularProgressIndicator, Shimmer" | Executor |
| `{{protected_directories}}` | "src/, lib/" | Both |
| `{{automation_extras}}` | "Uses Firebase for analytics" | Generator |
| `{{architecture}}` | "MVVM with Clean Architecture" | Generator |
| `{{business_domain}}` | "E-commerce platform for fashion retail" | Generator |
| `{{business_critical_paths}}` | "onboarding, login, checkout, payment" | Generator |
| `{{additional_resources}}` | "API docs: api.example.com" | Both |

### Example: Generator Skill

Before replacement:
```markdown
# Test Generator for {{project_name}}

You are testing {{business_domain}}.

Project Architecture: {{architecture}}
Build System: {{build_system}}
App Package: {{app_package}}

Protected source directories (never modify):
{{protected_directories}}

Loading indicators in this project:
{{loading_indicators}}

Generate realistic test scenarios...
```

After replacement:
```markdown
# Test Generator for My Shopping App

You are testing E-commerce platform for fashion retail.

Project Architecture: MVVM with Clean Architecture
Build System: Gradle
App Package: com.example.shopping

Protected source directories (never modify):
src/, lib/

Loading indicators in this project:
CircularProgressIndicator, Shimmer

Generate realistic test scenarios...
```

## Generator Skill

### Purpose

Convert natural language descriptions into structured test scenarios (JSON following Schema v2).

### Inputs

- User description: "Test login flow with email and password"
- Device context: Connected Android device
- Project knowledge: Architecture, domain, critical paths

### Process

1. Parse user intent
2. Identify test flow (sequence of user actions)
3. Map to test actions (tap, type, wait, etc.)
4. Add contextual assertions
5. Include retry logic for async operations
6. Capture values for verification
7. Output JSON scenario

### Output

```json
{
  "scenario_id": "login_flow",
  "schema_version": "2.0",
  "tags": ["authentication", "critical"],
  "actions": [
    {
      "step_id": "launch_app",
      "action_type": "launch_app",
      "description": "Launch the application"
    },
    {
      "step_id": "wait_for_login_screen",
      "action_type": "wait_for_element",
      "element_description": "Login button",
      "timeout_seconds": 10
    },
    {
      "step_id": "tap_email_field",
      "action_type": "tap",
      "element_description": "Email input field"
    },
    {
      "step_id": "type_email",
      "action_type": "type",
      "text": "test@example.com"
    },
    // ... more actions
  ],
  "assertions": [
    {
      "assertion_id": "home_screen_visible",
      "action_step_id": "wait_for_home",
      "assertion_type": "element_exists",
      "element_description": "Home screen content"
    }
  ]
}
```

### Where Placeholders Help

- `{{business_domain}}` — Helps generator understand your business logic
- `{{architecture}}` — Helps generator use the right naming conventions
- `{{business_critical_paths}}` — Focuses generator on important flows
- `{{loading_indicators}}` — Helps generator add correct wait steps
- `{{protected_directories}}` — Reminds generator not to reference source code

## Executor Skill

### Purpose

Execute test scenarios on connected devices and report detailed results with observations.

### Inputs

- Scenario JSON file
- Connected device
- Project configuration
- Reference screenshots (optional)

### Process

1. Parse scenario JSON
2. For each action:
   - Call mobile-mcp primitive
   - Execute on device
   - Capture state
3. For each assertion:
   - Check condition
   - Record result
   - Capture observation if relevant
4. Generate result report

### Output

```json
{
  "run_id": "login_flow_20250227_143022",
  "scenario_id": "login_flow",
  "schema_version": "2.0",
  "status": "passed",
  "duration_seconds": 15.3,
  "steps_executed": [
    {
      "step_id": "launch_app",
      "status": "passed",
      "duration_ms": 2300
    },
    {
      "step_id": "wait_for_login_screen",
      "status": "passed",
      "duration_ms": 450
    }
  ],
  "assertion_results": [
    {
      "assertion_id": "home_screen_visible",
      "status": "passed",
      "duration_ms": 120
    }
  ],
  "observations": [
    {
      "type": "regression",
      "step_id": "tap_email_field",
      "message": "Email field styling differs from reference screenshot"
    },
    {
      "type": "flakiness",
      "step_id": "wait_for_home",
      "message": "Loading indicator still visible after first wait, passed on retry after 2s additional wait"
    }
  ],
  "captured_variables": {
    "username": "John Doe",
    "user_id": "12345"
  }
}
```

### Where Placeholders Help

- `{{app_package}}` — Know which app to launch and verify
- `{{build_system}}` — Know how to rebuild if needed
- `{{build_command}}` — Can rebuild with correct command
- `{{loading_indicators}}` — Know what to wait for
- `{{environments}}` — Can switch environments between runs
- `{{business_critical_paths}}` — Prioritizes these paths if tests fail

## Skill Lifecycle

### 1. Installation (During Setup)

```
User runs /mobile-automator:setup
    ↓
Setup gathers knowledge (sections 1-5)
    ↓
Setup reads templates
    ↓
Setup replaces placeholders
    ↓
Setup writes to .gemini/skills/
    ↓
Skills ready for use
```

### 2. Usage (During Generate/Execute)

```
User runs /mobile-automator:generate or /mobile-automator:execute
    ↓
Tier 1 validates pre-flight
    ↓
Tier 1 invokes skill
    ↓
Skill loads config.json (runtime access to project knowledge)
    ↓
Skill executes (generates or runs test)
    ↓
Tier 1 saves result
```

### 3. Updates

**Extension Updates**: User updates mobile-automator extension
- Tier 1 commands update
- Tier 3 (mobile-mcp) can update
- Tier 2 skills DO NOT update (they stay in workspace)

**Skill Updates**: To update skills with new knowledge:
- Re-run `/mobile-automator:setup`
- It overwrites the existing skills with latest placeholders
- Config changes are preserved

## Advanced: Accessing Project Knowledge at Runtime

Skills can access the full project configuration at runtime via `mobile-automator/config.json`:

```json
{
  "project_name": "My Shopping App",
  "platform": "android",
  "environments": ["production", "staging", "development"],
  "app_package": "com.example.shopping",
  "architecture": "MVVM with Clean Architecture",
  "business_domain": "E-commerce platform for fashion retail",
  "business_critical_paths": ["onboarding", "login", "checkout", "payment"],
  "loading_indicators": ["CircularProgressIndicator", "Shimmer"],
  "protected_directories": ["src/", "lib/"],
  "build_command": "gradle assembleStaging",
  "platform_details": "Android (minSdk 24, targetSdk 34)",
  "build_system": "Gradle"
}
```

This allows skills to:
- Adapt behavior based on platform
- Use correct environment URLs
- Understand your architecture patterns
- Know what to wait for

## Modifying Skills

### Safe to Edit

Once installed, you can safely modify skills:

```bash
nano .gemini/skills/mobile-automator-generator/SKILL.md
```

**Good reasons to edit:**
- Add project-specific assertion logic
- Customize how observations are captured
- Integrate with custom CI/CD
- Add organization-specific patterns

**Don't edit:**
- The placeholder values themselves (they're auto-generated)
- Schema files in `references/`

### Preserving Changes

If you modify a skill and then re-run `/mobile-automator:setup`:
- The skill will be overwritten with fresh content
- Your modifications will be lost
- Solution: Keep a backup or commit to git before re-running setup

## Why Skills Instead of Code?

Traditional test frameworks require you to write tests in code or DSLs. Skills have significant advantages:

| Aspect | Skills | Traditional Code |
|--------|--------|------------------|
| **Readability** | Plain markdown, AI-readable | Language syntax, IDE-dependent |
| **Customization** | Auto-filled with project knowledge | Hardcoded values, must update manually |
| **Auditability** | Plain text, easy git history | Code review + build process |
| **AI Capability** | Claude understands natural language intent | Must parse code syntax |
| **Versioning** | Part of project git, tracked | Code repository complexity |
| **Learning Curve** | Minimal training needed | Language-specific knowledge required |
| **Maintenance** | Update template once | Update every test file |
| **Extensibility** | Easy to add project-specific logic | Complex inheritance/polymorphism |

## Advanced Features

### Semantic Visual Testing

The executor doesn't use pixel-by-pixel comparison. Instead, it uses AI vision to answer:

> Does this screen fulfill the same purpose as the reference?

This is done by evaluating:
- **Screen Identity** — Is this the intended screen?
- **Key Elements** — Are critical UI elements present?
- **Text Content** — Does content match expectations?
- **Layout Structure** — Are elements arranged correctly?
- **Accessibility** — Can users interact as expected?

**Benefits:**
- Tolerates cosmetic changes (fonts, colors, spacing)
- Catches functional regressions (missing buttons, wrong text)
- More stable than screenshot matching
- Requires fewer reference images

### Flakiness Detection

The executor detects when tests are flaky:

```json
{
  "observations": [{
    "type": "flakiness",
    "message": "Step 4 (wait_for_home) failed initially, passed on retry after 2s additional wait"
  }]
}
```

This helps distinguish between:
- **Real bugs** — Test fails consistently
- **Timing issues** — Test fails then passes on retry (flaky)
- **Device state** — Test fails due to device memory/performance

### Regression Detection

The executor detects visual changes beyond what assertions check:

```json
{
  "observations": [{
    "type": "regression",
    "step_id": "verify_email_field",
    "message": "Email field styling differs from reference (color changed from blue to gray)"
  }]
}
```

This catches:
- UI/UX changes not covered by assertions
- Unintended visual modifications
- Layout regressions

### Value Capture and Variables

Capture values during test execution for later verification:

```json
{
  "steps": {
    "capture_user_id": {
      "type": "capture_value",
      "element": "user_id_display",
      "capture_to": "user_id"
    },
    "verify_balance": {
      "type": "element_text",
      "element": "balance_display",
      "condition": "user_id matches variable user_id"
    }
  }
}
```

This allows:
- Dynamic assertions (compare with captured values)
- Multi-step data validation
- State verification across test steps

### Conditional Execution

Execute steps conditionally based on previous results:

```json
{
  "steps": {
    "attempt_login": { "type": "tap", "element": "login_button" },
    "check_error": {
      "type": "element_exists",
      "element": "error_message",
      "optional": true
    },
    "retry_if_error": {
      "type": "tap",
      "element": "retry_button",
      "condition": "error_message is visible"
    }
  }
}
```

This allows:
- Error recovery logic
- Different paths based on app state
- Graceful handling of edge cases

### Retry Policies

Configure how steps retry on failure:

```json
{
  "steps": {
    "wait_for_data": {
      "type": "wait_for_element",
      "element": "data_list",
      "retry_policy": {
        "max_retries": 3,
        "wait_between_retries_ms": 1000,
        "backoff_factor": 1.5
      }
    }
  }
}
```

This handles:
- Network timeouts
- Slow async operations
- Race conditions

## Testing Skills Locally

You can test how skills behave without running full tests:

```bash
# View the generator skill
cat .gemini/skills/mobile-automator-generator/SKILL.md

# Check what project knowledge was detected
cat mobile-automator/config.json

# Manually invoke the skill with test input
# (This depends on Gemini CLI capabilities)
```

## Debugging Skills

If a skill isn't behaving as expected:

1. **Check placeholders were replaced**: Ensure no `{{` in skill file
2. **Review config.json**: Verify project knowledge was detected correctly
3. **Check schemas**: Review scenario_schema_v2.json and result_schema.json
4. **Test manually**: Use Gemini CLI to invoke skill directly
5. **Edit for debugging**: Add comments in skill file temporarily

## Adding Custom Skills

You can add a third skill to your project:

### Example: mobile-automator-analyzer

Create `.gemini/skills/mobile-automator-analyzer/SKILL.md`:

```markdown
---
name: mobile-automator-analyzer
description: Analyze test results and generate reports for {{project_name}}
---

# Test Analyzer

Analyze results from mobile-automator test executions...

[Your custom logic here with {{placeholders}}]
```

Then create a command wrapper in `commands/mobile-automator/analyze.toml` to invoke it.

## Next Steps

- [Setup Guide](../guides/setup.md) — Deep dive into the 7-section setup
- [Generator Guide](../guides/generate.md) — How test generation works
- [Executor Guide](../guides/execute.md) — How test execution works
