'use strict';

// src/ and bin/ use no asynchronous fs API (#361).
//
// Why. The session client pins the directory it checked by chdir'ing into it
// for one synchronous window and connecting by relative names
// (src/device/session-dir.js inPinnedDir). The working directory is
// process-wide. An async fs call runs on the libuv thread pool, so one that
// mauto started earlier could still be resolving a RELATIVE path while the
// process sits in the session directory, and would read or write there
// instead of where it meant to. No JS can run inside the window, so the only
// way in is such an in-flight async call. Keeping src/ and bin/ to the *Sync
// fs API makes that impossible by construction. If you need async IO here,
// first make inPinnedDir safe without this rule.
//
// The scan uses tests/lint/network-detector.js's analyze(): comments and
// string contents are blanked in the `code` view, so prose naming an API never
// trips it; specifiers are read from its literal requires and imports.

const fs = require('fs');
const path = require('path');

const { analyze } = require('./network-detector');
const { REPO_ROOT, repoFiles } = require('./docs-corpus');

// fs functions whose non-Sync form takes a callback (and runs on the pool).
const ASYNC_FS_FUNCTIONS = [
  'access', 'appendFile', 'chmod', 'chown', 'close', 'copyFile', 'cp', 'exists', 'fchmod', 'fchown',
  'fdatasync', 'fstat', 'fsync', 'ftruncate', 'futimes', 'lchmod', 'lchown', 'link', 'lstat', 'lutimes',
  'mkdir', 'mkdtemp', 'open', 'openAsBlob', 'opendir', 'read', 'readdir', 'readFile', 'readlink', 'readv',
  'realpath', 'rename', 'rm', 'rmdir', 'stat', 'statfs', 'symlink', 'truncate', 'unlink', 'utimes',
  'write', 'writeFile', 'writev',
];
// Always async, whatever they are called on.
const ALWAYS_ASYNC = ['createReadStream', 'createWriteStream', 'watch', 'watchFile'];

const NAMES = ASYNC_FS_FUNCTIONS.join('|');
// A call on something named like an fs module: fs, nodeFs, realFs, d.fs, ...
const FS_MEMBER_CALL = new RegExp(`(?<![\\w$])([\\w$]*[fF]s)\\s*\\.\\s*(${NAMES})\\s*\\(`, 'g');
const FS_PROMISES = /(?<![\w$])[\w$]*[fF]s\s*\.\s*promises\b/g;
const STREAMS = new RegExp(`(?<![\\w$])(${ALWAYS_ASYNC.join('|')})\\s*\\(`, 'g');
// require('fs').readFile(...): read in the text view, which keeps the specifier.
const REQUIRE_MEMBER = new RegExp(`require\\s*\\(\\s*['"](?:node:)?fs['"]\\s*\\)\\s*\\.\\s*(${NAMES}|promises)(?![\\w$])`, 'g');
// const { readFile } = require('fs'): a destructured async name.
const DESTRUCTURED = new RegExp(
  `\\{[^}]*(?<![\\w$])(${NAMES}|promises|${ALWAYS_ASYNC.join('|')})(?![\\w$])[^}]*\\}\\s*=\\s*require\\s*\\(`,
  'g'
);

function violations(src) {
  const { specifiers, code, text } = analyze(src);
  const out = [];
  for (const s of specifiers) if (/^(node:)?fs\/promises$/.test(s.raw)) out.push(`requires '${s.raw}'`);
  for (const m of code.matchAll(FS_MEMBER_CALL)) out.push(`calls ${m[1]}.${m[2]}()`);
  for (const m of code.matchAll(FS_PROMISES)) out.push(`uses ${m[0].replace(/\s+/g, '')}`);
  for (const m of code.matchAll(STREAMS)) out.push(`calls ${m[1]}()`);
  for (const m of text.matchAll(REQUIRE_MEMBER)) out.push(`uses require('fs').${m[1]}`);
  for (const m of code.matchAll(DESTRUCTURED)) {
    // Only a destructure from fs counts; the specifier is in the text view.
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 20);
    if (/^\s*['"](node:)?fs['"]/.test(after)) out.push(`destructures ${m[1]} from fs`);
  }
  return out;
}

const files = repoFiles('src', 'bin')
  .filter((f) => f.endsWith('.js'))
  .filter((f) => fs.existsSync(path.join(REPO_ROOT, f)));

describe('src/ and bin/ use no async fs API (the session-socket pin chdirs the process, #361)', () => {
  it('scans a non-trivial number of files, including both bins', () => {
    expect(files.length).toBeGreaterThan(30);
    expect(files).toContain('bin/mauto.js');
    expect(files).toContain('bin/mauto-session-daemon.js');
    expect(files).toContain('src/device/session-dir.js');
  });

  it('the scan catches every form it forbids', () => {
    expect(violations("const p = require('fs/promises');")).toEqual(["requires 'fs/promises'"]);
    expect(violations("const p = require('node:fs/promises');")).toEqual(["requires 'node:fs/promises'"]);
    expect(violations('fs.readFile(f, cb);')).toEqual(['calls fs.readFile()']);
    expect(violations('d.fs.open(f, "r", cb);')).toEqual(['calls fs.open()']);
    expect(violations('nodeFs.writeFile(f, x, cb);')).toEqual(['calls nodeFs.writeFile()']);
    expect(violations('await fs.promises.readFile(f);')).toEqual(['uses fs.promises']);
    expect(violations('fs.createReadStream(f);')).toEqual(['calls createReadStream()']);
    expect(violations("const { readFile } = require('fs');")).toEqual(['destructures readFile from fs']);
    expect(violations("const { promises } = require('node:fs');")).toEqual(['destructures promises from fs']);
    expect(violations("require('fs').readFile(f, cb);")).toEqual(["uses require('fs').readFile"]);
    expect(violations("require('node:fs').promises.stat(f);")).toEqual(["uses require('fs').promises"]);
  });

  it('the scan leaves the Sync API, other modules and prose alone', () => {
    expect(violations('fs.readFileSync(f); fs.openSync(f, "r"); fs.constants.O_RDONLY;')).toEqual([]);
    expect(violations('socket.write(x); server.close(cb); stream.read();')).toEqual([]);
    expect(violations("const { readFileSync } = require('fs');")).toEqual([]);
    expect(violations("const { open } = require('./lock');")).toEqual([]);
    expect(violations("// fs.readFile(f, cb) would be wrong here\nconst s = 'fs.promises';")).toEqual([]);
  });

  it('no file under src/ or bin/ uses one', () => {
    const offenders = [];
    for (const f of files) {
      for (const v of violations(fs.readFileSync(path.join(REPO_ROOT, f), 'utf8'))) offenders.push(`${f}: ${v}`);
    }
    // The session client chdirs into .session/ for one synchronous window
    // (src/device/session-dir.js inPinnedDir). An async fs call in flight on
    // the libuv thread pool would resolve a relative path inside it. Use the
    // *Sync API.
    expect(offenders).toEqual([]);
  });
});
