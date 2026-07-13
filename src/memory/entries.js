'use strict';

const { HEADERS } = require('./paths');

// Pure model for the agent-authored memory files (app-knowledge.md,
// preferences.md): a flat list of `- [YYYY-MM-DD][asserted] <text>` bullets
// under a `# Header`. No I/O here. `[asserted]` marks agent-claimed facts the
// reader should verify, distinct from run-history's `[observed]`.

const MAX_ENTRY_LEN = 500;
const ENTRY_RE = /^-\s+\[(\d{4}-\d{2}-\d{2})\]\[asserted\]\s+(.*)$/;

function sanitizeEntryText(raw) {
  return String(raw == null ? '' : raw)
    .replace(/[\u0000-\u001F\u007F]+/g, ' ') // control chars / newlines / tabs -> space
    .replace(/\s+/g, ' ')
    .trim();
}

function validateEntryText(raw) {
  const value = sanitizeEntryText(raw);
  if (!value) return { ok: false, reason: 'empty' };
  if (value.length > MAX_ENTRY_LEN) return { ok: false, reason: 'too_long' };
  if (value.includes('{{')) return { ok: false, reason: 'placeholder' };
  return { ok: true, value };
}

function parseEntries(md) {
  const out = [];
  if (!md) return out;
  for (const line of md.split(/\r?\n/)) {
    const m = line.match(ENTRY_RE);
    if (m) out.push({ date: m[1], text: m[2] });
  }
  return out;
}

function renderEntries(kind, entries) {
  const out = [
    HEADERS[kind] || `# ${kind}`,
    "<!-- Managed by `mauto memory`. Edit an entry's text or delete whole bullets freely;",
    '     other lines are not preserved on the next write. [asserted] = agent-claimed; verify. -->',
    '',
  ];
  for (const e of entries) out.push(`- [${e.date}][asserted] ${e.text}`);
  return out.join('\n').replace(/\n+$/, '\n');
}

function hasText(entries, text) {
  return entries.some((e) => e.text === text);
}

module.exports = {
  MAX_ENTRY_LEN,
  ENTRY_RE,
  sanitizeEntryText,
  validateEntryText,
  parseEntries,
  renderEntries,
  hasText,
};
