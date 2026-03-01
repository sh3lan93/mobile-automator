# Setup Command Guide

The **Setup Command** is your entry point to mobile-automator. It analyzes your mobile project, detects its architecture and configuration, then automatically installs customized testing skills tailored specifically to your app.

**Key benefit**: You run setup once per project, and it configures everything needed for intelligent test generation and execution.

## Quick Start

```bash
cd /path/to/your/mobile-app
gemini /mobile-automator:setup
```

Setup will guide you through 7 sections of project analysis, typically taking 5-10 minutes depending on project complexity.

## The 7-Section Workflow

### Section 1: Pre-Initialization

**What happens:**
- Overview of the setup process is presented
- Checks if you've run setup before (enables resume capability)
- Verifies the Gemini CLI is properly configured

**User interaction:** You see an overview and confirm to proceed.

**Output:** If this is a resumed setup, loads previous progress from `mobile-automator/setup_state.json`.

---

### Section 2: Platform Detection

**What setup does:**
- Automatically scans your project structure for mobile platforms
- Looks for distinctive files and directories:
  - **Android**: `build.gradle`, `settings.gradle`, `AndroidManifest.xml`
  - **iOS**: `.xcodeproj`, `.xcworkspace`, `Podfile`
  - **Flutter**: `pubspec.yaml`, `lib/main.dart`
  - **React Native**: `package.json`, `index.js`, `react-native.config.js`
  - **Kotlin Multiplatform (KMP)**: `shared/build.gradle.kts`, `KMM structure`
  - **Compose Multiplatform (CMP)**: `compose/build.gradle.kts`

**User interaction:**
- If detection succeeds (most cases), you'll see: "Detected: Android"
- If detection is unclear, setup will ask you to select from available platforms
- You can confirm or override the detected platform

**Example:**
```
Analyzing project structure...
✓ Detected: Android (Gradle-based project)

Is this correct? (y/n): y
```

**Output:** Stored in setup_state.json with confirmed platform.

---

### Section 3: Environment Discovery

**What setup does:**
- Scans for different build environments (production, staging, development, etc.)
- Uses platform-specific detection:

**Android/KMP/CMP:**
- Reads `build.gradle` for `productFlavors` (paid, free, beta)
- Reads `buildTypes` (debug, release, custom)
- Combined: "debug, release, staging-debug, staging-release, prod-release"

**iOS:**
- Inspects Xcode project schemes
- Reads `.xcconfig` files for environment configurations
- Example: "Debug, Release, Staging, Production"

**Flutter:**
- Looks for `--dart-define` configurations in build files
- Scans for flavor-specific `.env` files (`.env.dev`, `.env.staging`, `.env.prod`)
- Checks for `flutter_flavor` package configurations

**React Native:**
- Scans `.env.*` files in project root
- Checks for `react-native-config` package setup
- Example: ".env.dev, .env.staging, .env.production"

**User interaction:**
- You'll see the detected environments
- Can add custom environments if auto-detection missed any
- Setup asks which environment you primarily test against

**Example:**
```
Detected environments:
  • debug
  • release
  • staging

Do you test against any other environments? (y/n): n
Primary environment for testing: staging
```

**Output:** Stored list of environments for later use in build commands and TestRail metadata.

---

### Section 4: App Package Inference

**What setup does:**
- Extracts your app's unique identifier (required for device automation)

**Android:**
- Reads `build.gradle` for `applicationId`
- Attempts to parse based on selected environment/flavor
- Example: `com.example.myapp` or `com.example.myapp.staging`

**iOS:**
- Reads Xcode project file for `PRODUCT_BUNDLE_IDENTIFIER`
- Falls back to `Info.plist` if project file parsing fails
- Example: `com.example.MyApp` or `com.example.MyApp.staging`

**User interaction:**
- If auto-detection succeeds, shows detected package ID
- If not found, prompts you to enter it manually
- You can override if multiple packages exist

**Example:**
```
Detected app package:
  Android: com.example.myapp
  iOS: com.example.MyApp

Is this correct? (y/n): y
```

**Output:** Package IDs stored for device automation commands (install, launch, etc.).

---

### Section 5: Project Knowledge (⭐ The Magic Happens Here!)

**What setup does:**
This is where mobile-automator learns the deep details of your project:

