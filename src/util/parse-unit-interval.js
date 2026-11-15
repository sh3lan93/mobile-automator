'use strict';

// A number in [0, 1] from a scenario field or a CLI flag value: a number, or a
// string that reads as one ("0.95", " 1 "). Anything else (an empty or
// whitespace-only string, a non-numeric string, NaN, Infinity, a value outside
// [0, 1], booleans, objects) is null, so every field that means "a fraction
// from 0 to 1" (a screenshot_match tolerance, a similarity score) refuses the
// same inputs.
function parseUnitInterval(raw) {
  let n;
  if (typeof raw === 'number') n = raw;
  else if (typeof raw === 'string' && raw.trim() !== '') n = Number(raw);
  else return null;
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : null;
}

module.exports = { parseUnitInterval };
