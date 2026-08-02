'use strict';

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const { formatError } = require('../schemas/format-error');

// Path to the canonical scenario schema, bundled inside the package.
// src/scenario/validator.js -> ../schemas/scenario_schema.json
const DEFAULT_SCHEMA_PATH = path.resolve(__dirname, '../schemas/scenario_schema.json');

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
