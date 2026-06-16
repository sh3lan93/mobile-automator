# Guide: setup (platform-agnostic)

You are configuring a mobile-QA workspace by **analyzing this project**. The mechanical part is already done: `mauto setup` has scaffolded the `mobile-automator/` tree (scenarios, screenshots, results) and written a starter `config.json`. **This guide completes the project analysis** — you inspect the codebase, infer each fact, confirm anything uncertain with the user, and PERSIST every finding with `mauto config set <key> <value>`. Read each value back with `mauto config get <key>` to confirm it landed.

In this mode the configuration is **portable**: facts are captured as plain-English, platform-neutral descriptions so a single config and the scenarios it drives run unchanged across both supported mobile platforms. You are doing LLM analysis work, not running a fixed script — read real project files, reason about what you find, and only ask the user when a value genuinely cannot be inferred.

## How to persist a finding

Every analysis result is stored in the workspace config:

```
mauto config set <key> <value>
```

For list-valued keys, pass a comma-separated value. Confirm uncertain values with the user before persisting; when a value truly cannot be inferred, ask the user directly and persist their answer.

## 1. Project basics

- **Project name** — auto-detect from `package.json` `name`, `pubspec.yaml` `name`, the root build file's project name, or the directory basename. Confirm with the user, then persist: `mauto config set project_name <name>`.
- **App package identifiers (optional)** — if present, capture the application identifier(s) from the project's build configuration. Persist whichever apply: `mauto config set android_package <id>` and/or `mauto config set ios_bundle_id <id>`. Either, both, or neither may exist — leave a missing one unset.

## 2. Business knowledge

- **Business domain** — read `README.md`, app-store description, or the app display name to infer a one-sentence domain description. If you cannot tell, ask the user. Persist: `mauto config set business_domain "<one sentence>"`.
- **Business-critical paths** — identify the most important user flows (onboarding, login, checkout, payment, search, profile, …) from navigation/route definitions, screen/page definitions, and feature structure. Confirm the list with the user. Persist a comma-separated value: `mauto config set business_critical_paths "<onboarding, login, checkout>"`.

## 3. Loading indicators (semantic descriptions)

Capture how loading **appears** in the app, in plain English — not class names. The agent needs to recognize loading visually, independent of platform. Examples:

- `a centered spinner overlay during full-screen loads`
- `shimmer placeholders for cards on the home screen`
- `a small spinner inside the Login button while authenticating`

Ask the user to describe it if you cannot infer it from the UI. Persist the description verbatim: `mauto config set loading_indicators "<plain-English description>"`.

## 4. Protected directories

List the source directories the QA tooling must NEVER modify (it operates on test artifacts, not source code). Auto-detect common source roots that exist in the project (e.g. `src/`, `lib/`, app/module source trees), confirm with the user, then persist a comma-separated value: `mauto config set protected_directories "<src/, lib/>"`.

## 5. Environments (optional)

In this mode environments are decoupled from build flavors — they are just labels for the test target. Ask the user whether the project has named environments (e.g. `production, staging, dev`). If yes, persist the list: `mauto config set environments <production,staging,dev>`. If no, leave it unset (or persist an empty list).

## 6. Confirm the config

Read the persisted values back with `mauto config get <key>` for each finding, and present a concise summary to the user. The workspace is now analyzed and configured: `mauto guide generate` and `mauto guide execute` will read these values to drive portable scenario authoring and execution. At execute time the four semantic actions — `press_back`, `dismiss_keyboard`, `grant_permission`, `deny_permission` — resolve per platform automatically, so nothing platform-specific needs to live in this config.

## Operational Boundaries

### DO

- Inspect real project files before inferring any value.
- Capture every fact as a plain-English, platform-neutral description.
- Persist every finding with `mauto config set <key> <value>` and verify with `mauto config get`.
- Ask the user directly for any value that cannot be inferred, and confirm uncertain inferences.

### DON'T

- Name a specific platform or platform-specific tooling in any persisted value — keep the config portable.
- Modify app source code — this guide only reads it and writes the workspace config.
- Re-scaffold the workspace — `mauto setup` already created the directory tree and starter config.
- Invent a value you cannot find evidence for — ask the user instead.
