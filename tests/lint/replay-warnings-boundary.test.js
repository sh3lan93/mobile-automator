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

// Guides (#255): reasoning is pulled, so the guides are where an agent learns
// what a finding means. Execute must replay literally -- an agent that
// substitutes its own reading of "intent" makes replay nondeterministic.
const CONTENT = path.join(SRC, 'guide', 'content');
const read = (name) => fs.readFileSync(path.join(CONTENT, name), 'utf8');
const lineNaming = (text, code) => text.split('\n').filter((l) => l.includes(code));

describe('replay warnings in guides', () => {
  const executeGuides = ['execute.aware.md', 'execute.agnostic.md'];
  const allGuides = [...executeGuides, 'generate.aware.md', 'generate.agnostic.md'];

  test.each(executeGuides)('%s replays an implicit-launch warning literally', (file) => {
    const lines = lineNaming(read(file), 'launch_cold_implicit');
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toContain('state_context');
      expect(line).not.toContain('--resume');
      expect(line.toLowerCase()).not.toMatch(/\bintent\b/);
    }
  });

  test.each(allGuides.flatMap((f) => Object.keys(CODES).map((c) => [f, c])))(
    '%s names the code %s',
    (file, code) => {
      expect(read(file)).toContain(code);
    }
  );
});
