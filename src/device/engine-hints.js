'use strict';

const fs = require('fs');
const path = require('path');

// Actionable hints for device-engine failures whose raw message alone does not
// tell the user what to do. Pure: message in, hint string (or null) out. It
// never throws — a hint classifier that crashes would turn a device failure
// into an internal one. Found by the #199 real-device run against mobile-mcp
// 1.0.5 / mobilecli 1.0.13.
//
// mauto only TELLS the user which command to run; it never runs mobilecli
// itself (the device is driven only through mauto verbs, which wrap
// mobile-mcp).

const ISSUE_459 = 'https://github.com/mobile-next/mobile-mcp/issues/459';

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

// B1 (iOS): mobilecli `agent status` exits 1 when the DeviceKit agent is
// missing and mobile-mcp runs it via execFileSync, so the throw skips its own
// auto-install (upstream mobile-mcp#459). Every verb fails until the agent is
// installed once by hand.
function missingAgentHint(message, resolver) {
  const version = safeVersion(resolver);
  const pkg = version ? `mobilecli@${version}` : 'mobilecli';
  const cmd = `npx -y ${pkg} agent install --device`;
  const m = /--device\s+(\S+)/.exec(message);
  const install = m
    ? `\`${cmd} ${m[1]}\``
    : `\`${cmd}\` followed by the simulator's id from \`mauto devices\``;
  return (
    'The simulator is missing the device agent the engine needs, and the engine cannot install it ' +
    `itself (upstream bug ${ISSUE_459}). Install it once with ${install} ` +
    '(needs network, takes a few seconds), then retry.'
  );
}

// B2: mobile-mcp 1.0.5's default robot lists Android emulators by AVD name,
// MOBILEMCP_LEGACY_ROBOT=1 (and 0.0.55) by adb serial, and each rejects the
// other's id — so a selection persisted before the upgrade fails every verb.
function deviceNotFoundHint(id) {
  return (
    `Device "${id}" is not known to the current engine. Device ids can differ between engines: ` +
    "mauto 0.27's default engine lists Android emulators by AVD name (e.g. Pixel_9_Pro), while " +
    'MOBILEMCP_LEGACY_ROBOT=1 uses the adb serial (e.g. emulator-5554). Run `mauto devices`, then ' +
    '`mauto devices use` with an id from that list (or pass that id to --device).'
  );
}

function engineHint(message, { mobilecliVersion = resolveMobilecliVersion } = {}) {
  try {
    if (typeof message !== 'string' || !message) return null;
    if (/Agent is not installed on the device/.test(message)) {
      return missingAgentHint(message, mobilecliVersion);
    }
    const notFound = /Device "([^"]+)" not found/.exec(message);
    if (notFound) return deviceNotFoundHint(notFound[1]);
    return null;
  } catch {
    return null;
  }
}

module.exports = { engineHint };
