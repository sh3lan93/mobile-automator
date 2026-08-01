'use strict';

// Type lookup + per-key validation for the workspace config.
//
// config_schema.json is the single source of truth for what shape each config
// key holds. This module is the only reader of that fact: the coercion layer
// asks it "what type is this key?" and the CLI asks it "is this value valid?".
// Nothing else hard-codes a config key's type.
//
// Validation is deliberately PER-KEY, not whole-document: a config carrying
// unrelated pre-existing drift must not block an unrelated `config set`.

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const { formatError } = require('../schemas/format-error');

const CONFIG_SCHEMA_PATH = path.resolve(__dirname, '../schemas/config_schema.json');

const schema = JSON.parse(fs.readFileSync(CONFIG_SCHEMA_PATH, 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: false });

// Resolve a local `$ref` ("#/definitions/stringList") one hop. The config
// schema only ever uses single-hop local refs; anything else is left as-is and
// Ajv resolves it at validation time.
function deref(node) {
  if (!node || typeof node !== 'object' || typeof node.$ref !== 'string') return node;
  const parts = node.$ref.replace(/^#\//, '').split('/');
  let cur = schema;
  for (const part of parts) {
    if (cur == null) return node;
    cur = cur[part];
  }
  return cur || node;
}

// Walk `properties` down a dotted path. Undeclared path -> null.
function subschemaAt(dottedKey) {
  const parts = String(dottedKey).split('.');
  let node = schema;
  for (const part of parts) {
    node = deref(node);
    if (!node || !node.properties || !node.properties[part]) return null;
    node = node.properties[part];
  }
  const resolved = deref(node);
  return resolved || null;
}

function declaredTypesAt(dottedKey) {
  const sub = subschemaAt(dottedKey);
  if (!sub || sub.type === undefined) return [];
  return Array.isArray(sub.type) ? [...sub.type] : [sub.type];
}

// Every array-typed dotted path in the schema, flat and nested. Drives both
// read-side healing and the structural lint guard.
function collectListPaths(node, prefix, out) {
  const resolved = deref(node);
  if (!resolved || !resolved.properties) return out;
  for (const [name, child] of Object.entries(resolved.properties)) {
    const childPath = prefix ? `${prefix}.${name}` : name;
    const rc = deref(child);
    if (!rc) continue;
    if (rc.type === 'array') out.push(childPath);
    else if (rc.type === 'object' || rc.properties) collectListPaths(rc, childPath, out);
  }
  return out;
}

const LIST_KEY_PATHS = collectListPaths(schema, '', []);

// Compiled per-path validators, built lazily and cached.
const compiled = new Map();

function validateAt(dottedKey, value) {
  const sub = subschemaAt(dottedKey);
  if (!sub) return { valid: true, errors: [] }; // undeclared key -> always allowed
  if (!compiled.has(dottedKey)) {
    compiled.set(dottedKey, ajv.compile(sub));
  }
  const fn = compiled.get(dottedKey);
  const valid = fn(value);
  if (valid) return { valid: true, errors: [] };
  return { valid: false, errors: (fn.errors || []).map(formatError) };
}

module.exports = {
  CONFIG_SCHEMA_PATH,
  subschemaAt,
  declaredTypesAt,
  LIST_KEY_PATHS,
  validateAt,
};
