'use strict';

// Structural guard: exactly ONE file in the shipped tree may talk to the
// network, and this test names it.
//
// The privacy contract is "telemetryPayload() is the only thing that builds a
// network payload". That is only true if there is only one network path. A
// second `fetch(` anywhere in src/ or bin/ — an update check, a crash reporter,
// a docs ping — would bypass the catalog entirely and no redaction test would
// notice, because none of them inspect the wire.
//
// Unix-domain sockets are deliberately NOT matched: src/device/session-client.js
// and src/device/session-daemon.js use net.connect / net.createServer against a
// filesystem path, which never leaves the machine.

const fs = require('fs');
const path = require('path');

const REPO = path.join(__dirname, '..', '..');
const ALLOWED = path.join('src', 'observe', 'transport.js');

const OUTBOUND = [
  /\bfetch\s*\(/,
  /require\(\s*['"]https?['"]\s*\)/,
  /\bXMLHttpRequest\b/,
];

function jsFilesUnder(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...jsFilesUnder(full));
    else if (entry.name.endsWith('.js')) out.push(full);
  }
  return out;
}

describe('telemetry transport isolation', () => {
  const files = [...jsFilesUnder(path.join(REPO, 'src')), ...jsFilesUnder(path.join(REPO, 'bin'))];

  it('finds an outbound HTTP call in exactly one file', () => {
    const offenders = files
      .filter((f) => {
        const text = fs.readFileSync(f, 'utf8');
        return OUTBOUND.some((re) => re.test(text));
      })
      .map((f) => path.relative(REPO, f))
      .filter((rel) => rel !== ALLOWED);
    expect(offenders).toEqual([]);
  });

  it('scanned a non-trivial number of files, so a broken walk cannot pass vacuously', () => {
    expect(files.length).toBeGreaterThan(30);
  });
});
