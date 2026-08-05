'use strict';

const { OBSERVATION_TYPES, parseObservation, parseCapture, parseBool } = require('../../../src/result/flags');

describe('parseObservation', () => {
  test('splits <type>:<message>', () => {
    expect(parseObservation('regression:logo is gone').value)
      .toEqual({ type: 'regression', message: 'logo is gone' });
  });

  test('keeps colons inside the message (splits on the FIRST colon only)', () => {
    expect(parseObservation('state_context:dark mode: reference was light').value)
      .toEqual({ type: 'state_context', message: 'dark mode: reference was light' });
  });

  test('rejects an unknown type', () => {
    expect(parseObservation('typo:something').error).toMatch(/unknown observation type "typo"/);
  });

  test('rejects a spec with no colon', () => {
    expect(parseObservation('regression').error).toMatch(/<type>:<message>/);
  });

  test('rejects an empty message', () => {
    expect(parseObservation('regression:   ').error).toMatch(/empty message/);
  });

  test('exposes exactly the three schema observation types', () => {
    expect(OBSERVATION_TYPES).toEqual(['regression', 'flakiness', 'state_context']);
  });
});

describe('parseCapture', () => {
  test('splits <name>=<value>', () => {
    expect(parseCapture('order_id=A-1729').value).toEqual({ name: 'order_id', value: 'A-1729' });
  });

  test('keeps = inside the value', () => {
    expect(parseCapture('token=abc=def').value).toEqual({ name: 'token', value: 'abc=def' });
  });

  test('preserves an empty value (a legitimately empty captured field)', () => {
    expect(parseCapture('note=').value).toEqual({ name: 'note', value: '' });
  });

  test('rejects a spec with no =', () => {
    expect(parseCapture('order_id').error).toMatch(/<name>=<value>/);
  });

  test('rejects an empty name', () => {
    expect(parseCapture('=x').error).toMatch(/empty variable name/);
  });
});

describe('parseBool', () => {
  test('accepts the two literals', () => {
    expect(parseBool('true', '--pass').value).toBe(true);
    expect(parseBool('false', '--pass').value).toBe(false);
  });

  test('rejects anything else, naming the flag', () => {
    expect(parseBool('yes', '--pass').error).toMatch(/--pass must be "true" or "false"/);
  });
});
