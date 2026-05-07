'use strict';

const KEYBOARD_RE = /(InputMethod|Keyboard|UIKeyboard|SoftInput)/;

function area(el) {
  const [x1, y1, x2, y2] = el.bounds;
  return Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
}

function contains(el, x, y) {
  const [x1, y1, x2, y2] = el.bounds;
  return x >= x1 && x < x2 && y >= y1 && y < y2;
}

function classOf(el) {
  return el.type || el.class || '';
}

function isInKeyboardRegion(snapshot, x, y) {
  if (!snapshot || !Array.isArray(snapshot.elements)) return false;
  for (const el of snapshot.elements) {
    if (!Array.isArray(el.bounds)) continue;
    if (!KEYBOARD_RE.test(classOf(el))) continue;
    if (contains(el, x, y)) return true;
  }
  return false;
}

function keyAtCoordinate(snapshot, x, y) {
  if (!snapshot || !Array.isArray(snapshot.elements)) return null;
  const candidates = snapshot.elements.filter(
    (el) => Array.isArray(el.bounds) && contains(el, x, y)
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => area(a) - area(b));
  const el = candidates[0];
  const text = el.text != null ? String(el.text) : '';
  if (text.length > 0) return text;
  const accLabel = el.accessibility_label && String(el.accessibility_label);
  if (accLabel) return accLabel;
  const contentDesc = el.content_description && String(el.content_description);
  if (contentDesc) return contentDesc;
  return null;
}

module.exports = { isInKeyboardRegion, keyAtCoordinate };
