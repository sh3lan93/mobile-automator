'use strict';

// Whether a value parsed from a file mauto does not fully trust is a JSON
// object: not null, not an array, not a primitive. A shared predicate, used by
// the telemetry spool (src/observe/event.js), the consent record
// (src/observe/consent.js) and the JUnit export (src/result/junit.js), so
// those readers draw the line in the same place.
const isPlainObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

module.exports = { isPlainObject };
