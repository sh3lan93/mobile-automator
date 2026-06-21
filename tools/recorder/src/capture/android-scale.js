'use strict';

const { execFile } = require('child_process');

// Computes raw-getevent -> screen-pixel scale factors. Reads the ABS axis
// maxima from `adb shell getevent -lp` and the screen size from
// `adb shell wm size`. If either is unavailable, returns 1:1 (correct on most
// emulators). `runAdb` is injectable for tests.
function defaultRunAdb({ deviceLabel }) {
  const base = deviceLabel ? ['-s', deviceLabel, 'shell'] : ['shell'];
  return (subArgs) => new Promise((resolve) => {
    execFile('adb', base.concat(subArgs), { maxBuffer: 4 * 1024 * 1024 }, (err, stdout) => {
      resolve(err ? '' : String(stdout));
    });
  });
}

async function computeAndroidScale({ deviceLabel, runAdb } = {}) {
  const run = runAdb || defaultRunAdb({ deviceLabel });
  const wm = await run(['wm', 'size']);             // "Physical size: 1280x2856"
  const lp = await run(['getevent', '-lp']);        // includes "ABS_MT_POSITION_X ... max 1279 ..."
  // Prefer the "Physical size:" line; fall back to first WxH match (e.g. "Override size:").
  const physicalMatch = wm.match(/Physical size:\s*(\d+)\s*x\s*(\d+)/);
  const wmMatch = physicalMatch || wm.match(/(\d+)\s*x\s*(\d+)/);
  const screenW = wmMatch ? parseInt(wmMatch[1], 10) : null;
  const screenH = wmMatch ? parseInt(wmMatch[2], 10) : null;
  const xMax = matchAbsMax(lp, 'ABS_MT_POSITION_X');
  const yMax = matchAbsMax(lp, 'ABS_MT_POSITION_Y');
  const scaleX = (screenW && xMax) ? screenW / (xMax + 1) : 1;
  const scaleY = (screenH && yMax) ? screenH / (yMax + 1) : 1;
  return { scaleX, scaleY };
}

function matchAbsMax(lp, code) {
  // Match a getevent -lp block line like: "ABS_MT_POSITION_X   : value 0, min 0, max 1279, ..."
  const re = new RegExp(code + '[^\\n]*?max\\s+(\\d+)');
  const m = lp && lp.match(re);
  return m ? parseInt(m[1], 10) : null;
}

module.exports = { computeAndroidScale, matchAbsMax };
