'use strict';

// A scripted stand-in for DeviceBridge (src/device/bridge.js), for driving
// the in-process runner (src/run/) without a device or a session daemon.
//
//   makeFakeBridge({ elements, platform, screenSize, methods })
//
// - `elements`: an array of element lists answered one per listElements()
//   call (the last one repeats), or a function `(n) => list` given the
//   1-based call count. Default: an empty screen.
// - `platform`: what getPlatform() answers ('android' by default), which is
//   what pressSemantic uses to pick a resolver.
// - `methods`: per-method overrides `(args, n) => value`; a throw becomes a
//   rejection, which is how a test scripts a flaky or broken device.
//
// Every call is logged in `calls` as `{ method, args }`. screenshot(dest)
// writes a tiny stub file at `dest`, like the real engine would.
//
// makeFakeClock() is `{ now, sleep }` where sleep advances time instantly.

const fs = require('fs');
const path = require('path');

const { normalize } = require('../../src/device/element-model');

const PROBE_DIR = path.join(__dirname, '..', 'fixtures', 'device', 'sample-app-probe');

function probe(name) {
  return normalize(JSON.parse(fs.readFileSync(path.join(PROBE_DIR, name), 'utf8')));
}

// Real `mauto elements` output for the sample app's Home and More screens.
const homeElements = () => probe('home.mobilecli.raw.json');
const moreElements = () => probe('more.mobilecli.raw.json');

// A minimal hand-made element carrying `text`.
function el(text, extra = {}) {
  return {
    text,
    accessibility_label: null,
    bounds: [0, 0, 10, 10],
    center: [5, 5],
    type: null,
    ...extra,
  };
}

const STUB_PNG = Buffer.from('89504e470d0a1a0a', 'hex');

function makeFakeBridge({ elements = [[]], platform = 'android', screenSize = { width: 1080, height: 2400 }, methods = {} } = {}) {
  const calls = [];
  const counts = {};
  const queue = Array.isArray(elements) ? elements.slice() : null;

  const defaults = {
    listElements: (_args, n) => {
      if (typeof elements === 'function') return elements(n);
      return queue.length > 1 ? queue.shift() : queue[0];
    },
    getPlatform: () => platform,
    getScreenSize: () => screenSize,
    screenshot: ([dest]) => {
      fs.writeFileSync(dest, STUB_PNG);
      return dest;
    },
    tap: () => null,
    type: () => null,
    swipe: () => null,
    pressButton: () => null,
    launchApp: () => null,
    terminateApp: () => null,
    restartApp: () => null,
  };

  const bridge = { calls };
  for (const method of new Set([...Object.keys(defaults), ...Object.keys(methods)])) {
    bridge[method] = (...args) => {
      calls.push({ method, args });
      counts[method] = (counts[method] || 0) + 1;
      const impl = methods[method] || defaults[method];
      try {
        return Promise.resolve(impl(args, counts[method]));
      } catch (err) {
        return Promise.reject(err);
      }
    };
  }
  // The method names called, in order; `of(m)` is the calls to one method.
  bridge.methods = () => calls.map((c) => c.method);
  bridge.of = (method) => calls.filter((c) => c.method === method);
  return bridge;
}

function makeFakeClock(start = 0) {
  let t = start;
  return {
    now: () => t,
    sleep: (ms) => {
      t += ms;
      return Promise.resolve();
    },
  };
}

module.exports = { makeFakeBridge, makeFakeClock, homeElements, moreElements, el };
