'use strict';

// mobile-mcp 0.0.55 requires `device` on every tool EXCEPT the discovery verb.
// Centralizing the injection (and its one exception) here keeps every call
// site correct. Pure + non-mutating so it is trivially testable.
const NO_DEVICE_TOOLS = new Set(['mobile_list_available_devices']);

function injectDeviceArg(toolName, args = {}, deviceId = null) {
  if (NO_DEVICE_TOOLS.has(toolName)) return args;
  if (!deviceId) return args;
  return { ...args, device: deviceId };
}

module.exports = { injectDeviceArg, NO_DEVICE_TOOLS };
