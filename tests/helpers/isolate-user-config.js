'use strict';

// Every test file runs against a throwaway per-user config directory (#348).
//
// Telemetry consent is recorded in the user's own config directory
// (src/observe/consent.js), outside the repository. Without this file, a test
// that enables telemetry would write the developer's real
// ~/.config/mauto/telemetry-consent.json and quietly opt their machine in for
// a temp project. So, before any test in the file runs:
//
//   1. the REAL consent file is located from the environment jest started
//      with, and its state is snapshotted;
//   2. XDG_CONFIG_HOME is pointed at a fresh temp directory;
//   3. afterAll fails the file if the real consent file changed.
//
// (3) is what makes this a guard and not a convention. jest gives each test
// file its own copy of process.env, but child_process reads the worker's real
// environment, not that copy, so a spawned CLI is isolated only when the test
// passes `env: { ...process.env, ... }` (every CLI spawn in this suite does).
// A spawn that does not, and writes consent, trips (3).

const fs = require('fs');
const os = require('os');
const path = require('path');

const { consentPath } = require('../../src/observe/consent');

const realConsentFile = consentPath({ env: { ...process.env } });

function snapshot(file) {
  try {
    const st = fs.lstatSync(file);
    return {
      exists: true,
      mtimeMs: st.mtimeMs,
      size: st.size,
      content: st.isFile() ? fs.readFileSync(file, 'utf8') : null,
    };
  } catch (err) {
    return { exists: false, code: err.code };
  }
}

const before = snapshot(realConsentFile);
const isolatedConfigHome = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-xdg-'));
process.env.XDG_CONFIG_HOME = isolatedConfigHome;

afterAll(() => {
  const after = snapshot(realConsentFile);
  fs.rmSync(isolatedConfigHome, { recursive: true, force: true });
  if (JSON.stringify(after) !== JSON.stringify(before)) {
    throw new Error(
      `A test changed the developer's real telemetry consent file ${realConsentFile}. ` +
        'Pass an isolated XDG_CONFIG_HOME (tests/helpers/user-config.js) to any env you inject, ' +
        'and spawn CLIs with env: { ...process.env, ... }.'
    );
  }
});
