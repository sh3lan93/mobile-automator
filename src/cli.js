'use strict';

const fs = require('fs');
const { Command } = require('commander');

const { version: PKG_VERSION } = require('../package.json');

const { ok, fail, render, exitCodeFor } = require('./output/envelope');
const { DeviceBridge } = require('./device/bridge');
const selectionStore = require('./device/selection');
const { ScenarioValidator } = require('./scenario/validator');
const { evaluate, MECHANICAL_TYPES } = require('./assertion/evaluator');
const { ResultStore } = require('./result/store');
const { OBSERVATION_TYPES, parseObservation, parseCapture, parseBool } = require('./result/flags');
const { MemoryStore } = require('./memory/store');
const { FILES: MEMORY_FILES, AGENT_KINDS } = require('./memory/paths');
const { validateEntryText, MAX_ENTRY_LEN } = require('./memory/entries');
const configManager = require('./config/manager');
const { coerceValue } = require('./config/coerce');
const { validateAt } = require('./config/schema');
const { scaffold } = require('./setup/scaffold');
const guideEmitter = require('./guide/emitter');
const { ADAPTERS } = require('./init/adapters');
const { isSemanticAction, ACTION_METHOD, selectResolver } = require('./device/semantic-press');
const connection = require('./device/connection');
const { record } = require('./observe/recorder');

// Commander throws (via exitOverride) for two very different reasons, and the
// split below is the ONLY thing that tells them apart.
//
// The set of commander outcomes that are NOT failures is closed and tiny: help
// and version already wrote their human-readable text and computed an exit
// code. The set of ways an invocation can be malformed is open — it grows with
// every commander release. So enumerate the closed set and let everything else
// default to a parse failure (#146).
//
// An allowlist of failure codes inverts that, and anything it forgets falls
// through to `internal` — which is the panic bucket, not a neutral default:
// `diagnose()` dumps a stack trace for `internal` and it maps to exit 1, so a
// missed code turns a user typo into a fake crash. That is exactly what
// happened with `commander.optionMissingArgument` (`--run-id` with no value).
//
// `commander.executeSubCommandAsync` is unreachable here by construction: it
// fires only for standalone executable subcommands (`.command('x', 'desc')`),
// and every command in this CLI is declared with an inline `.action()`.
const COMMANDER_NON_FAILURES = new Set([
  'commander.helpDisplayed', // the --help flag
  'commander.help', // an explicit .help() call
  'commander.version', // the --version flag
]);

// True for ANY commander parse failure: bad flag, missing option value, missing
// argument, unknown subcommand, invalid choice, conflicting options, excess
// arguments — and whatever commander adds in a future release.
function isCommanderParseFailure(err) {
  return Boolean(
    err && err.name === 'CommanderError' && !COMMANDER_NON_FAILURES.has(err.code)
  );
}

// Map the user-facing --mode flag onto the stored config mode values.
const MODE_ALIASES = {
  aware: 'platform-aware',
  agnostic: 'platform-agnostic',
  'platform-aware': 'platform-aware',
  'platform-agnostic': 'platform-agnostic',
};

const KNOWN_ASSERTION_TYPES = new Set([
  ...MECHANICAL_TYPES,
  // Tier-2 visual types the agent must judge.
  'screenshot_match',
  'visual_state',
  'element_fully_visible',
  'color_style',
  'screen_title',
  'alert_present',
  'alert_text',
  'toast_visible',
  'keyboard_visible',
  'dark_mode_active',
  'permission_dialog_shown',
  'element_state',
]);

const SWIPE_DIRECTIONS = new Set(['up', 'down', 'left', 'right']);
const ORIENTATIONS = new Set(['portrait', 'landscape']);

// fs error codes that signal an environment/filesystem problem (perms, missing
// path, read-only FS, disk full) rather than a logic bug — surfaced as
// `environment` with a filesystem-specific hint.
const FS_ERROR_CODES = new Set(['EACCES', 'ENOENT', 'EROFS', 'ENOSPC', 'EPERM']);

// Build a human-readable usage line for a commander command, e.g.
// "Usage: mauto result add-step [options]". Walks the parent chain so a
// subcommand's hint names the full invocation path.
function usageLine(cmd) {
  const names = [];
  for (let c = cmd; c; c = c.parent) names.unshift(c.name());
  const usage = (cmd.usage && cmd.usage()) || '';
  return `Usage: ${names.join(' ')} ${usage}`.trim();
}

// Classify an UNEXPECTED thrown/rejected error — one a handler did NOT already
// convert into a `{envelope, exitKind}` — into the uniform fail envelope. This
// is the single boundary that guarantees a calling agent always receives one
// JSON line + a meaningful exit code instead of a raw stack trace on stderr.
//   CommanderError (parse failure) -> invalid_input, with the usage line as hint
//   SyntaxError                  -> invalid_input (a malformed JSON file)
//   fs EACCES/ENOENT/EROFS/...    -> environment, with a filesystem hint
//   anything else                -> internal
function toEnvelope(err) {
  if (isCommanderParseFailure(err)) {
    return {
      envelope: fail(
        'invalid_input',
        err.message || String(err),
        err.usage || null
      ),
      exitKind: 'invalid_input',
    };
  }
  if (err instanceof SyntaxError) {
    return {
      envelope: fail(
        'invalid_input',
        err.message || String(err),
        'A JSON file in the workspace (config.json or a host MCP config) is malformed. Fix its syntax and retry.'
      ),
      exitKind: 'invalid_input',
    };
  }
  if (err && FS_ERROR_CODES.has(err.code)) {
    return {
      envelope: fail(
        'environment',
        err.message || String(err),
        'A filesystem operation failed (permissions, a missing path, a read-only filesystem, or no disk space). Check the workspace is writable and retry.'
      ),
      exitKind: 'environment',
    };
  }
  return {
    envelope: fail('internal', (err && err.message) || String(err), null),
    exitKind: 'internal',
  };
}

// ---------------------------------------------------------------------------
// Handlers — pure-ish: accept injected deps, return { envelope, exitKind }.
// No process.exit / printing here so they are trivially unit-testable.
// ---------------------------------------------------------------------------

async function handleElements({ deviceBridge }) {
  try {
    const elements = await deviceBridge.listElements();
    return { envelope: ok(elements), exitKind: 'ok' };
  } catch (err) {
    return {
      envelope: fail(
        'device',
        err.message || String(err),
        err.hint || 'Ensure a device or simulator is connected and the app is running.'
      ),
      exitKind: 'device',
    };
  }
}

async function handleScreenshot({ deviceBridge }, destPath) {
  try {
    const savedPath = await deviceBridge.screenshot(destPath);
    return { envelope: ok({ path: savedPath }), exitKind: 'ok' };
  } catch (err) {
    return {
      envelope: fail(
        'device',
        err.message || String(err),
        err.hint || 'Ensure a device or simulator is connected.'
      ),
      exitKind: 'device',
    };
  }
}

function handleValidate({ validator }, file) {
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch (err) {
    return {
      envelope: fail(
        'invalid_input',
        `cannot read file: ${err.message}`,
        'Check that the path exists and is readable.'
      ),
      exitKind: 'invalid_input',
    };
  }

  let scenario;
  try {
    scenario = JSON.parse(raw);
  } catch (err) {
    return {
      envelope: fail(
        'invalid_input',
        `file is not valid JSON: ${err.message}`,
        'Fix the JSON syntax and try again.'
      ),
      exitKind: 'invalid_input',
    };
  }

  const result = validator.validate(scenario);
  if (result.valid) {
    return { envelope: ok({ valid: true }), exitKind: 'ok' };
  }

  const env = fail(
    'invalid_input',
    'scenario failed schema validation',
    'See data.errors for the specific schema violations.'
  );
  env.data = { valid: false, errors: result.errors };
  return { envelope: env, exitKind: 'invalid_input' };
}

function deviceFail(err) {
  // Respect a typed error's kind (e.g. the daemon's 'timeout') so the envelope
  // and exit code reflect the real failure class; anything else defaults to
  // 'device' (exit 2) as before.
  const kind = err.kind || 'device';
  return {
    envelope: fail(
      kind,
      err.message || String(err),
      err.hint || 'Ensure a device or simulator is connected and the app is running.'
    ),
    exitKind: kind,
  };
}

