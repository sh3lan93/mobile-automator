'use strict';

// observe(): the one place `mauto assert` and `mauto run` read what the
// evaluator needs off the device (#276).

const { observe } = require('../../../src/assertion/observe');
const { SCREEN_SIZE_TYPES } = require('../../../src/assertion/evaluator');
const { makeFakeBridge } = require('../../helpers/fake-bridge');

const ELEMENTS = [{ text: 'Home', accessibility_label: null, bounds: [0, 0, 10, 10] }];
const SIZE = { width: 1280, height: 2856 };

test.each([...SCREEN_SIZE_TYPES])('%s: reads the elements and the screen size', async (type) => {
  const b = makeFakeBridge({ elements: [ELEMENTS], screenSize: SIZE });
  expect(await observe(b, type)).toEqual({ elements: ELEMENTS, screenSize: SIZE });
  expect(b.of('getScreenSize')).toHaveLength(1);
});

test.each(['element_exists', 'permission_dialog_shown', 'visual_state'])('%s: never fetches the screen size', async (type) => {
  const b = makeFakeBridge({ elements: [ELEMENTS], screenSize: SIZE });
  expect(await observe(b, type)).toEqual({ elements: ELEMENTS, screenSize: null });
  expect(b.of('getScreenSize')).toHaveLength(0);
});

test('a device error propagates for the caller to classify', async () => {
  const boom = new Error('no screen size');
  const b = makeFakeBridge({ elements: [ELEMENTS], methods: { getScreenSize: () => { throw boom; } } });
  await expect(observe(b, 'screen_title')).rejects.toBe(boom);
});
