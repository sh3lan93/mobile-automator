'use strict';

// A value parsed from a file mauto does not fully trust (a result file, the
// telemetry spool, the consent record) as a JSON object: not null, not an
// array, not a primitive. One predicate, so every reader of hand-editable JSON
// draws the line in the same place.
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

module.exports = { isPlainObject };
