# Contributing to Mobile Automator

First off, thank you for considering contributing to Mobile Automator! 🎉

This document provides guidelines for contributing to this project. Following these guidelines helps communicate that you respect the time of the developers managing and developing this open source project.

---

## 🤝 How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues to avoid duplicates. When creating a bug report, include:

- **Clear title** - Describe the issue concisely
- **Steps to reproduce** - Detailed steps to reproduce the behavior
- **Expected behavior** - What you expected to happen
- **Actual behavior** - What actually happened
- **Environment details**:
  - Mobile Automator (`mauto`) version
  - AI agent / host (Claude Code, Cursor, Gemini CLI, etc.)
  - Node version (`node --version`)
  - Platform (Android/iOS/Flutter/React Native/etc.)
  - OS (macOS/Linux/Windows)
- **Screenshots/logs** - If applicable
- **Setup state** - Contents of `mobile-automator/config.json` (remove sensitive data)

**Example:**
```markdown
**Bug:** Setup fails to detect React Native platform

**Steps:**
1. Run `mauto setup` in a React Native project
2. Setup claims platform is "unknown"

**Expected:** Should detect React Native from package.json
**Actual:** Platform detection fails

**Environment:**
- mauto: v0.21.0
- Host: Claude Code
- Node: v18.19.0
- Platform: React Native 0.73
- OS: macOS Sonoma 14.5
```

---

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion:

- **Use a clear title** describing the enhancement
- **Provide detailed description** of the proposed functionality
- **Explain why this enhancement would be useful** to most users
- **List alternatives you've considered**
- **Include mockups/examples** if applicable

**Areas for enhancement:**
- New platform support (Xamarin, Ionic, etc.)
- Additional assertion types
- Enhanced architecture detection
- CI/CD integrations
- Visual regression testing features
- Performance improvements

---

### Pull Requests

1. **Fork the repository** and create your branch from `main`
2. **Follow the development setup** (see below)
3. **Make your changes** following our coding standards
4. **Test thoroughly** in a real mobile project
5. **Update documentation** if you've changed APIs or added features
6. **Write clear commit messages** (see commit guidelines below)
7. **Submit a pull request**

**PR Checklist:**
- [ ] Code follows the project's style guidelines
- [ ] I have tested this with at least 2 different mobile projects
- [ ] I have updated the documentation (README, CHANGELOG, etc.)
- [ ] My changes don't break existing functionality
- [ ] I have added an entry to CHANGELOG.md under "Unreleased"

---

## 💻 Development Setup

### Prerequisites

- **Git** - Version control
- **Node ≥ 18** - `mauto` is a Node CLI
- **An AI coding agent** - Claude Code, Cursor, Gemini CLI, GitHub Copilot, or any MCP-capable agent
- **A test mobile project** - Android, iOS, Flutter, or React Native app for testing

### Local Development

1. **Clone your fork:**
   ```bash
   git clone https://github.com/YOUR-USERNAME/mobile-automator.git
   cd mobile-automator
   ```

2. **Install deps and expose `mauto` on your PATH:**
   ```bash
   npm install   # installs the pinned mobile-mcp engine
   npm link      # exposes `mauto` / `mobile-automator` globally
   ```

3. **Test in a mobile project:**
   ```bash
   cd ~/path/to/test-mobile-app
   mauto init --agent claude   # wire your agent (or: cursor | gemini | copilot | agents | all)
   mauto setup                 # scaffold the mobile-automator/ workspace
   mauto devices               # confirm a device/emulator is visible
   ```

4. **Make changes and test:**
   - Edit the workflow prose in `src/guide/content/**/*.md`, the verb handlers in
     `src/`, or the schemas in `src/schemas/`
   - Exercise the verbs directly (`mauto guide <topic>`, `mauto elements`, `mauto validate <file>`, …)
   - Run the test suite (`npm test`) and the guide lint guards (`npm run lint:guides`)

5. **Unlink when done:**
   ```bash
   npm unlink -g mobile-automator
   ```

### Prompt Linting (Vale + pre-commit)

