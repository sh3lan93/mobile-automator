---
description: "Contributing guide for mobile-automator - development setup, code standards, testing workflow, PR guidelines, and project architecture."
---

# Contributing

We welcome contributions to mobile-automator! This guide explains how to get started developing, submitting changes, and helping improve the project.

mobile-automator is a host-agnostic **`mauto` CLI**: any AI agent drives a device through `mauto` verbs (which wrap the mobile-mcp engine), and pulls its reasoning on demand via `mauto guide`. Contributions touch the verb handlers in `src/`, the workflow prose in `src/guide/content/**/*.md`, and the schemas in `src/schemas/`.

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

- **Node.js ≥ 18** — `mauto` is a Node CLI
- **Git** — For version control
- **An AI coding agent** — Claude Code, Cursor, Gemini CLI, GitHub Copilot, or any MCP-capable agent
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

### Install & Link the CLI Locally

To test changes while developing, install dependencies and expose `mauto` on your PATH:

```bash
# From the mobile-automator repo
npm install   # installs the pinned mobile-mcp engine
npm link      # exposes `mauto` / `mobile-automator` globally

# In a test mobile project
cd /path/to/test-mobile-app
mauto init --agent claude   # wire your agent (or: cursor | gemini | copilot | agents | all)
mauto setup                 # scaffold the mobile-automator/ workspace
mauto devices               # confirm a device/emulator is visible
```

When you are done, run `npm unlink -g mobile-automator` to remove the global link.

### Directory Structure

```
mobile-automator/
├── bin/
│   ├── mauto.js                 # entry point for `mauto` / `mobile-automator`
│   └── mauto-session-daemon.js  # entry point for the device session daemon
├── src/
│   ├── cli.js                   # verb registration + handlers
│   ├── guide/content/           # workflow prose pulled by `mauto guide <topic>`
│   │   ├── <topic>.aware.md      #   platform-aware variant
│   │   ├── <topic>.agnostic.md   #   platform-agnostic variant
│   │   └── <topic>.invariants.md #   placeholder-free, OS-free skill core
│   ├── schemas/                 # scenario_schema.json (v2.1), result_schema.json
│   ├── device/                  # mobile-mcp wrapper (one persistent session daemon)
│   └── init/ setup/ config/ …   # host adapters, workspace scaffold, config
├── CLAUDE.md                    # developer guide (architecture, workflows)
├── README.md                    # user-facing docs
└── docs/                        # website content
```

### Understanding the Flow

The contract is: **agent (the brain) → `mauto` verbs → mobile-mcp engine → device**. The agent drives the device *only* through `mauto` verbs; mobile-mcp is the internal engine those verbs wrap.

1. **Verb handlers** (`src/cli.js` + `src/`)
   - Every verb (`elements`, `tap`, `type`, `swipe`, `press`, `screenshot`, …) emits the uniform JSON envelope `{ok,data,error,hint,schema_version}`.
   - `src/device/` wraps the mobile-mcp engine via one persistent session daemon.

2. **Guide content** (`src/guide/content/<topic>.<aware|agnostic>.md`)
   - Contains the test generation/execution reasoning, pulled on demand via `mauto guide <topic>`.
   - Uses `{{placeholders}}` for project-specific values, filled by `src/guide/placeholders.js` at emit time.

3. **Schemas** (`src/schemas/*.json`)
   - Define the test scenario format (scenario schema 2.1) and the test result format.
   - Enforced by `mauto validate <file>`.

---

## Making Changes

### Feature Types

#### 1. Guide Content Changes

Modifying the generate/execute/setup workflow prose:

```bash
# Edit the workflow prose (both mode variants)
vim src/guide/content/generate.aware.md
vim src/guide/content/generate.agnostic.md

# Inspect the emitted guide
mauto guide generate

# Test in a mobile project
cd /path/to/test-mobile-app
mauto guide generate   # exercise the generate workflow
mauto guide execute    # exercise the execute workflow
```

**Guidelines:**
- Keep prompts clear and concise
- Every guide topic has two mode variants — `<topic>.aware.md` and `<topic>.agnostic.md`
- Reference `{{placeholders}}` for project context
- **Never name raw `mobile_*` tools** — the agent drives the device only through `mauto` verbs (this is a lint failure)
- **Agnostic variants name no OS** — map gestures to the four semantic actions instead
- Test with multiple project types (Android, iOS, Flutter, etc.)

#### 2. Schema Changes

Modifying test scenario or result format:

```bash
# Edit schema
vim src/schemas/scenario_schema.json

# Validate a scenario against it
mauto validate path/to/scenario.json

# Update the execute guide to support new fields
vim src/guide/content/execute.aware.md
```

**Guidelines:**
- Use JSON Schema format
- Maintain backward compatibility where possible (schema 2.1 is additive over 2.0)
- Add `description` for each new field
- Update `mauto schema scenario` / `mauto schema result` output expectations
- Update reference documentation

#### 3. Verb / Workflow Changes

Modifying a verb handler or setup behavior:

```bash
# Edit the verb registration + handlers
vim src/cli.js

# For complex changes, test multiple scenarios
# - Different platforms (Android, iOS, Flutter, etc.)
# - Different project structures
# - Different modes (platform-aware, platform-agnostic)
```

