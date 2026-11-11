'use strict';

const { noJudge } = require('../../../src/run/judge');

test('noJudge is named none, frozen, and never decides', async () => {
  expect(noJudge.name).toBe('none');
  expect(Object.isFrozen(noJudge)).toBe(true);
  await expect(noJudge.judge({ id: 'a', type: 'visual_state' }, { elements: [] })).resolves.toBeNull();
});
