#!/usr/bin/env node
'use strict';

const { run, emitFatal } = require('../src/cli');

// Final safety net for the envelope contract (#120): a stray async rejection
// that escapes the in-program boundary still becomes one JSON envelope + the
// mapped exit code instead of a raw stack trace. Registered here, at the
// process entry point, so importing/testing the CLI never installs a global
// exit-on-reject listener.
process.on('unhandledRejection', emitFatal);

// `--version` / `-V` are handled here (the process entry point) rather than in
// src/cli.js so the commander program stays free of a version flag that would
// otherwise be re-declared per test harness. The version is read from the
// package manifest so it always matches the installed release.
const VERSION_FLAGS = new Set(['--version', '-V']);
if (process.argv.slice(2).some((arg) => VERSION_FLAGS.has(arg))) {
  // eslint-disable-next-line global-require
  const { version } = require('../package.json');
  process.stdout.write(version + '\n');
  process.exit(0);
}

run(process.argv);
