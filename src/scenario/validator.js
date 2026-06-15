'use strict';

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

// Path to the canonical scenario schema, bundled inside the package.
// src/scenario/validator.js -> ../schemas/scenario_schema.json
const DEFAULT_SCHEMA_PATH = path.resolve(__dirname, '../schemas/scenario_schema.json');

function formatError(err) {
  const where = err.instancePath || '(root)';
  let msg = `${where} ${err.message}`;
  if (err.keyword === 'required' && err.params && err.params.missingProperty) {
    msg = `${where} is missing required property '${err.params.missingProperty}'`;
  } else if (err.keyword === 'enum' && err.params && Array.isArray(err.params.allowedValues)) {
    msg = `${where} ${err.message}: ${err.params.allowedValues.join(', ')}`;
  } else if (err.keyword === 'additionalProperties' && err.params) {
    msg = `${where} has unexpected property '${err.params.additionalProperty}'`;
  }
  return msg;
}

class ScenarioValidator {
  constructor({ schemaPath = DEFAULT_SCHEMA_PATH } = {}) {
    const schema = JSON.parse(fs.readFileSync(schemaPath, 'utf8'));
    const ajv = new Ajv({ allErrors: true, strict: false });
    this._validateFn = ajv.compile(schema);
  }

  validate(scenarioObject) {
    const valid = this._validateFn(scenarioObject);
    if (valid) {
      return { valid: true, errors: [] };
    }
    const errors = (this._validateFn.errors || []).map(formatError);
    return { valid: false, errors };
  }
}

module.exports = { ScenarioValidator, DEFAULT_SCHEMA_PATH };
