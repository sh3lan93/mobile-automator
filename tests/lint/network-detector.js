'use strict';

// A pure detector for "this source file can reach the network", shared by the
// telemetry transport-isolation guard. It is a plain helper module, not a test.
//
// Why this exists. The privacy contract is "telemetryPayload() is the ONLY thing
// that builds a network payload", which holds only if there is exactly one
// network path. The guard used to be three regexes (`fetch(`, `require("http(s)")`,
// `XMLHttpRequest`) and missed every other way out of the process:
// `require("node:https")`, `http2`, raw `tls` / `net` TCP, `dns` lookups used
// as an exfiltration channel, `import()` and ESM imports, `globalThis["fetch"]`,
// `undici`, `dgram`, a spawned `curl`. A guard that passes on a `node:https`
// import is worse than none, because the CHANGELOG claims it prevents exactly
// that.
//
// Approach: regex plus one tiny state-machine stripper — no parser, no eval, no
// dependencies. The stripper (`stripSource`) yields two views of the file that
// are aligned character-for-character:
//   text  the source with comments removed (string contents intact), used to
//         READ a specifier out of a call the code view located;
//   code  the source with comments removed AND string / template-text / regex
//         bodies blanked, used to FIND calls and identifiers, so prose such as
//         "an update check would fetch(…)" in a comment or a message string
//         never false-positives.
//
// Limits, stated honestly: this is a lint, not a sandbox. It cannot see a
// specifier assembled at runtime (it flags those as `dynamic-specifier` instead
// of guessing), and `Reflect.get(globalThis, name)` or a spawned variable
// command are beyond a regex. The point is to make the obvious and the
// moderately sneaky paths fail the build, and to make every deliberate
// exception an explicit, reviewed, per-file allowlist entry.

// The one file that is allowed to talk to the network. Not present until the
// transport task lands; the guard tolerates its absence (see the test).
const TRANSPORT = 'src/observe/transport.js';

// Modules that exist to reach the network (or to run code where the network
// guard cannot see it). Banned everywhere except TRANSPORT.
const NETWORK_ALWAYS = new Set([
  'http',
  'https',
  'http2',
  'tls',
  'dgram',
  'dns',
  'undici',
  'worker_threads',
  'cluster',
  'inspector',
  // Third-party HTTP / socket clients: not in the tree today, banned so that
  // adding one is a conscious change to this guard rather than a silent one.
  'ws',
  'node-fetch',
  'cross-fetch',
  'isomorphic-fetch',
  'axios',
  'got',
  'superagent',
  'request',
  'needle',
  'socket.io-client',
]);

// Modules that are legitimate for local work (Unix-domain socket, daemon spawn)
// but can also reach the network. Allowed only in the files named here.
// Widening a list is a reviewed edit — and the test asserts each entry still
// exists and still imports the module, so an entry cannot rot into blanket
// permission.
const DUAL_USE_ALLOWLIST = {
  // Unix-domain socket to the session daemon; never leaves the machine.
  net: ['src/device/session-client.js', 'src/device/session-daemon.js', TRANSPORT],
  // Spawns the session daemon / mobile-mcp child process.
  child_process: ['src/device/session-daemon.js', 'src/device/session-spawn.js', TRANSPORT],
};

// path -> reason. A non-literal `require(x)` / `import(x)` cannot be verified,
// so it is a violation unless the file is named here WITH a reason. Empty today:
// no file in src/ or bin/ has one.
const DYNAMIC_SPECIFIER_ALLOWLIST = {};

// Binaries whose only job is talking to the network. Checked wherever a
// child-process call names one, INCLUDING inside allowlisted files.
const NETWORK_BINARIES = new Set([
  'curl',
  'wget',
  'nc',
  'ncat',
  'netcat',
  'telnet',
  'ssh',
  'scp',
  'sftp',
  'ftp',
  'socat',
  'nslookup',
  'dig',
]);
// The MCP SDK is on the dependency list for its stdio transports. Its HTTP / SSE
// / WebSocket transports are network paths in a dependency's clothing.
const MCP_NETWORK_TRANSPORT = /^@modelcontextprotocol\/sdk\/(?:client|server)\/(?:streamableHttp|sse|websocket)/i;
const SHELLS = new Set(['sh', 'bash', 'zsh', 'dash', 'cmd', 'powershell', 'pwsh']);

const NETWORK_GLOBALS = ['fetch', 'WebSocket', 'EventSource', 'XMLHttpRequest', 'sendBeacon'];

// ---------------------------------------------------------------------------
// Stripper
// ---------------------------------------------------------------------------

