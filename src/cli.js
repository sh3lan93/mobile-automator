'use strict';

const fs = require('fs');
const { Command } = require('commander');

const { ok, fail, render, exitCodeFor } = require('./output/envelope');
const { DeviceBridge } = require('./device/bridge');
const selectionStore = require('./device/selection');
const { ScenarioValidator } = require('./scenario/validator');
const { evaluate, MECHANICAL_TYPES } = require('./assertion/evaluator');
const { ResultStore } = require('./result/store');
const configManager = require('./config/manager');
const { scaffold } = require('./setup/scaffold');
const guideEmitter = require('./guide/emitter');
const { ADAPTERS } = require('./init/adapters');

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
  return {
    envelope: fail(
      'device',
      err.message || String(err),
      err.hint || 'Ensure a device or simulator is connected and the app is running.'
    ),
    exitKind: 'device',
  };
}

async function handleTap({ deviceBridge }, raw) {
  const parts = String(raw == null ? '' : raw).split(',');
  if (parts.length !== 2) {
    return {
      envelope: fail('invalid_input', `expected coordinates as "x,y", got "${raw}"`, 'Pass --at <x,y>, e.g. --at 100,250.'),
      exitKind: 'invalid_input',
    };
  }
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return {
      envelope: fail('invalid_input', `coordinates must be numbers, got "${raw}"`, 'Pass --at <x,y>, e.g. --at 100,250.'),
      exitKind: 'invalid_input',
    };
  }
  const ix = Math.round(x);
  const iy = Math.round(y);
  try {
    await deviceBridge.tap({ x: ix, y: iy });
    return { envelope: ok({ tapped: [ix, iy] }), exitKind: 'ok' };
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
      envelope: fail('invalid_input', `unknown assertion type "${type}"`, 'See the executor SKILL for the supported assertion types.'),
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
  return {
    envelope: ok({
      type: r.type,
      mechanical: r.mechanical,
      pass: r.pass,
      needs_agent: r.needs_agent,
      message: r.message,
    }),
    exitKind: 'ok',
  };
}

function handleResultAddStep({ resultStoreFactory, projectRoot }, opts) {
  const { runId, scenarioId, stepId, status, attempts } = opts;
  if (!runId || !stepId || !status) {
    return {
      envelope: fail('invalid_input', '--run-id, --step-id and --status are required', null),
      exitKind: 'invalid_input',
    };
  }
  const store = resultStoreFactory({ runId, scenarioId, projectRoot });
  const step = store.addStep({
    step_id: stepId,
    status,
    attempts: attempts === undefined ? 1 : Number(attempts),
  });
  return { envelope: ok({ run_id: runId, step }), exitKind: 'ok' };
}

function handleResultFinalize({ resultStoreFactory, projectRoot }, opts) {
  const { runId, scenarioId, status, duration } = opts;
  if (!runId) {
    return {
      envelope: fail('invalid_input', '--run-id is required', null),
      exitKind: 'invalid_input',
    };
  }
  const store = resultStoreFactory({ runId, scenarioId, projectRoot });
  const result = store.finalize({
    status,
    durationSeconds: duration === undefined ? 0 : Number(duration),
  });
  return { envelope: ok(result), exitKind: 'ok' };
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

function handleConfigSet({ projectRoot }, key, rawValue) {
  let value = rawValue;
  try {
    value = JSON.parse(rawValue);
  } catch (_) {
    // Not JSON — keep the literal string.
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
      envelope: fail('invalid_input', `unknown schema "${name}"`, 'Names: scenario, result.'),
      exitKind: 'invalid_input',
    };
  }
  return { raw, exitKind: 'ok' };
}

// RAW bootstrap text; no error path.
function handleBootstrap({ emitter = guideEmitter } = {}) {
  return { raw: emitter.emitBootstrap(), exitKind: 'ok' };
}