**Guidelines:**
- Changes must not break existing projects (preserve the `mobile-automator/` workspace layout)
- Every verb must emit the `{ok,data,error,hint,schema_version}` envelope
- Workspace state lives in `mobile-automator/config.json`
- Never use `resource-id` / OS-specific element IDs

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

### Automated Tests & Lint

The fastest signal is the test suite plus the guide lint guards:

```bash
npm test              # run the full test suite
npm run lint:guides   # guide-content lint guards
```

The lint guards enforce that guide content under `src/guide/content/**/*.md`:

- has no surviving `{{placeholders}}`,
- leaks no `mobile_*` engine tool names, and
- (agnostic variants) names no OS.

### Manual Testing

**Test a guide-content change end to end:**

```bash
# 1. In test mobile project
cd /path/to/test-mobile-app

# 2. Run setup
mauto setup

# 3. Confirm a device is visible
mauto devices

# 4. Exercise the generate workflow
mauto guide generate

# 5. Exercise the execute workflow
mauto guide execute

# 6. Check results
cat mobile-automator/results/run_*.json | jq '.'
```

**Test different platforms:**

```bash
# Test on Android
adb devices
cd /path/to/android-app
mauto setup
mauto guide generate

# Test on iOS
xcrun simctl list
cd /path/to/ios-app
mauto setup
mauto guide generate

# Test on Flutter
cd /path/to/flutter-app
mauto setup
mauto guide generate
```

### Regression Testing

After making changes:

1. **Run the suite** — `npm test` and `npm run lint:guides` pass
2. **Test full setup workflow** — Run `mauto setup` to completion
3. **Test scenario generation** — Generate at least 3 scenarios
4. **Test execution** — Execute generated scenarios
5. **Test result collection** — Verify results are valid JSON and `mauto validate` accepts the scenarios
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
- **How tested?** — Testing performed (`npm test`, `npm run lint:guides`, manual runs)
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
- `npm test` and `npm run lint:guides` pass
- Tested on Android with custom Shimmer
- Tested on iOS with custom SkeletonView
- Tested with project having no custom indicators

## Related
Closes #123
```

---

## Code Standards

### Guide Content (`src/guide/content/**/*.md`)

**Structure:**
```markdown
## Resolve the target

1. Call `mauto elements` to list on-screen targets.
2. Pick the element by visible text + role — never a resource-id.
3. Tap it with `mauto tap --at <x,y>`.
```

**Style:**
- Use clear section headings (`##` or `###`)
- Include code examples in JSON blocks
- Reference `{{placeholders}}` in text; they are filled at emit time
- Never name raw `mobile_*` tools — drive the device through `mauto` verbs
- Agnostic variants name no OS — use the four semantic actions
- Keep lines readable (80-100 chars)

### Schemas (JSON)

**Structure:**
```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "Test Scenario Schema",
  "type": "object",
  "required": ["$schema_version", "scenario_id", "name", "steps", "assertions"],
  "properties": {
    "$schema_version": {
      "type": "string",
      "enum": ["2.1"],
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

### Verb Handlers (`src/`)

**Style:**
- Register every verb in `src/cli.js`
- Emit the uniform `{ok,data,error,hint,schema_version}` envelope (a `--human` flag is opt-in)
- One-shot verbs only — no interactive co-routine
- Drive the device only through the `src/device/` mobile-mcp wrapper
- Never use `resource-id` / OS-specific element IDs

---

## Documentation

### Updating Docs

When making code changes, update corresponding docs:

1. **Updated guide content** → Update [Guides](guides/index.md)
2. **New assertion type** → Update [Assertions](reference/assertions.md)
3. **Schema changes** → Update [Schema Reference](reference/schema.md)
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
  "$schema_version": "2.1",
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
- `mauto` version and the contents of `mobile-automator/config.json` (remove sensitive data)

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

1. Link the development branch: `npm install && npm link` from the repo
2. Test with your mobile project (`mauto setup`, `mauto guide generate`, `mauto guide execute`)
3. Report issues: `gh issue create`
4. Verify fixes: `gh pr list` → comment

---

## Review Process

### What We Look For

✅ **Approved when:**
- Code follows standards
- `npm test` and `npm run lint:guides` pass
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

# 2. Install deps and link the CLI
npm install
npm link

# 3. Create feature branch
git checkout -b feature/custom-assertions

# 4. Make changes
# - Edit src/guide/content/generate.aware.md (and .agnostic.md)
# - Add assertion example to docs/reference/assertions.md
# - Update changelog

# 5. Test locally
npm test
npm run lint:guides
cd /path/to/test-app
mauto setup
mauto guide generate

# 6. Commit
cd /path/to/mobile-automator
git add -A
git commit -m "feat: add custom assertion type"

# 7. Push
git push origin feature/custom-assertions

# 8. Create PR
gh pr create --title "feat: add custom assertion support" \
             --body "Enables users to define custom assertions..."

# 9. Address review feedback
git add -A
git commit -m "Address review feedback"
git push

# 10. Merge (after approval)
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
- **[Architecture Documentation](concepts/architecture.md)** — Understand the agent → `mauto` → mobile-mcp → device design
- **[Core Concepts](concepts/index.md)** — Foundation for CLI development
- **[Full Guides](guides/index.md)** — Detailed command walkthroughs

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
</content>
</invoke>
