'use strict';

// Element inputs for the E2E harness tests, taken from the real-device probe
// (tests/fixtures/device/sample-app-probe/) and run through the CLI's own
// normalizer, so the harness is tested against the shape `mauto elements`
// actually emits rather than a hand-written approximation of it.

const fs = require('fs');
const path = require('path');

const { normalize } = require('../../../src/device/element-model');

const PROBE_DIR = path.join(__dirname, '..', '..', 'fixtures', 'device', 'sample-app-probe');

function readJson(name) {
  return JSON.parse(fs.readFileSync(path.join(PROBE_DIR, name), 'utf8'));
}

const homeElements = () => normalize(readJson('home.mobilecli.raw.json'));
const moreElements = () => normalize(readJson('more.mobilecli.raw.json'));
// The legacy capture is an already-normalized `mauto elements` envelope, taken
// before normalize() learned to decode `&#10;` and collapse bare same-bounds
// twins (#251). Re-running it through normalize (which accepts the normalized
// shape) yields what the CLI emits today, keeping it comparable to the others.
const moreLegacyElements = () => normalize(readJson('more.legacy-robot.envelope.json').data);

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

module.exports = { homeElements, moreElements, moreLegacyElements, el };
