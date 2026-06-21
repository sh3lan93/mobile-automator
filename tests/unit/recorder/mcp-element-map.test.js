'use strict';
const { mapMcpElement } = require('../../../tools/recorder/src/capture/mcp-element-map');
const { resolveElement } = require('../../../tools/recorder/src/capture/element-resolver');

describe('mapMcpElement', () => {
  test('maps mobile-mcp element to the recorder resolver shape', () => {
    const el = mapMcpElement({ type: 'android.widget.Button', text: '', label: 'Wireless Earbuds', identifier: 'home_product_card_p001', coordinates: { x: 0, y: 804, width: 640, height: 853 } });
    expect(el.bounds).toEqual([0, 804, 640, 1657]);
    expect(el.accessibility_label).toBe('Wireless Earbuds');
    expect(el.resource_id).toBeUndefined();        // agnostic: never carry identifier
  });
  test('handles null/empty input without throwing', () => {
    expect(() => mapMcpElement(null)).not.toThrow();
    expect(mapMcpElement(null).bounds).toBeNull();
    expect(mapMcpElement({}).bounds).toBeNull();
  });
  test('non-numeric coordinates yield null bounds', () => {
    expect(mapMcpElement({ label: 'x', coordinates: { x: 'bad', y: 0, width: 1, height: 1 } }).bounds).toBeNull();
  });
  test('resolveElement resolves a tapped target from a mapped element (no tap_unknown)', () => {
    const snapshot = { elements: [mapMcpElement({ type: 'android.widget.Button', label: 'Wireless Earbuds', identifier: 'x', coordinates: { x: 0, y: 804, width: 640, height: 853 } })] };
    const r = resolveElement(snapshot, 320, 1100);
    expect(r).not.toBeNull();
    expect(r.display_name).toBe('Wireless Earbuds');
    expect(r.is_unnamed).toBe(false);
  });
});
