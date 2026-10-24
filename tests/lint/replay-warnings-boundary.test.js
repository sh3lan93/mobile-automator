'use strict';

// Boundary guard (#255): the replayability module owns finding codes, severity
// and wording; the action catalog owns which action/field a code is about. So
// cli.js must know no warning code, and replayability.js must name neither the
// launch action nor its field -- both arrive via the catalog marker.

const fs = require('fs');
const path = require('path');
const { CODES } = require('../../src/scenario/replayability');

const SRC = path.join(__dirname, '..', '..', 'src');
const cliSrc = fs.readFileSync(path.join(SRC, 'cli.js'), 'utf8');
const replaySrc = fs.readFileSync(path.join(SRC, 'scenario', 'replayability.js'), 'utf8');

describe('replay warnings boundary', () => {
  test.each(Object.keys(CODES))('cli.js does not name the code %s', (code) => {
    expect(cliSrc).not.toContain(code);
  });

  test('replayability.js names neither launch_app nor the cold field', () => {
    expect(replaySrc).not.toContain('launch_app');
    expect(replaySrc).not.toContain("'cold'");
    expect(replaySrc).not.toContain('"cold"');
  });
});