// Parse a "x,y" coordinate string shared by tap / long-press / double-tap.
// Returns { x, y } (rounded ints) on success, or { error } carrying the
// invalid_input fail envelope so callers can short-circuit uniformly.
function parseCoordinates(raw) {
  const parts = String(raw == null ? '' : raw).split(',');
  if (parts.length !== 2) {
    return {
      error: fail('invalid_input', `expected coordinates as "x,y", got "${raw}"`, 'Pass --at <x,y>, e.g. --at 100,250.'),
    };
  }
  // Reject empty/whitespace-only parts BEFORE Number(): Number('') is 0 (a
  // finite number), so `--at 10,` would otherwise silently resolve to (10, 0).
  const rawX = parts[0].trim();
  const rawY = parts[1].trim();
  if (rawX === '' || rawY === '') {
    return {
      error: fail('invalid_input', `expected coordinates as "x,y", got "${raw}"`, 'Pass --at <x,y>, e.g. --at 100,250.'),
    };
  }
  const x = Number(rawX);
  const y = Number(rawY);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return {
      error: fail('invalid_input', `coordinates must be numbers, got "${raw}"`, 'Pass --at <x,y>, e.g. --at 100,250.'),
    };
  }
  return { x: Math.round(x), y: Math.round(y) };
}

async function handleTap({ deviceBridge }, raw) {
  const coords = parseCoordinates(raw);
  if (coords.error) {
    return { envelope: coords.error, exitKind: 'invalid_input' };
  }
  const { x, y } = coords;
  try {
    await deviceBridge.tap({ x, y });
    return { envelope: ok({ tapped: [x, y] }), exitKind: 'ok' };
  } catch (err) {
    return deviceFail(err);
  }
}

async function handleLongPress({ deviceBridge }, raw, { duration } = {}) {
  const coords = parseCoordinates(raw);
  if (coords.error) {
    return { envelope: coords.error, exitKind: 'invalid_input' };
  }
  const { x, y } = coords;
  let ms;
  if (duration !== undefined) {
    ms = Number(duration);
    if (!Number.isInteger(ms) || ms <= 0) {
      return {
        envelope: fail('invalid_input', `duration must be a positive integer in ms, got "${duration}"`, 'Pass --duration <ms>, e.g. --duration 800.'),
        exitKind: 'invalid_input',
      };
    }
  }
  try {
    if (ms === undefined) {
      await deviceBridge.longPress({ x, y });
    } else {
      await deviceBridge.longPress({ x, y, duration: ms });
    }
    const data = { long_pressed: [x, y] };
    if (ms !== undefined) data.duration = ms;
    return { envelope: ok(data), exitKind: 'ok' };
  } catch (err) {
    return deviceFail(err);
  }
}

async function handleDoubleTap({ deviceBridge }, raw) {
  const coords = parseCoordinates(raw);
  if (coords.error) {
    return { envelope: coords.error, exitKind: 'invalid_input' };
  }
  const { x, y } = coords;
  try {
    await deviceBridge.doubleTap({ x, y });
    return { envelope: ok({ double_tapped: [x, y] }), exitKind: 'ok' };
  } catch (err) {
    return deviceFail(err);
  }
}

async function handleLaunch({ deviceBridge }, appId) {
  const id = String(appId == null ? '' : appId);
  if (!id) {
    return {
      envelope: fail('invalid_input', 'an app id is required', 'e.g. mauto launch com.example.app'),
      exitKind: 'invalid_input',
    };
  }
  try {
    await deviceBridge.launchApp(id);
    return { envelope: ok({ launched: id }), exitKind: 'ok' };
  } catch (err) {
    return deviceFail(err);
  }
}

async function handleInstall({ deviceBridge }, appPath) {
  const p = String(appPath == null ? '' : appPath);
  if (!p) {
    return {
      envelope: fail('invalid_input', 'an app path is required', 'e.g. mauto install ./app.apk'),
      exitKind: 'invalid_input',
    };
  }
  try {
    await deviceBridge.installApp(p);
    return { envelope: ok({ installed: p }), exitKind: 'ok' };
  } catch (err) {
    return deviceFail(err);
  }
}

async function handleUninstall({ deviceBridge }, appId) {
  const id = String(appId == null ? '' : appId);
  if (!id) {
    return {
      envelope: fail('invalid_input', 'an app id is required', 'e.g. mauto uninstall com.example.app'),
      exitKind: 'invalid_input',
    };
  }
  try {
    await deviceBridge.uninstallApp(id);
    return { envelope: ok({ uninstalled: id }), exitKind: 'ok' };
  } catch (err) {
    return deviceFail(err);
  }
}

async function handleOpenUrl({ deviceBridge }, url) {
  const u = String(url == null ? '' : url);
  if (!u) {
    return {
      envelope: fail('invalid_input', 'a url is required', 'e.g. mauto open-url https://example.com'),
      exitKind: 'invalid_input',
    };
  }
  try {
    await deviceBridge.openUrl(u);
    return { envelope: ok({ opened: u }), exitKind: 'ok' };
  } catch (err) {
    return deviceFail(err);
  }
}

async function handleOrientation({ deviceBridge }, orientation) {
  const o = String(orientation || '').toLowerCase();
  if (!ORIENTATIONS.has(o)) {
    return {
      envelope: fail('invalid_input', `invalid orientation "${orientation}"`, 'Use one of: portrait, landscape.'),
      exitKind: 'invalid_input',
    };
  }
  try {
    await deviceBridge.setOrientation(o);
    return { envelope: ok({ orientation: o }), exitKind: 'ok' };
  } catch (err) {
    return deviceFail(err);
  }
}

async function handleType({ deviceBridge }, text) {
  const str = text == null ? '' : String(text);
  try {
    await deviceBridge.type(str);
    return { envelope: ok({ typed: str.length }), exitKind: 'ok' };
  } catch (err) {
    return deviceFail(err);
  }
}

async function handleSwipe({ deviceBridge }, direction) {
  const dir = String(direction || '').toLowerCase();
  if (!SWIPE_DIRECTIONS.has(dir)) {
    return {
      envelope: fail('invalid_input', `invalid swipe direction "${direction}"`, 'Use one of: up, down, left, right.'),
      exitKind: 'invalid_input',
    };
  }
  try {
    await deviceBridge.swipe({ direction: dir });
    return { envelope: ok({ swiped: dir }), exitKind: 'ok' };
  } catch (err) {
    return deviceFail(err);
  }
}

async function handlePress({ deviceBridge }, button) {
  const b = String(button || '');
  if (!b) {
    return {
      envelope: fail('invalid_input', 'a button name is required', 'e.g. mauto press BACK'),
      exitKind: 'invalid_input',
    };
  }

  // Semantic actions are resolved to per-platform mechanics; a missing
  // resolution is a hard error, never a bogus token forwarded to mobile-mcp.
  if (isSemanticAction(b)) {
    try {
      const platform = await deviceBridge.getPlatform();
      const resolver = selectResolver(platform, deviceBridge);
      const { mechanism } = await resolver[ACTION_METHOD[b]]();
      return {
        envelope: ok({ pressed: b, resolved: { platform, mechanism } }),
        exitKind: 'ok',
      };
    } catch (err) {
      return deviceFail(err);
    }
  }

  // Hardware/system button passthrough (BACK/HOME/ENTER…) — unchanged.
  try {
    await deviceBridge.pressButton(b);
    return { envelope: ok({ pressed: b }), exitKind: 'ok' };
  } catch (err) {
    return deviceFail(err);
  }
}

// Build an assertion object from CLI flags, fetch the current element list,
// and run the pure evaluator. A failed assertion is a valid RESULT (exit 0);
// only an unknown assertion type is a structural (invalid_input) error.
async function handleAssert({ deviceBridge }, type, flags = {}) {
  if (!KNOWN_ASSERTION_TYPES.has(type)) {
    return {
      envelope: fail('invalid_input', `unknown assertion type "${type}"`, 'Run `mauto schema scenario` for the supported assertion types.'),
      exitKind: 'invalid_input',
    };
  }

  let elements;
  try {
    elements = await deviceBridge.listElements();
  } catch (err) {
    return deviceFail(err);
  }

  const assertion = { type };
  if (flags.target !== undefined) assertion.target = flags.target;
  if (flags.expected !== undefined) assertion.expected = flags.expected;
  if (flags.operator !== undefined) assertion.operator = flags.operator;
  if (flags.count !== undefined) assertion.count = Number(flags.count);
  if (flags.pattern !== undefined) assertion.pattern = flags.pattern;
  if (flags.variable !== undefined) assertion.variable_name = flags.variable;

  const r = evaluate(assertion, { elements });
  // The verdict has to be transcribed into `result add-assertion` by the agent
  // (assert has no run context, and Tier-2 types are not decided here at all).
  // Emitting the exact command turns transcription into copying (#140 D1).
  const verdict = r.needs_agent ? '<your verdict>' : String(r.pass);
  const hint =
    `Record it: mauto result add-assertion --run-id <run_id> --step-id <step_id> ` +
    `--type ${r.type} --pass ${verdict} --message "<why>"`;

  return {
    envelope: ok(
      {
        type: r.type,
        mechanical: r.mechanical,
        pass: r.pass,
        needs_agent: r.needs_agent,
        message: r.message,
      },
      hint
    ),
    exitKind: 'ok',
  };
}

