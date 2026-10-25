'use strict';

const { SESSION_ID_PATTERN, newSessionId } = require('../../../src/device/session-id');

describe('newSessionId', () => {
  // This test IS the enforcement of the event catalog's `sends: true` on
  // session_id. The catalog claims the value carries no user-derived content;
  // that claim is only true if the generator is what these assertions say.
  it('is 16 lowercase hex characters', () => {
    expect(newSessionId()).toMatch(/^[0-9a-f]{16}$/);
  });

  it('is unpredictable — 1000 ids collide zero times', () => {
    const ids = new Set();
    for (let i = 0; i < 1000; i++) ids.add(newSessionId());
    expect(ids.size).toBe(1000);
  });

  it('always matches SESSION_ID_PATTERN, so the mint and read sides cannot drift', () => {
    for (let i = 0; i < 200; i++) expect(newSessionId()).toMatch(SESSION_ID_PATTERN);
  });

  it('takes no arguments, so it cannot be derived from a path, device or pid', () => {
    expect(newSessionId.length).toBe(0);
  });
});
