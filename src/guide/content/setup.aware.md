# Guide: setup (platform-aware)

You are configuring a mobile-QA workspace by **analyzing this project**. The mechanical part is already done: `mauto setup` has scaffolded the `mobile-automator/` tree (scenarios, screenshots, results) and written a starter `config.json`. **This guide completes the project analysis** — you inspect the codebase, infer each fact, confirm anything uncertain with the user, and PERSIST every finding with `mauto config set <key> <value>`. Read each value back with `mauto config get <key>` to confirm it landed.

You are doing LLM analysis work, not running a fixed script. Read real project files, reason about what you find, and only ask the user when a value genuinely cannot be inferred.

## How to persist a finding

Every analysis result is stored in the workspace config:

```
mauto config set <key> <value>
```

For list-valued keys (e.g. `protected_directories`), pass a comma-separated value. When a value is uncertain, confirm it with the user before persisting. When you truly cannot infer a value, ask the user directly and persist their answer.

## 1. Detect the platform

Inspect the project files to determine the mobile platform. First honor any `.gitignore` patterns, then run these checks in order and stop at the first match:

- **Flutter** — `pubspec.yaml` at the root with `flutter` in `dependencies`/`environment`.
- **React Native** — `package.json` with `react-native` in `dependencies`/`devDependencies`.
- **Kotlin Multiplatform** — `build.gradle.kts`/`build.gradle` declaring the `kotlin("multiplatform")` plugin, or `shared/` / `composeApp/` source sets (`commonMain/`, `androidMain/`, `iosMain/`).
- **Compose Multiplatform** — the `org.jetbrains.compose` plugin or a `composeApp/` `commonMain/` with `@Composable` functions.
- **Android Native** — `build.gradle`/`build.gradle.kts` with the `com.android.application` plugin, or `AndroidManifest.xml`.
- **iOS Native** — `*.xcodeproj` / `*.xcworkspace`, `*.swift`/`*.m` sources, or `Info.plist`.

If none match, ask the user which platform this is. Confirm the detected platform with the user, then persist it:

```
mauto config set platform <platform>
```

## 2. Discover build environments

Scan the project's build configuration for named environments, scoped to the detected platform:

- **Gradle-based projects** — read the app/module build file; extract `productFlavors` (names + any `applicationIdSuffix`) and `buildTypes` (e.g. `debug`, `release`, `staging`). Compile the cross-product (e.g. `stagingDebug`, `productionRelease`).
- **Xcode-based projects** — list build schemes (`*.xcscheme`) and per-configuration `*.xcconfig` files; treat each configuration as an environment.
- **Flutter** — look for `--dart-define` patterns, flavor configs, and env files (`.env.staging`, `lib/flavors/`, `flutter_dotenv` / `envied`).
- **React Native** — look for `.env*` files, env-specific `package.json` scripts, and `react-native-config` / `react-native-dotenv`.

Deduplicate the result. If none are found, default to `production, staging, development`. Confirm with the user, then persist:

```
mauto config set environments <env1,env2,...>
```

## 3. Infer the app package

Read the application identifier from the build files, scoped to the platform:

- **Android module** — base `applicationId` from the app build file's `defaultConfig`, plus any flavor/buildType `applicationIdSuffix`. Persist with `mauto config set android_package <id>`.
- **Apple target** — `PRODUCT_BUNDLE_IDENTIFIER` from the Xcode project (`project.pbxproj`/`*.xcconfig`) or `CFBundleIdentifier` in `Info.plist`. Persist with `mauto config set ios_bundle_id <id>`.
- **Cross-platform projects** — persist both the Android `android_package` and the Apple `ios_bundle_id`.

If you cannot infer the identifier, ask the user for it (`e.g. com.example.myapp`), then persist. Confirm any inferred value with the user first.

## 4. Capture project knowledge

Infer each of the following from the codebase, confirm uncertain values with the user, and persist each one.

- **Project name** — from `settings.gradle*` `rootProject.name`, `pubspec.yaml` `name`, `package.json` `name`, the `*.xcodeproj` name, or the root directory name. Persist: `mauto config set project_name <name>`.
- **Platform details** — versions like `minSdk`/`targetSdk`/`compileSdk` (Gradle) or the deployment target (Xcode); format as e.g. `"Android (minSdk 24, targetSdk 34)"` or `"iOS (deployment target 16)"`. Persist: `mauto config set platform_details "<details>"`.
- **Build system** — `"Gradle (AGP)"`, `"Xcode"`, `"Flutter CLI + Gradle + Xcode"`, or `"Metro + Gradle + Xcode"`. Persist: `mauto config set build_system "<system>"`.
- **Build command** — the default debug/development build command (e.g. `./gradlew assembleDemoDebug`, `flutter build apk --flavor demo`, `npx react-native run-android`, or `xcodebuild -scheme <scheme>`). Persist: `mauto config set build_command "<command>"`.
- **Architecture** — infer from directory and class naming (`viewmodel/` → MVVM; `repository/`+`usecase/`+`domain/`+`data/` → Clean Architecture; `bloc/`/`cubit/` → BLoC; `reducer/`/`store/` → Redux/MVI; `presenter/`/`interactor/` → MVP/VIPER). Combine findings (e.g. `"MVVM with Clean Architecture"`). If unclear, ask the user. Persist: `mauto config set architecture "<pattern>"`.
- **Business domain** — read `README.md`, app-store metadata, `pubspec.yaml`/`package.json` description, or the app display name to infer a one-sentence domain description. If you cannot tell, ask the user. Persist: `mauto config set business_domain "<one sentence>"`.
- **Business-critical paths** — analyze navigation graphs, route/deep-link definitions, screen/Activity/Fragment/ViewController/page definitions, and feature modules to find the most important user flows (login, signup, onboarding, checkout, payment, search, profile, …). Confirm the list with the user. Persist a comma-separated value: `mauto config set business_critical_paths "<onboarding, login, checkout>"`.
- **Loading indicators** — grep for loading widgets/components (progress indicators, spinners, shimmer/skeleton placeholders) and any `*Loading*`/`*Spinner*`/`*Shimmer*`/`*Skeleton*` classes. Persist the found names, or a description like `"progress bars, spinners, shimmer effects"` if none found. Persist: `mauto config set loading_indicators "<list>"`.
- **Protected directories** — list the source directories the QA tooling must NEVER modify (e.g. `app/src/`, `lib/`, `src/`, `shared/`, `composeApp/`, `iosApp/`). Confirm with the user. Persist a comma-separated value: `mauto config set protected_directories "<app/src/, lib/, core/>"`.

## 5. Confirm the config

Read the persisted values back with `mauto config get <key>` for each finding, and present a concise summary to the user. The workspace is now analyzed and configured: `mauto guide generate` and `mauto guide execute` will read these values to drive scenario authoring and execution.

## Operational Boundaries

### DO

- Inspect real project files before inferring any value.
- Persist every finding with `mauto config set <key> <value>` and verify with `mauto config get`.
- Ask the user directly for any value that cannot be inferred, and confirm uncertain inferences.

### DON'T

- Modify app source code — this guide only reads it and writes the workspace config.
- Re-scaffold the workspace — `mauto setup` already created the directory tree and starter config.
- Invent a value you cannot find evidence for — ask the user instead.
