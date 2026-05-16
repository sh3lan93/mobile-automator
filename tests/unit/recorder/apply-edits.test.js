'use strict';

const { applyEdits } = require('../../../tools/recorder/src/reconcile/apply-edits');

const ev = (step_id, extra = {}) => ({ step_id, kind: 'tap', ...extra });
const as = (id, anchor, nl = 'x') => ({ id, anchor_step_id: anchor, nl_text: nl });

describe('applyEdits', () => {
  test('rename sets effective display_name, keeps step_id key', () => {
    const r = applyEdits({
      events: [ev('tap_login')],
      assertions: [],
      edits: [{ op: 'rename', target_step_id: 'tap_login', new_display_name: 'Tap Login button', ts: '2026-05-16T10:00:00.000Z' }],
    });
    expect(r.steps[0].step_id).toBe('tap_login');
    expect(r.steps[0].display_name).toBe('Tap Login button');
  });

  test('edit-value sets effective value on the type step', () => {
    const r = applyEdits({
      events: [ev('type_email', { kind: 'type', value: 'usr@acme' })],
      assertions: [],
      edits: [{ op: 'edit-value', target_step_id: 'type_email', new_value: 'user@acme.io', ts: '2026-05-16T10:00:00.000Z' }],
    });
    expect(r.steps[0].value).toBe('user@acme.io');
  });

  test('edit-assertion-text sets effective nl_text', () => {
    const r = applyEdits({
      events: [ev('tap_x')],
      assertions: [as('a1', 'tap_x', 'old')],
      edits: [{ op: 'edit-assertion-text', target_assertion_id: 'a1', new_nl_text: 'new text', ts: '2026-05-16T10:00:00.000Z' }],
    });
    expect(r.assertions[0].nl_text).toBe('new text');
  });

  test('delete + cascade removes the step and its anchored assertions', () => {
    const r = applyEdits({
      events: [ev('tap_a'), ev('tap_b')],
      assertions: [as('a1', 'tap_b'), as('a2', 'tap_a')],
      edits: [{ op: 'delete', target_step_id: 'tap_b', assertion_policy: 'cascade', ts: '2026-05-16T10:00:00.000Z' }],
    });
    expect(r.steps.map((s) => s.step_id)).toEqual(['tap_a']);
    expect(r.assertions.map((a) => a.id)).toEqual(['a2']);
  });

  test('delete + reanchor re-points anchored assertions to the previous surviving step', () => {
    const r = applyEdits({
      events: [ev('tap_a'), ev('tap_b'), ev('tap_c')],
      assertions: [as('a1', 'tap_b')],
      edits: [{ op: 'delete', target_step_id: 'tap_b', assertion_policy: 'reanchor', ts: '2026-05-16T10:00:00.000Z' }],
    });
    expect(r.steps.map((s) => s.step_id)).toEqual(['tap_a', 'tap_c']);
    expect(r.assertions[0].anchor_step_id).toBe('tap_a');
  });

  test('delete + reanchor on the first step falls back to the next surviving step', () => {
    const r = applyEdits({
      events: [ev('tap_first'), ev('tap_second')],
      assertions: [as('a1', 'tap_first')],
      edits: [{ op: 'delete', target_step_id: 'tap_first', assertion_policy: 'reanchor', ts: '2026-05-16T10:00:00.000Z' }],
    });
    expect(r.assertions[0].anchor_step_id).toBe('tap_second');
  });

  test('delete + reanchor with no surviving step drops the assertions and reports', () => {
    const r = applyEdits({
      events: [ev('tap_only')],
      assertions: [as('a1', 'tap_only')],
      edits: [{ op: 'delete', target_step_id: 'tap_only', assertion_policy: 'reanchor', ts: '2026-05-16T10:00:00.000Z' }],
    });
    expect(r.steps).toEqual([]);
    expect(r.assertions).toEqual([]);
    expect(r.report.some((x) => x.dropped === 'assertions')).toBe(true);
  });

  test('chronological precedence: later rename on same step wins', () => {
    const r = applyEdits({
      events: [ev('tap_x')],
      assertions: [],
      edits: [
        { op: 'rename', target_step_id: 'tap_x', new_display_name: 'first', ts: '2026-05-16T10:00:00.000Z' },
        { op: 'rename', target_step_id: 'tap_x', new_display_name: 'second', ts: '2026-05-16T10:00:05.000Z' },
      ],
    });
    expect(r.steps[0].display_name).toBe('second');
  });

  test('edit targeting an already-deleted step is a silent no-op', () => {
    const r = applyEdits({
      events: [ev('tap_x')],
      assertions: [],
      edits: [
        { op: 'delete', target_step_id: 'tap_x', assertion_policy: 'none', ts: '2026-05-16T10:00:00.000Z' },
        { op: 'rename', target_step_id: 'tap_x', new_display_name: 'ghost', ts: '2026-05-16T10:00:05.000Z' },
      ],
    });
    expect(r.steps).toEqual([]);
    expect(r.report.some((x) => x.ignored === 'rename')).toBe(true);
  });

  test('unparseable / null edit entry is skipped and reported', () => {
    const r = applyEdits({ events: [ev('tap_x')], assertions: [], edits: [null] });
    expect(r.steps).toHaveLength(1);
    expect(r.report.some((x) => x.skipped === 'unparseable')).toBe(true);
  });

  test('unrecognized op is ignored and reported (forward-compat)', () => {
    const r = applyEdits({
      events: [ev('tap_x')],
      assertions: [],
      edits: [{ op: 'reorder', target_step_id: 'tap_x', ts: '2026-05-16T10:00:00.000Z' }],
    });
    expect(r.steps).toHaveLength(1);
    expect(r.report.some((x) => x.ignored === 'unrecognized-op')).toBe(true);
  });

  test('edits applied in ts order even if given out of order', () => {
    const r = applyEdits({
      events: [ev('tap_x')],
      assertions: [],
      edits: [
        { op: 'rename', target_step_id: 'tap_x', new_display_name: 'late', ts: '2026-05-16T10:00:09.000Z' },
        { op: 'rename', target_step_id: 'tap_x', new_display_name: 'early', ts: '2026-05-16T10:00:01.000Z' },
      ],
    });
    expect(r.steps[0].display_name).toBe('late');
  });
});
