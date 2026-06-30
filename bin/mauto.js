#!/usr/bin/env node
'use strict';

const { run, emitFatal } = require('../src/cli');

// Final safety net for the envelope contract (#120): a stray async rejection
// that escapes the in-program boundary still becomes one JSON envelope + the
// mapped exit code instead of a raw stack trace. Registered here, at the
// process entry point, so importing/testing the CLI never installs a global
// exit-on-reject listener.
process.on('unhandledRejection', emitFatal);

run(process.argv);
