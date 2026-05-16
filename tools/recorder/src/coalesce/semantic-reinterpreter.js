'use strict';

// Edge-swipe threshold (px) for iOS Simulator back gesture (PRD #21 / #29).
// Heuristic: only x is checked (not y, not velocity) — favours a false
// press_back over missing a real back gesture; tune against real devices later.
const EDGE_X_MAX = 16;

// Superset of the allow/deny labels in templates/references/platform-resolutions.md,
// normalised to lowercase. Combined (not OS-partitioned) — the snapshot alone
// does not reliably tell us the OS, and cross-matching is harmless here.
const ALLOW_LABELS = [
  'allow', 'allow while using app', 'allow once', 'while using the app',
  'only this time', 'allow only while using the app', 'ok',
];
const DENY_LABELS = ["don't allow", 'deny', 'cancel'];

// Android system permission dialogs live in one of these packages (PRD #21 / #29).
// permissioncontroller is the modern runtime-permission UI; systemui covers
// older / OEM surfaces that still host the grant dialog.
const ANDROID_PERM_RID_PREFIXES = [
  'com.android.permissioncontroller:',
  'com.android.systemui:',
];

function norm(s) {
  return String(s == null ? '' : s).trim().toLowerCase();
}

function isAndroidPermissionSnapshot(snapshot) {
  const els = (snapshot && snapshot.elements) || [];
  return els.some((e) => {
    const rid = e && e.resource_id ? String(e.resource_id) : '';
    return ANDROID_PERM_RID_PREFIXES.some((p) => rid.startsWith(p));
  });
}

function isIosAlertSnapshot(snapshot) {
  const els = (snapshot && snapshot.elements) || [];
  return els.some((e) => {
    const t = e && e.type ? String(e.type) : '';
    // `=== ` is the documented SpringBoard shape; `endsWith` is a defensive
    // hedge for unverified real-device type strings (heuristic, tune later).
    return t === '_UIAlertController' || t.endsWith('_UIAlertController');
  });
}

function classifyPermissionLabel(label) {
  const l = norm(label);
  if (ALLOW_LABELS.includes(l)) return 'grant_permission';
  if (DENY_LABELS.includes(l)) return 'deny_permission';
  return null;
}

/**
 * Pure, mode-aware step reinterpreter (spec D1/D2/D3).
 * @param {object} step  emitted step (kind + kind-specific fields)
 * @param {object|null} snapshot  hierarchy snapshot active at step time (may be null)
 * @param {string} mode  'platform-aware' | 'platform-agnostic'
 * @returns {object} same step (aware) or a rewritten step (agnostic)
 */
function reinterpret(step, snapshot, mode) {
  if (!step || mode !== 'platform-agnostic') return step;

  if (step.kind === 'press_button' && norm(step.value) === 'back') {
    return { ...step, kind: 'press_back', derived_from: { kind: 'press_button', value: step.value } };
  }

  if (step.kind === 'swipe'
      && Array.isArray(step.from)
      && step.from[0] <= EDGE_X_MAX
      && step.direction === 'right') {
    return { ...step, kind: 'press_back', derived_from: { kind: 'swipe', from: step.from, direction: step.direction } };
  }

  if (step.kind === 'tap'
      && (isAndroidPermissionSnapshot(snapshot) || isIosAlertSnapshot(snapshot))) {
    const semantic = classifyPermissionLabel(step.target);
    if (semantic) {
      return { ...step, kind: semantic, derived_from: { kind: 'tap', target: step.target } };
    }
  }

  return step;
}

module.exports = { reinterpret };
