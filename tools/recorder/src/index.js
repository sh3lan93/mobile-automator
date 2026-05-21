#!/usr/bin/env node
'use strict';

const { Command, Option } = require('commander');

const SUPPORTED_PLATFORMS = ['android', 'ios'];

function buildProgram() {
  const program = new Command();
  program
    .name('mobile-automator-recorder')
    .description('Sidecar for /mobile-automator:record')
    .requiredOption('--scenario <name>', 'scenario name (snake_case)')
    .option('--mode <mode>', 'capture mode: b | c3', 'b')
    .addOption(
      new Option('--platform <platform>', 'target device platform').choices(SUPPORTED_PLATFORMS).default('android'),
    )
    .option('--no-gui', 'run without launching browser (test mode)')
    .option('--preconditions-modal', 'show preconditions modal before recording')
    .option('--allow-sensitive-input', 'opt-out of sensitive-input warnings')
    .option('--verify', 'replay scenario via /execute after Save')
    .option('--overwrite', 'overwrite existing scenario');
  return program;
}

async function main(argv) {
  const program = buildProgram();
  program.parse(argv);
  const opts = program.opts();
  const { startLiveCapture } = require('./lifecycle/live');
  const exitCode = await startLiveCapture({
    projectRoot: process.cwd(),
    scenarioId: opts.scenario,
    platform: opts.platform,
    mode: opts.mode,
    opts: {
      noGui: !opts.gui,
      preconditionsModal: !!opts.preconditionsModal,
      allowSensitiveInput: !!opts.allowSensitiveInput,
      verify: !!opts.verify,
      overwrite: !!opts.overwrite,
    },
  });
  process.exit(exitCode);
}

if (require.main === module) {
  main(process.argv);
}

module.exports = { buildProgram, main };