// Collect a repeatable flag's values into an array (commander's collector).
const collect = (value, previous) => previous.concat([value]);

function handleResultAddStep({ resultStoreFactory, projectRoot }, opts) {
  const { runId, scenarioId, stepId, status, attempts, screenshot, errorMessage } = opts;
  if (!runId || !stepId || !status) {
    return {
      envelope: fail('invalid_input', '--run-id, --step-id and --status are required', null),
      exitKind: 'invalid_input',
    };
  }

  // Parse every composite flag BEFORE touching the store: a half-recorded step
  // (screenshot persisted, observation rejected) leaves the agent unable to
  // tell which half landed, so validation is all-or-nothing.
  const observations = [];
  for (const spec of opts.observation || []) {
    const parsed = parseObservation(spec);
    if (parsed.error) {
      return {
        envelope: fail('invalid_input', parsed.error, `Valid types: ${OBSERVATION_TYPES.join(' | ')}.`),
        exitKind: 'invalid_input',
      };
    }
    observations.push({ ...parsed.value, step_id: stepId });
  }

  const captures = [];
  for (const spec of opts.capture || []) {
    const parsed = parseCapture(spec);
    if (parsed.error) {
      return {
        envelope: fail('invalid_input', parsed.error, 'Use --capture <name>=<value>.'),
        exitKind: 'invalid_input',
      };
    }
    captures.push(parsed.value);
  }

  const store = resultStoreFactory({ runId, scenarioId, projectRoot });
  const step = store.addStep({
    step_id: stepId,
    status,
    attempts: attempts === undefined ? 1 : Number(attempts),
    screenshot: screenshot === undefined ? null : screenshot,
    error_message: errorMessage === undefined ? null : errorMessage,
  });
  // Echo what the STORE recorded, not the parsed request: if the store ever
  // normalizes an observation (e.g. trims/derives a field), the envelope must
  // reflect that rather than silently lying about what actually landed.
  const recordedObservations = observations.map((obs) => store.addObservation(obs));
  for (const cap of captures) store.captureVariable(cap.name, cap.value);

  return {
    envelope: ok(
      {
        run_id: runId,
        step,
        observations: recordedObservations,
        captured_variables: Object.fromEntries(captures.map((c) => [c.name, c.value])),
      },
      storeHint(store)
    ),
    exitKind: 'ok',
  };
}

// Persist an assertion verdict. Deliberately a separate verb rather than a
// side effect of `mauto assert`: 12 of the 27 assertion types are Tier 2
// (`needs_agent`, `pass: null`), so `assert` has no verdict to record at
// return time, and a side effect would re-record on every retry — inflating
// total_assertions past the scenario's actual assertion count (#140 D1).
function handleResultAddAssertion({ resultStoreFactory, projectRoot }, opts) {
  const { runId, scenarioId, stepId, type, pass, assertionId, message, expected, actual } = opts;
  if (!runId || !stepId || !type || pass === undefined) {
    return {
      envelope: fail('invalid_input', '--run-id, --step-id, --type and --pass are required', null),
      exitKind: 'invalid_input',
    };
  }
  if (!KNOWN_ASSERTION_TYPES.has(type)) {
    return {
      envelope: fail(
        'invalid_input',
        `unknown assertion type "${type}"`,
        'Run `mauto schema scenario` for the supported assertion types.'
      ),
      exitKind: 'invalid_input',
    };
  }
  const verdict = parseBool(pass, '--pass');
  if (verdict.error) {
    return { envelope: fail('invalid_input', verdict.error, null), exitKind: 'invalid_input' };
  }

  const store = resultStoreFactory({ runId, scenarioId, projectRoot });
  const entry = store.addAssertion({
    step_id: stepId,
    assertion_id: assertionId,
    type,
    pass: verdict.value,
    message,
    expected: expected === undefined ? null : expected,
    actual: actual === undefined ? null : actual,
  });
  return { envelope: ok({ run_id: runId, assertion: entry }, storeHint(store)), exitKind: 'ok' };
}

function handleResultFinalize({ resultStoreFactory, memoryStoreFactory, projectRoot }, opts) {
  const { runId, scenarioId, status, duration } = opts;
  if (!runId) {
    return {
      envelope: fail('invalid_input', '--run-id is required', null),
      exitKind: 'invalid_input',
    };
  }

  // Only provided keys: `defaultMetadata` fills the rest with 'unknown', and
  // the result schema requires all five fields to be strings, so threading
  // `undefined` through would break conformance.
  const metadata = {};
  if (opts.appVersion !== undefined) metadata.app_version = opts.appVersion;
  if (opts.deviceModel !== undefined) metadata.device_model = opts.deviceModel;
  if (opts.apiLevel !== undefined) metadata.api_level = opts.apiLevel;
  if (opts.environment !== undefined) metadata.environment = opts.environment;

  const store = resultStoreFactory({ runId, scenarioId, projectRoot });
  const result = store.finalize({
    status,
    durationSeconds: duration === undefined ? 0 : Number(duration),
    metadata,
    // Undefined when --summary is omitted; ResultStore.finalize's own
    // `summary || <generated default>` already treats that as "no override",
    // so no provided-keys-only guard is needed here (unlike metadata, whose
    // sub-fields default independently to 'unknown').
    summary: opts.summary,
  });

  // Auto-harvest into cross-session memory. This is best-effort: a memory
  // failure must never fail an otherwise-successful finalize, so its warnings
  // fold into the envelope hint instead of throwing.
  const hints = [storeHint(store)].filter(Boolean);
  if (memoryStoreFactory) {
    let mem;
    try {
      mem = memoryStoreFactory({ projectRoot });
      mem.recordRun(result);
    } catch (e) {
      hints.push(`run-history not updated: ${e.message}`);
    }
    // Fold any warnings the store accumulated (even if recordRun later threw).
    const memHint = storeHint(mem);
    if (memHint) hints.push(memHint);
  }

  return { envelope: ok(result, hints.length ? hints.join(' ') : null), exitKind: 'ok' };
}

// Collapse any recovery warnings a ResultStore accumulated (e.g. a corrupt
// prior file preserved as a sidecar) into a single envelope hint, or null.
function storeHint(store) {
  const warnings = (store && store.warnings) || [];
  return warnings.length ? warnings.join(' ') : null;
}

// --- Slice 3: workspace + reasoning-delivery floor -----------------------
//
// Contract split: the action/result verbs above emit the JSON envelope. The
// content-emitting verbs `guide`/`schema`/`bootstrap` instead emit RAW content
// (markdown / JSON schema / text) on stdout, because an agent injects that text
// directly into its own context. Their handlers return `{ raw, exitKind:'ok' }`
// on success; only their ERROR paths (unknown topic/name) fall back to the
// `fail(...)` envelope + exit 3.

function handleSetup({ projectRoot }, opts = {}) {
  const raw = opts.mode === undefined ? 'aware' : String(opts.mode);
  const mode = MODE_ALIASES[raw];
  if (!mode) {
    return {
      envelope: fail('invalid_input', `unknown mode "${opts.mode}"`, 'Use --mode aware or --mode agnostic.'),
      exitKind: 'invalid_input',
    };
  }
  const r = scaffold(projectRoot, { mode });
  return {
    envelope: ok({ created: r.created, mode: r.mode, next: 'run `mauto guide setup`' }),
    exitKind: 'ok',
  };
}

function handleConfigGet({ projectRoot }, key) {
  const value = configManager.get(projectRoot, key);
  return { envelope: ok({ key, value }), exitKind: 'ok' };
}

// Coerce the raw CLI string into the type config_schema.json declares for this
// key, then validate that one key before writing. Per-key (not whole-document)
// so unrelated pre-existing drift never blocks an otherwise-valid write.
function handleConfigSet({ projectRoot }, key, rawValue) {
  const value = coerceValue(key, rawValue);
  const { valid, errors } = validateAt(key, value);
  if (!valid) {
    return {
      envelope: fail(
        'invalid_input',
        `invalid value for config key "${key}": ${errors.join('; ')}`,
        'Run `mauto schema config` to see the declared type for this key. List keys accept a comma-separated value or a JSON array.'
      ),
      exitKind: 'invalid_input',
    };
  }
  configManager.set(projectRoot, key, value);
  return { envelope: ok({ key, value }), exitKind: 'ok' };
}