#### Auto-Detected Values (No User Input Needed)

**Project Name:**
- Extracts from `build.gradle`, `package.json`, or `pubspec.yaml`
- Falls back to directory name
- Example: "MyShoppingApp"

**Platform Details:**
- SDK versions, deployment targets
- Android: "Android (minSdk 24, targetSdk 34)"
- iOS: "iOS 14.0+" or "iOS 14.0-17.2"

**Build System:**
- Automatically identified as: Gradle, Xcode, Flutter CLI, Metro, or custom
- Example: "Gradle with productFlavors"

**Build Command:**
- Inferred from detected platform and environments
- Android example: `./gradlew assembleDebug` or `./gradlew assembleStaging`
- iOS example: `xcodebuild -scheme MyApp -configuration Debug`
- Flutter example: `flutter build apk --flavor staging`

**Architecture Pattern:**
- Scans source code for design patterns:
  - **MVVM**: Looks for `viewmodel/`, `ViewModel` classes, `LiveData`, data binding
  - **Clean Architecture**: Looks for `repository/`, `usecase/`, `domain/`, `data/`, `presentation/` layers
  - **BLoC**: Flutter-specific, looks for `bloc/`, `cubit/`, event definitions
  - **Redux/MVI**: Looks for `reducer/`, `store/`, `action/`, `middleware/`
  - **MVP/VIPER**: Looks for `presenter/`, `interactor/`, `router/`, `entity/`
- Intelligently combines patterns: e.g., "MVVM with Clean Architecture" or "BLoC pattern"

**Loading Indicators:**
- Greps source code for platform-specific loading patterns:

| Platform | Indicators Detected |
|----------|-------------------|
| Android | CircularProgressIndicator, LinearProgressIndicator, ProgressBar, ShimmerEffect, ContentLoadingProgressBar |
| iOS | UIActivityIndicatorView, ProgressView, SkeletonView |
| Flutter | CircularProgressIndicator, LinearProgressIndicator, Shimmer, LoadingOverlay |
| React Native | ActivityIndicator, SkeletonPlaceholder, LottieView |
| Any | Custom patterns matching `*Loading*`, `*Spinner*`, `*Shimmer*`, `*Skeleton*` |

**Protected Directories:**
- Identifies source code directories to never modify
- Typically: `src/`, `lib/`, `android/`, `ios/`, `kotlin/`, `swift/`
- Prevents accidents when generating test support code

#### Values Requiring Your Input

**Corrections to Auto-Detected Values:**
- Setup shows what it detected
- You can correct any inaccuracies
- Example: "Detected architecture: MVVM. Correct? (y/n)"

**Business Domain:**
- One-sentence description: "E-commerce mobile shopping app with checkout flow"
- Used to understand context and test priorities
- Helps skills focus on business-critical flows

**Business-Critical User Paths:**
- You list the most important user flows to test
- Examples: "onboarding, login, product search, add-to-cart, checkout, payment"
- Skills prioritize these paths in test generation
- Setup asks: "Enter critical user flows (comma-separated):"

**Example Section 5 Interaction:**
```
=== PROJECT KNOWLEDGE ===

Auto-detected:
  • Project: MyShoppingApp
  • Platform: Android (minSdk 24, targetSdk 34)
  • Architecture: MVVM with Clean Architecture
  • Build system: Gradle
  • Loading indicators: CircularProgressIndicator, ShimmerEffect (found 2)
  • Protected dirs: src/main/java, src/main

Corrections needed? (y/n): n

Business domain (one sentence):
E-commerce mobile shopping app with product catalog and checkout flow

Critical user paths (comma-separated):
onboarding, login, product-search, add-to-cart, checkout, payment
```

**Output:** All project knowledge stored in `mobile-automator/setup_state.json`.

---

### Section 6: Skill Installation (Fully Automated)

**What setup does:**
- Creates `.gemini/skills/` directory structure
- Reads skill template files from the extension
- **Replaces 13 placeholders** with detected/gathered values
- Copies schema files to workspace
- Verifies all placeholders were replaced

#### The 13 Placeholders Automatically Populated

