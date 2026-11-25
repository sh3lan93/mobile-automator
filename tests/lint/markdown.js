'use strict';

// The shared markdown readers for the prose guards: fenced blocks, headings and
// the section under a heading. They started inside docs-ci-recipe.test.js
// (#277); the showcase walkthrough guard (#312) needed the same section
// slicing, so they moved here rather than grow a second parser. A `#` line
// inside a fenced block (a shell comment) is never a heading.

const FENCE = /^\s*(`{3,}|~{3,})\s*([\w-]*)/;

// The one fence state machine. A fence closes only on the same character, at
// the same or greater length, with no info string, so a ```bash line inside a
// ```` fence stays inside it. Returns the blocks and, per line, whether the
// line is inside a fence (fence lines themselves count as inside).
function scanFences(lines) {
  const blocks = [];
  const inside = [];
  let open = null;
  lines.forEach((line, i) => {
    const m = FENCE.exec(line);
    if (!open) {
      inside.push(Boolean(m));
      if (m) open = { fence: m[1], lang: m[2], startLine: i + 2, lines: [] };
      return;
    }
    inside.push(true);
    if (m && m[1][0] === open.fence[0] && m[1].length >= open.fence.length && !m[2]) {
      blocks.push({ lang: open.lang, startLine: open.startLine, lines: open.lines });
      open = null;
      return;
    }
    open.lines.push(line);
  });
  return { blocks, inside };
}

/**
 * Every fenced code block in a blob of markdown, as
 * `{ lang, startLine, lines }`; `startLine` is the 1-based line of the first
 * line inside the fence.
 */
function fencedBlocks(text) {
  return scanFences(text.split('\n')).blocks;
}

/**
 * Every ATX heading outside a fence, as `{ level, text, line }` (`line`
 * 1-based).
 */
function headings(text) {
  const lines = text.split('\n');
  const { inside } = scanFences(lines);
  const out = [];
  lines.forEach((l, i) => {
    const m = /^(#{1,6}) +(.*?)\s*$/.exec(l);
    if (!inside[i] && m) out.push({ level: m[1].length, text: m[2], line: i + 1 });
  });
  return out;
}

/**
 * The body under one heading, given with its hashes (`'### Answer?'`):
 * everything up to the next heading of the same or a higher level outside a
 * fence. Returns null when the heading is absent (or only appears inside a
 * fence), so the caller names what it was looking for.
 */
function section(text, heading) {
  const level = /^#+/.exec(heading)[0].length;
  const lines = text.split('\n');
  const { inside } = scanFences(lines);
  const start = lines.findIndex((l, i) => !inside[i] && l.trim() === heading);
  if (start === -1) return null;
  let end = lines.findIndex((l, i) => {
    if (i <= start || inside[i]) return false;
    const m = /^(#+) /.exec(l);
    return m && m[1].length <= level;
  });
  if (end === -1) end = lines.length;
  return lines.slice(start + 1, end).join('\n');
}

/**
 * `section`, for a guard that needs the heading to exist: throws naming the
 * file and the heading when it is gone, so a renamed heading fails with its
 * name rather than as an empty match further down.
 */
function requireSection(text, heading, file) {
  const body = section(text, heading);
  if (body === null) throw new Error(`${file}: no "${heading}" section found`);
  return body;
}

module.exports = { fencedBlocks, headings, section, requireSection };
