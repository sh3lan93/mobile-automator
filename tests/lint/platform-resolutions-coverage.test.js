// tests/lint/platform-resolutions-coverage.test.js
const fs = require('fs');
const path = require('path');

const SEMANTIC_ACTIONS = [
  'press_back',
  'dismiss_keyboard',
  'grant_permission',
  'deny_permission',
];

describe('platform-resolutions.md coverage', () => {
  const filePath = path.resolve(
    __dirname, '..', '..', 'templates', 'references', 'platform-resolutions.md'
  );
  const content = fs.readFileSync(filePath, 'utf8');

  // Parse table rows: lines that start with "| `"
  const rows = content
    .split('\n')
    .filter(line => /^\|\s*`[a-z_]+`\s*\|/.test(line))
    .map(line => {
      const cells = line.split('|').map(c => c.trim());
      // cells[0] is empty (leading |), [1]=action, [2]=android, [3]=ios
      const actionMatch = cells[1].match(/`([a-z_]+)`/);
      return {
        action: actionMatch ? actionMatch[1] : null,
        android: cells[2] || '',
        ios: cells[3] || '',
      };
    });

  it('every semantic action from the schema has a row', () => {
    const tableActions = rows.map(r => r.action).filter(Boolean);
    for (const action of SEMANTIC_ACTIONS) {
      expect(tableActions).toContain(action);
    }
  });

  it('no row has empty Android or iOS column', () => {
    for (const row of rows) {
      expect(row.android.length).toBeGreaterThan(0);
      expect(row.ios.length).toBeGreaterThan(0);
      expect(row.android.toLowerCase()).not.toBe('tbd');
      expect(row.ios.toLowerCase()).not.toBe('tbd');
    }
  });

  it('table contains exactly the documented semantic actions (no extras)', () => {
    const tableActions = rows.map(r => r.action).filter(Boolean).sort();
    const expected = [...SEMANTIC_ACTIONS].sort();
    expect(tableActions).toEqual(expected);
  });
});
