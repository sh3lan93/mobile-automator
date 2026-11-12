'use strict';

const {
  OBSERVATION_TYPES,
  parseObservation,
  parseCapture,
  parseAssertionVerdict,
  JUDGES,
  RUN_STATUSES,
  parseRunStatus,
} = require('../../../src/result/flags');

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

describe('parseAssertionVerdict (#275, B3)', () => {
  test('JUDGES is what an agent may claim: never mauto', () => {
    expect(JUDGES).toEqual(['agent', 'none']);
  });

  // [--pass, --judge] -> { status, judge } as a unit (plan decision 2). `judge`
  // is undefined for "no claim", never null.
  test.each([
    ['true', undefined, { status: 'passed', judge: undefined }],
    ['false', undefined, { status: 'failed', judge: undefined }],
    ['true', 'agent', { status: 'passed', judge: { by: 'agent' } }],
    ['false', 'agent', { status: 'failed', judge: { by: 'agent' } }],
    ['pending', undefined, { status: 'needs_agent', judge: { by: 'none' } }],
    ['pending', 'none', { status: 'needs_agent', judge: { by: 'none' } }],
  ])('--pass %p --judge %p records %p', (pass, judge, value) => {
    const r = parseAssertionVerdict(pass, judge);
    expect(r).toEqual({ value });
    if (value.judge === undefined) expect(r.value.judge).toBeUndefined();
  });

  test.each(['yes', 'TRUE', '', 'needs_agent', undefined])('rejects --pass %p, naming the flag and the choices', (raw) => {
    expect(parseAssertionVerdict(raw).error).toMatch(/--pass must be true \| false \| pending/);
  });

  test('--judge agent with pending is refused: an agent that judged has a verdict', () => {
    expect(parseAssertionVerdict('pending', 'agent').error).toMatch(/--judge agent needs a verdict/);
  });

  test.each(['true', 'false'])('--judge none with a decided verdict (%p) is refused', (pass) => {
    expect(parseAssertionVerdict(pass, 'none').error).toMatch(/--judge none means nobody decided/);
  });

  test.each(['mauto', 'Agent', ''])('rejects --judge %p', (raw) => {
    expect(parseAssertionVerdict('true', raw).error).toMatch(/--judge must be agent \| none/);
  });
});

describe('parseRunStatus', () => {
  test('accepts incomplete (#275)', () => {
    expect(parseRunStatus('incomplete')).toEqual({ value: 'incomplete' });
    expect(RUN_STATUSES).toContain('incomplete');
  });
});
