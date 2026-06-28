'use strict';

// System permission-dialog button labels, per platform. Lowercase and
// apostrophe-normalized so matching is locale-tolerant within English.
const ALLOW_LABELS = {
  android: ['allow', 'while using the app', 'allow only this time', 'ok', 'continue'],
  ios: ['allow', 'allow while using app', 'allow once', 'ok'],
};

const DENY_LABELS = {
  android: ['deny', "don't allow"],
  ios: ["don't allow"],
};

function norm(s) {
  // Map the curly apostrophe (U+2019, the ’ glyph in the regex below) onto a
  // straight quote, so "Don’t Allow" matches the straight-quoted entries in the
  // label sets above. The U+2019 byte must be preserved literally here; the
  // guard assertion in labels.test.js fails loudly if it is ever flattened to a
  // straight quote by editor/transport tooling.
  return String(s == null ? '' : s).replace(/’/g, "'").trim().toLowerCase();
}

// First element whose visible text or accessibility label exactly equals one of
// `labels` (after normalization). Returns the element plus the original label
// that matched, or null.
function findByLabels(elements, labels) {
  const wanted = new Set(labels.map(norm));
  for (const el of Array.isArray(elements) ? elements : []) {
    for (const raw of [el.text, el.accessibility_label]) {
      if (raw != null && wanted.has(norm(raw))) {
        return { element: el, label: raw };
      }
    }
  }
  return null;
}

module.exports = { ALLOW_LABELS, DENY_LABELS, findByLabels };
