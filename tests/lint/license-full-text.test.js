'use strict';

// LICENSE must be the complete, verbatim Apache-2.0 text (#160). For months it
// was a 644-byte stub carrying only the short "Licensed under..." notice, and
// the npm tarball shipped that stub. Apache-2.0 §4(a) requires that recipients
// of a redistribution get "a copy of this License" — a pointer to apache.org
// is not a copy — and license scanners (licensee, FOSSA, Snyk) identify the
// license by matching the full text, so a stub reads as "unknown license".
// Nothing else notices a truncation: the file is not code, no test reads it,
// and any "tidy the repo" pass can shorten it again without a reviewer
// spotting the loss. So the file is pinned to the canonical text.
//
// The one line a project legitimately edits is the appendix copyright line,
// `Copyright [yyyy] [name of copyright owner]`. The guard restores that line
// to its template and compares the SHA-256 against the canonical file, so
// every other byte must match apache.org exactly.

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { REPO_ROOT } = require('./docs-corpus');
const pkg = require('../../package.json');

const LICENSE = path.join(REPO_ROOT, 'LICENSE');

// Measured from https://www.apache.org/licenses/LICENSE-2.0.txt on 2026-10-23.
const CANONICAL_SHA256 = 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30';
const CANONICAL_BYTES = 11358;
const TEMPLATE_LINE = '   Copyright [yyyy] [name of copyright owner]';
const FILLED_LINE = /^ {3}Copyright \d{4}(-\d{4})? \S.*$/gm;

const FIX_HINT =
  'Re-fetch the text from https://www.apache.org/licenses/LICENSE-2.0.txt, ' +
  'copy it over LICENSE, and edit only the appendix copyright line. ' +
  'Do not re-pin CANONICAL_SHA256 to match an edited file.';

const text = fs.readFileSync(LICENSE, 'utf8');

describe('LICENSE ships the full Apache-2.0 text (#160)', () => {
  test('is the full text, not the short notice', () => {
    expect(Buffer.byteLength(text, 'utf8')).toBeGreaterThan(10 * 1024);
    for (const marker of [
      'TERMS AND CONDITIONS FOR USE, REPRODUCTION, AND DISTRIBUTION',
      'END OF TERMS AND CONDITIONS',
      'APPENDIX: How to apply the Apache License to your work',
    ]) {
      expect(text).toContain(marker);
    }
  });

  test('the appendix copyright line is filled in exactly once', () => {
    const filled = text.match(FILLED_LINE) || [];
    expect(filled).toHaveLength(1);
    expect(text).not.toContain(TEMPLATE_LINE);
  });

  test('every other byte matches the canonical apache.org text', () => {
    const restored = text.replace(FILLED_LINE, TEMPLATE_LINE);
    const actual = {
      bytes: Buffer.byteLength(restored, 'utf8'),
      sha256: crypto.createHash('sha256').update(restored, 'utf8').digest('hex'),
    };
    if (actual.bytes !== CANONICAL_BYTES || actual.sha256 !== CANONICAL_SHA256) {
      throw new Error(
        `LICENSE (copyright line restored to its template) is ${actual.bytes} bytes ` +
          `with sha256 ${actual.sha256}; the canonical text is ${CANONICAL_BYTES} bytes ` +
          `with sha256 ${CANONICAL_SHA256}. ${FIX_HINT}`,
      );
    }
  });

  test('package.json declares the same license', () => {
    expect(pkg.license).toBe('Apache-2.0');
  });
});
