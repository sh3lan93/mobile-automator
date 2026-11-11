const {
  selectResolver,
  isSemanticAction,
  SEMANTIC_ACTIONS,
  ACTION_METHOD,
} = require('../../../../src/device/semantic-press');
const { AndroidResolver, IOSResolver, SemanticResolutionError } =
  require('../../../../src/device/semantic-press/resolver');

describe('selectResolver', () => {
  test('returns the Android strategy for android', () => {
    expect(selectResolver('android', {})).toBeInstanceOf(AndroidResolver);
  });
  test('returns the iOS strategy for ios', () => {
    expect(selectResolver('ios', {})).toBeInstanceOf(IOSResolver);
  });
  test('hard-fails for an unsupported platform', () => {
    expect(() => selectResolver('windows', {})).toThrow(SemanticResolutionError);
  });
});

describe('isSemanticAction', () => {
  test('recognizes all four semantic tokens', () => {
    for (const a of SEMANTIC_ACTIONS) expect(isSemanticAction(a)).toBe(true);
  });
  test('rejects hardware buttons', () => {
    expect(isSemanticAction('BACK')).toBe(false);
  });
});

describe('completeness guard', () => {
  test('every semantic action maps to a method implemented by both strategies', () => {
    for (const action of SEMANTIC_ACTIONS) {
      const method = ACTION_METHOD[action];
      expect(typeof AndroidResolver.prototype[method]).toBe('function');
      expect(typeof IOSResolver.prototype[method]).toBe('function');
    }
  });
});

describe('pressSemantic', () => {
  const { pressSemantic } = require('../../../../src/device/semantic-press');

  function fakeBridge(platform) {
    const calls = [];
    return {
      calls,
      getPlatform: async () => platform,
      pressButton: async (b) => { calls.push(['pressButton', b]); },
    };
  }

  test('resolves press_back on android to the BACK button and reports the mechanism', async () => {
    const bridge = fakeBridge('android');
    await expect(pressSemantic(bridge, 'press_back')).resolves.toEqual({ platform: 'android', mechanism: 'button:BACK' });
    expect(bridge.calls).toEqual([['pressButton', 'BACK']]);
  });

  test('dispatches through ACTION_METHOD to the platform strategy', async () => {
    const bridge = fakeBridge('android');
    const spy = jest.spyOn(AndroidResolver.prototype, 'dismissKeyboard');
    try {
      await pressSemantic(bridge, 'dismiss_keyboard');
      expect(spy).toHaveBeenCalledTimes(1);
    } finally {
      spy.mockRestore();
    }
  });

  test('hard-fails on an unsupported platform without touching the device', async () => {
    const bridge = fakeBridge('windows');
    await expect(pressSemantic(bridge, 'press_back')).rejects.toBeInstanceOf(SemanticResolutionError);
    expect(bridge.calls).toEqual([]);
  });

  test('rejects a token that is not a semantic action', async () => {
    const bridge = fakeBridge('android');
    await expect(pressSemantic(bridge, 'BACK')).rejects.toBeInstanceOf(SemanticResolutionError);
    expect(bridge.calls).toEqual([]);
  });
});
