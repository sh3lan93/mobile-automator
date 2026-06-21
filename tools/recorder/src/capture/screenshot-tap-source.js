'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { EventEmitter } = require('events');
const { VideoTapDetector } = require('./video-tap-detector');

// Default frame capture: `xcrun simctl io <udid> screenshot <file>` then read
// the PNG bytes. Injectable so tests never shell out.
function defaultCaptureFrame({ deviceLabel }) {
  return () => new Promise((resolve) => {
    const file = path.join(os.tmpdir(), `recorder-shot-${process.pid}.png`);
    execFile('xcrun', ['simctl', 'io', deviceLabel, 'screenshot', file], (err) => {
      if (err) { resolve(null); return; }
      fs.readFile(file, (rErr, buf) => resolve(rErr ? null : { buf }));
    });
  });
}

function createScreenshotTapSource({
  deviceLabel,
  intervalMs = 125,                 // ~8 fps
  color = 'ios_simulator',
  captureFrame,
  makeDetector,
  setInterval: setIntervalFn = setInterval,
  clearInterval: clearIntervalFn = clearInterval,
} = {}) {
  const emitter = new EventEmitter();
  const detector = (makeDetector || (() => new VideoTapDetector({ emit: (e) => emitter.emit('tap', e), color })))();
  const capture = captureFrame || defaultCaptureFrame({ deviceLabel });
  let timer = null;
  let busy = false;
  const tStart = 0;
  let t = 0;

  emitter.start = async () => {
    if (timer) return;
    timer = setIntervalFn(async () => {
      if (busy) return;               // skip if a capture is still in flight
      busy = true;
      try {
        const frame = await capture();
        if (frame && frame.buf) { t += intervalMs; detector.feed({ t: t + tStart, buf: frame.buf }); }
      } catch (_e) { /* best-effort: drop this frame */ }
      busy = false;
    }, intervalMs);
  };

  emitter.stop = async () => {
    if (timer) { clearIntervalFn(timer); timer = null; }
    try { detector.flush(); } catch (_e) {}
  };

  return emitter;
}

module.exports = { createScreenshotTapSource };