// Words after which a `/` starts a regex literal rather than a division.
const REGEX_AFTER_WORD = new Set([
  'return',
  'typeof',
  'case',
  'in',
  'of',
  'delete',
  'void',
  'throw',
  'new',
  'else',
  'do',
  'yield',
  'await',
]);
const IDENT_CHAR = /[\w$]/;

function isNewline(ch) {
  return ch === '\n' || ch === '\r';
}

/**
 * Split a source file into two aligned views (same length, same newlines).
 *
 * @param {string} src
 * @returns {{ text: string, code: string }}
 */
function stripSource(src) {
  const n = src.length;
  const text = new Array(n);
  const code = new Array(n);
  const blankOf = (ch) => (isNewline(ch) ? ch : ' ');
  // comment: blank in both views. raw: keep in `text`, blank in `code`.
  const comment = (i) => {
    text[i] = code[i] = blankOf(src[i]);
  };
  const raw = (i) => {
    text[i] = src[i];
    code[i] = blankOf(src[i]);
  };
  const both = (i) => {
    text[i] = code[i] = src[i];
  };

  // Last non-blank character already emitted in the code view, and the
  // identifier that ends there (if any) — decides regex-vs-division.
  const regexAllowedAt = (i) => {
    let j = i - 1;
    while (j >= 0 && (code[j] === ' ' || isNewline(code[j]) || code[j] === '\t')) j--;
    if (j < 0) return true;
    const p = code[j];
    if (IDENT_CHAR.test(p)) {
      let k = j;
      while (k >= 0 && IDENT_CHAR.test(code[k])) k--;
      return REGEX_AFTER_WORD.has(code.slice(k + 1, j + 1).join(''));
    }
    // After a closing bracket or a quote/backtick it is a division.
    return !(p === ')' || p === ']' || p === "'" || p === '"' || p === '`');
  };

  const stack = [{ type: 'code', depth: 0 }];
  let i = 0;

  // A shebang is not JavaScript; treat the first line as a comment.
  if (src.startsWith('#!')) {
    while (i < n && !isNewline(src[i])) comment(i++);
  }

  while (i < n) {
    const top = stack[stack.length - 1];
    const c = src[i];

    if (top.type === 'template') {
      if (c === '\\') {
        raw(i);
        if (i + 1 < n) raw(i + 1);
        i += 2;
      } else if (c === '`') {
        both(i++);
        stack.pop();
      } else if (c === '$' && src[i + 1] === '{') {
        both(i);
        both(i + 1);
        i += 2;
        stack.push({ type: 'code', depth: 0 });
      } else {
        raw(i++);
      }
      continue;
    }

    // code context
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && !isNewline(src[i])) comment(i++);
    } else if (c === '/' && src[i + 1] === '*') {
      comment(i++);
      comment(i++);
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) comment(i++);
      if (i < n) {
        comment(i++);
        comment(i++);
      }
    } else if (c === "'" || c === '"') {
      both(i);
      let j = i + 1;
      while (j < n && src[j] !== c && !isNewline(src[j])) {
        if (src[j] === '\\' && j + 1 < n) {
          raw(j);
          raw(j + 1);
          j += 2;
        } else {
          raw(j++);
        }
      }
      if (j < n && src[j] === c) both(j++);
      i = j;
    } else if (c === '`') {
      both(i++);
      stack.push({ type: 'template' });
    } else if (c === '/' && regexAllowedAt(i)) {
      // Regex literal: scan to the closing `/`, honouring escapes and classes.
      let j = i + 1;
      let inClass = false;
      let closed = false;
      while (j < n && !isNewline(src[j])) {
        if (src[j] === '\\') j += 2;
        else if (src[j] === '[') { inClass = true; j++; }
        else if (src[j] === ']') { inClass = false; j++; }
        else if (src[j] === '/' && !inClass) { closed = true; break; }
        else j++;
      }
      if (closed) {
        both(i);
        for (let k = i + 1; k < j; k++) raw(k);
        both(j);
        i = j + 1;
      } else {
        both(i++); // not a regex after all; carry on
      }
    } else {
      if (stack.length > 1) {
        if (c === '{') top.depth++;
        else if (c === '}') {
          if (top.depth === 0) {
            both(i++);
            stack.pop();
            continue;
          }
          top.depth--;
        }
      }
      both(i++);
    }
  }
  return { text: text.join(''), code: code.join('') };
}

// ---------------------------------------------------------------------------
// Specifiers
// ---------------------------------------------------------------------------