// RAW content on success; fail envelope only when the topic is unknown.
function handleGuide({ projectRoot, emitter = guideEmitter, config = configManager }, topic) {
  const cfg = config.load(projectRoot);
  const mode = config.resolveMode(cfg);
  let raw;
  try {
    raw = emitter.emitGuide(topic, { mode, projectRoot });
  } catch (err) {
    return {
      envelope: fail('invalid_input', `unknown guide topic "${topic}"`, 'Topics: generate, execute, setup.'),
      exitKind: 'invalid_input',
    };
  }
  return { raw, exitKind: 'ok' };
}

// RAW JSON schema on success; fail envelope only when the name is unknown.
function handleSchema({ emitter = guideEmitter } = {}, name) {
  let raw;
  try {
    raw = emitter.emitSchema(name);
  } catch (err) {
    return {
      envelope: fail('invalid_input', `unknown schema "${name}"`, 'Names: scenario, result, config.'),
      exitKind: 'invalid_input',
    };
  }
  return { raw, exitKind: 'ok' };
}

// RAW bootstrap text; no error path.
function handleBootstrap({ emitter = guideEmitter } = {}) {
  return { raw: emitter.emitBootstrap(), exitKind: 'ok' };
}

// RAW markdown on success; fail envelope only when --kind is unknown.
function handleMemoryShow({ memoryStoreFactory, projectRoot }, opts = {}) {
  const kind = opts.kind;
  if (kind && !Object.prototype.hasOwnProperty.call(MEMORY_FILES, kind)) {
    return {
      envelope: fail(
        'invalid_input',
        `unknown memory kind "${kind}"`,
        'Kinds: run-history, app-knowledge, preferences.'
      ),
      exitKind: 'invalid_input',
    };
  }
  const store = memoryStoreFactory({ projectRoot });
  const raw = store.render({ kind, scenario: opts.scenario });
  return { raw, exitKind: 'ok' };
}

// Agent-authored memory verbs (`memory add`/`memory forget`) are MUTATIONS —
// unlike `memory show`, they emit the JSON envelope via `emit(...)`, not raw
// content. `--kind` is validated against the closed AGENT_KINDS set;
// run-history is machine-owned (auto-harvested on `result finalize`) and is
// rejected here.
// invalid_input fail envelope if kind isn't an agent-authorable kind, else null.
function validateAgentKind(kind) {
  if (!AGENT_KINDS.includes(kind)) {
    return fail(
      'invalid_input',
      `--kind must be one of: ${AGENT_KINDS.join(', ')}`,
      'run-history is auto-harvested and cannot be hand-authored.'
    );
  }
  return null;
}

function handleMemoryAdd({ memoryStoreFactory, projectRoot }, opts = {}) {
  const { kind, text } = opts;
  const kindErr = validateAgentKind(kind);
  if (kindErr) return { envelope: kindErr, exitKind: 'invalid_input' };
  const v = validateEntryText(text);
  if (!v.ok) {
    const hint = {
      empty: 'Provide non-empty entry text.',
      too_long: `Keep entries under ${MAX_ENTRY_LEN} characters.`,
      placeholder: 'Entry text must not contain "{{".',
    }[v.reason];
    return { envelope: fail('invalid_input', `invalid entry text (${v.reason})`, hint), exitKind: 'invalid_input' };
  }
  const store = memoryStoreFactory({ projectRoot });
  const r = store.add(kind, v.value);
  const hint = r.deduped ? 'identical entry already present; skipped' : storeHint(store);
  return { envelope: ok(r, hint), exitKind: 'ok' };
}

function handleMemoryForget({ memoryStoreFactory, projectRoot }, opts = {}) {
  const { kind, match } = opts;
  const kindErr = validateAgentKind(kind);
  if (kindErr) return { envelope: kindErr, exitKind: 'invalid_input' };
  if (!match || !String(match).trim()) {
    return {
      envelope: fail('invalid_input', '--match is required', 'Provide a substring to match entries to remove.'),
      exitKind: 'invalid_input',
    };
  }
  const store = memoryStoreFactory({ projectRoot });
  const r = store.forget(kind, match);
  const hint = r.removed === 0 ? 'no matching entries' : storeHint(store);
  return { envelope: ok(r, hint), exitKind: 'ok' };
}

// --- Slice 7: vendor init -------------------------------------------------
//
// `mauto init --agent <claude|cursor>` writes per-vendor artifacts in the
// vendor's own namespace. Adapters are injectable for tests; the device is
// never exposed as MCP tools — the `mauto mcp` server advertises prompts only.
// Apply one adapter, converting any throw (perms, corrupt host config, missing
// asset) into a per-agent record so a mid-batch failure never escapes as a bare
// stack trace. Writers are idempotent/content-addressed, so a failed agent is
// re-converged cleanly on the next run without clobbering the succeeded ones.
// Classify an adapter failure HONESTLY rather than blanket-labeling it a
// filesystem fault. Real OS errors carry an E-prefixed errno (EACCES, ENOSPC,
// ...); our own malformed-config guard carries 'corrupt_mcp_config'; anything
// else (a TypeError, the leaked-placeholder guard) is an unexpected internal
// error and must NOT be disguised as an environment problem — that would send
// the operator to fix the filesystem for what is actually a code bug.
function adapterErrorClass(err) {
  const code = err && err.code;
  if (typeof code === 'string' && /^E[A-Z]+$/.test(code)) return code;
  if (code === 'corrupt_mcp_config') return 'corrupt_mcp_config';
  return 'internal';
}

function hintForAdapterError(cls) {
  if (cls === 'corrupt_mcp_config') {
    return 'An existing host config file is malformed JSON — fix it and re-run (writers are idempotent).';
  }
  if (/^E[A-Z]+$/.test(cls)) {
    return 'A filesystem/permission error blocked init (e.g. an unwritable directory or a full disk) — fix it and re-run (writers are idempotent).';
  }
  return 'Unexpected error during init (possibly a bug) — see the message, then re-run after resolving (writers are idempotent).';
}

function applyOneAdapter(adapter, agent, projectRoot) {
  try {
    const r = adapter.apply({ projectRoot });
    return { agent, ok: true, written: r.written, merged: r.merged };
  } catch (err) {
    return {
      agent,
      ok: false,
      error: adapterErrorClass(err),
      message: (err && err.message) || String(err),
    };
  }
}

function handleInit({ projectRoot, adapters = ADAPTERS }, agent) {
  const known = Object.keys(adapters);
  if (agent === 'all') {
    // Continue-on-error: every host is attempted; the result is ONE envelope
    // carrying a per-agent ok/failed map. `ok` only when all succeed.
    const perAgent = known.map((a) => applyOneAdapter(adapters[a], a, projectRoot));
    const failed = perAgent.filter((r) => !r.ok);
    if (failed.length === 0) {
      return { envelope: ok({ agents: perAgent }), exitKind: 'ok' };
    }
    return {
      envelope: fail(
        'partial_failure',
        `${failed.length}/${known.length} agents failed to initialize`,
        'See data.agents[].error; re-run to converge the failed agents (writers are idempotent).',
        { agents: perAgent }
      ),
      exitKind: 'partial',
    };
  }
  const adapter = adapters[agent];
  if (!adapter) {
    return {
      envelope: fail(
        'invalid_input',
        `unknown agent "${agent}"`,
        `supported: ${known.join(', ')}, all`
      ),
      exitKind: 'invalid_input',
    };
  }
  const r = applyOneAdapter(adapter, agent, projectRoot);
  if (!r.ok) {
    // A malformed host config is the user's input, not an environment fault —
    // surface it as invalid_input (exit 3), matching how every other verb
    // classifies bad JSON; fs/unknown adapter errors stay internal (exit 1).
    const kind = r.error === 'corrupt_mcp_config' ? 'invalid_input' : 'internal';
    return {
      envelope: fail(
        kind,
        `init for "${agent}" failed: ${r.message}`,
        hintForAdapterError(r.error),
        { agents: [r] }
      ),
      exitKind: kind,
    };
  }
  return {
    envelope: ok({ agent: r.agent, written: r.written, merged: r.merged }),
    exitKind: 'ok',
  };
}

// --- Issue #91: persistent device session daemon -------------------------
//
// `mauto session start|status|end` manage the per-workspace daemon that holds
// ONE mobile-mcp connection and serves every one-shot device verb over a Unix
// domain socket. Device verbs still autostart a daemon transparently; these
// verbs give an agent explicit lifecycle control. The handlers own only the
// envelope shaping — the "is a daemon alive / spawn one / shut one down"
// decision lives in device/connection.js, the same owner the verb path uses, so
// there is no second inline wiring of session-client/session-spawn. Deps stay
// injectable so the handlers are unit-testable without spawning a real daemon.

