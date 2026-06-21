# Fix mauto ↔ mobile-mcp contract drift (0.0.55) — design

- **Date:** 2026-06-21
- **Issue:** [#105](https://github.com/sh3lan93/mobile-automator/issues/105)
- **Status:** approved design, pre-implementation
- **Branch:** `fix/105-mobile-mcp-device-contract` (off `main`)

## Problem

Element/target resolution is broken **tool-wide** against the pinned
`@mobilenext/mobile-mcp@0.0.55`. `mauto elements` returns `[]` on a screen full of
elements; `tap`/`type`/`swipe`/`press`/`screenshot` fail; the recorder records every tap as
`tap_unknown`. Three independent contract drifts, all proven on-device:

1. **`device` is now a required tool argument.** mobile-mcp 0.0.55 declares
   `device: z.string()` on every tool except `mobile_list_available_devices`. `mauto`
   passes the device only via the `MOBILE_MCP_DEVICE` env var and calls tools with no
   `device` arg → MCP validation error (`-32602`), swallowed to `[]`.
2. **Prefixed-string element response.** `mobile_list_elements_on_screen` returns the
   *string* `Found these elements on screen: [json]`. `parseToolResult`
   (`src/device/mobile-mcp-client.js`) can't `JSON.parse` it (prefix) → returns the raw
   string; `DeviceBridge.listElements` (`src/device/bridge.js`) and the recorder
   `HierarchyPoller` expect an array / `.elements` → `[]`.
3. **`coordinates` object shape.** mobile-mcp returns `coordinates: {x,y,width,height}`
   (object). `element-model.js resolveBounds` only handles a 4-element `coordinates` array
   or a `rect` object → every element is skipped even once parsed.

Evidence: a raw probe with `{device:"emulator-5554"}` returns 30+ real elements (product
names, prices, nav tabs); with `{}` + env → validation error. Direct `uiautomator dump`
shows the labelled tree — the app is fine; the integration is broken.

## Design

### Component 1 — Device resolution: explicit → selection → auto-discover

Every device verb resolves a **concrete** device id before any non-discovery tool call:

1. **Explicit `--device <id>`** — per-call override, always wins.
2. **Persisted selection** (`mauto devices use <id>`, #92) — if set.
3. **Auto-discover** (new) — enumerate via `mobile_list_available_devices` (needs no device
   arg):
   - exactly **1** active → use it;
   - **multiple** → fail `error.kind=device` (exit 2), listing ids/names, hint:
     *"Multiple devices active; pick one with `--device <id>` or `mauto devices use <id>`."*;
   - **none** → fail `error.kind=device`, hint:
     *"No active device or emulator. Start one (or connect a device), or pass `--device <id>`."*

The resolved id is injected into **every** mobile-mcp tool call's `arguments` (the
`call(tool, args)` wrapper in `createCall`, `src/device/mobile-mcp-client.js`), **except**
`mobile_list_available_devices`. One wrapper fixes ~7 verbs for both the CLI `DeviceBridge`
and the recorder (both source their `call` from `createCall`).

Chicken-and-egg note: discovery uses `mobile_list_available_devices`, which takes no device
arg, so a connection can enumerate devices before a concrete id exists.

### Component 2 — Element response parsing (read path)

A shared tolerant helper (`src/device/element-model.js`, e.g. `parseElements(raw)`) accepts
either form and returns an array of raw mobile-mcp element objects:
- **string** `Found these elements on screen: [json]` → extract the JSON array (strip the
  known prefix; tolerate surrounding text by parsing from the first `[` to its matching
  end) and `JSON.parse`;
- **array** or **`{elements:[...]}`** → pass through;
- anything else → `[]`.

`DeviceBridge.listElements` runs it before `normalize`. `parseToolResult` stays generic
(returns raw text for non-JSON) — we do **not** teach it to strip arbitrary prefixes.

### Component 3 — `coordinates` object → bounds

`resolveBounds` (`element-model.js`) gains a branch: `coordinates: {x,y,width,height}`
(object) → `[x, y, x+width, y+height]`. Existing array/`rect`/`bounds` branches stay.

### Component 4 — Recorder alignment

The recorder must resolve real targets so captured taps aren't `tap_unknown`:
- `McpBridge.listElementsOnScreen` (`tools/recorder/src/capture/mobile-mcp-bridge.js`) runs
  the Component 2 parser and returns a usable element array.
- `HierarchyPoller` stores those elements (no longer `snap.elements` on a string).
- The recorder's element resolver (`tools/recorder/src/capture/element-resolver.js`) maps
  mobile-mcp's `{label,text,coordinates}` to the recorder's element shape it hit-tests
  against (`display_name` from `label`/`text`; bounds from the `coordinates` object).

This makes #104's live captures replayable. #105 is independent of #104 (the CLI half is
broken on `main` regardless); only the recorder *end-to-end* re-validation needs both.

### Component 5 — Invariant + tests

- **Platform-agnostic invariant:** mobile-mcp's `identifier` is a resource-id (e.g.
  `home_product_card_p001`). All mappers derive `display_name`/labels from `label`/`text`
  and **never** from `identifier`. Existing `element-model.js` already drops it — preserve
  that; the recorder mapper must do the same.
- **Recorded-fixture integration tests** (the regression guard the faked unit suites
  lacked):
  - fixtures captured from real mobile-mcp 0.0.55: the prefixed element string (30+
    elements), the `device`-validation-error response, a `mobile_list_available_devices`
    response;
  - assert: device injected into tool args (and **not** into `mobile_list_available_devices`);
    auto-discover picks the single device / errors on 0 or many; the element string parses
    to N elements; `coordinates` object → bounds; `identifier` never surfaces as a label.

## Scope boundaries (YAGNI)

- Adapt mauto to 0.0.55's contract; do **not** change the mobile-mcp pin.
- No new element-targeting logic in the bridge (taps still take explicit `x,y`); we only fix
  parsing/shape/device-threading.
- Single-device auto-discovery only; no interactive picker (multiple → actionable error).

## Risks

- The auto-discover adds a `mobile_list_available_devices` round-trip when no device is
  selected; cache the resolved id per connection so it's once per session, not per verb.
- The session daemon (#91) builds its own connection — device threading must hold on that
  path too (the daemon pins a device, so the concrete id is available).
- Element-string parsing must tolerate labels containing `]`/quotes (the captured data has
  `&#10;`-encoded multi-line labels) — parse the whole JSON array, don't regex per element.
