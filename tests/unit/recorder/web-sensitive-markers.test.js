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

const CAUTION_TOOLTIP = 'Sensitive input. Click to edit value before Save.';

describe('recorder GUI: sensitive-input caution markers (slice #9)', () => {
  beforeEach(() => {
    document.body.innerHTML = '<ul id="step-list"></ul>';
    app._resetSensitiveState();
  });

  test('renders a .caution span with the spec tooltip for sensitive type steps', () => {
    const li = app.renderStepRow({
      id: 'type_password',
      index: 1,
      action: 'type',
      value: 'p4ssw0rd!',
      field_label: 'Password',
      sensitive: true,
    });

    const caution = li.querySelector('.caution');
    expect(caution).not.toBeNull();
    expect(caution.textContent).toBe('⚠');
    expect(caution.getAttribute('title')).toBe(CAUTION_TOOLTIP);
    expect(caution.getAttribute('aria-label')).toBe(CAUTION_TOOLTIP);
    expect(caution.getAttribute('role')).toBe('img');
  });

  test('does NOT render a caution span when sensitive is false', () => {
    const li = app.renderStepRow({
      id: 'type_email',
      index: 2,
      action: 'type',
      value: 'a@b.com',
      field_label: 'Email',
      sensitive: false,
    });
    expect(li.querySelector('.caution')).toBeNull();
  });

  test('does NOT render a caution span when --allow-sensitive-input is set', () => {
    app._setAllowSensitiveInput(true);
    const li = app.renderStepRow({
      id: 'type_password',
      index: 3,
      action: 'type',
      value: 'p4ssw0rd!',
      field_label: 'Password',
      sensitive: true,
    });
    expect(li.querySelector('.caution')).toBeNull();
  });

  test('caution span sits between .step-value and .step-into for visual association', () => {
    const li = app.renderStepRow({
      id: 'type_password',
      index: 4,
      action: 'type',
      value: 'p4ss!',
      field_label: 'Password',
      sensitive: true,
    });

    const spans = [...li.children];
    const valueIdx = spans.findIndex((el) => el.classList && el.classList.contains('step-value'));
    const cautionIdx = spans.findIndex((el) => el.classList && el.classList.contains('caution'));
    const intoIdx = spans.findIndex((el) => el.classList && el.classList.contains('step-into'));

    expect(valueIdx).toBeGreaterThanOrEqual(0);
    expect(cautionIdx).toBe(valueIdx + 1);
    expect(intoIdx).toBe(cautionIdx + 1);
  });

  test('applyValueEdited removes the caution span for the edited step', () => {
    app.appendStep({
      id: 'type_password',
      index: 1,
      action: 'type',
      value: 'p4ss!',
      field_label: 'Password',
      sensitive: true,
    });
    const li = document.querySelector('[data-step-id="type_password"]');
    expect(li.querySelector('.caution')).not.toBeNull();

    app.applyValueEdited(document, { step_id: 'type_password', new_value: '${env.PASSWORD}' });

    expect(li.querySelector('.caution')).toBeNull();
  });

  test('applyValueEdited does not affect caution on a different (still-flagged) step', () => {
    app.appendStep({ id: 'type_pw1', index: 1, action: 'type', value: 'a', field_label: 'Password', sensitive: true });
    app.appendStep({ id: 'type_pw2', index: 2, action: 'type', value: 'b', field_label: 'Password', sensitive: true });

    app.applyValueEdited(document, { step_id: 'type_pw1', new_value: '${env.A}' });

    const pw1 = document.querySelector('[data-step-id="type_pw1"]');
    const pw2 = document.querySelector('[data-step-id="type_pw2"]');
    expect(pw1.querySelector('.caution')).toBeNull();
    expect(pw2.querySelector('.caution')).not.toBeNull();
  });

  test('applyValueEdited rewrites the value span literally (no bullets after edit)', () => {
    app.appendStep({
      id: 'type_password',
      index: 1,
      action: 'type',
      value: 'p4ss!',
      field_label: 'Password',
      sensitive: true,
    });
    app.applyValueEdited(document, { step_id: 'type_password', new_value: '${env.PASSWORD}' });

    const li = document.querySelector('[data-step-id="type_password"]');
    const valueSpan = li.querySelector('.step-value');
    expect(valueSpan.textContent).toBe('"${env.PASSWORD}"');
    expect(valueSpan.textContent).not.toMatch(/•/);
  });

  test('edit then re-edit to the original literal still leaves caution cleared (intent-based)', () => {
    app.appendStep({
      id: 'type_password',
      index: 1,
      action: 'type',
      value: 'p4ss!',
      field_label: 'Password',
      sensitive: true,
    });
    app.applyValueEdited(document, { step_id: 'type_password', new_value: '${env.X}' });
    app.applyValueEdited(document, { step_id: 'type_password', new_value: 'p4ss!' });

    const li = document.querySelector('[data-step-id="type_password"]');
    expect(li.querySelector('.caution')).toBeNull();
  });

  test('renderStepRow on a sensitive step is idempotent re-rendering does not duplicate caution spans', () => {
    // The second render replaces a fresh row (callers control mounting); regression
    // guard against the future bug of accidentally appending two cautions.
    const li1 = app.renderStepRow({ id: 'type_pw', index: 1, action: 'type', value: 'x', field_label: 'Password', sensitive: true });
    const li2 = app.renderStepRow({ id: 'type_pw', index: 1, action: 'type', value: 'x', field_label: 'Password', sensitive: true });
    expect(li1.querySelectorAll('.caution').length).toBe(1);
    expect(li2.querySelectorAll('.caution').length).toBe(1);
  });

  test('applyValueEdited on a non-sensitive step is a no-op for caution UI', () => {
    app.appendStep({ id: 'type_email', index: 1, action: 'type', value: 'a@b.com', field_label: 'Email', sensitive: false });
    expect(document.querySelector('[data-step-id="type_email"] .caution')).toBeNull();

    app.applyValueEdited(document, { step_id: 'type_email', new_value: 'c@d.com' });

    expect(document.querySelector('[data-step-id="type_email"] .caution')).toBeNull();
  });
});
