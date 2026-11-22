'use strict';

// The harness for end-to-end workspace-safety cases (#345, #347): a real
// temp project with a planted link, a verb run in-process through
// buildProgram, and a snapshot to prove the link's target was left alone.
// Each case file builds its own CASES on top of these.

const os = require('os');
const fs = require('fs');
const path = require('path');

const { buildProgram } = require('../../src/cli');
const { findWorkspaceRoot } = require('../../src/workspace/discover');

const CANARY = 'SECRET-CANARY';

// A fresh temp dir, realpath'd so paths compare equal to what the CLI sees.
function tmpDir(prefix = 'mauto-cli-safety-') {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
}

function captureEmitters() {
  const calls = [];
  return {
    calls,
    emitters: {
      emit: (r) => calls.push(r),
      emitRaw: (raw, exitKind) => calls.push({ raw, exitKind }),
      finish: () => {},
      setVerb: () => {},
      setRunId: () => {},
      setSessionId: () => {},
      getRunId: () => null,
      getVerb: () => null,
    },
  };
}

// Every file under dir, relative path -> bytes.
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      const st = fs.lstatSync(p);
      if (st.isDirectory()) walk(p);
      else out[path.relative(dir, p)] = fs.readFileSync(p, 'utf8');
    }
  };
  walk(dir);
  return out;
}

// A workspace with a regular config.json and an outside/ directory holding the
// canary. `plant(ws, outside)` adds the symlink under test.
function fixture(plant) {
  const root = tmpDir();
  const ws = path.join(root, '.mobile-automator');
  const outside = path.join(root, 'outside');
  fs.mkdirSync(ws);
  fs.mkdirSync(outside);
  fs.writeFileSync(path.join(ws, 'config.json'), JSON.stringify({ mode: 'platform-aware' }, null, 2) + '\n');
  plant(ws, outside);
  return { root, ws, outside };
}

const fakeBridgeFactory = async () => ({
  bridge: { listDevices: async () => [{ id: 'emulator-5554', name: 'Pixel', platform: 'android' }] },
  close: async () => {},
});

// `cwd` (default `root`) is where the verb runs from, and where discovery
// starts: a subdirectory of `root` for a verb run below the workspace.
async function runIn(root, argv, { deviceBridgeFactory = fakeBridgeFactory, emitterOverrides = {}, cwd = root } = {}) {
  const { calls, emitters: base } = captureEmitters();
  const emitters = { ...base, ...emitterOverrides };
  const written = [];
  const out = jest.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
    written.push(String(chunk));
    return true;
  });
  const err = jest.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    written.push(String(chunk));
    return true;
  });
  try {
    await buildProgram({
      cwd,
      workspace: findWorkspaceRoot(cwd),
      emitters,
      deviceBridgeFactory,
    }).parseAsync(['node', 'mauto', ...argv]);
  } finally {
    out.mockRestore();
    err.mockRestore();
  }
  return { calls, written: written.join('') };
}

module.exports = { CANARY, tmpDir, captureEmitters, snapshot, fixture, fakeBridgeFactory, runIn };