// --- Slice 7: vendor init -------------------------------------------------
//
// `mauto init --agent <claude|cursor>` writes per-vendor artifacts in the
// vendor's own namespace. Adapters are injectable for tests; the device is
// never exposed as MCP tools — the `mauto mcp` server advertises prompts only.
function handleInit({ projectRoot, adapters = ADAPTERS }, agent) {
  const known = Object.keys(adapters);
  if (agent === 'all') {
    const results = known.map((a) => adapters[a].apply({ projectRoot }));
    return {
      envelope: ok({
        agents: results.map((r) => r.agent),
        written: results.flatMap((r) => r.written),
        merged: results.flatMap((r) => r.merged),
      }),
      exitKind: 'ok',
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
  const r = adapter.apply({ projectRoot });
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
// verbs give an agent explicit lifecycle control. All session deps are
// injectable so the handlers are unit-testable without spawning a real daemon.

async function handleSessionStart(
  { projectRoot, spawn = require('./device/session-spawn'), client = require('./device/session-client') },
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

  if (await client.isAlive(projectRoot)) {
    return {
      envelope: ok({ started: false, already_running: true, device }),
      exitKind: 'ok',
    };
  }

  const started = await spawn.spawnDaemon({ projectRoot, device, idleMs });
  if (!started) {
    return {
      envelope: fail('device', 'failed to start the device session daemon', 'Ensure a device or simulator is connected, or run verbs directly (they fall back to one-shot).'),
      exitKind: 'device',
    };
  }
  return { envelope: ok({ started: true, device }), exitKind: 'ok' };
}

async function handleSessionStatus(
  { projectRoot, client = require('./device/session-client') } = {}
) {
  const running = await client.isAlive(projectRoot);
  return { envelope: ok({ running }), exitKind: 'ok' };
}

async function handleSessionEnd(
  { projectRoot, client = require('./device/session-client') } = {}
) {
  const stopped = await client.requestShutdown(projectRoot);
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

function handleDevicesClear({ store = selectionStore, projectRoot }) {
  const previous = store.read(projectRoot);
  store.clear(projectRoot);
  return { envelope: ok({ cleared: previous || null }), exitKind: 'ok' };
}

// ---------------------------------------------------------------------------
// Program wiring
// ---------------------------------------------------------------------------

// Build a DeviceBridge, transparently reusing the per-workspace device session
// daemon when one fits and falling back to a one-shot mobile-mcp spawn
// otherwise. Returns { bridge, close } — the `deviceBridgeFactory` seam +
// contract are preserved so existing handler tests stay green. When the bridge
// is daemon-backed, close() only releases this verb's socket; it never tears
// the shared daemon down.
async function realDeviceBridge({ device, projectRoot = process.cwd() } = {}) {
  const { resolveDeviceConnection } = require('./device/resolve-connection');
  const { bridge, close } = await resolveDeviceConnection({ device, projectRoot });
  return { bridge, close };
}

function buildProgram(deps = {}) {
  const {
    // Factory returning { bridge, close }. Overridable in tests.
    deviceBridgeFactory = realDeviceBridge,
    validator = new ScenarioValidator(),
    // Factory for the incremental result store. Overridable in tests.
    resultStoreFactory = (args) => new ResultStore(args),
    // Project root used to resolve mobile-automator/results/.
    projectRoot = process.cwd(),
    // Sink used to emit the rendered envelope + drive the exit code.
    emit = defaultEmit,
  } = deps;

  const program = new Command();
  program
    .name('mauto')
    .description('Platform-agnostic mobile automation CLI')
    .option('--human', 'render human-readable output instead of JSON', false);

  const humanFlag = () => Boolean(program.opts().human);

  // Resolve which device a verb targets: explicit --device wins, else the
  // persisted selection, else null (mobile-mcp auto-selects a single device).
  // Keeping the no-selection fast path returning null preserves zero-config use.
  const resolveVerbDevice = (explicit) =>
    selectionStore.resolveDevice({ explicit, projectRoot, store: selectionStore }).device;

  program
    .command('elements')
    .description('List the agnostic UI elements currently on screen')
    .option('--device <id>', 'target device id')
    .action(async (opts) => {
      const device = resolveVerbDevice(opts.device);
      const { bridge, close } = await deviceBridgeFactory({ device, projectRoot });
      try {
        const r = await handleElements({ deviceBridge: bridge });
        emit(r, humanFlag());
      } finally {
        if (typeof close === 'function') await close();
      }
    });

  program
    .command('screenshot <path>')
    .description('Save a screenshot to the given path')
    .option('--device <id>', 'target device id')
    .action(async (destPath, opts) => {
      const device = resolveVerbDevice(opts.device);
      const { bridge, close } = await deviceBridgeFactory({ device, projectRoot });
      try {
        const r = await handleScreenshot({ deviceBridge: bridge }, destPath);
        emit(r, humanFlag());
      } finally {
        if (typeof close === 'function') await close();
      }
    });

  program
    .command('validate <file>')
    .description('Validate a scenario JSON file against the scenario schema')
    .action((file) => {
      const r = handleValidate({ validator }, file);
      emit(r, humanFlag());
    });

  // --- Action verbs (one-shot; CLI owns the mechanical work) ---------------

  const withBridge = async (explicitDevice, fn) => {
    const device = resolveVerbDevice(explicitDevice);
    const { bridge, close } = await deviceBridgeFactory({ device, projectRoot });
    try {
      const r = await fn(bridge);
      emit(r, humanFlag());
    } finally {
      if (typeof close === 'function') await close();
    }
  };

  program
    .command('tap')
    .description('Tap at absolute screen coordinates')
    .requiredOption('--at <x,y>', 'coordinates as "x,y"')
    .option('--device <id>', 'target device id')
    .action((opts) => withBridge(opts.device, (bridge) => handleTap({ deviceBridge: bridge }, opts.at)));

  program
    .command('type <text>')
    .description('Type text into the focused element')
    .option('--device <id>', 'target device id')
    .action((text, opts) => withBridge(opts.device, (bridge) => handleType({ deviceBridge: bridge }, text)));

  program
    .command('swipe')
    .description('Swipe in a cardinal direction')
    .requiredOption('--direction <dir>', 'up | down | left | right')
    .option('--device <id>', 'target device id')
    .action((opts) => withBridge(opts.device, (bridge) => handleSwipe({ deviceBridge: bridge }, opts.direction)));

  program
    .command('press <button>')
    .description('Press a system/hardware button (BACK, HOME, ENTER, ...)')
    .option('--device <id>', 'target device id')
    .action((button, opts) => withBridge(opts.device, (bridge) => handlePress({ deviceBridge: bridge }, button)));

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
    .action((type, opts) =>
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
    );

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
    .action((opts) => {
      const r = handleResultAddStep(
        { resultStoreFactory, projectRoot },
        {
          runId: opts.runId,
          scenarioId: opts.scenarioId,
          stepId: opts.stepId,
          status: opts.status,
          attempts: opts.attempts,
        }
      );
      emit(r, humanFlag());
    });

  result
    .command('finalize')
    .description('Assemble and write the final result file')
    .requiredOption('--run-id <id>', 'run identifier')
    .option('--scenario-id <id>', 'scenario identifier')
    .option('--status <s>', 'passed | failed | error')
    .option('--duration <secs>', 'total duration in seconds')
    .action((opts) => {
      const r = handleResultFinalize(
        { resultStoreFactory, projectRoot },
        {
          runId: opts.runId,
          scenarioId: opts.scenarioId,
          status: opts.status,
          duration: opts.duration,
        }
      );
      emit(r, humanFlag());
    });

  // --- Slice 3 verbs --------------------------------------------------------

  // Emit a handler result that may be either an envelope (success/error) OR
  // raw content. Raw content with exitKind 'ok' prints verbatim (exit 0);
  // anything else is an envelope error and goes through the normal emit path.
  const emitMaybeRaw = (r) => {
    if (r.raw !== undefined && r.exitKind === 'ok') {
      emitRaw(r.raw, r.exitKind);
    } else {
      emit(r, humanFlag());
    }
  };

  program
    .command('setup')
    .description('Scaffold the workspace (mobile-automator/) and write a config')
    .option('--mode <mode>', 'aware (platform-aware, default) | agnostic (platform-agnostic)')
    .action((opts) => {
      const r = handleSetup({ projectRoot }, { mode: opts.mode });
      emit(r, humanFlag());
    });

  const config = program.command('config').description('Read or update the workspace config');
  config
    .command('get <key>')
    .description('Get a dotted-path config value')
    .action((key) => emit(handleConfigGet({ projectRoot }, key), humanFlag()));
  config
    .command('set <key> <value>')
    .description('Set a dotted-path config value (JSON-parsed when possible)')
    .action((key, value) => emit(handleConfigSet({ projectRoot }, key, value), humanFlag()));

  program
    .command('guide <topic>')
    .description('Print the RAW workflow guide for a topic (generate|execute|setup)')
    .action((topic) => emitMaybeRaw(handleGuide({ projectRoot }, topic)));

  program
    .command('schema <name>')
    .description('Print the RAW JSON schema (scenario|result)')
    .action((name) => emitMaybeRaw(handleSchema({}, name)));

  program
    .command('bootstrap')
    .description('Print the RAW bootstrap (verb map + invariants)')
    .action(() => emitMaybeRaw(handleBootstrap({})));

  // --- Slice 7: vendor init + MCP prompts server ---------------------------

  program
    .command('init')
    .description('Install native Agent Skills (+ slash commands/rules + MCP entry) for an agent')
    .requiredOption('--agent <name>', 'claude | cursor | gemini | copilot | agents | all')
    .action((opts) => {
      const r = handleInit({ projectRoot }, opts.agent);
      emit(r, humanFlag());
    });

  // --- Issue #91: device session lifecycle ---------------------------------

  const session = program
    .command('session')
    .description('Manage the persistent device session daemon (one reused mobile-mcp connection)');

  session
    .command('start')
    .description('Start the device session daemon (subsequent verbs reuse its connection)')
    .option('--device <id>', 'pin the daemon to a target device id')
    .option('--idle <ms>', 'idle timeout in milliseconds before the daemon self-reaps')
    .action(async (opts) => {
      const r = await handleSessionStart({ projectRoot }, { device: opts.device, idle: opts.idle });
      emit(r, humanFlag());
    });

  session
    .command('status')
    .description('Report whether a device session daemon is running')
    .action(async () => {
      const r = await handleSessionStatus({ projectRoot });
      emit(r, humanFlag());
    });

  session
    .command('end')
    .description('Stop the device session daemon and remove its socket/pidfile')
    .action(async () => {
      const r = await handleSessionEnd({ projectRoot });
      emit(r, humanFlag());
    });

  // --- Issue #92: device discovery + persisted selection -------------------

  const devices = program
    .command('devices')
    .description('List connected devices/simulators (id/name/platform/state)')
    .action(async () => {
      const { bridge, close } = await deviceBridgeFactory({ device: null, projectRoot });
      try {
        const r = await handleDevices({ deviceBridge: bridge });
        emit(r, humanFlag());
      } finally {
        if (typeof close === 'function') await close();
      }
    });

  devices
    .command('use <id>')
    .description('Persist a device selection so subsequent verbs reuse it (--device still overrides per-call)')
    .action(async (id) => {
      const { bridge, close } = await deviceBridgeFactory({ device: null, projectRoot });
      try {
        const r = await handleDevicesUse({ deviceBridge: bridge, projectRoot }, id);
        emit(r, humanFlag());
      } finally {
        if (typeof close === 'function') await close();
      }
    });

  devices
    .command('clear')
    .description('Remove the persisted device selection')
    .action(() => {
      const r = handleDevicesClear({ projectRoot });
      emit(r, humanFlag());
    });

  program
    .command('mcp')
    .description('Run the MCP prompts server (stdio) exposing the mauto workflows as prompts')
    .action(async () => {
      // Long-lived: connect the stdio transport and serve until the client
      // closes. Loaded lazily so the MCP SDK is only required for `mauto mcp`.
      const { runServer } = require('./mcp/server');
      await runServer({ projectRoot });
    });

  return program;
}

function defaultEmit({ envelope, exitKind }, human) {
  process.stdout.write(render(envelope, { human }) + '\n');
  process.exit(exitCodeFor(exitKind));
}

// Print raw content (markdown / JSON schema / text) verbatim — no envelope
// wrapping — then exit. Used by guide/schema/bootstrap success paths.
function emitRaw(content, exitKind) {
  process.stdout.write(content.endsWith('\n') ? content : content + '\n');
  process.exit(exitCodeFor(exitKind));
}

async function run(argv) {
  const program = buildProgram();
  await program.parseAsync(argv);
}

module.exports = {
  run,
  buildProgram,
  handleElements,
  handleScreenshot,
  handleValidate,
  handleTap,
  handleType,
  handleSwipe,
  handlePress,
  handleAssert,
  handleResultAddStep,
  handleResultFinalize,
  handleSetup,
  handleConfigGet,
  handleConfigSet,
  handleGuide,
  handleSchema,
  handleBootstrap,
  handleInit,
  handleSessionStart,
  handleSessionStatus,
  handleSessionEnd,
  handleDevices,
  handleDevicesUse,
  handleDevicesClear,
};
