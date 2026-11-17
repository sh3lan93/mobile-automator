'use strict';

// `mauto run`'s frozen contract — the keys of `data` and the outcome exit
// codes — is what a CI job branches on, and docs/reference/cli-verbs.md is
// where a user reads it. Both are derived here from the code that owns them
// (RUN_DATA_KEYS in src/run/summary.js, EXIT in src/output/envelope.js), so a
// new key or a renumbered exit fails the reference instead of leaving it
// stale. The execute guides are pinned the same way in
// tests/unit/guide/execute-content.test.js.

const fs = require('fs');
const path = require('path');

const { REPO_ROOT, shippingDocs } = require('./docs-corpus');
const { EXIT } = require('../../src/output/envelope');
const { RUN_DATA_KEYS } = require('../../src/run/summary');

const DOC = 'docs/reference/cli-verbs.md';

describe('cli-verbs.md states the `mauto run` contract the code has', () => {
  const row = fs
    .readFileSync(path.join(REPO_ROOT, DOC), 'utf8')
    .split('\n')
    .find((l) => l.startsWith('| `mauto run <scenario>'));

  test('is part of the shipping doc corpus and has a `mauto run` row', () => {
    expect(shippingDocs()).toContain(DOC);
    expect(row).toBeDefined();
  });

  test('the row lists exactly the keys of `data`, in order', () => {
    expect(row).toContain(`Returns \`{${RUN_DATA_KEYS.join(', ')}}\``);
  });

  test('the row gives the three outcome exit codes', () => {
    expect(row).toContain(
      `Exits \`${EXIT.OK}\` passed, \`${EXIT.TEST_FAILED}\` \`test_failed\`, \`${EXIT.INCOMPLETE}\` \`incomplete\``
    );
  });
});
