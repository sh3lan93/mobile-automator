# Contributing

We welcome contributions to mobile-automator! This guide explains how to get started developing, submitting changes, and helping improve the project.

## Table of Contents

1. [Getting Started](#getting-started)
2. [Development Setup](#development-setup)
3. [Making Changes](#making-changes)
4. [Testing](#testing)
5. [Submitting Changes](#submitting-changes)
6. [Code Standards](#code-standards)
7. [Documentation](#documentation)
8. [Types of Contributions](#types-of-contributions)

---

## Getting Started

### Prerequisites

Before contributing, ensure you have:

- **Node.js 20+** — Required for Gemini CLI and MCP server
- **Git** — For version control
- **Mobile tools**:
  - **Android:** Android SDK, ADB, Android emulator or device
  - **iOS:** Xcode command-line tools, iOS simulator or device
- **A test mobile app** — For testing changes locally

### Fork & Clone

```bash
# Fork the repository on GitHub
gh repo fork sh3lan93/mobile-automator --clone

# Navigate to directory
cd mobile-automator

# Add upstream remote
git remote add upstream https://github.com/sh3lan93/mobile-automator.git
```

---

## Development Setup

### Link Extension Locally

To test changes while developing:

```bash
# From mobile-automator directory
gemini extensions link .

# In a test mobile project
cd /path/to/test-mobile-app
gemini /mobile-automator:setup  # Test the extension
```

### Directory Structure

```
mobile-automator/
├── commands/                  # Gemini CLI command definitions
│   └── mobile-automator/
│       ├── setup.toml        # Setup workflow
│       ├── generate.toml      # Generate wrapper command
│       ├── execute.toml       # Execute wrapper command
│       └── migrate.toml       # Migration tool
├── templates/                 # Skill templates
│   ├── mobile-automator-generator/
│   │   ├── SKILL.md          # Generator skill with {{placeholders}}
│   │   └── references/        # Schema files
│   └── mobile-automator-executor/
│       ├── SKILL.md          # Executor skill with {{placeholders}}
│       └── references/        # Schema files
├── gemini-extension.json      # Extension manifest
├── GEMINI.md                  # AI context for Gemini
├── CLAUDE.md                  # Developer documentation
├── README.md                  # User-facing docs
└── docs/                      # Website content
```

### Understanding the Flow

1. **Extension commands** (`commands/mobile-automator/*.toml`)
   - User-facing commands: `/mobile-automator:setup`, `/mobile-automator:generate`, etc.
   - Handle pre-flight checks and validation
   - Delegate to skills for actual work

2. **Skill templates** (`templates/mobile-automator-*/SKILL.md`)
   - Contain test generation/execution logic
   - Use `{{placeholders}}` for project-specific values
   - Populated during setup Section 6.0

3. **Schemas** (`templates/*/references/*.json`)
   - Define test scenario format (v2, v1 legacy)
   - Define test result format
   - Referenced by skills for validation

---

## Making Changes

### Feature Types

#### 1. Skill Template Changes

Modifying generator or executor skills:

```bash
# Edit template
vim templates/mobile-automator-generator/SKILL.md

# Test in a mobile project
cd /path/to/test-mobile-app
gemini /mobile-automator:setup      # Re-populate skill
gemini /mobile-automator:generate   # Test generation
gemini /mobile-automator:execute    # Test execution
```

**Guidelines:**
- Keep prompts clear and concise
- Use section markers for organization
- Reference `{{placeholders}}` for project context
- Add comments for complex logic
- Test with multiple project types (Android, iOS, Flutter, etc.)

#### 2. Schema Changes

Modifying test scenario or result format:

```bash
# Edit schema
vim templates/mobile-automator-generator/references/scenario_schema_v2.json

# Validate schema syntax
npm run validate-schemas  # If you add this script

# Update executor to support new fields
vim templates/mobile-automator-executor/SKILL.md
```

**Guidelines:**
- Use JSON Schema format (draft-07)
- Maintain backward compatibility where possible
- Add `description` for each new field
- Provide example in comments
- Update GEMINI.md schema registry
- Update reference documentation

#### 3. Command Workflow Changes

Modifying setup or command behavior:

```bash
# Edit command
vim commands/mobile-automator/setup.toml

# For complex changes, test multiple scenarios
# - Different platforms (Android, iOS, Flutter, etc.)
# - Different project structures
# - Different environments (staging, prod, custom)
```

**Guidelines:**
- Changes must not break existing projects
- Maintain resume capability (save state between sections)
- Test resume from each section
- Add new state to `mobile-automator/setup_state.json`

#### 4. Documentation Changes

Updating guides, examples, or reference:

```bash
# Edit markdown
vim docs/guides/setup.md
vim docs/examples/android.md
vim docs/faq.md

# Preview locally (if mkdocs setup)
mkdocs serve
```

**Guidelines:**
- Use clear, concise language
- Include code examples
- Link to related sections
- Update table of contents
- Add to changelog

---

## Testing

### Manual Testing

**Test a new skill template:**

```bash
# 1. In test mobile project
cd /path/to/test-mobile-app

# 2. Run setup
gemini /mobile-automator:setup

# 3. Verify skill populated correctly
cat .gemini/skills/mobile-automator-generator/SKILL.md | grep "{{"
# ^ Should return nothing (no placeholders remaining)

# 4. Generate a test
gemini /mobile-automator:generate

# 5. Execute the test
gemini /mobile-automator:execute

# 6. Check results
cat mobile-automator/results/run_*.json | jq '.'
```

**Test different platforms:**

```bash
# Test on Android
adb devices
cd /path/to/android-app
gemini /mobile-automator:setup
gemini /mobile-automator:generate

# Test on iOS
xcrun simctl list
cd /path/to/ios-app
gemini /mobile-automator:setup
gemini /mobile-automator:generate

# Test on Flutter
cd /path/to/flutter-app
gemini /mobile-automator:setup
gemini /mobile-automator:generate
```

### Regression Testing

After making changes:

1. **Test full setup workflow** — Run setup to completion
2. **Test scenario generation** — Generate at least 3 scenarios
3. **Test execution** — Execute generated scenarios
4. **Test result collection** — Verify results are valid JSON
5. **Test resume capability** — Stop setup mid-way, resume it
6. **Test with different projects** — Android, iOS, Flutter, React Native

---

## Submitting Changes

### Create a Branch

```bash
# Create feature branch
git checkout -b feature/my-feature

# Or bug fix branch
git checkout -b fix/issue-description
```

**Branch naming conventions:**
- `feature/` — New features
- `fix/` — Bug fixes
- `docs/` — Documentation
- `refactor/` — Code cleanup
- `test/` — Test improvements

### Commit Messages

Write clear, descriptive commit messages:

```
# Good commit message format
feat: add support for custom loading indicators
fix: handle missing package ID in iOS projects
docs: improve setup guide with examples
refactor: simplify placeholder replacement logic

# Format: type(scope): description
# Types: feat, fix, docs, refactor, test, chore
```

### Push & Open PR

```bash
# Push to your fork
git push origin feature/my-feature

# Create pull request
gh pr create --title "feat: add custom assertions" \
             --body "This PR adds support for..."

# Or use GitHub web interface
```

### PR Description

Include:
- **What changes?** — Brief description
- **Why?** — Problem being solved
- **How tested?** — Testing performed
- **Links** — Related issues or discussions

Example:
```markdown
## Description
Add support for custom loading indicators beyond built-in patterns.

## Problem
Users with custom loading indicators (spinners, animations) couldn't
verify completion. Tests had to use fixed wait times.

## Solution
- Scan source for custom loading patterns
- Add `custom_loading_indicators` to project config
- Include in precondition evaluation

## Testing
- Tested on Android with custom Shimmer
- Tested on iOS with custom SkeletonView
- Tested with project having no custom indicators

## Related
Closes #123
```

---

## Code Standards

### Skill Templates (Markdown)

**Structure:**
```markdown
---
name: skill-name
description: What this skill does
---

# Skill Title

[Introduction section]

## Key Responsibilities

- Responsibility 1
- Responsibility 2

## Implementation Details

[Detailed explanation with code examples]

### Using {{Placeholders}}

Explain what each placeholder means:
- `{{app_package}}` — Android package or iOS bundle ID
- `{{architecture}}` — Detected architecture pattern

## Assertions

List supported assertion types with examples

## Variables

Explain how to use captured variables
```

**Style:**
- Use clear section headings (## or ###)
- Include code examples in JSON blocks
- Reference placeholders in text
- Comment complex logic
- Keep lines readable (80-100 chars)

### Schemas (JSON)

**Structure:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Test Scenario Schema v2",
  "type": "object",
  "required": ["$schema_version", "scenario_id", "name", "steps", "assertions"],
  "properties": {
    "$schema_version": {
      "type": "string",
      "enum": ["2.0"],
      "description": "Schema version identifier"
    },
    "new_field": {
      "type": "string",
      "description": "What this field does",
      "examples": ["example1", "example2"]
    }
  }
}
```

**Style:**
- Use `title` and `description` generously
- Provide `examples` for complex fields
- Use `required` array for mandatory fields
- Reference other schemas with `$ref`
- Document version changes

### Commands (TOML)

**Structure:**
```toml
# Command description and purpose
# Workflow: Step 1 → Step 2 → Step 3

[[steps]]
id = "step_1"
prompt = "What should we verify?"

# Explanation of this step
# Include context from previous steps

[[steps]]
id = "step_2"
task = """
${workspacePath}/path/to/skill
...skill configuration...
"""
```

**Style:**
- Add comments explaining workflow
- Use descriptive step IDs
- Include task descriptions
- Reference workspace paths correctly
- Handle state between steps

---

## Documentation

### Updating Docs

When making code changes, update corresponding docs:

1. **Updated skill** → Update [Guides](guides/index.md)
2. **New assertion type** → Update [Assertions](reference/assertions.md)
3. **Schema changes** → Update [Schema Reference](reference/schema-v2.md)
4. **New feature** → Add example to [Examples](examples/index.md)
5. **Bug fix** → Update [Changelog](changelog.md)

### Writing Examples

Include complete, runnable examples:

```markdown
## Example: Login Flow

Complete scenario showing authentication:

### Scenario JSON

\`\`\`json
{
  "$schema_version": "2.0",
  "scenario_id": "login_example",
  ...
}
\`\`\`

### What This Tests

- Authentication flow
- Error handling
- Loading states

### Adaptation Tips

- Change email for different account
- Adjust timeouts for network speed
```

### Building Docs

If using mkdocs:

```bash
# Install dependencies
pip install mkdocs mkdocs-material

# Preview locally
mkdocs serve
# Visit http://localhost:8000

# Build for production
mkdocs build
```

---

## Types of Contributions

### Bug Reports

Found an issue? Please report it:

```bash
gh issue create --title "Bug: tests fail on Android 14" \
                 --body "Description of the issue..."
```

**Include:**
- Platform (Android, iOS, Flutter, etc.)
- Reproduction steps
- Expected vs actual behavior
- Device/simulator details
- Test app version

### Feature Requests

Have an idea? Share it:

```bash
gh issue create --title "Feature: add support for video recording" \
                 --body "Use case and desired behavior..."
```

**Include:**
- Problem you're solving
- Proposed solution
- Example usage
- Why it's useful

### Documentation Improvements

Help clarify or expand docs:

1. **Typos & clarity** — Quick edits
2. **Add examples** — Show real-world usage
3. **Expand sections** — Detail underexplained topics
4. **Create guides** — Step-by-step walkthroughs
5. **Improve FAQs** — Answer common questions

### Code Reviews

Help review pull requests:

```bash
# View open PRs
gh pr list

# Review a PR
gh pr review 42 --comment "Consider adding test case for..."
```

### Testing & QA

Help test new features:

1. Link the development branch: `gemini extensions link .`
2. Test with your mobile project
3. Report issues: `gh issue create`
4. Verify fixes: `gh pr list` → comment

---

## Review Process

### What We Look For

✅ **Approved when:**
- Code follows standards
- Tests pass
- Documentation updated
- Backwards compatible
- No breaking changes

❌ **Needs work if:**
- Missing tests
- Outdated docs
- Breaking changes
- Style inconsistencies
- Unclear implementation

### Getting Feedback

1. **Author submits PR**
2. **Maintainers review** (1-3 days)
3. **CI/CD checks run** automatically
4. **Discussion in PR comments** if needed
5. **Requested changes** applied
6. **Re-review** if significant changes
7. **Merge** when approved

---

## Development Workflow Example

```bash
# 1. Fork and clone
gh repo fork sh3lan93/mobile-automator --clone
cd mobile-automator

# 2. Create feature branch
git checkout -b feature/custom-assertions

# 3. Make changes
# - Edit templates/mobile-automator-generator/SKILL.md
# - Add assertion example to docs/reference/assertions.md
# - Update changelog

# 4. Test locally
cd /path/to/test-app
gemini extensions link /path/to/mobile-automator
gemini /mobile-automator:setup
gemini /mobile-automator:generate

# 5. Commit
cd /path/to/mobile-automator
git add -A
git commit -m "feat: add custom assertion type"

# 6. Push
git push origin feature/custom-assertions

# 7. Create PR
gh pr create --title "feat: add custom assertion support" \
             --body "Enables users to define custom assertions..."

# 8. Address review feedback
git add -A
git commit -m "Address review feedback"
git push

# 9. Merge (after approval)
gh pr merge 42
```

---

## Community & Communication

### Getting Help

- **Questions** → [GitHub Issues](https://github.com/sh3lan93/mobile-automator/issues)
- **Issues** → [GitHub Issues](https://github.com/sh3lan93/mobile-automator/issues)
- **Ideas** → Share in Discussions
- **Feedback** → Welcome all suggestions

### Code of Conduct

- Be respectful and professional
- Value diversity and inclusion
- Assume good intent
- Give constructive feedback
- Help others learn

---

## Release Process

Once your PR is merged, it will be included in the next release. See the [Changelog](changelog.md) for version history details.

**Version numbers:** We use Semantic Versioning
- **Major** (1.0.0) — Breaking changes
- **Minor** (1.1.0) — New features, backwards compatible
- **Patch** (1.1.1) — Bug fixes

---

## Resources

- **[JSON Schema Docs](https://json-schema.org/)** — Schema validation
- **[Architecture Documentation](../concepts/architecture.md)** — Understand the 3-tier design
- **[Core Concepts](../concepts/index.md)** — Foundation for extension development
- **[Full Guides](../guides/index.md)** — Detailed command walkthroughs

---

## Questions?

Don't hesitate to ask:

1. **GitHub Discussions** — For general questions
2. **GitHub Issues** — For bugs and features
3. **PR comments** — For implementation details

We're here to help make contributing as smooth as possible!

---

Thank you for contributing to mobile-automator! 🎉

[Back to Docs →](index.md)
