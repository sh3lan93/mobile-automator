'use strict';

// Device-sourced text (element labels, which the app under test controls) can
// carry terminal control characters; printed raw on a human's terminal they
// clear the screen, retitle the window or forge lines (#349). JSON.stringify
// escapes C0 but not C1 (U+0080-U+009F, e.g. U+009B is a one-byte CSI), so
// every human-facing writer passes its final string through here.
//
// C0 and DEL become `\xHH`; C1 becomes `\u00HH`. Hex is uppercase. Tab is
// always kept. By default (multi-line output) LF and a CR that ends a line are
// kept too: CRLF moves the cursor nowhere a bare LF would not, so CRLF files
// print byte-identical (#353). A lone CR returns to the line start and can
// forge a line, so it is escaped. `escapeNewlines` is for one-line log output:
// it escapes LF and every CR.

// The one control set: C0 except tab, LF and CR; DEL; C1.
const ALWAYS = '\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f';
const MULTI_LINE = new RegExp(`[${ALWAYS}]|\\r(?!\\n)`, 'g');
const ONE_LINE = new RegExp(`[${ALWAYS}\\n\\r]`, 'g');

function escapeChar(c) {
  const code = c.charCodeAt(0);
  const hex = code.toString(16).toUpperCase().padStart(2, '0');
  return code >= 0x80 ? `\\u00${hex}` : `\\x${hex}`;
}

function neutraliseControls(s, { escapeNewlines = false } = {}) {
  if (typeof s !== 'string') return s;
  return s.replace(escapeNewlines ? ONE_LINE : MULTI_LINE, escapeChar);
}

module.exports = { neutraliseControls };
