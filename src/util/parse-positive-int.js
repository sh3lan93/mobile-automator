'use strict';

// A positive integer from a CLI flag value: a number, or a plain decimal
// string of digits ("800"). Anything else (exponent or hex notation, signs,
// spaces, fractions, zero, booleans) is null, so every flag that means "a
// positive integer number of ms" refuses the same inputs.
function parsePositiveInt(raw) {
  let n;
  if (typeof raw === 'number') n = raw;
  else if (typeof raw === 'string' && /^[0-9]+$/.test(raw)) n = Number(raw);
  else return null;
  return Number.isInteger(n) && n > 0 ? n : null;
}

module.exports = { parsePositiveInt };
