'use strict';

// Structural guard: the privacy page and the field catalog cannot disagree.
//
// A privacy disclosure is the one document where "slightly out of date" is not
// a documentation bug, it is a false statement about what leaves a user's
// machine. So the page is checked against EVENT_FIELDS in both directions: a
// field that gains a network path and is not documented fails here, and a
// field the page claims is sent while the catalog says otherwise fails too.

const fs = require('fs');
const path = require('path');

const { sentFields, neverSentFields } = require('../../src/observe/telemetry');

const DOC = fs.readFileSync(
  path.join(__dirname, '..', '..', 'docs', 'reference', 'telemetry.md'),
  'utf8'
);

// Field names appear in the page as leading table cells: `| `field` | ... |`
function documented(section) {
  const start = DOC.indexOf(section);
  expect(start).toBeGreaterThan(-1);
  const rest = DOC.slice(start);
  const end = rest.indexOf('\n## ', 1);
  const body = end === -1 ? rest : rest.slice(0, end);
  return new Set([...body.matchAll(/^\|\s*`([a-z_]+)`\s*\|/gm)].map((m) => m[1]));
}

describe('telemetry documentation', () => {
  it('documents every field that can leave the machine', () => {
    const doc = documented('## What is sent');
    expect(sentFields().filter((f) => !doc.has(f))).toEqual([]);
  });

  it('claims no field the catalog does not actually send', () => {
    const doc = documented('## What is sent');
    expect([...doc].filter((f) => !sentFields().includes(f))).toEqual([]);
  });

  it('documents every field that is permanently withheld', () => {
    const doc = documented('## What is never sent');
    expect(neverSentFields().filter((f) => !doc.has(f))).toEqual([]);
  });

  it('states the controls a user needs to find', () => {
    for (const token of [
      'mauto telemetry enable',
      'mauto telemetry disable',
      'mauto telemetry status',
      'MAUTO_TELEMETRY=0',
      'DO_NOT_TRACK',
      'eu.i.posthog.com',
    ]) {
      expect(DOC).toContain(token);
    }
  });

  it('is reachable from the docs site', () => {
    const nav = fs.readFileSync(path.join(__dirname, '..', '..', 'mkdocs.yml'), 'utf8');
    expect(nav).toContain('reference/telemetry.md');
  });
});
