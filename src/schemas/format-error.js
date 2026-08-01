'use strict';

// Ajv error -> one human-readable sentence. Shared by the scenario validator
// (`mauto validate`) and the config validator (`mauto config set`) so a schema
// violation reads the same wherever it surfaces.
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

module.exports = { formatError };
