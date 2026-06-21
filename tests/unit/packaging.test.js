'use strict';

const { execFileSync } = require('child_process');
const path = require('path');

// Guards against the recorder sidecar silently dropping out of the published
// npm package via the package.json `files` allowlist. The recorder graduated
// in v0.17.0; before that `files` was ["bin/","src/"], which excluded
// tools/recorder/ — so `mauto record` worked only in linked local checkouts.
describe('npm package contents (files allowlist)', () => {
  const repoRoot = path.resolve(__dirname, '..', '..');
  let files;

  beforeAll(() => {
    const out = execFileSync('npm', ['pack', '--dry-run', '--json'], {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    files = JSON.parse(out)[0].files.map((f) => f.path);
  });

  test.each([
    'tools/recorder/src/lifecycle/live.js',
    'tools/recorder/src/server/http-server.js',
    'tools/recorder/web/index.html',
    'tools/recorder/web/app.js',
  ])('ships the recorder sidecar file %s', (p) => {
    expect(files).toContain(p);
  });
});