async function handleSessionStart(
  {
    projectRoot,
    spawn = require('./device/session-spawn'),
    client = require('./device/session-client'),
    readHandle = require('./device/resolve-connection').readHandleDevice,
  },
  opts = {}
) {
  const device = opts.device || null;
  let idleMs;
  if (opts.idle !== undefined) {
    idleMs = Number(opts.idle);
    if (!Number.isFinite(idleMs) || idleMs < 0) {
      return {
        envelope: fail('invalid_input', `invalid --idle value "${opts.idle}"`, 'Pass a non-negative number of milliseconds.'),
        exitKind: 'invalid_input',
      };
    }
  }

  if (await connection.isSessionAlive(projectRoot, { client })) {
    // A live daemon is already pinned to whatever device it was started with.
    // Echoing back the *requested* device without comparing the handle pin is
    // how #148 lied to the agent: `session start --device B` against a daemon
    // pinned to A reported already_running:true, device:B while every verb
    // kept driving A. Fail with a hint instead — the agent stays in control
    // and decides whether to `session end` and repin.
    const pinned = readHandle(projectRoot);
    if (device !== null && device !== pinned) {
      return {
        envelope: fail(
          'device',
          `a device session is already running, pinned to ${pinned || 'auto'} — not ${device}`,
          `Run \`mauto session end\` first, then \`mauto session start --device ${device}\` to repin. Omit --device to reuse the running session.`,
          { started: false, already_running: true, pinned, requested: device }
        ),
        exitKind: 'device',
      };
    }
    return {
      envelope: ok({ started: false, already_running: true, device }),
      exitKind: 'ok',
    };
  }

  const started = await connection.startSession({ projectRoot, device, idleMs, spawn });
  if (!started) {
    // The daemon's stdout/stderr are captured to the workspace log, so the
    // "why" of a startup crash exists on disk — but only this hint tells the
    // user (or agent) that it does. Same sentence the transparent-autostart
    // fallback uses, so the log is named identically wherever it surfaces.
    const logHint = connection.daemonLogHint(projectRoot);
    return {
      envelope: fail('device', 'failed to start the device session daemon', `Ensure a device or simulator is connected, or run verbs directly (they fall back to one-shot). ${logHint}`),
      exitKind: 'device',
    };
  }
  return { envelope: ok({ started: true, device }), exitKind: 'ok' };
}

async function handleSessionStatus(
  { projectRoot, client = require('./device/session-client') } = {}
) {
  const status = await connection.sessionStatus(projectRoot, { client });
  return { envelope: ok(status), exitKind: 'ok' };
}

async function handleSessionEnd(
  { projectRoot, client = require('./device/session-client') } = {}
) {
  const stopped = await connection.endSession(projectRoot, { client });
  return {
    envelope: ok({ stopped, already_stopped: !stopped }),
    exitKind: 'ok',
  };
}

// --- Issue #92: device discovery + persisted selection -------------------
//
// `mauto devices` lists connected devices/simulators (id/name/platform/state)
// via mobile-mcp. `mauto devices use <id>` persists a selection so subsequent
// one-shot verbs don't need --device; `mauto devices clear` removes it. A
// per-verb --device flag remains a per-call OVERRIDE that never writes the
// store. All deps (deviceBridge, store) are injectable for testing.

async function handleDevices({ deviceBridge }) {
  try {
    const devices = await deviceBridge.listDevices();
    // Zero devices is a valid result, not an error (exit 0 with an empty list).
    return { envelope: ok(devices), exitKind: 'ok' };
  } catch (err) {
    return {
      envelope: fail(
        'device',
        err.message || String(err),
        err.hint || 'Ensure a device or simulator is connected and reachable.'
      ),
      exitKind: 'device',
    };
  }
}

// Persist a device selection. Validates the id against the live device list so
// using a non-existent id (or selecting against zero devices) fails clearly
// with a hint instead of pinning the workspace to a phantom device.
async function handleDevicesUse({ deviceBridge, store = selectionStore, projectRoot }, id) {
  const wanted = String(id == null ? '' : id);
  if (!wanted) {
    return {
      envelope: fail('invalid_input', 'a device id is required', 'Run `mauto devices` to see ids, then `mauto devices use <id>`.'),
      exitKind: 'invalid_input',
    };
  }

  let devices;
  try {
    devices = await deviceBridge.listDevices();
  } catch (err) {
    return {
      envelope: fail('device', err.message || String(err), err.hint || 'Ensure a device or simulator is connected and reachable.'),
      exitKind: 'device',
    };
  }

  if (!devices.length) {
    return {
      envelope: fail('device', 'no devices are connected', 'Connect a device or simulator, then run `mauto devices`.'),
      exitKind: 'device',
    };
  }

  const match = devices.find((d) => d.id === wanted);
  if (!match) {
    const ids = devices.map((d) => d.id).join(', ');
    return {
      envelope: fail('device', `no connected device matches id "${wanted}"`, `Choose one of: ${ids}`),
      exitKind: 'device',
    };
  }

  store.write(projectRoot, match.id);
  return { envelope: ok({ selected: match.id, device: match }), exitKind: 'ok' };
}

async function handleDevicesClear({
  store = selectionStore,
  projectRoot,
  isAlive = require('./device/connection').isSessionAlive,
  readHandle = require('./device/resolve-connection').readHandleDevice,
} = {}) {
  const previous = store.read(projectRoot);
  store.clear(projectRoot);
  // Clearing selection.json only forgets the *persisted* choice; a running
  // daemon keeps serving the device it was started with (its handle pin is
  // the truth, and rewriting the handle would lie between file and reality).
  // Surface that so the agent knows `mauto session end` is required to switch.
  const alive = await isAlive(projectRoot);
  if (!alive) {
    return { envelope: ok({ cleared: previous || null }), exitKind: 'ok' };
  }
  const pinned = readHandle(projectRoot);
  return {
    envelope: ok(
      { cleared: previous || null, daemon_still_pinned: pinned },
      `a running device session is still pinned to ${pinned || 'auto'} — run \`mauto session end\` to switch devices`
    ),
    exitKind: 'ok',
  };
}

// ---------------------------------------------------------------------------
// Program wiring
// ---------------------------------------------------------------------------

// Build a DeviceBridge via the one connection seam, which transparently reuses
// the per-workspace device session daemon when one fits and falls back to a
// one-shot mobile-mcp spawn otherwise. Returns { bridge, close } — the
// `deviceBridgeFactory` seam + contract are preserved so existing handler tests
// stay green. When the bridge is daemon-backed, close() only releases this
// verb's socket; it never tears the shared daemon down. This is a thin alias:
// the daemon-vs-oneshot decision lives entirely in device/connection.js.
function realDeviceBridge(args) {
  return require('./device/connection').acquireConnection(args);
}

