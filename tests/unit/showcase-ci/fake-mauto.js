'use strict';

// Shared harness for the showcase CI script tests (#313): a temp sandbox with
// a fake `mauto` executable in it, and a runner that executes a real script
// under bash with MAUTO pointing at the fake. replay.test.js and
// device-id.test.js both use it, so there is one fake-mauto setup to keep
// right, not two.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const CI_DIR = path.resolve(__dirname, '../../../showcase-app/ci');
const hasBash = spawnSync('bash', ['--version']).status === 0;
const describeIfBash = hasBash ? describe : describe.skip;

let current;

/**
 * Create a sandbox: `<root>/bin/fake-mauto` holding `body` (a bash script).
 * The sandbox is removed by `cleanup()` (call it from afterEach).
 */
function sandbox(prefix, body) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  current = root;
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const mauto = path.join(bin, 'fake-mauto');
  fs.writeFileSync(mauto, body, { mode: 0o755 });
  return { root, bin, mauto };
}

/** Run `showcase-app/ci/<script>` under bash with MAUTO set to the sandbox's fake. */
function runScript(script, args, { mauto, env = {} }) {
  return spawnSync('bash', [path.join(CI_DIR, script), ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, MAUTO: mauto, ...env },
  });
}

function cleanup() {
  if (current) fs.rmSync(current, { recursive: true, force: true });
  current = undefined;
}

module.exports = { CI_DIR, hasBash, describeIfBash, sandbox, runScript, cleanup };
