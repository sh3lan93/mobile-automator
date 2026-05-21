'use strict';

const path = require('path');
const { DeviceWatchdog } = require('./device-watchdog');
const { CrashWatchdog } = require('./crash-watchdog');
const { BrowserWatchdog } = require('./browser-watchdog');

/**
 * Failure-modes orchestrator.
 *
 * Owns three watchdogs (device / crash / browser) and the side effects that
 * fire when any of them trip: WS broadcasts, artifact cleanup, poller suspend
 * and resume, the crash-relaunch handshake, and the final exit-code signal
 * via `onDone`.
 *
 * The watchdogs themselves are pure state machines — they never touch the
 * store, never broadcast, and never call `process.exit`. All policy lives
 * here so the wiring is auditable in one place.
 *
 * Crash-choice handshake
 * ----------------------
 * When the crash watchdog detects a crash, the orchestrator broadcasts
 * `app-crashed` and then waits for a single `{type:'crash-choice', choice}`
 * WS message. A per-detection generation counter (`_crashGen`) guards against
 * stray duplicate choice messages: each new crash detection bumps the counter,
 * and the active choice handler captures the counter at install time, so a
 * second `crash-choice` message after the first is honoured will be ignored
 * (it belongs to an already-resolved generation).
 *
 * Save-handoff
 * ------------
 * The `save` branch is terminal but does NOT call `onDone` — the existing
 * save flow (slice #9) is expected to run the recording's normal close-out
 * elsewhere. The orchestrator just broadcasts `save-partial-ready` and stops
 * driving the poll loop; subsequent watchdog trips can still cleanup safely.
 */