function buildProgram(deps = {}) {
  const {
    // Factory returning { bridge, close }. Overridable in tests.
    deviceBridgeFactory = realDeviceBridge,
    validator = new ScenarioValidator(),
    // Factory for the incremental result store. Overridable in tests.
    resultStoreFactory = (args) => new ResultStore(args),
    // Factory for the cross-session memory store. Overridable in tests.
    memoryStoreFactory = (args) => new MemoryStore(args),
    // Project root used to resolve mobile-automator/results/ — and, through the
    // emitters below, mobile-automator/.logs/. One root, one tree.
    projectRoot = process.cwd(),
    // The exit paths. run() passes its own instance so the help/version and
    // fatal paths it owns share this program's resolved verb.
    emitters = makeEmitters({ projectRoot }),
    // Sink used to emit the rendered envelope + drive the exit code.
    emit = emitters.emit,
  } = deps;

  const program = new Command();
  program
    .name('mauto')
    .description('Platform-agnostic mobile automation CLI')
    // Commander owns `-V, --version` rather than a hand-rolled argv pre-scan.
    // A scan like `argv.some((a) => a === '--version')` is positionally blind:
    // it cannot honor the POSIX `--` separator, which is a state transition in
    // the parser (everything after it is an operand), not a token to match. It
    // therefore hijacked the value in `mauto type -- --version`, making a
    // literal "--version" impossible to type into a device by ANY invocation.
    // Commander tracks that state, so `--` works and the version flag still
    // resolves anywhere else. Emits `commander.version` via exitOverride, which
    // run() treats as a display outcome and exits 0.
    .version(PKG_VERSION)
    .option('--human', 'render human-readable output instead of JSON', false);

  // Parse-level failures (unknown option, missing required option/argument,
  // unknown subcommand) must NOT bypass the envelope contract (#146). Without
  // exitOverride, commander prints bare text to stderr and calls process.exit
  // itself. exitOverride makes it throw a CommanderError instead; configureOutput
  // swallows commander's own stderr text so it never reaches the agent raw (the
  // message is carried in the envelope instead). Both are set on the ROOT before
  // any subcommand is created so every subcommand inherits them (commander copies
  // _exitCallback + _outputConfiguration to children via copyInheritedSettings).
  program.exitOverride(function (err) {
    // Attach the throwing command's usage line so the envelope hint can carry it.
    // `this` is the command that threw: commander invokes the callback as a
    // method of the throwing command even when the callback is inherited from
    // the root, so this.usage() names the exact subcommand that failed.
    if (this && typeof this.usage === 'function') {
      err.usage = usageLine(this);
    }
    throw err;
  });
  program.configureOutput({ writeErr: () => {} });

  // Name the verb for the observability record, from commander's own resolution
  // rather than from argv. preAction fires only after a SUCCESSFUL parse and
  // only for a command that exists, which is what makes `verb` provably a name
  // out of the vocabulary this CLI ships — the property event.js's `sends: true`
  // classification asserts. Hooks registered on the root are inherited by every
  // subcommand, so one registration covers all of them.
  //
  // `actionCommand` is the innermost command (`get` in `config get mode`), so
  // walk up to the child of the root: the record names the verb, not its
  // subcommand, keeping the vocabulary the size of the verb list.
  program.hook('preAction', (_thisCommand, actionCommand) => {
    let command = actionCommand;
    while (command.parent && command.parent.parent) command = command.parent;
    emitters.setVerb(command.name());
  });

  const humanFlag = () => Boolean(program.opts().human);

  // The single envelope boundary. Wrap every `.action(...)` callback so any
  // error that escapes a handler (an unprotected JSON.parse, an fs write, a
  // bridge-connect rejection, ...) is converted into a fail envelope + the
  // right exit code instead of a raw stack trace. Handlers that already
  // self-classify expected errors emit first and never reach this catch; it
  // only fires on the UNEXPECTED leaks. Belt-and-suspenders for buildProgram's
  // own throws lives in run() below.
  const withEnvelope = (action) => async (...args) => {
    try {
      await action(...args);
    } catch (err) {
      const classified = toEnvelope(err);
      diagnose(err, classified.exitKind);
      emit(classified, humanFlag());
    }
  };

  // Resolve which device a verb targets: explicit --device wins, else the
  // persisted selection, else null (mobile-mcp auto-selects a single device).
  // Keeping the no-selection fast path returning null preserves zero-config use.
  const resolveVerbDevice = (explicit) =>
    selectionStore.resolveDevice({ explicit, projectRoot, store: selectionStore }).device;

  // Connect a DeviceBridge for an ALREADY-RESOLVED device, run `fn` against it,
  // emit its result, and always release the connection. The factory call is
  // INSIDE the try with its own catch so a connect failure (no device, daemon
  // spawn failure, socket error) lands as a `device` envelope (exit 2) — the
  // kind an agent expects — rather than escaping as a generic `internal`.
  // `deviceBridgeFactory` is realDeviceBridge -> connection.acquireConnection
  // (the single connection seam), so this keeps both the envelope boundary and
  // the acquire-seam refactor.
  const connectBridge = async (device, fn) => {
    let bridge;
    let close;
    try {
      ({ bridge, close } = await deviceBridgeFactory({ device, projectRoot }));
    } catch (err) {
      emit(deviceFail(err), humanFlag());
      return;
    }
    try {
      const r = await fn(bridge);
      emit(r, humanFlag());
    } finally {
      if (typeof close === 'function') await close();
    }
  };

  program
    .command('elements')
    .description('List the agnostic UI elements currently on screen')
    .option('--device <id>', 'target device id')
    .action(withEnvelope((opts) =>
      connectBridge(resolveVerbDevice(opts.device), (bridge) =>
        handleElements({ deviceBridge: bridge })
      )
    ));

  program
    .command('screenshot <path>')
    .description('Save a screenshot to the given path')
    .option('--device <id>', 'target device id')
    .action(withEnvelope((destPath, opts) =>
      connectBridge(resolveVerbDevice(opts.device), (bridge) =>
        handleScreenshot({ deviceBridge: bridge }, destPath)
      )
    ));

  program
    .command('validate <file>')
    .description('Validate a scenario JSON file against the scenario schema')
    .action(withEnvelope((file) => {
      const r = handleValidate({ validator }, file);
      emit(r, humanFlag());
    }));

  // --- Action verbs (one-shot; CLI owns the mechanical work) ---------------

  const withBridge = (explicitDevice, fn) =>
    connectBridge(resolveVerbDevice(explicitDevice), fn);

  program
    .command('tap')
    .description('Tap at absolute screen coordinates')
    .requiredOption('--at <x,y>', 'coordinates as "x,y"')
    .option('--device <id>', 'target device id')
    .action(withEnvelope((opts) => withBridge(opts.device, (bridge) => handleTap({ deviceBridge: bridge }, opts.at))));

  program
    .command('type <text>')
    .description('Type text into the focused element')
    .option('--device <id>', 'target device id')
    .action(withEnvelope((text, opts) => withBridge(opts.device, (bridge) => handleType({ deviceBridge: bridge }, text))));

  program
    .command('swipe')
    .description('Swipe in a cardinal direction')
    .requiredOption('--direction <dir>', 'up | down | left | right')
    .option('--device <id>', 'target device id')
    .action(withEnvelope((opts) => withBridge(opts.device, (bridge) => handleSwipe({ deviceBridge: bridge }, opts.direction))));

  program
    .command('press <button>')
    .description('Press a system/hardware button (BACK, HOME, ENTER, ...)')
    .option('--device <id>', 'target device id')
    .action(withEnvelope((button, opts) => withBridge(opts.device, (bridge) => handlePress({ deviceBridge: bridge }, button))));

  program
    .command('long-press')
    .description('Long-press at absolute screen coordinates')
    .requiredOption('--at <x,y>', 'coordinates as "x,y"')
    .option('--duration <ms>', 'press duration in milliseconds')
    .option('--device <id>', 'target device id')
    .action(withEnvelope((opts) => withBridge(opts.device, (bridge) => handleLongPress({ deviceBridge: bridge }, opts.at, { duration: opts.duration }))));

  program
    .command('double-tap')
    .description('Double-tap at absolute screen coordinates')
    .requiredOption('--at <x,y>', 'coordinates as "x,y"')
    .option('--device <id>', 'target device id')
    .action(withEnvelope((opts) => withBridge(opts.device, (bridge) => handleDoubleTap({ deviceBridge: bridge }, opts.at))));

  program
    .command('launch <appId>')
    .description('Launch an installed app by its package/bundle id')
    .option('--device <id>', 'target device id')
    .action(withEnvelope((appId, opts) => withBridge(opts.device, (bridge) => handleLaunch({ deviceBridge: bridge }, appId))));

  program
    .command('install <path>')
    .description('Install an app from a local .apk/.app/.ipa path')
    .option('--device <id>', 'target device id')
    .action(withEnvelope((path, opts) => withBridge(opts.device, (bridge) => handleInstall({ deviceBridge: bridge }, path))));

  program
    .command('uninstall <appId>')
    .description('Uninstall an app by its package/bundle id')
    .option('--device <id>', 'target device id')
    .action(withEnvelope((appId, opts) => withBridge(opts.device, (bridge) => handleUninstall({ deviceBridge: bridge }, appId))));

  program
    .command('open-url <url>')
    .description('Open a URL (deep link or web) on the device')
    .option('--device <id>', 'target device id')
    .action(withEnvelope((url, opts) => withBridge(opts.device, (bridge) => handleOpenUrl({ deviceBridge: bridge }, url))));

  program
    .command('orientation <orientation>')
    .description('Set the device orientation (portrait | landscape)')
    .option('--device <id>', 'target device id')
    .action(withEnvelope((orientation, opts) => withBridge(opts.device, (bridge) => handleOrientation({ deviceBridge: bridge }, orientation))));

  program
    .command('assert <type>')
    .description('Evaluate an assertion against the current screen (mechanical types decided by the CLI; visual types deferred to the agent)')
    .option('--target <s>', 'element/target description')
    .option('--expected <s>', 'expected value')
    .option('--operator <op>', 'comparison operator for count assertions')
    .option('--count <n>', 'expected count')
    .option('--pattern <re>', 'regex pattern')
    .option('--variable <name>', 'captured variable name')
    .option('--device <id>', 'target device id')
    .action(withEnvelope((type, opts) =>
      withBridge(opts.device, (bridge) =>
        handleAssert({ deviceBridge: bridge }, type, {
          target: opts.target,
          expected: opts.expected,
          operator: opts.operator,
          count: opts.count,
          pattern: opts.pattern,
          variable: opts.variable,
        })
      )
    ));

  // --- Result persistence verbs --------------------------------------------

  const result = program.command('result').description('Incremental result file operations');

  result
    .command('add-step')
    .description('Append a step result to the run file')
    .requiredOption('--run-id <id>', 'run identifier (run_YYYYMMDD_HHMMSS)')
    .option('--scenario-id <id>', 'scenario identifier')
    .requiredOption('--step-id <id>', 'step identifier')
    .requiredOption('--status <s>', 'pass | fail | skipped | error')
    .option('--attempts <n>', 'number of attempts (>1 records flakiness on pass)')
    .option('--screenshot <path>', 'path to the screenshot backing this step')
    .option('--error-message <text>', 'diagnostic detail for a failed step')
    .option(
      '--observation <type:message>',
      `typed observation (${OBSERVATION_TYPES.join(' | ')}); repeatable`,
      collect,
      []
    )
    .option('--capture <name=value>', 'captured variable; repeatable', collect, [])
    .action(withEnvelope((opts) => {
      const r = handleResultAddStep(
        { resultStoreFactory, projectRoot },
        {
          runId: opts.runId,
          scenarioId: opts.scenarioId,
          stepId: opts.stepId,
          status: opts.status,
          attempts: opts.attempts,
          screenshot: opts.screenshot,
          errorMessage: opts.errorMessage,
          observation: opts.observation,
          capture: opts.capture,
        }
      );
      emit(r, humanFlag());
    }));

  result
    .command('add-assertion')
    .description('Record an assertion verdict against a step')
    .requiredOption('--run-id <id>', 'run identifier (run_YYYYMMDD_HHMMSS)')
    .option('--scenario-id <id>', 'scenario identifier')
    .requiredOption('--step-id <id>', 'step this assertion belongs to')
    .requiredOption('--type <t>', 'assertion type (see `mauto schema scenario`)')
    .requiredOption('--pass <bool>', 'true | false — the verdict being recorded')
    .option('--assertion-id <id>', 'stable assertion identifier (derived when omitted)')
    .option('--message <text>', 'human-readable justification for the verdict')
    .option('--expected <v>', 'expected value')
    .option('--actual <v>', 'observed value')
    .action(withEnvelope((opts) => {
      const r = handleResultAddAssertion(
        { resultStoreFactory, projectRoot },
        {
          runId: opts.runId,
          scenarioId: opts.scenarioId,
          stepId: opts.stepId,
          type: opts.type,
          pass: opts.pass,
          assertionId: opts.assertionId,
          message: opts.message,
          expected: opts.expected,
          actual: opts.actual,
        }
      );
      emit(r, humanFlag());
    }));

  result
    .command('finalize')
    .description('Assemble and write the final result file')
    .requiredOption('--run-id <id>', 'run identifier')
    .option('--scenario-id <id>', 'scenario identifier')
    .option('--status <s>', 'passed | failed | error')
    .option('--duration <secs>', 'total duration in seconds')
    .option('--app-version <v>', 'app version under test')
    .option('--device-model <v>', 'device the run executed on')
    .option('--api-level <v>', 'OS API level / version')
    .option('--environment <v>', "target environment (e.g. 'staging')")
    .option('--summary <text>', 'override the generated one-line result summary')
    .action(withEnvelope((opts) => {
      const r = handleResultFinalize(
        { resultStoreFactory, memoryStoreFactory, projectRoot },
        {
          runId: opts.runId,
          scenarioId: opts.scenarioId,
          status: opts.status,
          duration: opts.duration,
          appVersion: opts.appVersion,
          deviceModel: opts.deviceModel,
          apiLevel: opts.apiLevel,
          environment: opts.environment,
          summary: opts.summary,
        }
      );
      emit(r, humanFlag());
    }));

  // --- Slice 3 verbs --------------------------------------------------------

  // Emit a handler result that may be either an envelope (success/error) OR
  // raw content. Raw content with exitKind 'ok' prints verbatim (exit 0);
  // anything else is an envelope error and goes through the normal emit path.
  const emitMaybeRaw = (r) => {
    if (r.raw !== undefined && r.exitKind === 'ok') {
      emitters.emitRaw(r.raw, r.exitKind);
    } else {
      emit(r, humanFlag());
    }
  };

  program
    .command('setup')
    .description('Scaffold the workspace (mobile-automator/) and write a config')
    .option('--mode <mode>', 'aware (platform-aware, default) | agnostic (platform-agnostic)')
    .action(withEnvelope((opts) => {
      const r = handleSetup({ projectRoot }, { mode: opts.mode });
      emit(r, humanFlag());
    }));

  const config = program.command('config').description('Read or update the workspace config');
  config
    .command('get <key>')
    .description('Get a dotted-path config value')
    .action(withEnvelope((key) => emit(handleConfigGet({ projectRoot }, key), humanFlag())));
  config
    .command('set <key> <value>')
    .description('Set a dotted-path config value (coerced to its declared type per `mauto schema config`)')
    .action(withEnvelope((key, value) => emit(handleConfigSet({ projectRoot }, key, value), humanFlag())));

  program
    .command('guide <topic>')
    .description('Print the RAW workflow guide for a topic (generate|execute|setup)')
    .action(withEnvelope((topic) => emitMaybeRaw(handleGuide({ projectRoot }, topic))));

  program
    .command('schema <name>')
    .description('Print the RAW JSON schema (scenario|result|config)')
    .action(withEnvelope((name) => emitMaybeRaw(handleSchema({}, name))));

  program
    .command('bootstrap')
    .description('Print the RAW bootstrap (verb map + invariants)')
    .action(withEnvelope(() => emitMaybeRaw(handleBootstrap({}))));

  // --- Cross-session memory verbs ------------------------------------------

  const memory = program.command('memory').description('Cross-session memory (learning) operations');

  memory
    .command('show')
    .description('Print RAW memory markdown (run-history[, app-knowledge, preferences])')
    .option('--kind <k>', 'run-history | app-knowledge | preferences')
    .option('--scenario <id>', 'filter run-history to one scenario')
    .action(withEnvelope((opts) =>
      emitMaybeRaw(
        handleMemoryShow({ memoryStoreFactory, projectRoot }, { kind: opts.kind, scenario: opts.scenario })
      )
    ));

  memory
    .command('add <text>')
    .description('Record an agent-authored memory entry (app-knowledge or preferences)')
    .requiredOption('--kind <k>', 'app-knowledge | preferences')
    .action(withEnvelope((text, opts) =>
      emit(handleMemoryAdd({ memoryStoreFactory, projectRoot }, { kind: opts.kind, text }), humanFlag())
    ));

  memory
    .command('forget')
    .description('Remove agent-authored memory entries whose text contains a substring')
    .requiredOption('--kind <k>', 'app-knowledge | preferences')
    .requiredOption('--match <substr>', 'remove entries containing this substring')
    .action(withEnvelope((opts) =>
      emit(handleMemoryForget({ memoryStoreFactory, projectRoot }, { kind: opts.kind, match: opts.match }), humanFlag())
    ));

  // --- Slice 7: vendor init + MCP prompts server ---------------------------

  program
    .command('init')
    .description('Install native Agent Skills (+ slash commands/rules + MCP entry) for an agent')
    .requiredOption('--agent <name>', 'claude | cursor | gemini | copilot | agents | all')
    .action(withEnvelope((opts) => {
      const r = handleInit({ projectRoot }, opts.agent);
      emit(r, humanFlag());
    }));

  // --- Issue #91: device session lifecycle ---------------------------------

  const session = program
    .command('session')
    .description('Manage the persistent device session daemon (one reused mobile-mcp connection)');

  session
    .command('start')
    .description('Start the device session daemon (subsequent verbs reuse its connection)')
    .option('--device <id>', 'pin the daemon to a target device id')
    .option('--idle <ms>', 'idle timeout in milliseconds before the daemon self-reaps')
    .action(withEnvelope(async (opts) => {
      const r = await handleSessionStart({ projectRoot }, { device: opts.device, idle: opts.idle });
      emit(r, humanFlag());
    }));

  session
    .command('status')
    .description('Report whether a device session daemon is running')
    .action(withEnvelope(async () => {
      const r = await handleSessionStatus({ projectRoot });
      emit(r, humanFlag());
    }));

  session
    .command('end')
    .description('Stop the device session daemon and remove its socket/pidfile')
    .action(withEnvelope(async () => {
      const r = await handleSessionEnd({ projectRoot });
      emit(r, humanFlag());
    }));

  // --- Issue #92: device discovery + persisted selection -------------------

  const devices = program
    .command('devices')
    .description('List connected devices/simulators (id/name/platform/state)')
    .action(withEnvelope(() =>
      // device:null deliberately bypasses the persisted selection — this verb
      // lists ALL connected devices, it does not target the pinned one.
      connectBridge(null, (bridge) => handleDevices({ deviceBridge: bridge }))
    ));

  devices
    .command('use <id>')
    .description('Persist a device selection so subsequent verbs reuse it (--device still overrides per-call)')
    .action(withEnvelope((id) =>
      connectBridge(null, (bridge) =>
        handleDevicesUse({ deviceBridge: bridge, projectRoot }, id)
      )
    ));

  devices
    .command('clear')
    .description('Remove the persisted device selection')
    .action(withEnvelope(async () => {
      const r = await handleDevicesClear({ projectRoot });
      emit(r, humanFlag());
    }));

  program
    .command('mcp')
    .description('Run the MCP prompts server (stdio) exposing the mauto workflows as prompts')
    .action(withEnvelope(async () => {
      // Long-lived: connect the stdio transport and serve until the client
      // closes. Loaded lazily so the MCP SDK is only required for `mauto mcp`.
      const { runServer } = require('./mcp/server');
      await runServer({ projectRoot });
    }));

  return program;
}

