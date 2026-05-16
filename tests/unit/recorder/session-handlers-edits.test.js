'use strict';

const {
  handleRenameStep,
  handleDeleteStep,
  handleEditValue,
  handleEditAssertionText,
} = require('../../../tools/recorder/src/session-handlers');

describe('handleRenameStep', () => {
  test('appends a canonical rename record and broadcasts step-renamed', () => {
    const store = { appendEdit: jest.fn() };
    const broadcast = jest.fn();
    handleRenameStep({ store, broadcast, msg: { type: 'rename-step', step_id: 'tap_login', new_display_name: 'Tap Login' } });
    const rec = store.appendEdit.mock.calls[0][0];
    expect(rec).toMatchObject({ op: 'rename', target_step_id: 'tap_login', new_display_name: 'Tap Login' });
    expect(typeof rec.ts).toBe('string');
    expect(broadcast).toHaveBeenCalledWith({ type: 'step-renamed', step_id: 'tap_login', new_display_name: 'Tap Login' });
  });

  test('rejects empty new_display_name (no append, no broadcast)', () => {
    const store = { appendEdit: jest.fn() };
    const broadcast = jest.fn();
    handleRenameStep({ store, broadcast, msg: { step_id: 'tap_login', new_display_name: '  ' } });
    expect(store.appendEdit).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });
});

describe('handleEditValue', () => {
  test('appends edit-value record and broadcasts value-edited', () => {
    const store = { appendEdit: jest.fn() };
    const broadcast = jest.fn();
    handleEditValue({ store, broadcast, msg: { step_id: 'type_email', new_value: 'user@acme.io' } });
    expect(store.appendEdit.mock.calls[0][0]).toMatchObject({ op: 'edit-value', target_step_id: 'type_email', new_value: 'user@acme.io' });
    expect(broadcast).toHaveBeenCalledWith({ type: 'value-edited', step_id: 'type_email', new_value: 'user@acme.io' });
  });

  test('rejects empty new_value', () => {
    const store = { appendEdit: jest.fn() };
    const broadcast = jest.fn();
    handleEditValue({ store, broadcast, msg: { step_id: 'type_email', new_value: '' } });
    expect(store.appendEdit).not.toHaveBeenCalled();
  });
});

describe('handleEditAssertionText', () => {
  test('appends edit-assertion-text record and broadcasts assertion-text-edited', () => {
    const store = { appendEdit: jest.fn() };
    const broadcast = jest.fn();
    handleEditAssertionText({ store, broadcast, msg: { assertion_id: 'a3', new_nl_text: 'Dashboard header is visible' } });
    expect(store.appendEdit.mock.calls[0][0]).toMatchObject({ op: 'edit-assertion-text', target_assertion_id: 'a3', new_nl_text: 'Dashboard header is visible' });
    expect(broadcast).toHaveBeenCalledWith({ type: 'assertion-text-edited', assertion_id: 'a3', new_nl_text: 'Dashboard header is visible' });
  });
});

describe('handleDeleteStep', () => {
  test('appends delete record with policy and broadcasts step-deleted', () => {
    const store = { appendEdit: jest.fn() };
    const broadcast = jest.fn();
    handleDeleteStep({ store, broadcast, msg: { step_id: 'tap_submit', assertion_policy: 'reanchor' } });
    expect(store.appendEdit.mock.calls[0][0]).toMatchObject({ op: 'delete', target_step_id: 'tap_submit', assertion_policy: 'reanchor' });
    expect(broadcast).toHaveBeenCalledWith({ type: 'step-deleted', step_id: 'tap_submit', assertion_policy: 'reanchor' });
  });

  test('accepts policy "none"', () => {
    const store = { appendEdit: jest.fn() };
    const broadcast = jest.fn();
    handleDeleteStep({ store, broadcast, msg: { step_id: 'tap_x', assertion_policy: 'none' } });
    expect(store.appendEdit).toHaveBeenCalledTimes(1);
  });

  test('rejects unknown assertion_policy', () => {
    const store = { appendEdit: jest.fn() };
    const broadcast = jest.fn();
    handleDeleteStep({ store, broadcast, msg: { step_id: 'tap_x', assertion_policy: 'bogus' } });
    expect(store.appendEdit).not.toHaveBeenCalled();
    expect(broadcast).not.toHaveBeenCalled();
  });
});