/** `node:https` -> `https`, `dns/promises` -> `dns`, relative -> null. */
function normalizeSpecifier(spec) {
  if (spec.startsWith('.') || spec.startsWith('/')) return null;
  let s = spec.startsWith('node:') ? spec.slice(5) : spec;
  const parts = s.split('/');
  s = s.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
  return s;
}

function skipSpace(text, i) {
  while (i < text.length && /\s/.test(text[i])) i++;
  return i;
}

// Read a plain quoted string starting at `i` (after whitespace) in `text`.
// Returns { value, end } or null when it is not a plain literal.
function readQuoted(text, i) {
  i = skipSpace(text, i);
  const q = text[i];
  if (q !== "'" && q !== '"') return null;
  let j = i + 1;
  while (j < text.length && text[j] !== q) {
    if (text[j] === '\\' || isNewline(text[j])) return null;
    j++;
  }
  if (j >= text.length) return null;
  return { value: text.slice(i + 1, j), end: j + 1 };
}

function snippet(text, i) {
  return text.slice(i, i + 40).replace(/\s+/g, ' ').trim();
}

/**
 * Every module specifier the file names, plus every place it names one that
 * cannot be read statically.
 *
 * @returns {{ specifiers: Array<{specifier:string, raw:string, via:string}>,
 *             unverifiable: Array<{detail:string}> }}
 */
