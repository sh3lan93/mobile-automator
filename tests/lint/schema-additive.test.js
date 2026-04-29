// tests/lint/schema-additive.test.js
const fs = require('fs');
const path = require('path');

describe('Schema additive over v2.0', () => {
  const fixturePath = path.resolve(
    __dirname, '..', 'fixtures', 'scenario_schema_v2.0.json'
  );
  const currentPath = path.resolve(
    __dirname, '..', '..',
    'templates', 'mobile-automator-generator', 'references', 'scenario_schema.json'
  );
  const v2 = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  const cur = JSON.parse(fs.readFileSync(currentPath, 'utf8'));

  function collectEnumValues(node, path, results = []) {
    if (node && typeof node === 'object') {
      if (Array.isArray(node.enum) && path.endsWith('.type')) {
        results.push({ path, values: node.enum });
      }
      for (const [k, v] of Object.entries(node)) {
        collectEnumValues(v, `${path}.${k}`, results);
      }
    }
    return results;
  }

  it('every action.type / type enum value in v2.0 is preserved in current', () => {
    const v2Enums = collectEnumValues(v2, '$');
    const curEnums = collectEnumValues(cur, '$');
    const curByPath = Object.fromEntries(curEnums.map(e => [e.path, e.values]));
    for (const { path, values } of v2Enums) {
      const currentValues = curByPath[path] || [];
      const missing = values.filter(v => !currentValues.includes(v));
      expect(missing).toEqual([]); // never remove enum values
    }
  });

  it('current schema preserves "2.0" in $schema_version enum', () => {
    // Walk the schema to find the $schema_version property's enum.
    function findEnum(node) {
      if (node && typeof node === 'object') {
        if (node.properties && node.properties.$schema_version && Array.isArray(node.properties.$schema_version.enum)) {
          return node.properties.$schema_version.enum;
        }
        for (const v of Object.values(node)) {
          const found = findEnum(v);
          if (found) return found;
        }
      }
      return null;
    }
    const enumValues = findEnum(cur);
    expect(enumValues).toContain('2.0');
  });
});
