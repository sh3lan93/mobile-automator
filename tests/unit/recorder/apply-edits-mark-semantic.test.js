'use strict';

const { applyEdits } = require('../../../tools/recorder/src/reconcile/apply-edits');

describe('applyEdits mark-as-semantic', () => {
  test('rewrites the step kind and preserves provenance', () => {
    const events = [
      { step_id: 'tap_blank', kind: 'tap', target: 'blank area' },
      { step_id: 'tap_login', kind: 'tap', target: 'Login' },
    ];
    const edits = [
      { op: 'mark-as-semantic', target_step_id: 'tap_blank', semantic_action: 'dismiss_keyboard', ts: '2026-05-17T10:00:00.000Z' },
    ];
    const { steps } = applyEdits({ events, assertions: [], edits });
    const s = steps.find((x) => x.step_id === 'tap_blank');
    expect(s.kind).toBe('dismiss_keyboard');
    expect(s.derived_from).toMatchObject({ kind: 'tap', target: 'blank area' });
    expect(steps.find((x) => x.step_id === 'tap_login').kind).toBe('tap');
  });

  test('missing target is reported, not thrown', () => {
    const { report } = applyEdits({
      events: [],
      assertions: [],
      edits: [{ op: 'mark-as-semantic', target_step_id: 'nope', semantic_action: 'dismiss_keyboard', ts: '2026-05-17T10:00:00.000Z' }],
    });
    expect(report).toContainEqual({ ignored: 'mark-as-semantic', target: 'nope' });
  });
});
