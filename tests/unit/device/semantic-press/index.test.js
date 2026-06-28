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
