'use strict';

const { spawn: defaultSpawn } = require('child_process');
const { EventEmitter } = require('events');
const { GeteventTouchParser } = require('./getevent-touch-parser');
const { computeAndroidScale } = require('./android-scale');

// Live Android tap source. Spawns `adb shell getevent -lt`, scales raw coords
// to screen pixels (via computeScale), and re-emits parsed touch + key events
// as `tap` events for the mode-b pipeline. Best-effort: a spawn failure
// disables the source (warns once) rather than crashing the recorder.
function createGeteventTapSource({
  deviceLabel,
  spawn = defaultSpawn,
  computeScale = computeAndroidScale,
  warn = console.warn,
  now = () => Date.now(),
} = {}) {
  const emitter = new EventEmitter();
  let proc = null;
  let parser = null;

  emitter.start = async () => {
    if (proc) return;
    let scale;
    try {
      scale = await computeScale({ deviceLabel });
    } catch (_e) {
      scale = { scaleX: 1, scaleY: 1 };
    }
    parser = new GeteventTouchParser({
      emit: (e) => emitter.emit('tap', { ...e, t: now() }),
      scaleX: scale.scaleX,
      scaleY: scale.scaleY,
      tStart: null,
    });
    const args = deviceLabel
      ? ['-s', deviceLabel, 'shell', 'getevent', '-lt']
      : ['shell', 'getevent', '-lt'];
    try {
      proc = spawn('adb', args, { stdio: ['ignore', 'pipe', 'ignore'] });
    } catch (err) {
      warn(`[recorder] getevent unavailable (${err && err.message}); live taps disabled`);
      return;
    }
    if (proc.stdout) {
      if (proc.stdout.setEncoding) proc.stdout.setEncoding('utf8');
      proc.stdout.on('data', (chunk) => { try { parser.feedChunk(String(chunk)); } catch (_e) {} });
    }
    if (typeof proc.on === 'function') {
      proc.on('error', (err) => warn(`[recorder] getevent error (${err && err.message})`));
    }
  };

  emitter.stop = async () => {
    if (proc) { try { proc.kill(); } catch (_e) {} proc = null; }
    if (parser) { try { parser.end(); } catch (_e) {} parser = null; }
  };

  return emitter;
}

module.exports = { createGeteventTapSource };
