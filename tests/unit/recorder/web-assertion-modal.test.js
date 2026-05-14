/**
 * @jest-environment jsdom
 */

'use strict';

// Mark the environment so app.js does not auto-connect a real WebSocket.
window.__RECORDER_TEST__ = true;

const path = require('path');
const appPath = path.resolve(__dirname, '../../../tools/recorder/web/app.js');

// eslint-disable-next-line import/no-dynamic-require
const app = require(appPath);

describe('renderAssertionModal', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="modal-root"></div>';
  });

  test('mounts under #modal-root with img.src, textarea, Save and Cancel buttons', () => {
    app.renderAssertionModal({
      assertion_id: 'a1',
      screenshot_url: '/screenshots/assert_a1.png',
      anchor_step_id: 'tap_login',
      onSave: jest.fn(),
      onCancel: jest.fn(),
    });

    const modalRoot = document.getElementById('modal-root');
    expect(modalRoot.children.length).toBeGreaterThan(0);

    const img = modalRoot.querySelector('img');
    expect(img).not.toBeNull();
    expect(img.src).toContain('/screenshots/assert_a1.png');

    const textarea = modalRoot.querySelector('textarea');
    expect(textarea).not.toBeNull();

    const btnSave = modalRoot.querySelector('#modal-btn-save');
    expect(btnSave).not.toBeNull();
    expect(btnSave.textContent).toBe('Save');

    const btnCancel = modalRoot.querySelector('#modal-btn-cancel');
    expect(btnCancel).not.toBeNull();
    expect(btnCancel.textContent).toBe('Cancel');
  });

  test('Save invokes onSave(text) with the textarea value and unmounts the modal', () => {
    const onSave = jest.fn();
    const onCancel = jest.fn();

    app.renderAssertionModal({
      assertion_id: 'a1',
      screenshot_url: '/screenshots/assert_a1.png',
      anchor_step_id: 'tap_login',
      onSave,
      onCancel,
    });

    const modalRoot = document.getElementById('modal-root');
    const textarea = modalRoot.querySelector('textarea');
    textarea.value = 'Welcome screen is shown';

    const btnSave = modalRoot.querySelector('#modal-btn-save');
    btnSave.dispatchEvent(new window.Event('click'));

    expect(onSave).toHaveBeenCalledWith('Welcome screen is shown');
    expect(onCancel).not.toHaveBeenCalled();
    // Modal should be unmounted.
    expect(document.getElementById('modal-btn-save')).toBeNull();
  });

  test('Cancel invokes onCancel() and unmounts the modal', () => {
    const onSave = jest.fn();
    const onCancel = jest.fn();

    app.renderAssertionModal({
      assertion_id: 'a1',
      screenshot_url: '/screenshots/assert_a1.png',
      anchor_step_id: 'tap_login',
      onSave,
      onCancel,
    });

    const modalRoot = document.getElementById('modal-root');
    const btnCancel = modalRoot.querySelector('#modal-btn-cancel');
    btnCancel.dispatchEvent(new window.Event('click'));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    // Modal should be unmounted.
    expect(document.getElementById('modal-btn-cancel')).toBeNull();
  });

  test('Escape key invokes onCancel() and unmounts the modal', () => {
    const onSave = jest.fn();
    const onCancel = jest.fn();

    app.renderAssertionModal({
      assertion_id: 'a1',
      screenshot_url: '/screenshots/assert_a1.png',
      anchor_step_id: 'tap_login',
      onSave,
      onCancel,
    });

    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSave).not.toHaveBeenCalled();
    // Modal should be unmounted.
    expect(document.getElementById('modal-btn-cancel')).toBeNull();
  });

  test('throws for an invalid screenshot_url (not starting with /screenshots/)', () => {
    expect(() => {
      app.renderAssertionModal({
        assertion_id: 'a1',
        screenshot_url: '/evil/path.png',
        anchor_step_id: 'tap_login',
        onSave: jest.fn(),
        onCancel: jest.fn(),
      });
    }).toThrow('renderAssertionModal: invalid screenshot_url');
  });
});
