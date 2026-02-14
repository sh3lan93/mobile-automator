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
  - Mobile Automator version
  - Gemini CLI version (`gemini --version`)
  - Platform (Android/iOS/Flutter/React Native/etc.)
  - OS (macOS/Linux/Windows)
- **Screenshots/logs** - If applicable
- **Setup state** - Contents of `mobile-automator/config.json` (remove sensitive data)

**Example:**
```markdown
**Bug:** Setup fails to detect React Native platform

**Steps:**
1. Run `/mobile-automator:setup` in a React Native project
2. Setup claims platform is "unknown"

**Expected:** Should detect React Native from package.json
**Actual:** Platform detection fails

**Environment:**
- Mobile Automator: v0.1.0
- Gemini CLI: v1.0.0
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
- **Gemini CLI** - `npm install -g @anthropic/gemini-cli`
- **A test mobile project** - Android, iOS, Flutter, or React Native app for testing

### Local Development

1. **Clone your fork:**
   ```bash
   git clone https://github.com/YOUR-USERNAME/mobile-automator.git
   cd mobile-automator
   ```

2. **Link the extension locally:**
   ```bash
   gemini extensions link .
   ```

3. **Test in a mobile project:**
   ```bash
   cd ~/path/to/test-mobile-app
   gemini
   > /mobile-automator:setup
   ```

4. **Make changes and test:**
   - Edit files in `commands/mobile-automator/` or `templates/`
   - Reload skills: `/skills reload`
   - Test your changes thoroughly

5. **Unlink when done:**
   ```bash
   gemini extensions unlink mobile-automator
   ```

---

## 📝 Coding Guidelines

### File Organization

```
mobile-automator/
├── commands/mobile-automator/   # Command definitions
│   ├── setup.toml              # Setup workflow
│   ├── generate.toml           # Pre-flight wrapper for generator
│   └── execute.toml            # Pre-flight wrapper for executor
├── templates/                   # Skill templates
│   ├── mobile-automator-generator/
│   └── mobile-automator-executor/
├── GEMINI.md                    # AI context (schema, conventions)
├── CLAUDE.md                    # Developer documentation
└── README.md                    # User-facing documentation
```

### Command File Standards (.toml)

- **Use clear section headers** with numbered protocols
- **Add CRITICAL warnings** for important constraints
- **Include explicit WAIT instructions** for user interactions
- **Add "END YOUR TURN" guards** before user responses
- **Document all placeholders** in skill templates
- **Use descriptive variable names** in prompts

**Example:**
```toml
## 2.0 PLATFORM DETECTION

1. **Announce Action:** "Detecting mobile platform..."

2. **Scan Project Files:** Look for platform indicators...

3. **ABSOLUTE REQUIREMENT: END YOUR TURN HERE.**
   - **DO NOT PROCEED until the user responds.**
   - The user will respond in the next message.
```

### Documentation Standards

- **GEMINI.md** - AI context, schemas, tool mappings
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
   - [ ] `/mobile-automator:setup` completes successfully
   - [ ] `/skills reload` required after setup
   - [ ] `/mobile-automator:generate` records scenarios
   - [ ] `/mobile-automator:execute` replays scenarios
   - [ ] Interactive menus work correctly
   - [ ] Sequential questions wait for responses

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
