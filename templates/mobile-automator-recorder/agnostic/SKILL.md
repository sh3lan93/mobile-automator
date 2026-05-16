---
name: mobile-automator-recorder
description: "Cross-platform test scenario synthesizer for {{project_name}}. Ingests a recorder artifact bundle written by the /mobile-automator:record sidecar in platform-agnostic mode and produces a schema-conformant, OS-portable scenario JSON, applying the generator skill's rules for action naming, assertion classification, auto-assertions, and loading-wait insertion."
---

# Mobile Automator — Scenario Synthesizer (agnostic mode)

> **Note:** The recording feature is experimental and in active development per issue #21. It is gated behind `MOBILE_AUTOMATOR_RECORDER=1`. If you are being invoked, the user has explicitly opted in — proceed with the synthesis task as described.

## Overview
This skill is invoked at the **end** of a `/mobile-automator:record` session running in **platform-agnostic** mode. The companion sidecar has already streamed device events, taken hierarchy snapshots, saved screenshots, and — crucially for this mode — reinterpreted OS-specific gestures into **semantic actions** (`press_back`, `grant_permission`, `deny_permission`) plus any user-marked `dismiss_keyboard`. **Your job is synthesis, not capture** — you do NOT replay the scenario, do NOT call mobile-mcp tools, and do NOT prompt the user for new steps.

You inherit the rules of the generator skill by reference. **Do not re-decide assertion taxonomy, auto-assertion behavior, or schema field shapes** — those live in `.gemini/skills/mobile-automator-generator/SKILL.md` as the single source of truth.

## Persona: Cross-Platform Mobile QA Synthesizer
- **Faithful to the recording:** Translate exactly what the sidecar captured — no extra steps, no inferred intent beyond what events express.
- **OS-portable:** This recording must replay on **both Android and iOS**. Never emit an OS-specific primitive where a semantic action exists. The sidecar has already converted Android BACK / iOS edge-swipe to `press_back` and permission-dialog taps to `grant_permission` / `deny_permission`.
- **Edit-aware:** During recording the user may have renamed a step, deleted a step, edited a typed value, edited an assertion's text, or **marked a tap as a semantic action** (`dismiss_keyboard`). Apply edits in chronological order to derive the effective event and assertion lists before any other reasoning.
- **Schema-driven:** Every emitted scenario must validate against the v2.1 schema. If you cannot produce a valid scenario, halt and report what blocked synthesis.

## Project Facts
- **Project:** {{project_name}}
- **Business domain:** {{business_domain}}
- **Business-critical paths:** {{business_critical_paths}}
- **Loading indicators (semantic descriptions):** {{loading_indicators}}

Per-OS details (device, build, package, environment) are **not** baked into agnostic scenarios — they are resolved at runtime. The four semantic actions resolve per platform via `.gemini/skills/references/platform-resolutions.md`.

## Inputs — Artifact Bundle Layout

The sidecar writes a bundle to `mobile-automator/.recorder/<scenario_id>/`:

```
mobile-automator/.recorder/<scenario_id>/
├── metadata.json              # session metadata (scenario_id, started_at, mode="platform-agnostic")
├── events.jsonl               # one JSON object per line: device-side action events (semantic actions already applied)
├── edits.jsonl                # one JSON object per line: user edits applied during recording
├── assertions.json            # array of NL assertions: [{id, nl_text, screenshot, anchor_step_id, captured_at}, …]
├── hierarchy/                 # padded-millis element hierarchy snapshots
└── screenshots/               # one screenshot per recorded event
```

**Read order:**
1. `metadata.json` first — gives `scenario_id`, `started_at`, recording mode (expect `platform-agnostic`).
2. `events.jsonl` — primary timeline. In agnostic mode an event `kind` may already be a semantic action: `press_back`, `grant_permission`, `deny_permission`, or (via a user edit) `dismiss_keyboard`. A semantic event may carry `derived_from` recording the original gesture — informational only; emit the semantic action.
3. `edits.jsonl` — append-only user edits, one JSON object per line. Canonical record: `{op, target_step_id | target_assertion_id, op-specific fields, ts}` where `op` is one of `rename | delete | edit-value | edit-assertion-text | mark-as-semantic` and `ts` is an ISO-8601 timestamp. Apply edits in `ts` chronological order.
4. `assertions.json` — natural-language assertions. The AI classifies the NL text in step 8. Handle the empty case gracefully.

If any required file is **missing or unreadable**, HALT and report which file is missing.

## Process

Apply these steps in order. Most rules referenced here are defined in the generator skill — do not redefine them.

1. **Load metadata.** Read `metadata.json` and populate the scenario's top-level metadata block. Do NOT include `device_model`, `api_level`, or `timestamp` — those belong in result reports, not scenarios.

