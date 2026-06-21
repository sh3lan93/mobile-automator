'use strict';

const { toStepView } = require('../../../tools/recorder/src/coalesce/step-view');

describe('toStepView', () => {
  test('maps a resolved tap event to the GUI step shape', () => {
    const ev = { kind: 'tap', step_id: 'tap_wireless_earbuds', target: 'Wireless Earbuds' };
    expect(toStepView(ev, 1)).toEqual({
      id: 'tap_wireless_earbuds',
      index: 1,
      action: 'tap',
      target: 'Wireless Earbuds',
      value: null,
      field_label: null,
      direction: null,
      sensitive: false,
      is_unnamed: false,
    });
  });

  test('flags an unresolved tap (no target) as unnamed', () => {
    const ev = { kind: 'tap', step_id: 'tap_unknown' };
    const view = toStepView(ev, 4);
    expect(view.index).toBe(4);
    expect(view.action).toBe('tap');
    expect(view.target).toBeNull();
    expect(view.is_unnamed).toBe(true);
  });

  test('maps a type event with sensitive + field_label', () => {
    const ev = { kind: 'type', step_id: 'type_password', value: 'hunter2', field_label: 'Password', sensitive: true };
    expect(toStepView(ev, 2)).toEqual({
      id: 'type_password',
      index: 2,
      action: 'type',
      target: null,
      value: 'hunter2',
      field_label: 'Password',
      direction: null,
      sensitive: true,
      is_unnamed: false,
    });
  });

  test('maps a swipe event with direction (no target/unnamed)', () => {
    const ev = { kind: 'swipe', step_id: 'swipe_unknown', direction: 'up' };
    const view = toStepView(ev, 3);
    expect(view.action).toBe('swipe');
    expect(view.direction).toBe('up');
    expect(view.is_unnamed).toBe(false);
  });
});
