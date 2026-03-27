# Design: execute.toml Improvements

**Date:** 2026-03-20
**Status:** Approved
**File:** `commands/mobile-automator/execute.toml`

---

## Background

The `execute.toml` command has diverged from `generate.toml` since the environment persistence feature was added in March 2026. Several UX patterns were standardised in `generate.toml` (structured `ask_user` tool calls, upfront resolution sections) that were never back-ported to `execute.toml`. This spec covers a parity + quality pass to bring both commands into alignment.

---

## Goals

1. Bring `execute.toml` to structural and UX parity with `generate.toml`
2. Fix a logical ordering contradiction in Section 0.0
3. Add `--device` flag support for ephemeral device pre-selection
4. Add `--all` flag support for skipping the interactive scenario menu
5. Replace prose prompts with structured `ask_user` tool calls throughout

## Non-Goals

- Environment filtering via `--environment` flag (not needed; execute reads environment from scenario metadata)
- Device preference persistence via `--set-device` flag (ephemeral only is sufficient)
- Changes to the executor skill (SKILL.md) or result schema
- Changes to tag filtering syntax or the interactive scenario menu structure

---

## Changes by Section

### Section 0.0 — Deprecation Gate (restructured)

**Problem:** Section 0.0 is numbered before pre-flight checks but its own instruction says *"After loading the scenario file(s) to execute (resolved in Section 2.0)"* — a direct contradiction. An AI model executing this command cannot resolve which behaviour is intended.

**Solution:** Restructure Section 0.0 as a pure **upfront gate** that checks for explicit user intent (a flag), matching `generate.toml`'s Section 0.0 pattern exactly.

**New behaviour:**
1. Check if the user specified `--schema-version 1.0` in their command.
2. Apply the existing 3-phase deprecation logic based on today's date vs 2026-02-17:
   - Phase 1 (until 2026-08-17): Non-blocking warning, continue.
   - Phase 2 (2026-08-17 to 2027-01-17): Block new execution with escalated warning.
   - Phase 3 (after 2027-01-17): Hard fail.
3. If no `--schema-version` flag → proceed normally. Per-scenario schema version checking remains in the executor skill (SKILL.md).

**Key change:** Remove all references to "after loading the scenario file(s) to execute (resolved in Section 2.0)". This section no longer touches scenario content.

---

### Section 0.1 — Device Resolution (new)

**Purpose:** Resolve `selected_device` before pre-flight checks, so Section 1.2 can consume a pre-validated value cleanly. Mirrors `generate.toml`'s Section 0.1 ENVIRONMENT RESOLUTION pattern.

**config.json absence guard:** If `mobile-automator/config.json` does not exist, skip Section 0.1 entirely. Section 1.1 handles the missing config error.

**Resolution logic:**

1. **`--device="<device_id>"` flag present:**
   - Call `mobile_list_available_devices()` to get the list of connected devices.
   - Validate that the specified device ID exists in the returned list.
   - If not found → halt:
     > "❌ Device not found: \"[device_id]\"\n   Connected devices: [list of connected device names/IDs]"
   - If valid → set `selected_device` to the matched device. Announce:
     > "ℹ️  Using device: [device_name] (--device flag)"
   - Proceed to Section 1.0.

2. **No `--device` flag:** Leave `selected_device` unset. Section 1.2 handles interactive discovery.

**Design notes:**
- `--device` is ephemeral only — no persistence, no `--set-device` counterpart.
- Device IDs change frequently (emulators restart, physical devices reconnect with new identifiers), making persistence unreliable.

---

### Section 1.2 — Verify Device (updated)

**Problem:** Current prose instructions don't distinguish between single and multiple device cases clearly, and use no structured tooling.

**New behaviour:**

1. If `selected_device` is already set (resolved via `--device` in Section 0.1) → announce and proceed. No prompt.
   > "✅ Using device: [device_name]"
2. Call `mobile_list_available_devices()`.
   - If no devices found → halt with existing message.
3. If exactly **one** device found → announce and proceed. No prompt.
   > "✅ Using device: [device_name]"
4. If **multiple** devices found → use `ask_user` tool (type: `choice`):
   - Header: `Device`
   - Question: `Which device should I use?`
   - Options: Dynamically list all connected devices.

**Key change:** Single-device auto-selection is now explicit. The `ask_user` tool replaces prose instructions for multi-device scenarios.

---

### Section 1.3 — Check Preconditions and Prepare App (updated)

**Problem:** The build/install confirmation uses plain prose (`Ask the user: "..."`) instead of the structured `ask_user` tool.

**Change:** Replace the prose build/install prompt with an `ask_user` tool call (type: `choice`) matching `generate.toml`'s Section 1.3 pattern:

- Header: `Build & Install`
- Question: `I'll be testing [app_package] ([scenario_environment]) on [device_name]. Should I build and install the app?`
- Options:
  - `Build and install` (description: `using: [build_command]`)
  - `Already installed, skip build`

All other logic in Section 1.3 (precondition handling, package ID resolution, uninstall flows) remains unchanged.

---

### Section 2.2 — Resolve Which Scenarios to Execute (updated)

**Problem:** No way to run all scenarios without going through the interactive menu.

**Change:** Add `--all` flag support. Insert a new step **before** the existing tag/name/menu logic:

**Updated command format line:**
```
/mobile-automator:execute [scenario_name]
/mobile-automator:execute --tag <expression>
/mobile-automator:execute --all
/mobile-automator:execute
```

**New step (inserted first in Section 2.2):**

1. **If `--all` flag is present:**
   - Load all `.json` files from `mobile-automator/scenarios/`.
   - Show confirmation before executing:
     > "I'll execute all [N] scenario(s):\n[list all scenario names]\nProceed? (yes/no)"
   - **WAIT for "yes".** If anything else → halt.
   - If confirmed → skip remaining selection logic and proceed to Section 3.0.

All existing logic (tag filter → name filter → interactive menu) follows unchanged after this step.

---

## Section 3.0 — Hand Off to Executor Skill

Unchanged.

---

## Summary of Changes

| Section | Type | Change |
|---------|------|--------|
| 0.0 | Fix | Restructured as upfront flag gate; removed contradictory Section 2.0 reference |
| 0.1 | New | Device resolution with `--device` flag support (ephemeral) |
| 1.2 | Update | Explicit single-device auto-selection; `ask_user` tool for multi-device |
| 1.3 | Update | `ask_user` tool for build/install confirmation |
| 2.2 | Update | `--all` flag with confirmation prompt |
| 3.0 | None | Unchanged |

---

## UX Message Consistency

All new announce messages follow the conventions already established in `generate.toml`:
- `✅` for auto-resolved selections (no user action needed)
- `ℹ️` for flag-driven selections (user explicitly set this)
- `❌` for validation failures that halt execution

---

## Risks

- **None structural** — no changes to the executor skill, scenario schema, or result schema.
- **Regression risk is low** — changes are additive (`--all`, `--device`, new section 0.1) or cosmetic replacements of prose with equivalent `ask_user` calls.
