'use strict';

// Classifies the one terminate failure that still leaves the app stopped: the
// app was not running in the first place. DeviceBridge#restartApp (#255) uses
// it to tolerate exactly that case and treat every other terminate failure as
// a real fault. Pure: error in, boolean out. It never throws — a classifier
// that crashed would turn a device failure into an internal one.
//
// Only engines/targets with known evidence get a pattern. An unrecognised
// message is deliberately NOT tolerated: restartApp fails loudly and hints at
// `--resume`, which is honest, rather than claiming a cold start it cannot
// vouch for.
//
// No pattern is needed for Android: `am force-stop` (both engines) succeeds
// for an app that is not running, and even for one that is not installed
// (device-probed on an emulator, mobilecli and legacy engines).
//
// Legacy engine, real iOS (go-ios `ios kill`): message unknown, no pattern, so
// it is fatal until someone captures it.

const NOT_RUNNING_PATTERNS = [
  // iOS simulator, BOTH engines (the legacy engine still drives simulators
  // through mobilecli). simctl terminate exits 3 (ESRCH, "found nothing to
  // terminate"); mobilecli drops simctl's output so only the exit status
  // survives. Device-probed (mobilecli 1.0.13 via mobile-mcp 1.0.5).
  // A NOT-INSTALLED app yields the identical message; tolerating it is safe
  // because the launch that follows fails loudly for an app that is missing.
  /xcrun simctl command: exit status 3\b/,
  // Real iOS, mobilecli engine. Source-verified (mobilecli 1.0.13
  // devices/ios.go TerminateApp returns `process of <bundle> not found`,
  // wrapped by commands/apps.go), not device-probed.
  /: process of \S+ not found\b/,
];

function isAppNotRunning(err) {
  try {
    if (!(err instanceof Error)) return false;
    const message = err.message;
    if (typeof message !== 'string' || !message) return false;
    return NOT_RUNNING_PATTERNS.some((re) => re.test(message));
  } catch {
    return false;
  }
}

module.exports = { isAppNotRunning };
