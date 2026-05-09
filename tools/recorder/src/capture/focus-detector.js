'use strict';

const INPUT_CLASS_RE = /(EditText|UITextField|UISecureTextField|XCUIElementTypeTextField|XCUIElementTypeSecureTextField|XCUIElementTypeTextView|AutoCompleteTextView)/;
const SECURE_CLASS_RE = /(UISecureTextField|XCUIElementTypeSecureTextField|SecureTextField)/;

function isInputClass(typeOrClass) {
  if (!typeOrClass) return false;
  return INPUT_CLASS_RE.test(typeOrClass);
}

function isSecureClass(typeOrClass) {
  if (!typeOrClass) return false;
  return SECURE_CLASS_RE.test(typeOrClass);
}

function findFocusedField(snapshot) {
  if (!snapshot || !Array.isArray(snapshot.elements)) return null;
  for (const el of snapshot.elements) {
    if (!el || el.focused !== true) continue;
    const cls = el.type || el.class;
    if (!isInputClass(cls)) continue;
    let sensitive = isSecureClass(cls);
    if (!sensitive && typeof el.inputType === 'string' && /password/i.test(el.inputType)) {
      sensitive = true;
    }
    // Modern XCUITest exposes secure input as a trait or boolean rather than a class.
    if (!sensitive && Array.isArray(el.accessibility_traits) && el.accessibility_traits.includes('secureTextField')) {
      sensitive = true;
    }
    if (!sensitive && el.secureTextEntry === true) {
      sensitive = true;
    }
    const label =
      (el.accessibility_label && String(el.accessibility_label).trim()) ||
      (el.content_description && String(el.content_description).trim()) ||
      (el.text && String(el.text).trim()) ||
      el.id ||
      'field';
    return {
      id: el.id || el.resource_id || label,
      label,
      sensitive,
    };
  }
  return null;
}

module.exports = { findFocusedField };
