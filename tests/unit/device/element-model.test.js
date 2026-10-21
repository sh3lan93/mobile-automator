'use strict';

const fs = require('fs');
const path = require('path');

const { normalize, parseElements, decodeEntities, collapseUnlabeledTwins } = require('../../../src/device/element-model');

describe('element-model.normalize', () => {
  test('normalizes a bounds-based element and computes center midpoint', () => {
    const out = normalize([
      {
        text: 'Login',
        accessibility_label: 'login-button',
        bounds: [0, 0, 100, 50],
        type: 'android.widget.Button',
      },
    ]);
    expect(out).toEqual([
      {
        text: 'Login',
        accessibility_label: 'login-button',
        bounds: [0, 0, 100, 50],
        center: [50, 25],
        type: 'android.widget.Button',
      },
    ]);
  });

  test('accepts rect:{x,y,width,height} and derives bounds + center', () => {
    const out = normalize([
      { label: 'Box', rect: { x: 10, y: 20, width: 40, height: 60 }, type: 'View' },
    ]);
    expect(out[0].bounds).toEqual([10, 20, 50, 80]);
    expect(out[0].center).toEqual([30, 50]);
    // `label` is mapped onto accessibility_label
    expect(out[0].accessibility_label).toBe('Box');
  });

  test('accepts a coordinates array as bounds', () => {
    const out = normalize([{ coordinates: [5, 5, 15, 25], text: 'C' }]);
    expect(out[0].bounds).toEqual([5, 5, 15, 25]);
    expect(out[0].center).toEqual([10, 15]);
  });

  test('defaults missing text and label to null', () => {
    const out = normalize([{ bounds: [0, 0, 10, 10], type: 'View' }]);
    expect(out[0].text).toBeNull();
    expect(out[0].accessibility_label).toBeNull();
  });

  test('STRIPS resource_id and identifier (platform-agnostic invariant)', () => {
    const out = normalize([
      {
        text: 'X',
        bounds: [0, 0, 2, 2],
        resource_id: 'com.app:id/login',
        identifier: 'loginBtn',
        type: 'Button',
      },
    ]);
    const keys = Object.keys(out[0]);
    expect(keys).not.toContain('resource_id');
    expect(keys).not.toContain('identifier');
    // exact key set is the agnostic shape
    expect(keys.sort()).toEqual(
      ['accessibility_label', 'bounds', 'center', 'text', 'type'].sort()
    );
  });

  test('tolerates empty / non-array input', () => {
    expect(normalize([])).toEqual([]);
    expect(normalize(undefined)).toEqual([]);
    expect(normalize(null)).toEqual([]);
  });

  test('skips entries with no resolvable bounds', () => {
    const out = normalize([{ text: 'no-bounds' }, { bounds: [0, 0, 4, 4] }]);
    expect(out).toHaveLength(1);
    expect(out[0].bounds).toEqual([0, 0, 4, 4]);
  });
});

describe('normalize with mobile-mcp coordinates object', () => {
  test('maps coordinates:{x,y,width,height} to bounds + center, label to accessibility_label', () => {
    const out = normalize([{ type: 'android.widget.Button', text: '', label: 'Wireless Earbuds', identifier: 'home_product_card_p001', coordinates: { x: 10, y: 20, width: 100, height: 50 } }]);
    expect(out).toHaveLength(1);
    expect(out[0].bounds).toEqual([10, 20, 110, 70]);
    expect(out[0].center).toEqual([60, 45]);
    expect(out[0].accessibility_label).toBe('Wireless Earbuds');
  });
  test('never surfaces identifier (resource-id) as a field', () => {
    const out = normalize([{ label: 'x', identifier: 'res_id_secret', coordinates: { x: 0, y: 0, width: 2, height: 2 } }]);
    expect(JSON.stringify(out)).not.toContain('res_id_secret');
  });

  test('rejects non-finite coordinates (NaN/garbage)', () => {
    const out = normalize([
      { label: 'bad', coordinates: { x: NaN, y: 0, width: 10, height: 10 } },
      { label: 'bad2', bounds: ['x', 'y', 1, 2] },
    ]);
    expect(out).toEqual([]);
  });
});

