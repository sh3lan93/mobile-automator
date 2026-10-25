'use strict';

const fs = require('fs');
const path = require('path');

// Actionable hints for device-engine failures whose raw message alone does not
// tell the user what to do. Pure: message in, hint string (or null) out. It
// never throws — a hint classifier that crashes would turn a device failure
// into an internal one. Found by the #199 real-device run against mobile-mcp
// 1.0.5 / mobilecli 1.0.13; the missing-agent case's auto-install was fixed
// upstream in mobile-mcp 1.0.11 (#248), so that hint now covers only a failed
// automatic install.
//
// mauto only TELLS the user which command to run; it never runs mobilecli
// itself (the device is driven only through mauto verbs, which wrap
// mobile-mcp).

// The mobilecli that the pinned mobile-mcp actually spawns — resolved from
// mobile-mcp's own directory, since that is the copy whose agent the device
// must match. Null when it cannot be resolved; the caller omits `@<version>`.
function resolveMobilecliVersion() {
  const mcpDir = path.dirname(require.resolve('@mobilenext/mobile-mcp/package.json'));
  const pkgPath = require.resolve('mobilecli/package.json', { paths: [mcpDir] });
  // Read, not require(): a non-literal require specifier is unverifiable to
  // tests/lint/telemetry-transport-isolation.test.js.
  return JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || null;
}

function safeVersion(resolver) {
  try {
    const v = resolver();
    return typeof v === 'string' && v ? v : null;
  } catch {
    return null;
  }
}

// B1 (iOS): the simulator is missing the DeviceKit agent. Against mobile-mcp
// 1.0.5 (#199) the engine could not install it itself — `agent status` exited 1
// under execFileSync and the throw skipped the auto-install (mobile-mcp#459).
// mobile-mcp 1.0.11+ installs it automatically, so this message now means that
// automatic install failed (e.g. offline); installing once by hand still works.
function missingAgentHint(message, resolver) {
  const version = safeVersion(resolver);
  const pkg = version ? `mobilecli@${version}` : 'mobilecli';
  const cmd = `npx -y ${pkg} agent install --device`;
  const m = /--device\s+(\S+)/.exec(message);
  const install = m
    ? `\`${cmd} ${m[1]}\``
    : `\`${cmd}\` followed by the simulator's id from \`mauto devices\``;
  return (
    'The simulator is missing the device agent the engine needs. The engine normally installs it ' +
    `automatically, but that install failed. Install it once by hand with ${install} ` +
    '(needs network, takes a few seconds), then retry.'
  );
}

// B2: mobile-mcp 1.0.5's default robot lists Android emulators by AVD name,
// the legacy robot (and 0.0.55) by adb serial, and each rejects the other's id
// — so a selection made under the other engine fails every verb. Since #251
// the workspace `engine` key selects the robot; the env var still overrides it.
function deviceNotFoundHint(id) {
  return (
    `Device "${id}" is not known to the current engine. Device ids differ between engines: ` +
    'the default mobilecli engine lists Android emulators by AVD name (e.g. Pixel_9_Pro), while the ' +
    'legacy engine uses the adb serial (e.g. emulator-5554). Check which engine this workspace uses with ' +
    '`mauto config get engine` and change it with `mauto config set engine <mobilecli|legacy>`; an exported ' +
    'MOBILEMCP_LEGACY_ROBOT overrides that key. Then run `mauto devices` and `mauto devices use` with an id ' +
    'from that list (or pass that id to --device).'
  );
}

// B3 (#214): mobile-mcp's validateOutputPath only allows screenshots under the
// engine's cwd or the temp dir, and its message calls the former "the current
// directory". The engine runs from the project root (the daemon is spawned
// there), which is not necessarily the directory the user ran the verb from.
const OUTSIDE_ALLOWED_DIRS_HINT =
  'Screenshots must be saved under the project root (the directory containing mobile-automator/) ' +
  'or the system temp directory. Choose a path inside one of them and retry.';

function engineHint(message, { mobilecliVersion = resolveMobilecliVersion } = {}) {
  try {
    if (typeof message !== 'string' || !message) return null;
    if (/Agent is not installed on the device/.test(message)) {
      return missingAgentHint(message, mobilecliVersion);
    }
    const notFound = /Device "([^"]+)" not found/.exec(message);
    if (notFound) return deviceNotFoundHint(notFound[1]);
    if (/not in the list of allowed directories/.test(message)) return OUTSIDE_ALLOWED_DIRS_HINT;
    return null;
  } catch {
    return null;
  }
}

module.exports = { engineHint };
