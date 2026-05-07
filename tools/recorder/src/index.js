#!/usr/bin/env node
'use strict';

const { Command } = require('commander');

function buildProgram() {
  const program = new Command();
  program
    .name('mobile-automator-recorder')
    .description('Sidecar for /mobile-automator:record')
    .requiredOption('--scenario <name>', 'scenario name (snake_case)')
    .option('--mode <mode>', 'capture mode: b | c3', 'b')
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
  // Phase 1 implementation arrives in subsequent tasks.
  console.log(`recorder: scenario=${opts.scenario} mode=${opts.mode}`);
  process.exit(0);
}

if (require.main === module) {
  main(process.argv);
}

module.exports = { buildProgram, main };
