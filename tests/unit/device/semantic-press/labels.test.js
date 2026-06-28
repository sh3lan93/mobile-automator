const { findByLabels, ALLOW_LABELS, DENY_LABELS } = require('../../../../src/device/semantic-press/labels');

describe('findByLabels', () => {
  const els = [
    { text: 'Cancel', accessibility_label: null, center: [10, 20] },
    { text: null, accessibility_label: 'Allow', center: [30, 40] },
  ];

  test('matches on accessibility_label, case-insensitively', () => {
    const hit = findByLabels(els, ALLOW_LABELS.android);
    expect(hit).toEqual({ element: els[1], label: 'Allow' });
  });

  test('normalizes curly apostrophes so "Don\'t Allow" matches', () => {
    const deny = [{ text: "Don't Allow", accessibility_label: null, center: [1, 2] }];
    const hit = findByLabels(deny, DENY_LABELS.ios);
    expect(hit.element).toBe(deny[0]);
  });

  test('returns null when nothing matches', () => {
    expect(findByLabels(els, ['nope'])).toBeNull();
  });
});
