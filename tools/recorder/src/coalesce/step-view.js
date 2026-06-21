'use strict';

// Maps a STORED recorder event (events.jsonl shape produced by the mode-b
// emit closures + reinterpret(): `kind`, `step_id`, `target`, `value`,
// `field_label`, `direction`, `sensitive`) onto the GUI step shape consumed by
// tools/recorder/web/app.js renderStepRow (`id`, `index`, `action`, `target`,
// `value`, `field_label`, `direction`, `sensitive`, `is_unnamed`). Pure and
// side-effect free so it is trivially unit-tested and reusable by any live
// producer. Index is assigned by the caller (1-based running counter).
function toStepView(ev, index) {
  const e = ev || {};
  // "Unnamed" only applies to target-bearing actions that failed to resolve an
  // element label. type (uses field_label) and swipe (uses direction) carry no
  // target concept, so they are never unnamed.
  const targetBearing = e.kind === 'tap' || e.kind === 'long_press' || e.kind === 'double_tap';
  return {
    id: e.step_id,
    index,
    action: e.kind,
    target: e.target != null ? e.target : null,
    value: e.value != null ? e.value : null,
    field_label: e.field_label != null ? e.field_label : null,
    direction: e.direction != null ? e.direction : null,
    sensitive: e.sensitive === true,
    is_unnamed: targetBearing && (e.target == null),
  };
}

module.exports = { toStepView };
