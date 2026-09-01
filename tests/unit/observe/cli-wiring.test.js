'use strict';

// Structural drift guard. Both process-ending paths must stay instrumented:
// defaultEmit covers the envelope verbs, emitRaw covers guide/schema/bootstrap.
// Deleting either hook silently blinds a whole class of invocation, which no
// behavioural test would notice because the verb still works.

const fs = require('fs');
const path = require('path');

const SRC = fs.readFileSync(
  path.join(__dirname, '..', '..', '..', 'src', 'cli.js'),
  'utf8'
);

function bodyBetween(startMarker, endMarker) {
  const a = SRC.indexOf(startMarker);
  const b = SRC.indexOf(endMarker);
  expect(a).toBeGreaterThan(-1);
  expect(b).toBeGreaterThan(a);
  return SRC.slice(a, b);
}

describe('cli wiring', () => {
  it('requires the recorder', () => {
    expect(SRC).toContain("require('./observe/recorder')");
  });

  it('instruments defaultEmit — the envelope exit path', () => {
    expect(bodyBetween('function defaultEmit', 'function emitRaw')).toContain('record(');
  });

  it('instruments emitRaw — the guide/schema/bootstrap exit path', () => {
    expect(bodyBetween('function emitRaw', 'function diagnose')).toContain('record(');
  });

  it('measures duration from a module-level start stamp, not a per-call clock', () => {
    expect(SRC).toMatch(/const PROCESS_START_MS = Date\.now\(\);/);
  });

  it('records before writing stdout, since process.exit is immediate', () => {
    const body = bodyBetween('function defaultEmit', 'function emitRaw');
    expect(body.indexOf('record(')).toBeLessThan(body.indexOf('process.stdout.write'));
  });
});
