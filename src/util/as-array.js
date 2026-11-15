'use strict';

// A value read from a result file as a list: the array itself, anything else
// (absent, null, hand-edited into an object) empty. Callers that need only
// object entries filter on top of it.
const asArray = (value) => (Array.isArray(value) ? value : []);

module.exports = { asArray };
