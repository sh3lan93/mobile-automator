'use strict';

// Agnostic element shape. We deliberately drop every OS-specific identifier
// (resource_id / identifier) so downstream consumers can only target elements
// by visible/semantic attributes (text, accessibility_label, geometry).

function resolveBounds(raw) {
  if (Array.isArray(raw.bounds) && raw.bounds.length === 4) {
    return raw.bounds.map(Number);
  }
  if (Array.isArray(raw.coordinates) && raw.coordinates.length === 4) {
    return raw.coordinates.map(Number);
  }
  if (raw.rect && typeof raw.rect === 'object') {
    const { x, y, width, height } = raw.rect;
    if ([x, y, width, height].every((v) => typeof v === 'number')) {
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

module.exports = { normalize };