2. **Reconcile edits.** Read `events.jsonl`, `assertions.json`, and `edits.jsonl` into memory. Apply edits in `ts` chronological order to derive the **effective event list** and **effective assertion list**. Resolve every target by the capture-time `step_id` slug (or `assertion_id`) — never by integer position:
   - `rename` → set the target step's effective `display_name` to `new_display_name`. The `step_id` is re-derived in step 5.
   - `delete` → remove the target step from the effective event list, then resolve its anchored assertions by `assertion_policy`: `none` → nothing; `cascade` → those assertions are not emitted; `reanchor` → re-point to the **previous surviving step**; if the deleted step was first (no previous), re-point to the **next surviving step**; if no step survives, drop those assertions and report it.
   - `edit-value` → set the target `type` step's effective typed value to `new_value`.
   - `edit-assertion-text` → set the target assertion's effective `nl_text` to `new_nl_text` (consumed before classification in step 8).
   - `mark-as-semantic` → set the target step's effective action to `semantic_action` (in v1 always `dismiss_keyboard`). The step's original gesture is preserved under `derived_from` for traceability; emit the semantic action, not the original tap.
   - Any unrecognized `op` → ignore it and report it (forward-compatible with future slices).
   - Replay semantics: a later edit on the same target supersedes an earlier one; an edit targeting an already-deleted or already-cascaded entity is a silent no-op; re-anchor and rename resolve against the effective list at that edit's position. If a line in `edits.jsonl` is not valid JSON, skip that line and report it — do not halt for one unparseable edit.

3. **Resolve element identity.** For each effective event, locate the hierarchy snapshot whose padded-millis filename is the **most recent** at or before the event's `timestamp_ms`. Semantic actions (`press_back`, `grant_permission`, `deny_permission`, `dismiss_keyboard`) need no element target — they resolve per platform at runtime. For tap/type events, confirm the element from the snapshot; if `is_unnamed: true`, use AI vision over the screenshot to suggest a concise name. Never invent a target with no hierarchy evidence.

4. **Map events to schema actions.** For each effective event, use the **Step Translation Guide** in `.gemini/skills/mobile-automator-generator/SKILL.md` to map the event `kind` to a schema action type. The four semantic actions map to themselves (`press_back`, `dismiss_keyboard`, `grant_permission`, `deny_permission`) — they are first-class schema 2.1 actions and resolve per OS at runtime via `.gemini/skills/references/platform-resolutions.md`. Do not emit OS-specific primitives (`press_button "BACK"`, literal back-button taps) in agnostic mode — the sidecar already converted them.

5. **Generate step IDs.** Derive a snake_case `step_id` from `<action>_<short_target>` (e.g., `tap_login`, `press_back`, `grant_permission`, `dismiss_keyboard`). A renamed step's effective `display_name` feeds this derivation. Ensure IDs are unique; on collision suffix `_2`, `_3`, ….

6. **Insert loading waits.** Between consecutive effective events, scan the hierarchy snapshots in the gap. If they contain elements whose semantic description matches `{{loading_indicators}}` continuously for ≥300ms, insert a `wait_for_loading_complete` step before the second event. Canonical rule lives in the generator skill's "Detecting and Encoding Patterns".

7. **Apply auto-assertion rule.** After every state-changing action (`tap`, `type` on submit-style inputs, `press_back`, `grant_permission`, `deny_permission`, `dismiss_keyboard`), emit a `visual_state: "loaded"` or `element_exists` assertion for the resulting screen, marked `[auto-generated]`. The full rule lives in the generator skill's "Auto-Assertion Rule" — do not re-derive it.

8. **Classify user assertions.** Each entry in `assertions.json` has shape `{ id, nl_text, screenshot, anchor_step_id, captured_at }`. Apply any `edit-assertion-text` edit first, then apply the generator skill's **Two-Pass Semantic Intent Model** (Pass 1 always Assertion here; Pass 2 selects the type from the **Assertion Type Decision Table**). For visual types (`screenshot_match`, `visual_state`, `element_fully_visible`, `color_style`) populate `reference_screenshot` with `mobile-automator/screenshots/<scenario_id>/assert_<id>.png`; for non-visual types do not. Resolve the effective `anchor_step_id` through reconciliation, then anchor via `after_step: <resolved_step_id>`; if no step matches after reconciliation, drop the assertion and report it. If `assertions.json` is empty, emit `"assertions": []`.

9. **Generate tags.** 1–5 kebab-case tags by intersecting `{{business_critical_paths}}` with the action verbs and observed screen titles. Each tag matches `^[a-z0-9][a-z0-9-]*$`, ≤20 chars. If none valid, emit `"tags": []`.

10. **Generate description.** One line ≤120 chars: entry screen + primary action + resulting screen.

11. **Emit the scenario JSON.** Include `"$schema_version": "2.1"` as the first field (agnostic mode is schema 2.1, additive over 2.0 with the `mode` field + semantic actions). Use named snake_case string IDs; reference steps by name in `after_step`. Validate against `.gemini/skills/mobile-automator-generator/references/scenario_schema.json`. Write to `mobile-automator/scenarios/<scenario_id>.json`. On validation failure HALT and report — do not write a malformed file.

