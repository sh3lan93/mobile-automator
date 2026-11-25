'use strict';

// The shared markdown readers for the prose guards: fenced blocks, headings and
// the section under a heading. They started inside docs-ci-recipe.test.js
// (#277); the showcase walkthrough guard (#312) needed the same section
// slicing, so they moved here rather than grow a second parser. A `#` line
// inside a fenced block (a shell comment) is never a heading.

const FENCE = /^\s*(`{3,}|~{3,})\s*([\w-]*)/;

/**
 * Every fenced code block in a blob of markdown, as
 * `{ lang, startLine, lines }`; `startLine` is the 1-based line of the first
 * line inside the fence.
 */
function fencedBlocks(text) {
  const blocks = [];
  let open = null;
  text.split('\n').forEach((line, i) => {
    const m = FENCE.exec(line);
    if (!open) {
      if (m) open = { fence: m[1], lang: m[2], startLine: i + 2, lines: [] };
      return;
    }
    if (m && m[1][0] === open.fence[0] && m[1].length >= open.fence.length && !m[2]) {
      blocks.push({ lang: open.lang, startLine: open.startLine, lines: open.lines });
      open = null;
      return;
    }
    open.lines.push(line);
  });
  return blocks;
}

// For each line, whether it sits outside every fence (fence lines themselves
// count as inside).
function outsideFences(lines) {
  let fence = null;
  return lines.map((l) => {
    const m = FENCE.exec(l);
    if (m) fence = fence === null ? m[1][0] : fence === m[1][0] ? null : fence;
    return fence === null && !m;
  });
}

/**
 * Every ATX heading outside a fence, as `{ level, text, line }` (`line`
 * 1-based).
 */
function headings(text) {
  const lines = text.split('\n');
  const outside = outsideFences(lines);
  const out = [];
  lines.forEach((l, i) => {
    const m = /^(#{1,6}) +(.*?)\s*$/.exec(l);
    if (outside[i] && m) out.push({ level: m[1].length, text: m[2], line: i + 1 });
  });
  return out;
}

/**
 * The body under one heading, given with its hashes (`'### Answer?'`):
 * everything up to the next heading of the same or a higher level outside a
 * fence. Returns null when the heading is absent, so the caller names what it
 * was looking for.
 */
function section(text, heading) {
  const level = /^#+/.exec(heading)[0].length;
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === heading);
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const outside = outsideFences(rest);
  const end = rest.findIndex((l, i) => {
    const m = /^(#+) /.exec(l);
    return outside[i] && m && m[1].length <= level;
  });
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

module.exports = { fencedBlocks, headings, section };
