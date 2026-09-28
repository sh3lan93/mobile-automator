'use strict';

// Agnostic element shape. We deliberately drop every OS-specific identifier
// (resource_id / identifier) so downstream consumers can only target elements
// by visible/semantic attributes (text, accessibility_label, geometry).

function resolveBounds(raw) {
  if (Array.isArray(raw.bounds) && raw.bounds.length === 4) {
    const b = raw.bounds.map(Number);
    if (b.every(Number.isFinite)) return b;
  }
  if (Array.isArray(raw.coordinates) && raw.coordinates.length === 4) {
    const c = raw.coordinates.map(Number);
    if (c.every(Number.isFinite)) return c;
  }
  if (raw.coordinates && typeof raw.coordinates === 'object' && !Array.isArray(raw.coordinates)) {
    const { x, y, width, height } = raw.coordinates;
    if ([x, y, width, height].every((v) => Number.isFinite(v))) {
      return [x, y, x + width, y + height];
    }
  }
  if (raw.rect && typeof raw.rect === 'object') {
    const { x, y, width, height } = raw.rect;
    if ([x, y, width, height].every((v) => Number.isFinite(v))) {
      return [x, y, x + width, y + height];
    }
  }
  return null;
}

function centerOf([x1, y1, x2, y2]) {
  return [Math.round((x1 + x2) / 2), Math.round((y1 + y2) / 2)];
}

function nullable(v) {
  return v === undefined || v === null || v === '' ? null : v;
}

function normalize(rawElements) {
  if (!Array.isArray(rawElements)) return [];

  const out = [];
  for (const raw of rawElements) {
    if (!raw || typeof raw !== 'object') continue;
    const bounds = resolveBounds(raw);
    if (!bounds) continue; // can't position it -> not useful, skip

    out.push({
      text: nullable(raw.text),
      accessibility_label: nullable(
        raw.accessibility_label !== undefined ? raw.accessibility_label : raw.label
      ),
      bounds,
      center: centerOf(bounds),
      type: nullable(raw.type),
    });
  }
  return out;
}

// Short, single-line excerpt of an unparseable payload for the error message:
// the FIRST non-empty line only, capped, so a multi-kilobyte screen dump never
// floods the envelope but the reader still sees what shape came back.
const EXCERPT_MAX = 120;
function excerptOf(text) {
  const line = (text.split(/\r?\n/).find((l) => l.trim() !== '') || '').trim();
  return line.length > EXCERPT_MAX ? `${line.slice(0, EXCERPT_MAX)}…` : line;
}

// mobile-mcp returns elements as the string
// `Found these elements on screen: <JSON array>` (0.0.55, and 1.0.5 when called
// with format:"json"). Earlier/other shapes may be a bare array or
// `{elements:[...]}`. Parse all three into the raw element array. Parse the
// WHOLE JSON array (never per-element regex) so labels containing
// brackets/quotes/newlines survive.
//
// A non-empty string we cannot parse THROWS rather than returning []: mobile-mcp
// 1.0.5 defaults this tool to a line-per-element text format whose header
// contains `[focused] ... [disabled]`, and a silent [] there reported `ok:true`
// with an empty screen — the failure probe then blamed the app (#199). An empty
// or whitespace-only string stays [] because it carries no content to misread:
// it is not evidence of a format change. null / non-string values stay [] for
// the same reason.
function parseElements(raw) {
  if (Array.isArray(raw)) return raw;
  if (raw && Array.isArray(raw.elements)) return raw.elements;
  if (typeof raw !== 'string' || raw.trim() === '') return [];

  const start = raw.indexOf('[');
  const end = raw.lastIndexOf(']');
  if (start !== -1 && end > start) {
    try {
      const parsed = JSON.parse(raw.slice(start, end + 1));
      if (Array.isArray(parsed)) return parsed;
    } catch (_e) { /* fall through to the loud failure below */ }
  }
  const err = new Error(`The element list could not be parsed. Engine returned: "${excerptOf(raw)}"`);
  err.hint =
    'The mobile-mcp engine likely changed its element output format (e.g. text instead of JSON). ' +
    'Check the installed @mobilenext/mobile-mcp version matches the one mobile-automator pins.';
  throw err;
}

module.exports = { normalize, parseElements };