describe('parseElements', () => {
  const FIXTURE = 'Found these elements on screen: ' + JSON.stringify([
    { type: 'android.view.View', text: '', label: 'Sample Shop', coordinates: { x: 48, y: 198, width: 388, height: 84 } },
    { type: 'android.widget.Button', text: '', label: '', identifier: 'home_product_card_p001', coordinates: { x: 0, y: 804, width: 640, height: 853 } },
  ]);
  test('parses the prefixed string form', () => {
    const els = parseElements(FIXTURE);
    expect(els).toHaveLength(2);
    expect(els[0].label).toBe('Sample Shop');
  });
  test('passes a bare array through', () => {
    expect(parseElements([{ label: 'x' }])).toEqual([{ label: 'x' }]);
  });
  test('handles the {elements:[...]} envelope', () => {
    expect(parseElements({ elements: [{ label: 'y' }] })).toEqual([{ label: 'y' }]);
  });
  // Non-string, non-array values carry no element text at all, so [] is honest.
  test('returns [] for null / non-string non-array input', () => {
    expect(parseElements(null)).toEqual([]);
    expect(parseElements(undefined)).toEqual([]);
    expect(parseElements(42)).toEqual([]);
    expect(parseElements({ nope: true })).toEqual([]);
  });
  test('returns [] for an empty / whitespace-only string', () => {
    expect(parseElements('')).toEqual([]);
    expect(parseElements('  \n ')).toEqual([]);
  });
  test('accepts a genuinely empty screen', () => {
    expect(parseElements('Found these elements on screen: []')).toEqual([]);
  });
  // Previously this returned [] silently, which surfaced as `ok:true` with an
  // empty screen and sent the failure probe after the app (#199).
  test('throws on non-empty text it cannot parse', () => {
    expect(() => parseElements('totally not elements')).toThrow(/element list could not be parsed/i);
  });
  test('throws on the mobile-mcp 1.0.5 text format, with an excerpt and a hint', () => {
    const TEXT_1_0_5 =
      'One element per line: @ref Type text= label= name= value= id= at=x,y size=WxH [focused] [selected] [checked] [disabled]\n' +
      '@e1 Button text="Login" at=10,20 size=100x40';
    let err;
    try { parseElements(TEXT_1_0_5); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(Error);
    expect(err.message).toMatch(/element list could not be parsed/i);
    expect(err.message).toContain('One element per line');
    // Excerpt is truncated so a huge dump never floods the envelope.
    expect(err.message).not.toContain('@e1 Button');
    expect(err.hint).toMatch(/output format/i);
  });
  test('truncates a long unparseable payload to a short excerpt', () => {
    const long = 'x'.repeat(5000);
    let err;
    try { parseElements(long); } catch (e) { err = e; }
    expect(err.message.length).toBeLessThan(300);
  });
  test('tolerates labels containing brackets/quotes', () => {
    const tricky = 'Found these elements on screen: ' + JSON.stringify([{ label: 'a]b"c', coordinates: { x: 0, y: 0, width: 1, height: 1 } }]);
    expect(parseElements(tricky)[0].label).toBe('a]b"c');
  });
});

describe('decodeEntities', () => {
  test('decodes decimal and hex numeric references', () => {
    expect(decodeEntities('Home&#10;Tab 1 of 3')).toBe('Home\nTab 1 of 3');
    expect(decodeEntities('a&#x0A;b&#X41;')).toBe('a\nbA');
  });
  test('decodes the five XML named entities', () => {
    expect(decodeEntities('&amp;&lt;&gt;&quot;&apos;')).toBe('&<>"\'');
  });
  test('decodes exactly once (no double-unescape)', () => {
    expect(decodeEntities('&amp;#10;')).toBe('&#10;');
    expect(decodeEntities('&amp;amp;')).toBe('&amp;');
  });
  test('leaves unknown named entities and stray ampersands untouched', () => {
    expect(decodeEntities('&nbsp;Fish &chips & co')).toBe('&nbsp;Fish &chips & co');
  });
  test('leaves an out-of-range code point untouched', () => {
    expect(decodeEntities('&#x110000;')).toBe('&#x110000;');
  });
  test('passes non-strings through', () => {
    expect(decodeEntities(null)).toBeNull();
    expect(decodeEntities(undefined)).toBeUndefined();
  });
});

describe('normalize decodes character references', () => {
  test('in text, accessibility_label and the label fallback', () => {
    const out = normalize([
      { text: 'Tom &amp; Jerry', accessibility_label: 'Home&#10;Tab 1 of 3', bounds: [0, 0, 1, 1] },
      { label: 'More&#x0A;Tab 3 of 3', bounds: [0, 0, 2, 2] },
    ]);
    expect(out[0].text).toBe('Tom & Jerry');
    expect(out[0].accessibility_label).toBe('Home\nTab 1 of 3');
    expect(out[1].accessibility_label).toBe('More\nTab 3 of 3');
  });
});

describe('collapseUnlabeledTwins (via normalize)', () => {
  const B = [48, 372, 1232, 540];
  test('drops an unlabeled element that shares bounds with a labeled one, keeping order', () => {
    const out = normalize([
      { label: 'Header', bounds: [0, 0, 5, 5] },
      { bounds: B, type: 'EditText' },
      { label: 'Name', bounds: B, type: 'EditText' },
      { text: 'After', bounds: [0, 10, 5, 15] },
    ]);
    expect(out.map((e) => e.text || e.accessibility_label)).toEqual(['Header', 'Name', 'After']);
  });
  test('a text-only twin also counts as labeled', () => {
    const out = normalize([{ text: 'Go', bounds: B }, { bounds: B }]);
    expect(out).toHaveLength(1);
    expect(out[0].text).toBe('Go');
  });
  test('keeps two labeled elements with identical bounds', () => {
    const out = normalize([{ label: 'A', bounds: B }, { text: 'B', bounds: B }]);
    expect(out).toHaveLength(2);
  });
  test('keeps an unlabeled element with no labeled twin', () => {
    const out = normalize([{ bounds: B, type: 'Button' }, { label: 'X', bounds: [0, 0, 1, 1] }]);
    expect(out).toHaveLength(2);
    expect(out[0].type).toBe('Button');
  });
  test('keeps unlabeled same-bounds elements when none is labeled', () => {
    expect(normalize([{ bounds: B }, { bounds: B }])).toHaveLength(2);
  });
  test('is exported as a pure helper over normalized elements', () => {
    const lab = { text: null, accessibility_label: 'L', bounds: B, center: [0, 0], type: null };
    const bare = { text: null, accessibility_label: null, bounds: [...B], center: [0, 0], type: null };
    expect(collapseUnlabeledTwins([bare, lab])).toEqual([lab]);
  });
});

describe('normalize over the legacy-robot More screen (#251)', () => {
  const FIXTURE = path.join(__dirname, '..', '..', 'fixtures', 'device', 'sample-app-probe', 'more.legacy-robot.envelope.json');
  // Re-shape the captured envelope into the raw engine form (`label` +
  // `coordinates`) so the whole normalize path, escaped labels included, runs.
  const raw = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).data.map((e) => ({
    type: e.type,
    text: e.text === null ? '' : e.text,
    label: e.accessibility_label === null ? '' : e.accessibility_label,
    coordinates: { x: e.bounds[0], y: e.bounds[1], width: e.bounds[2] - e.bounds[0], height: e.bounds[3] - e.bounds[1] },
  }));
  const out = normalize(raw);

  test.each(['Name', 'Email', 'Search products', 'Notifications'])('exactly one element labeled %s', (label) => {
    expect(out.filter((e) => e.accessibility_label === label)).toHaveLength(1);
  });
  test('no unlabeled element survives beside a labeled twin', () => {
    const labeled = out.filter((e) => e.text || e.accessibility_label).map((e) => e.bounds.join());
    const bareTwins = out.filter((e) => !e.text && !e.accessibility_label && labeled.includes(e.bounds.join()));
    expect(bareTwins).toEqual([]);
  });
  test('nav labels are decoded to real newlines', () => {
    expect(out.map((e) => e.accessibility_label)).toContain('Home\nTab 1 of 3');
    expect(JSON.stringify(out)).not.toContain('&#10;');
  });
});
