'use strict';

// Live tap source for the Mode-B pipeline (slice 8, BEST-EFFORT).
//
// Mode-B's coalescing pipeline consumes a `tapSource` that fires `tap` events
// shaped `{ t, kind:'down'|'up'|'move', x, y }` (see lifecycle/mode-b.js). Until
// now that source was a TODO and only tests injected it. This module provides
// the real source: it drives mobile-mcp screen recording, extracts frames, runs
// them through `video-tap-detector` (which emits exactly that event shape from
// the OS touch indicator), and forwards each detected event to `tap` listeners.
//
// ─────────────────────────────────────────────────────────────────────────────
// ⚠️  ON-DEVICE VALIDATION REQUIRED. This is the known PRD build risk (#69/#77).
// The frame→tap DETECTION path is unit-verifiable with synthetic frames (see
// tap-source.smoke.test.js) and is exercised here. But the END-TO-END live path
// — mobile-mcp `mobile_start_screen_recording` / `mobile_stop_screen_recording`
// semantics, the produced video container/codec, ffmpeg frame extraction timing,
// and the "Show taps" / iOS touch-indicator being enabled on the target — CANNOT
// be verified in CI and needs validation on a real device/emulator before this
// path can be trusted. The detector colour calibration also assumes the OS touch
// indicator overlay is on.
// ─────────────────────────────────────────────────────────────────────────────

const path = require('path');
const os = require('os');
const fs = require('fs');
const { EventEmitter } = require('events');

const { VideoTapDetector } = require('./video-tap-detector');

/**
 * @param {object} opts
 * @param {object} opts.bridge  McpBridge-like with startScreenRecording()/stopScreenRecording()
 * @param {string} [opts.color] detector colour profile ('light_blue' | 'ios_simulator')
 * @param {number} [opts.fps]   frame-extraction rate
 * @param {string} [opts.workDir] scratch dir for extracted frames
 * @returns {EventEmitter & {start, stop, _processFrames}}
 */
function createTapSource({ bridge, color = 'light_blue', fps = 30, workDir } = {}) {
  const emitter = new EventEmitter();
  const detector = new VideoTapDetector({
    color,
    fps,
    // The detector calls this for every down/move/up it finds; re-emit as `tap`.
    emit: (ev) => emitter.emit('tap', ev),
  });

  let recording = false;

  // Pure detection seam — feed already-extracted frames straight through the
  // detector. Used by the smoke test (synthetic frames, no device, no ffmpeg).
  emitter._processFrames = (frames) => detector.processFrames(frames);

  // Live path (NOT CI-verifiable — see the on-device caveat above).
  emitter.start = async () => {
    if (recording) return;
    if (!bridge || typeof bridge.startScreenRecording !== 'function') {
      throw new Error('tap-source requires a bridge with startScreenRecording()');
    }
    recording = true;
    await bridge.startScreenRecording();
  };

  emitter.stop = async () => {
    if (!recording) return;
    recording = false;
    const videoPath = await bridge.stopScreenRecording();
    if (!videoPath) return;
    // Extract frames to a scratch dir and run them through the detector. ffmpeg
    // availability + the recording's container/codec are device-dependent.
    const outDir = workDir || fs.mkdtempSync(path.join(os.tmpdir(), 'tap-frames-'));
    const frames = await detector.extractFrames(videoPath, outDir);
    detector.processFrames(frames);
  };

  return emitter;
}

module.exports = { createTapSource };