function analyze(src) {
  const { text, code } = stripSource(src);
  const specifiers = [];
  const unverifiable = [];
  const add = (raw, via) => {
    const specifier = normalizeSpecifier(raw);
    if (specifier !== null) specifiers.push({ specifier, raw, via });
  };

  // require('x') — also matches `module.require(`; not `require.resolve(`.
  for (const m of code.matchAll(/(?<![\w$])require\s*\(/g)) {
    const at = m.index + m[0].length;
    const lit = readQuoted(text, at);
    if (lit && /^\s*[),]/.test(text.slice(lit.end, lit.end + 20))) add(lit.value, 'require');
    else unverifiable.push({ detail: `require(${snippet(text, at)}…) has a non-literal specifier` });
  }

  // import('x')
  for (const m of code.matchAll(/(?<![\w$.])import\s*\(/g)) {
    const at = m.index + m[0].length;
    const lit = readQuoted(text, at);
    if (lit && /^\s*[),]/.test(text.slice(lit.end, lit.end + 20))) add(lit.value, 'import()');
    else unverifiable.push({ detail: `import(${snippet(text, at)}…) has a non-literal specifier` });
  }

  // import x from 'y' / import 'y'  (not import( and not import.meta)
  for (const m of code.matchAll(/(?<![\w$.])import\b(?!\s*[(.])/g)) {
    const re = /import\s*(?:[\w$*{}\s,]+?\s*from\s*)?(['"])([^'"\n]*)\1/y;
    re.lastIndex = m.index;
    const hit = re.exec(text);
    if (hit) add(hit[2], 'import');
    else unverifiable.push({ detail: `import statement '${snippet(text, m.index)}…' could not be read` });
  }

  // export * from 'y' / export { a } from 'y'  (a plain export has no specifier)
  for (const m of code.matchAll(/(?<![\w$.])export\b/g)) {
    const re = /export\s*(?:\*(?:\s*as\s+[\w$]+)?|\{[^}]*\})\s*from\s*(['"])([^'"\n]*)\1/y;
    re.lastIndex = m.index;
    const hit = re.exec(text);
    if (hit) add(hit[2], 'export-from');
  }

  return { specifiers, unverifiable, text, code };
}

/**
 * The normalised, literal module specifiers a file imports.
 * @returns {Array<{specifier:string, raw:string, via:string}>}
 */
function collectSpecifiers(src) {
  return analyze(src).specifiers;
}

// ---------------------------------------------------------------------------
// Detector
// ---------------------------------------------------------------------------

function callSlice(text, from) {
  const close = text.indexOf(')', from);
  return text.slice(from, close === -1 ? from + 400 : Math.min(close + 1, from + 400));
}

/**
 * Report every way `sourceText` can reach the network, other than as the
 * sanctioned transport file.
 *
 * @param {string} sourceText  the file's text
 * @param {string} relPath     repo-relative path (forward or back slashes)
 * @returns {Array<{ kind: string, detail: string }>}
 */
function findNetworkUse(sourceText, relPath) {
  const rel = String(relPath).replace(/\\/g, '/');
  if (rel === TRANSPORT) return [];

  const out = [];
  const flag = (kind, detail) => out.push({ kind, detail });
  const { specifiers, unverifiable, text, code } = analyze(sourceText);

  // 1. modules
  for (const { specifier, raw, via } of specifiers) {
    if (MCP_NETWORK_TRANSPORT.test(raw)) {
      flag('network-module', `${via} of '${raw}' is an MCP network transport; only stdio transports are allowed`);
    } else if (NETWORK_ALWAYS.has(specifier)) {
      flag('network-module', `${via} of '${specifier}' is a network module; only ${TRANSPORT} may use it`);
    } else if (Object.prototype.hasOwnProperty.call(DUAL_USE_ALLOWLIST, specifier)) {
      if (!DUAL_USE_ALLOWLIST[specifier].includes(rel)) {
        flag(
          'dual-use-module',
          `${via} of '${specifier}' outside its allowlist (${DUAL_USE_ALLOWLIST[specifier].join(', ')})`,
        );
      }
    }
  }

  // 2. specifiers we cannot verify
  if (!DYNAMIC_SPECIFIER_ALLOWLIST[rel]) {
    for (const u of unverifiable) flag('dynamic-specifier', u.detail);
  }

  // 3. ways to obtain a module without a readable specifier
  for (const m of code.matchAll(/(?<![\w$.])require\b(?!\s*[(.])/g)) {
    flag('require-alias', `'require' is used as a value (${snippet(text, m.index)}…); its calls cannot be scanned`);
  }
  for (const m of code.matchAll(/(?<![\w$])createRequire\b/g)) {
    flag('loader-escape', `createRequire (${snippet(text, m.index)}…) loads modules the scan cannot see`);
  }
  for (const m of code.matchAll(/(?<![\w$])process\s*(?:\.\s*(?:binding|_linkedBinding|dlopen)\b|\[)/g)) {
    flag('loader-escape', `${snippet(text, m.index)}… reaches native bindings`);
  }
  for (const m of code.matchAll(/(?<![\w$])Module\s*\.\s*_load\b/g)) {
    flag('loader-escape', `${snippet(text, m.index)}… loads modules the scan cannot see`);
  }
  for (const m of code.matchAll(/(?<![\w$.])(?:eval|Function)\s*\(/g)) {
    flag('dynamic-code', `${snippet(text, m.index)}… runs code the scan cannot see`);
  }

  // 4. network-capable identifiers
  for (const name of NETWORK_GLOBALS) {
    const re = new RegExp(`(?<![\\w$])${name}(?![\\w$])`, 'g');
    for (const m of code.matchAll(re)) {
      flag('network-identifier', `'${name}' (${snippet(text, m.index)}…) is a network API; only ${TRANSPORT} may use it`);
    }
  }
  for (const m of code.matchAll(/(?<![\w$.])(?:globalThis|global|window)\s*\[/g)) {
    const at = m.index + m[0].length;
    const lit = readQuoted(text, at);
    if (lit && NETWORK_GLOBALS.includes(lit.value)) {
      flag('network-identifier', `'${lit.value}' reached through a computed global lookup`);
    } else {
      flag('global-computed-access', `${snippet(text, m.index)}… is a computed global lookup; the scan cannot tell what it reaches`);
    }
  }

  // 5. a spawned network binary (checked even inside allowlisted files)
  for (const m of code.matchAll(/(?<![\w$])(?:spawn|spawnSync|exec|execSync|execFile|execFileSync|fork)\s*\(\s*/g)) {
    const at = m.index + m[0].length;
    const q = text[at];
    if (q !== "'" && q !== '"' && q !== '`') continue;
    const end = text.indexOf(q, at + 1);
    if (end === -1) continue;
    const command = text.slice(at + 1, end).trim().split(/\s+/)[0] || '';
    const base = command.split('/').pop();
    if (NETWORK_BINARIES.has(base)) {
      flag('network-binary', `spawns '${base}', a network tool`);
    } else if (SHELLS.has(base)) {
      const rest = callSlice(text, end);
      const word = rest.match(new RegExp(`(?<![\\w./-])(${[...NETWORK_BINARIES].join('|')})(?![\\w-])`));
      if (word) flag('network-binary', `runs '${word[1]}' through a shell`);
    }
  }

  return out;
}

module.exports = {
  findNetworkUse,
  collectSpecifiers,
  stripSource,
  normalizeSpecifier,
  TRANSPORT,
  NETWORK_ALWAYS,
  DUAL_USE_ALLOWLIST,
  DYNAMIC_SPECIFIER_ALLOWLIST,
  NETWORK_BINARIES,
};
