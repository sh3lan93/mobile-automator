'use strict';

// Typed error so callers (CLI verb handlers) can map it onto the `device`
// envelope with the carried, actionable hint.
class DeviceResolutionError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'DeviceResolutionError';
    this.kind = 'device';
    this.hint = hint;
  }
}

// mobile-mcp 0.0.55 requires a concrete device id on every action/read tool.
// When the caller pinned nothing (no --device, no persisted selection), we
// auto-discover: exactly one active device is used; zero or many is a clear,
// actionable failure rather than a silent empty result.
function resolveSingleDevice(devices) {
  const list = Array.isArray(devices) ? devices : [];
  if (list.length === 1) return list[0].id;
  if (list.length === 0) {
    throw new DeviceResolutionError(
      'No active device or emulator found.',
      'Start an emulator/simulator (or connect a device), or pass --device <id>.'
    );
  }
  const ids = list.map((d) => (d && d.name ? `${d.id} (${d.name})` : d.id)).join(', ');
  throw new DeviceResolutionError(
    `Multiple active devices: ${ids}.`,
    'Pick one with --device <id> or persist it via `mauto devices use <id>`.'
  );
}

module.exports = { resolveSingleDevice, DeviceResolutionError };
