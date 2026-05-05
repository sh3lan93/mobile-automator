'use strict';

function area(el) {
  const [x1, y1, x2, y2] = el.bounds;
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

function contains(el, x, y) {
  const [x1, y1, x2, y2] = el.bounds;
  return x >= x1 && x < x2 && y >= y1 && y < y2;
}

function lastResourceIdSegment(rid) {
  if (!rid) return null;
  const idx = rid.lastIndexOf('/');
  return idx >= 0 ? rid.slice(idx + 1) : rid;
}

function shortClass(type) {
  if (!type) return 'view';
  const segs = type.split('.');
  return segs[segs.length - 1].toLowerCase();
}

function resolveElement(snapshot, x, y) {
  const candidates = (snapshot.elements || []).filter((el) => Array.isArray(el.bounds) && contains(el, x, y));
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => area(a) - area(b));
  const el = candidates[0];

  const accLabel = el.accessibility_label && String(el.accessibility_label).trim();
  if (accLabel) return { display_name: accLabel, is_unnamed: false, raw_element: el };

  const text = el.text && String(el.text).trim();
  if (text) return { display_name: text, is_unnamed: false, raw_element: el };

  const ridSeg = lastResourceIdSegment(el.resource_id);
  if (ridSeg) return { display_name: ridSeg, is_unnamed: false, raw_element: el };

  return { display_name: `unnamed_${shortClass(el.type)}`, is_unnamed: true, raw_element: el };
}

module.exports = { resolveElement };