// Keep the stack of a genuinely-unexpected error on STDERR so a crash stays
// debuggable. The stdout envelope (the agent's contract) is untouched, and the
// expected/diagnosed classes (invalid_input, environment) carry an actionable
// message + hint — so only `internal` warrants a trace.
function diagnose(err, exitKind) {
  if (exitKind === 'internal' && err && err.stack) {
    process.stderr.write(err.stack + '\n');
  }
}

// The exit paths, bound to ONE invocation's resolved dependencies. Per
// invocation rather than module-scope because every input they need is: as
// module-level functions, finish() could not see the projectRoot buildProgram()
// was handed, so it reached around the program's own DI to process.cwd() and
// wrote the record of a verb into a different tree than the verb ran against.
function makeEmitters({ projectRoot = process.cwd() } = {}) {
  // The top-level command commander actually RESOLVED, or null when parsing
  // never got that far (a parse failure, or help/version). Set via setVerb()
  // from buildProgram()'s preAction hook.
  //
  // Deliberately not `process.argv[2]`: event.js marks `verb` as `sends: true`
  // on the grounds that it is "a fixed vocabulary we ship", and slice 5 ships
  // it to a third party on that justification. argv[2] is arbitrary user text —
  // `mauto --human config get mode` recorded `--human`.
  let resolvedVerb = null;

  // THE process-ending path: every way this CLI terminates goes through here,
  // so "is this invocation observable" has exactly one answer. Only `mauto mcp`
  // is outside it — it serves until its client disconnects and then returns,
  // with no termination to record.
  //
  // One function rather than four copies of a ten-line record() literal. Two of
  // the four got written, and the classes left unrecorded were parse failures
  // (#146) — the crashes this instrumentation exists to see — and help/version.
  //
  // `text` is optional: commander writes help/version itself, so that path has
  // an invocation to record but nothing left to print.
  //
  // dur_ms uses process.uptime() (seconds since THIS process started, no state
  // needed). A Date.now() stamped at require time would measure from whenever
  // cli.js was loaded, which is not process start for anything that requires it
  // first (a test harness, bin/mauto.js's own guards).
  function finish({ text = '', exitKind, ok, errorKind, exitCode = exitCodeFor(exitKind) }) {
    // Record BEFORE the write: process.exit() below is immediate.
    const fields = {
      event: 'verb.end',
      // `info`, not `warn`-on-failure: the failure is carried by `ok` and
      // `error_kind`, and the LEVEL only decides routing. At `warn` every
      // failed verb would clear the stderr threshold and echo the envelope the
      // CLI just wrote. stderr stays a human's channel; the file sink
      // (threshold `info`) keeps the forensic record either way.
      level: 'info',
      src: 'cli',
      // Absent, not guessed, when no command resolved. makeEvent drops
      // undefined fields, so the line carries no `verb` rather than a lie.
      verb: resolvedVerb || undefined,
      ok,
      error_kind: errorKind,
      exit_code: exitCode,
      dur_ms: Math.round(process.uptime() * 1000),
    };
    record(fields, { projectRoot });
    if (text) process.stdout.write(text.endsWith('\n') ? text : text + '\n');
    process.exit(exitCode);
  }

  const fromEnvelope = (envelope, exitKind, human) => ({
    text: render(envelope, { human }),
    exitKind,
    ok: Boolean(envelope && envelope.ok),
    errorKind: envelope && envelope.error ? envelope.error.kind : undefined,
  });

  return {
    finish,
    setVerb: (verb) => {
      resolvedVerb = verb;
    },

    emit: ({ envelope, exitKind }, human) => finish(fromEnvelope(envelope, exitKind, human)),

    // Raw content (markdown / JSON schema / text) verbatim, no envelope
    // wrapping. Used by the guide/schema/bootstrap success paths.
    emitRaw: (content, exitKind) => finish({ text: content, exitKind, ok: true }),

    // Last-resort emit for errors that escape BEFORE any action runs, so the
    // in-program withEnvelope boundary can't see them — a throw inside
    // buildProgram, or a stray unhandled rejection. One JSON envelope on stdout
    // + the mapped exit code, never a raw stack trace.
    emitFatal: (err, human = false) => {
      const { envelope, exitKind } = toEnvelope(err);
      diagnose(err, exitKind);
      finish(fromEnvelope(envelope, exitKind, human));
    },
  };
}