The CLI guide prose under `src/guide/content/**/*.md` is linted by [Vale](https://vale.sh) with a `PromptHygiene` style that catches characters known to confuse AI agents or downstream parsers: the section sign (`§`), smart/curly quotes, non-breaking spaces, and zero-width characters. The same rules run in CI on every PR.

To run the same checks locally before you push:

1. **Install Vale** (one-time):
   ```bash
   brew install vale          # macOS
   # or follow https://vale.sh/docs/install for Linux/Windows
   ```

2. **Install the pre-commit framework** (one-time):
   ```bash
   pip install pre-commit     # or: brew install pre-commit
   ```

3. **Wire up the git hook** (one-time per clone):
   ```bash
   pre-commit install
   ```

After that, `git commit` automatically runs Vale on staged prompt files. To run it manually against the whole repo:

```bash
vale .
```

Path scoping lives in `.vale.ini` - `PromptHygiene` only attaches to `src/guide/content/**/*.md`. Human-facing docs are scanned but unscoped, so they never produce errors.

If a rule fires, the message tells you what to replace it with. To add a new rule, drop a YAML file into `.vale/styles/PromptHygiene/`.

---

## 📝 Coding Guidelines

### File Organization

```
src/
├── cli.js                       # verb registration + handlers
├── guide/content/               # workflow prose pulled by `mauto guide <topic>`
│   ├── <topic>.aware.md         #   platform-aware variant
│   ├── <topic>.agnostic.md      #   platform-agnostic variant
│   └── <topic>.invariants.md    #   placeholder-free, OS-free skill core
├── schemas/                     # scenario_schema.json (v2.1), result_schema.json
├── device/                      # mobile-mcp wrapper (one persistent session daemon)
└── init/  setup/  config/  …    # host adapters, workspace scaffold, config
CLAUDE.md                        # developer guide (architecture, workflows)
README.md                        # user-facing documentation
```

### Guide Content Standards (`src/guide/content/**/*.md`)

- **Each guide topic has two mode variants** — `<topic>.aware.md` and `<topic>.agnostic.md`
- **Use `{{placeholder}}` tokens** for config-derived values; they are filled by
  `src/guide/placeholders.js` at emit time
- **Never name raw `mobile_*` tools** — the agent drives the device only through `mauto` verbs
- **Agnostic variants name no OS** — map gestures to the four semantic actions instead
- Lint guards in `tests/lint/guide-*.test.js` enforce all three rules

**Example:**
```markdown
## Resolve the target

1. Call `mauto elements` to list on-screen targets.
2. Pick the element by visible text + role — never a resource-id.
3. Tap it with `mauto tap --at <x,y>`.
```

### Documentation Standards

- **`src/guide/content/**/*.md`** - Agent-facing workflow prose (pulled via `mauto guide`)
- **CLAUDE.md** - Developer guide, architecture, workflows
- **README.md** - User guide, quick start, features
- **CHANGELOG.md** - Keep a Changelog format, semantic versioning
- **TROUBLESHOOTING.md** - Common issues and solutions

### Commit Message Format

Follow conventional commits:

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

**Types:**
- `feat:` - New feature
- `fix:` - Bug fix
- `docs:` - Documentation changes
- `refactor:` - Code refactoring
- `test:` - Test improvements
- `chore:` - Maintenance tasks

**Examples:**
```
feat(setup): Add KMP platform detection
fix(execute): Prevent auto-selection of last scenario
docs(readme): Add motivation section
refactor(setup): Improve environment discovery logic
```

---

## 🧪 Testing Guidelines

### Manual Testing Checklist

Test your changes with:

1. **Multiple platforms:**
   - [ ] Android (Gradle)
   - [ ] iOS (Xcode)
   - [ ] Flutter
   - [ ] React Native

2. **Different scenarios:**
   - [ ] Fresh project (no previous setup)
   - [ ] Existing setup (resume capability)
   - [ ] Multiple environments (staging, prod)
   - [ ] Non-standard project structure

3. **Command flow:**
   - [ ] `mauto setup` completes successfully
   - [ ] `mauto devices` lists a connected device
   - [ ] The generate workflow (`/mobile-automator-generate` or `mauto guide generate`) records scenarios
   - [ ] The execute workflow (`/mobile-automator-execute` or `mauto guide execute`) replays scenarios
   - [ ] `mauto validate <file>` accepts the generated scenario
   - [ ] Verbs emit the `{ok,data,error,hint,schema_version}` envelope

### Test Project Setup

Keep test projects for each platform:

```bash
~/mobile-automator-tests/
├── android-app/         # Gradle-based Android
├── ios-app/            # Xcode project
├── flutter-app/        # Flutter project
├── react-native-app/   # RN with Expo or bare
└── kmp-app/           # Kotlin Multiplatform
```

---

## 📋 Pull Request Process

1. **Update CHANGELOG.md** - Add your changes under `## [Unreleased]`
2. **Update version** (maintainers will handle this for releases)
3. **Ensure all tests pass** in multiple test projects
4. **Get review approval** from maintainers
5. **Squash commits** if requested
6. **Merge** will be done by maintainers

### PR Title Format

Use conventional commit format:
```
feat(setup): Add Xamarin platform support
fix(execute): Handle empty scenario list gracefully
docs: Update troubleshooting guide
```

---

## 🎯 Priority Areas

We especially welcome contributions in these areas:

### High Priority
- **Additional platform support** - Xamarin, Ionic, Cordova
- **Bug fixes** - Especially for edge cases in platform detection
- **Improved error messages** - Make failures more actionable
- **Documentation improvements** - Tutorials, examples, guides

### Medium Priority
- **Enhanced architecture detection** - More patterns (MVI, Flux, etc.)
- **Additional assertion types** - Network, database, permissions
- **Performance optimizations** - Faster setup, lighter footprint

### Future Enhancements
- **Visual regression testing** - Screenshot comparison with AI
- **CI/CD integration** - GitHub Actions, CircleCI examples
- **Test result analytics** - Trend analysis, flakiness detection

---

## 💬 Community

- **Issues** - [GitHub Issues](https://github.com/sh3lan93/mobile-automator/issues)
- **Discussions** - Use GitHub Discussions for questions and ideas
- **Contributing** - This guide!

---

## 📜 Code of Conduct

### Our Standards

- **Be respectful** - Treat everyone with respect
- **Be collaborative** - Work together constructively
- **Be patient** - Help others learn and grow
- **Be inclusive** - Welcome diverse perspectives

### Unacceptable Behavior

- Harassment, discrimination, or offensive comments
- Trolling, insulting comments, or personal attacks
- Publishing others' private information
- Any conduct that could be considered inappropriate

---

## ❓ Questions?

Don't hesitate to ask! Open an issue with the `question` label or start a discussion.

---

**Thank you for contributing to Mobile Automator!** 🎉

Your efforts help make mobile QA automation accessible to everyone.