| Placeholder | Example Value |
|-------------|---------------|
| `{{project_name}}` | MyShoppingApp |
| `{{platform_details}}` | Android (minSdk 24, targetSdk 34) |
| `{{architecture}}` | MVVM with Clean Architecture |
| `{{build_system}}` | Gradle |
| `{{build_command}}` | ./gradlew assembleDebug |
| `{{app_package}}` | com.example.myapp |
| `{{environments}}` | debug, release, staging |
| `{{loading_indicators}}` | CircularProgressIndicator, ShimmerEffect |
| `{{business_domain}}` | E-commerce mobile shopping app... |
| `{{business_critical_paths}}` | onboarding, login, checkout, payment |
| `{{protected_directories}}` | src/main/java, src/main/kotlin |
| `{{automation_extras}}` | Android-specific automation notes |
| `{{additional_resources}}` | Links to documentation |

#### Skills Created

**1. Generator Skill**
- Location: `.gemini/skills/mobile-automator-generator/SKILL.md`
- Purpose: Generate test scenarios from natural language
- Includes: All 13 placeholders populated with your project details
- Schemas: `references/scenario_schema_v2.json`, `references/scenario_schema.json`

**2. Executor Skill**
- Location: `.gemini/skills/mobile-automator-executor/SKILL.md`
- Purpose: Execute test scenarios and collect results
- Includes: All 13 placeholders populated
- Schemas: `references/result_schema.json`

**Example of Populated Placeholder:**

Before replacement (in template):
```markdown
# Mobile Automator — Test Generator for {{project_name}}

This skill generates test scenarios for {{project_name}}, which uses:
- **Platform**: {{platform_details}}
- **Architecture**: {{architecture}}
- **Business Domain**: {{business_domain}}

Critical paths: {{business_critical_paths}}
```

After replacement (in workspace):
```markdown
# Mobile Automator — Test Generator for MyShoppingApp

This skill generates test scenarios for MyShoppingApp, which uses:
- **Platform**: Android (minSdk 24, targetSdk 34)
- **Architecture**: MVVM with Clean Architecture
- **Business Domain**: E-commerce mobile shopping app with product catalog and checkout flow

Critical paths: onboarding, login, checkout, payment
```

**Verification Step:**
- Setup scans generated SKILL.md files
- Confirms no `{{` remains (all placeholders replaced)
- Reports success or error if placeholders remain

**Example Output:**
```
✓ Creating .gemini/skills/mobile-automator-generator/
✓ Installing generator skill (SKILL.md)
✓ Replacing 13 placeholders...
✓ Verifying no placeholders remain: PASSED
✓ Copying scenario_schema_v2.json
✓ Copying scenario_schema.json

✓ Creating .gemini/skills/mobile-automator-executor/
✓ Installing executor skill (SKILL.md)
✓ Replacing 13 placeholders...
✓ Verifying no placeholders remain: PASSED
✓ Copying result_schema.json
```

---

### Section 7: Finalization

**What setup does:**

1. **Creates directory structure:**
   - `mobile-automator/scenarios/` — Store generated test JSON files
   - `mobile-automator/screenshots/` — Reference and execution screenshots
   - `mobile-automator/results/` — Execution result reports

2. **Generates configuration files:**
   - `mobile-automator/config.json` — Complete project configuration (JSON)
   - `mobile-automator/index.md` — Setup documentation and summary
   - `mobile-automator/setup_state.json` — Internal state for resume capability

3. **Git integration (optional):**
   - If your project is a git repository, setup offers to commit
   - Commit message: "🤖 Mobile Automator Setup: Project Analysis & Skill Installation"
   - Includes: config.json, .gemini/skills/, directories

4. **Success summary:**
   - Shows what was created
   - Lists next steps
   - Provides command examples

**Example Section 7 Output:**
```
=== FINALIZATION ===

Creating directories:
  ✓ mobile-automator/scenarios/
  ✓ mobile-automator/screenshots/
  ✓ mobile-automator/results/

Generating configuration:
  ✓ mobile-automator/config.json (47 KB)
  ✓ mobile-automator/index.md
  ✓ mobile-automator/setup_state.json

Git integration:
  ? Would you like to commit setup changes? (y/n): y
  ✓ Committed: "🤖 Mobile Automator Setup: Project Analysis & Skill Installation"

=== SETUP COMPLETE ===

Your project is ready for mobile testing!

Next steps:
1. Review mobile-automator/config.json for accuracy
2. Run: gemini /mobile-automator:generate
3. Create your first test scenario

Learn more: mobile-automator/index.md
```

