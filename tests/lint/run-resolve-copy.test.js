'use strict';

// Temporary guard (replay PRD #271, slice R1 #278). `mauto run` needs the E2E
// harness's target resolver, and the harness must keep resolving with the
// install under test until replay R7 retires it. Until then the resolver
// lives twice — src/run/resolve.js (shipped) and
// sample-app/scripts/lib/resolve.js (harness) — and this guard holds them
// byte-identical so the two can never resolve a target differently. R7
// deletes the harness copy and this file with it.

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const SHIPPED = path.join(REPO, 'src', 'run', 'resolve.js');
const HARNESS = path.join(REPO, 'sample-app', 'scripts', 'lib', 'resolve.js');

describe('the run resolver copy', () => {
  test('src/run/resolve.js is byte-identical to sample-app/scripts/lib/resolve.js', () => {
    const shipped = fs.readFileSync(SHIPPED);
    const harness = fs.readFileSync(HARNESS);
    expect(shipped.equals(harness)).toBe(true);
  });
});