function attachFailureModes({
  store,
  wsCtx,
  mcpBridge,
  hierarchyPoller,
  projectRoot,
  scenarioId, // eslint-disable-line no-unused-vars
  deviceLabel,
  appPackage,
  onDone,
  logger = console,
  now = () => new Date(),
  deviceWatchdogOpts = {},
  crashWatchdogOpts = {},
  browserWatchdogOpts = {},
} = {}) {
  // Generation counter — bumped on each crash detection; the choice handler
  // closes over its generation at install time so stale duplicates are dropped.
  let crashGen = 0;
  let activeCrashGen = null;
  // Track the most recent crash's persistent-log path so the relaunch branch
  // can reference its basename without walking broadcast history.
  let lastPersistentLogPath = null;
  // Terminal-state flag — once any branch has signalled `onDone` (or stopAll
  // has fired), suppress further terminal side effects. Guards against the
  // BrowserWatchdog re-arming after stop() (its disconnect handler stays on
  // the wsCtx handler list even after stop() nulls its local refs).
  let terminalSignalled = false;
  function fireOnce(code) {
    if (terminalSignalled) return;
    terminalSignalled = true;
    try { onDone(code); } catch (_e) { /* swallow */ }
  }

  // ---- Device watchdog -----------------------------------------------------

  const deviceWatchdog = new DeviceWatchdog({
    deviceLabel,
    ...deviceWatchdogOpts,
    onTrip: ({ deviceLabel: lbl, reason }) => {
      wsCtx.broadcast({
        type: 'device-disconnected',
        device_label: lbl,
        reason,
      });

      // Tear down the other watchdogs — recording is over.
      try { crashWatchdog.stop(); } catch (_e) { /* swallow */ }
      try { browserWatchdog.stop(); } catch (_e) { /* swallow */ }

      // Suspend the poller.
      if (hierarchyPoller && typeof hierarchyPoller.stop === 'function') {
        try { hierarchyPoller.stop(); } catch (_e) { /* swallow */ }
      }

      // Drop the in-bundle artifacts (persistent crash logs survive — they
      // live outside the bundle root).
      try { store.cleanupOnCancel(); } catch (_e) { /* swallow */ }

      if (logger && typeof logger.error === 'function') {
        logger.error(
          `device '${lbl}' disconnected — rerun /mobile-automator:record`
        );
      }

      fireOnce(2);
    },
  });

  // ---- Crash watchdog ------------------------------------------------------

  const crashWatchdog = new CrashWatchdog({
    bridge: mcpBridge,
    ...crashWatchdogOpts,
    onCrash: ({ crash }) => {
      // Bump the generation BEFORE wiring the handler so the handler's
      // captured `gen` matches this detection exactly.
      crashGen += 1;
      const gen = crashGen;
      activeCrashGen = gen;

      // Sanitize timestamp: colons and dots are filesystem-hostile on some
      // platforms. Spec: 2026-05-20T18:23:09.123Z → 2026-05-20T18-23-09-123Z.
      const timestampISO = now().toISOString().replace(/[:.]/g, '-');

      // Suspend the poller during the human prompt.
      if (hierarchyPoller && typeof hierarchyPoller.stop === 'function') {
        try { hierarchyPoller.stop(); } catch (_e) { /* swallow */ }
      }

      let inBundlePath;
      let persistentPath;
      try {
        const written = store.writeCrashLog({
          timestampISO,
          body: crash.log,
          persistentRoot: path.join(projectRoot, 'mobile-automator', 'crash-logs'),
        });
        inBundlePath = written.inBundlePath;
        persistentPath = written.persistentPath;
        lastPersistentLogPath = persistentPath;
      } catch (e) {
        if (logger && typeof logger.error === 'function') {
          logger.error(`failed to write crash log: ${e && e.message ? e.message : e}`);
        }
        return;
      }

      wsCtx.broadcast({
        type: 'app-crashed',
        log_path: persistentPath,
        in_bundle_log_path: inBundlePath,
      });
    },
  });

  // ---- Browser watchdog ----------------------------------------------------

  const browserWatchdog = new BrowserWatchdog({
    wsCtx,
    ...browserWatchdogOpts,
    onTimeout: () => {
      // Browser is gone — recording is unrecoverable. Skip the device watchdog
      // (it's event-driven, no timer to clear) and bring everything else down.
      try { crashWatchdog.stop(); } catch (_e) { /* swallow */ }

      if (hierarchyPoller && typeof hierarchyPoller.stop === 'function') {
        try { hierarchyPoller.stop(); } catch (_e) { /* swallow */ }
      }

      try { store.cleanupOnCancel(); } catch (_e) { /* swallow */ }

      fireOnce(130);
    },
  });

  // ---- WS message dispatcher (one-shot per crash detection) ----------------

  wsCtx.onMessage((msg) => {
    if (!msg || msg.type !== 'crash-choice') return;
    // Ignore choices that don't belong to the currently-active detection.
    if (activeCrashGen === null) return;
    const myGen = activeCrashGen;
    // Mark the current generation as handled so subsequent duplicates fall
    // through to the early-return above.
    activeCrashGen = null;

    handleCrashChoice(msg.choice, myGen).catch((e) => {
      if (logger && typeof logger.error === 'function') {
        logger.error(`crash-choice handler failed: ${e && e.message ? e.message : e}`);
      }
    });
  });

  async function handleCrashChoice(choice, _gen) {
    if (choice === 'relaunch') {
      try {
        await mcpBridge.launchApp(appPackage);
      } catch (e) {
        wsCtx.broadcast({
          type: 'app-relaunch-failed',
          error: e && e.message ? e.message : String(e),
        });
        // Fall through to discard semantics: drop artifacts and signal exit.
        try { store.cleanupOnCancel(); } catch (_e) { /* swallow */ }
        fireOnce(130);
        return;
      }

      // Successful relaunch: append a launch_app event so the scenario notes
      // the recovery point. The persistent crash log is referenced by basename
      // so reviewers can find it under mobile-automator/crash-logs/.
      const logBasename = lastPersistentLogPath
        ? path.basename(lastPersistentLogPath)
        : 'unknown.log';
      try {
        store.appendEvent({
          kind: 'launch_app',
          t: Date.now(),
          app_package: appPackage,
          expected_state: `app relaunched after crash; see crash-logs/${logBasename}`,
        });
      } catch (_e) { /* swallow */ }

      // Resume capture.
      if (hierarchyPoller && typeof hierarchyPoller.start === 'function') {
        try { hierarchyPoller.start(); } catch (_e) { /* swallow */ }
      }
      try { crashWatchdog.resume(); } catch (_e) { /* swallow */ }

      wsCtx.broadcast({ type: 'app-relaunched' });
      return;
    }

    if (choice === 'save') {
      wsCtx.broadcast({ type: 'save-partial-ready' });
      // Terminal — but DO NOT call onDone. The save flow elsewhere is
      // responsible for finishing the recording. Leave the poller stopped
      // (the save flow is terminal too).
      return;
    }

    if (choice === 'discard') {
      try { store.cleanupOnCancel(); } catch (_e) { /* swallow */ }
      fireOnce(130);
      return;
    }

    // Unknown choice — log and ignore (operator can re-issue).
    if (logger && typeof logger.warn === 'function') {
      logger.warn(`unknown crash-choice '${choice}' — ignoring`);
    }
  }

  // ---- Lifecycle -----------------------------------------------------------

  // Start the time-driven watchdogs immediately. The device watchdog is
  // event-driven, so it has no "start".
  crashWatchdog.start();
  browserWatchdog.start();

  function stopAll() {
    // Suppress any further terminal side effects. The browser watchdog leaves
    // its disconnect handler attached to the wsCtx after stop() (the
    // BrowserWatchdog only nulls its own refs); without this flag a later
    // disconnect+timeout could still call onDone.
    terminalSignalled = true;
    try { crashWatchdog.stop(); } catch (_e) { /* swallow */ }
    try { browserWatchdog.stop(); } catch (_e) { /* swallow */ }
  }

  return {
    deviceWatchdog,
    crashWatchdog,
    browserWatchdog,
    stopAll,
  };
}

module.exports = { attachFailureModes };