// bin/mauto.js registers the exported emitFatal as a PROCESS-wide
// unhandledRejection handler, which can fire before run() has built anything —
// so it needs a module-level way to reach the invocation in flight. A pointer to
// the per-invocation instance, not a second copy of its state: an unhandled
// rejection is exactly the crash class this instrumentation exists to see, and
// it should carry the verb and projectRoot the invocation actually resolved.
let activeEmitters = null;
const emitFatal = (err, human = false) => (activeEmitters || makeEmitters()).emitFatal(err, human);

async function run(argv) {
  // Belt-and-suspenders around the in-program withEnvelope boundary: a throw in
  // buildProgram() (e.g. the ScenarioValidator default-param compiling a corrupt
  // bundled schema) happens before any `.action` callback, so only this outer
  // try/catch can convert it into the envelope contract. The matching
  // `unhandledRejection` guard lives in bin/mauto.js (the process entry point),
  // not here, so calling run() in tests never installs a global exit-on-reject
  // listener that would leak across the suite.
  const emitters = makeEmitters();
  activeEmitters = emitters;
  try {
    const program = buildProgram({ emitters });
    await program.parseAsync(argv);
  } catch (err) {
    // Help/version are NOT errors: commander already wrote the human-readable
    // text to stdout, so they get no envelope wrapped around them (#146). Same
    // COMMANDER_NON_FAILURES set toEnvelope classifies against, so "which
    // commander outcomes aren't failures" has exactly one answer.
    //
    // They still exit through finish(), with no text of their own to print.
    // They are real invocations, and slice 5 computes rates off this stream —
    // omitting a whole invocation class skews every one of those denominators.
    // `exitCode` comes from commander rather than a kind because commander
    // already computed one: `.help({error:true})` yields 1, not 0.
    if (err && err.name === 'CommanderError' && COMMANDER_NON_FAILURES.has(err.code)) {
      emitters.finish({ exitCode: err.exitCode || 0, ok: true });
      return;
    }
    emitters.emitFatal(err, argv.slice(2).includes('--human'));
  }
}

module.exports = {
  run,
  buildProgram,
  toEnvelope,
  diagnose,
  emitFatal,
  handleElements,
  handleScreenshot,
  handleValidate,
  handleTap,
  handleLongPress,
  handleDoubleTap,
  handleType,
  handleSwipe,
  handlePress,
  handleLaunch,
  handleInstall,
  handleUninstall,
  handleOpenUrl,
  handleOrientation,
  handleAssert,
  handleResultAddStep,
  handleResultAddAssertion,
  handleResultFinalize,
  handleSetup,
  handleConfigGet,
  handleConfigSet,
  handleGuide,
  handleSchema,
  handleBootstrap,
  handleMemoryShow,
  handleMemoryAdd,
  handleMemoryForget,
  handleInit,
  handleSessionStart,
  handleSessionStatus,
  handleSessionEnd,
  handleDevices,
  handleDevicesUse,
  handleDevicesClear,
};
