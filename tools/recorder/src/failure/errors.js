'use strict';

/**
 * DeviceDisconnectedError
 *
 * Raised (or surfaced via watchdog `onTrip`) when the device under test
 * stops responding to capture requests. Carries a `deviceLabel` so the
 * orchestrator can include it in the WS broadcast and operator log line.
 */
class DeviceDisconnectedError extends Error {
  constructor(message, { deviceLabel } = {}) {
    super(message);
    this.name = 'DeviceDisconnectedError';
    this.deviceLabel = deviceLabel;
  }
}

module.exports = { DeviceDisconnectedError };
