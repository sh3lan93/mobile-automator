'use strict';

const fs = require('fs');
const { Command } = require('commander');

const { ok, fail, render, exitCodeFor } = require('./output/envelope');
const { DeviceBridge } = require('./device/bridge');
const { ScenarioValidator } = require('./scenario/validator');

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
        'Ensure a device or simulator is connected and the app is running.'
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
        'Ensure a device or simulator is connected.'
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

// ---------------------------------------------------------------------------
// Program wiring
// ---------------------------------------------------------------------------

// Lazily build a DeviceBridge backed by a real mobile-mcp connection. Returns
// the bridge plus a close() to tear the transport down. Imported lazily so the
// MCP SDK is only loaded when an on-device command actually runs.
async function realDeviceBridge({ device } = {}) {
  const { createCall } = require('./device/mobile-mcp-client');
  const { call, close } = await createCall({ device });
  return { bridge: new DeviceBridge({ call }), close };
}

function buildProgram(deps = {}) {
  const {
    // Factory returning { bridge, close }. Overridable in tests.
    deviceBridgeFactory = realDeviceBridge,
    validator = new ScenarioValidator(),
    // Sink used to emit the rendered envelope + drive the exit code.
    emit = defaultEmit,
  } = deps;

  const program = new Command();
  program
    .name('mauto')
    .description('Platform-agnostic mobile automation CLI')
    .option('--human', 'render human-readable output instead of JSON', false);

  const humanFlag = () => Boolean(program.opts().human);

  program
    .command('elements')
    .description('List the agnostic UI elements currently on screen')
    .option('--device <id>', 'target device id')
    .action(async (opts) => {
      const { bridge, close } = await deviceBridgeFactory({ device: opts.device });
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
      const { bridge, close } = await deviceBridgeFactory({ device: opts.device });
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

  return program;
}

function defaultEmit({ envelope, exitKind }, human) {
  process.stdout.write(render(envelope, { human }) + '\n');
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
};