---

## Resume Capability

If setup is interrupted (network timeout, user cancels, etc.):

1. Setup stores progress in `mobile-automator/setup_state.json`
2. Run `/mobile-automator:setup` again
3. Setup detects the partial state
4. Resumes from the last completed section
5. No need to re-enter previous answers

**Example:**
```bash
# First run: interrupted at Section 5
gemini /mobile-automator:setup

# Resume from Section 5
gemini /mobile-automator:setup
Resuming setup from Section 5: Project Knowledge...
```

---

## Configuration File (config.json)

After setup completes, review `mobile-automator/config.json`:

```json
{
  "project_name": "MyShoppingApp",
  "platform": "android",
  "app_package": "com.example.myapp",
  "environments": ["debug", "release", "staging"],
  "platform_details": "Android (minSdk 24, targetSdk 34)",
  "architecture": "MVVM with Clean Architecture",
  "build_system": "Gradle",
  "build_command": "./gradlew assembleDebug",
  "business_domain": "E-commerce mobile shopping app...",
  "business_critical_paths": ["onboarding", "login", "checkout", "payment"],
  "loading_indicators": ["CircularProgressIndicator", "ShimmerEffect"],
  "protected_directories": ["src/main/java", "src/main/kotlin"],
  "automation_extras": "Android automation notes...",
  "additional_resources": "...",
  "setup_completed_at": "2026-03-01T10:30:00Z",
  "setup_completed_by": "user@example.com"
}
```

---

## Troubleshooting

### Platform Detection Failed

**Problem:** Setup can't determine your project platform.

**Solution:**
- Ensure you're in the root directory of a mobile project
- Setup will prompt you to manually select: Android, iOS, Flutter, React Native, KMP, or CMP
- Or add files distinctive to your platform (e.g., `pubspec.yaml` for Flutter)

### Package ID Not Found

**Problem:** Setup can't extract your app's bundle ID or package name.

**Solution:**
- Setup will prompt: "Enter app package name:"
- Android: Find in `build.gradle` under `applicationId`
- iOS: Find in Xcode project or `Info.plist` under `CFBundleIdentifier`

### Skills Not Installed

**Problem:** After setup, `.gemini/skills/mobile-automator-*/SKILL.md` don't exist.

**Solution:**
1. Check directory exists: `ls -la .gemini/skills/`
2. Re-run setup: `gemini /mobile-automator:setup`
3. Setup will detect partial state and resume from Section 6
4. If still failing, check extension installation

### Placeholders Not Replaced

**Problem:** Generated SKILL.md still contains `{{placeholder_name}}`.

**Solution:**
1. Setup failed to populate a placeholder value
2. Check `mobile-automator/setup_state.json` for missing keys
3. Manually edit SKILL.md to replace `{{placeholders}}`
4. Or re-run setup from Section 5 (Project Knowledge)

### Need to Re-Run Setup

**Problem:** You modified your project (added environments, changed architecture) and want to update config.

**Solution:**
```bash
# Option 1: Resume from specific section
gemini /mobile-automator:setup

# Option 2: Fresh setup (overwrites previous)
rm mobile-automator/setup_state.json
gemini /mobile-automator:setup
```

---

## After Setup

Once setup completes successfully:

1. **Review configuration**: `mobile-automator/config.json`
2. **Generate your first test**: `/mobile-automator:generate`
3. **Execute the test**: `/mobile-automator:execute`

See [Generate Command Guide](generate.md) for next steps.

---

## Advanced: Customizing Skill Templates

If you need to modify the generated skills (advanced users only):

1. Edit `.gemini/skills/mobile-automator-generator/SKILL.md`
2. Or `.gemini/skills/mobile-automator-executor/SKILL.md`
3. Changes persist until you re-run setup
4. Re-running setup will regenerate from templates (overwrites your edits)

To permanently modify templates, contribute changes to the extension repository.

---

## See Also

- [Generate Command Guide](generate.md) — Next step after setup
- [Architecture: 3-Tier Design](../concepts/three-tier-design.md) — How setup fits in the overall system
- [FAQ: Setup Issues](../faq.md#setup-installation)
