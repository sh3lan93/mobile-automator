'use strict';

// Docs guard (#255): the CLI verb reference must document every replay warning
// code the validator can emit (derived from CODES, never restated), and must
// not keep the pre-#255 sentence that described `unsupported_action` as the
// only warning.

const fs = require('fs');
const path = require('path');
const { REPO_ROOT, shippingDocs } = require('./docs-corpus');
const { CODES } = require('../../src/scenario/replayability');

const REL = 'docs/reference/cli-verbs.md';
const doc = fs.readFileSync(path.join(REPO_ROOT, REL), 'utf8');

describe('cli-verbs.md replay warnings', () => {
  test('is part of the shipping doc corpus', () => {
    expect(shippingDocs()).toContain(REL);
  });

  test.each(Object.keys(CODES))('names the warning code %s', (code) => {
    expect(doc).toContain(code);
  });

  test('has no leftover single-code warning sentence', () => {
    expect(doc).not.toContain('Each warning is {code: "unsupported_action"');
    expect(doc).not.toContain('Each warning is `{code: "unsupported_action"');
  });
});
