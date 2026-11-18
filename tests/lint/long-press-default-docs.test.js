'use strict';

// The long-press default duration has one source of truth:
// DEFAULT_LONG_PRESS_MS in src/device/bridge.js (#324). `mauto long-press
// --help` derives its text from it; the reference docs state it in prose. This
// guard fails when a shipping doc claims a different long-press default, so a
// change to the constant cannot leave the docs teaching the old value.
//
// It is loud in both directions: it also fails when no doc states the default
// at all, so a rewording that slips past CLAIM cannot turn it into a guard that
// silently checks nothing.

const fs = require('fs');
const path = require('path');
const { REPO_ROOT, shippingDocs } = require('./docs-corpus');
const { DEFAULT_LONG_PRESS_MS } = require('../../src/device/bridge');

const LONG_PRESS = /long[-_ ]press/i;
// "defaults to 1000 ms", "default 1000", "presses for 1000 ms"
const CLAIM = /\b(?:defaults?(?:\s+to)?|presses\s+for)\s+(\d+)\s*(?:ms\b)?/gi;

function longPressDefaultClaims() {
  const claims = [];
  for (const rel of shippingDocs()) {
    const lines = fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!LONG_PRESS.test(line)) return;
      for (const m of line.matchAll(CLAIM)) {
        claims.push({ where: `${rel}:${i + 1}`, value: Number(m[1]) });
      }
    });
  }
  return claims;
}

describe('long-press default duration in docs (#324)', () => {
  const claims = longPressDefaultClaims();

  test('at least one shipping doc states the default (the guard is not vacuous)', () => {
    expect(claims.length).toBeGreaterThan(0);
  });

  test('every stated long-press default equals DEFAULT_LONG_PRESS_MS', () => {
    const wrong = claims.filter((c) => c.value !== DEFAULT_LONG_PRESS_MS);
    expect(wrong).toEqual([]);
  });
});
