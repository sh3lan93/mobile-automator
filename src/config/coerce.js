'use strict';

// Normalizes config values into the types config_schema.json declares.
//
// Two entry points, one contract:
//   coerceValue    — a raw CLI string on the way IN to `config set`.
//   normalizeConfig — a config object on the way OUT of `manager.load()`,
//                     healing values written before the schema existed (#136).
//
// The comma-splitting rule is what makes the setup guide's long-standing
// `mauto config set environments <env1,env2,...>` prose correct instead of
// silently producing a string.

const { declaredTypesAt, LIST_KEY_PATHS } = require('./schema');

function splitList(raw) {
  return String(raw)
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function tryJson(raw) {
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (_) {
    return { ok: false };
  }
}

function coerceValue(dottedKey, rawValue) {
  // A bare `null` argument always means JSON null, regardless of the key's
  // declared type. It is `validateAt` — not this function — that decides
  // whether the key is allowed to hold it: keys declared nullable accept it,
  // everything else gets a loud invalid_input instead of silently storing the
  // string "null" (see #136 fix-wave, Important 2).
  if (String(rawValue).trim() === 'null') return null;

  const types = declaredTypesAt(dottedKey);

  // Undeclared key: preserve the historical lenient behavior exactly.
  if (types.length === 0) {
    const parsed = tryJson(rawValue);
    return parsed.ok ? parsed.value : rawValue;
  }

  if (types.includes('array')) {
    const parsed = tryJson(rawValue);
    if (parsed.ok && Array.isArray(parsed.value)) return parsed.value;
    return splitList(rawValue);
  }

  if (types.includes('string')) {
    // Never let JSON.parse retype a string key (a project literally named
    // "12345" stays a string).
    return String(rawValue);
  }

  const parsed = tryJson(rawValue);
  return parsed.ok ? parsed.value : rawValue;
}

function getPath(obj, parts) {
  let cur = obj;
  for (const part of parts) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

function setPath(obj, parts, value) {
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (cur[parts[i]] == null || typeof cur[parts[i]] !== 'object') return;
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = value;
}

// Heals every declared list path that holds a string. Values that are already
// arrays — or are neither string nor array — are left exactly as found; this
// repairs the known drift, it does not guess at anything else.
function normalizeConfig(cfg) {
  if (cfg == null || typeof cfg !== 'object') return cfg;
  const out = JSON.parse(JSON.stringify(cfg));
  for (const listPath of LIST_KEY_PATHS) {
    const parts = listPath.split('.');
    const current = getPath(out, parts);
    if (typeof current === 'string') {
      setPath(out, parts, splitList(current));
    }
  }
  return out;
}

module.exports = { coerceValue, normalizeConfig, splitList };