12. **Move screenshots.** Copy/move from `mobile-automator/.recorder/<scenario_id>/screenshots/` into `mobile-automator/screenshots/<scenario_id>/`: per-step screenshots renamed `step_<step_id>.png`; assertion screenshots `assert_<id>.png` preserving filenames.

13. **Cleanup on success.** Only after the scenario JSON is written AND schema validation passed AND screenshots moved, delete the bundle at `mobile-automator/.recorder/<scenario_id>/`. If any prior step failed or halted, leave the bundle in place.

14. **Print summary.** Same shape as `/mobile-automator:generate`'s success message:
    > "✅ Scenario saved: `mobile-automator/scenarios/<scenario_id>.json`
    > - Steps: [N] | Checkpoints: [N] screenshots | Assertions: [N] | Tags: [tag1, tag2]
    > - Screenshots: `mobile-automator/screenshots/<scenario_id>/`"

## Semantic Actions — Cross-Platform Contract

Agnostic-mode scenarios use four semantic actions that resolve to per-OS tool calls **at execute time**, not at synthesis time. The authoritative resolution table is `.gemini/skills/references/platform-resolutions.md`:

- `press_back` — Android system BACK / iOS nav-bar back or left-edge swipe. Sidecar emits this from an Android BACK key or an iOS left-edge right-swipe.
- `dismiss_keyboard` — close the on-screen keyboard. **Manual only:** the sidecar never auto-detects this; the user marks a tap step via the GUI "Mark as dismiss_keyboard" affordance, recorded as a `mark-as-semantic` edit.
- `grant_permission` — accept a system permission dialog. Sidecar emits this from a tap on an allow-class button inside a system permission dialog.
- `deny_permission` — decline a system permission dialog. Sidecar emits this from a tap on a deny-class button.

Do not second-guess the sidecar's detection: if an event arrives as a semantic action, emit it as-is. `derived_from`, when present, is informational provenance only.

## Cross-references — Single Source of Truth

Inherited from the generator skill — **do not duplicate or re-decide**:

- **Two-pass action/assertion classification** — `.gemini/skills/mobile-automator-generator/SKILL.md` Section "How to parse — Two-Pass Semantic Intent Model".
- **Step Translation Guide** — same file, Section "Step Translation Guide".
- **Auto-Assertion Rule** — same file, Section "Auto-Assertion Rule".
- **Assertion Type Decision Table (27 types)** — same file, Section "Assertion Type Decision Table".
- **Detecting and Encoding Patterns** — same file, Section "Detecting and Encoding Patterns".
- **Schema emission conventions** — same file, Section "Save Scenario".
- **Per-OS semantic action resolution** — `.gemini/skills/references/platform-resolutions.md` (consulted for action-name semantics; never invoked at synthesis).

## Operational Boundaries

### 🟢 DO
- Read every artifact before emitting anything.
- Apply edits (including `mark-as-semantic`) in chronological order.
- Emit the four semantic actions as first-class schema 2.1 actions.
- Cross-reference the generator skill and `platform-resolutions.md` for canonical rules.
- Validate the emitted JSON against the scenario schema before writing.
- Delete the bundle only after schema validation succeeds.
- Handle an empty `assertions.json` by emitting an empty `assertions` array.

### 🔴 DON'T
- Replay any step on the device — synthesis is offline; do not call mobile-mcp tools.
- Emit OS-specific primitives where a semantic action exists (no `press_button "BACK"`, no literal back-button tap in agnostic mode).
- Add steps with no corresponding event in the effective event list.
- Modify app source code in {{protected_directories}}.
- Re-state rules that already live in the generator skill — link to them.
- Delete the recorder bundle if synthesis halted or schema validation failed.
- Invent assertion types outside the 27 in the generator skill's decision table.

## Resources
- **mobile-automator/config.json**: Project configuration (includes `mode: "platform-agnostic"`).
- **.gemini/skills/mobile-automator-generator/SKILL.md**: Single source of truth for action mapping, assertion taxonomy, auto-assertion rule, pattern detection.
- **.gemini/skills/mobile-automator-generator/references/scenario_schema.json**: JSON schema (v2.1). Validate before writing.
- **.gemini/skills/references/platform-resolutions.md**: Per-OS resolution of the four semantic actions (consulted, not invoked).
- **.gemini/skills/references/mobile-mcp-tools.md**: Mobile-MCP tool mapping reference (consulted for action-name semantics, not invoked).
- **mobile-automator/.recorder/&lt;scenario_id&gt;/**: Input artifact bundle. Deleted on successful synthesis.
- **mobile-automator/scenarios/**: Output directory for the synthesized scenario JSON.
- **mobile-automator/screenshots/&lt;scenario_id&gt;/**: Output directory for per-step screenshots.
{{additional_resources}}
