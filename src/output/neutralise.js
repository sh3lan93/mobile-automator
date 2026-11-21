'use strict';

// Device-sourced text (element labels, which the app under test controls) can
// carry terminal control characters; printed raw on a human's terminal they
// clear the screen, retitle the window or forge lines (#349). JSON.stringify
// escapes C0 but not C1 (U+0080-U+009F, e.g. U+009B is a one-byte CSI), so
// every human-facing writer passes its final string through here.
//
// C0 (except tab and, by default, newline) and DEL become `\xHH`; C1 becomes
// `\u00HH`. Hex is uppercase. `escapeNewlines` is for one-line log output.
// `keepCrlf` keeps a CR that ends a line (CRLF moves the cursor nowhere a bare
// LF would not), for raw file content such as CRLF memory markdown (#353); a
// lone CR returns to the line start and can forge a line, so it is escaped.

// eslint-disable-next-line no-control-regex -- matching control chars is the point
const CONTROLS = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;
// eslint-disable-next-line no-control-regex -- matching control chars is the point
const CONTROLS_AND_NEWLINE = /[\u0000-\u0008\u000a-\u001f\u007f-\u009f]/g;
// The CONTROLS set minus a CR immediately followed by LF.
// eslint-disable-next-line no-control-regex -- matching control chars is the point
const CONTROLS_KEEP_CRLF = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]|\r(?!\n)/g;

function escapeChar(c) {
  const code = c.charCodeAt(0);
  const hex = code.toString(16).toUpperCase().padStart(2, '0');
  return code >= 0x80 ? `\\u00${hex}` : `\\x${hex}`;
}

function neutraliseControls(s, { escapeNewlines = false, keepCrlf = false } = {}) {
  if (typeof s !== 'string') return s;
  if (escapeNewlines) return s.replace(CONTROLS_AND_NEWLINE, escapeChar);
  return s.replace(keepCrlf ? CONTROLS_KEEP_CRLF : CONTROLS, escapeChar);
}

module.exports = { neutraliseControls };
