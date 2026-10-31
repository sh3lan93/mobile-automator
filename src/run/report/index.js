'use strict';

// The one entry point for rendering result files as a CI report. `mauto result
// export` calls it now and `mauto run --junit` will call it unchanged, so a new
// format is added here once and both verbs gain it.

const { toJUnit } = require('./junit');

const RENDERERS = {
  junit: (results, opts) => {
    const { xml, ...counts } = toJUnit(results, opts);
    return { content: xml, ...counts };
  },
};

const REPORT_FORMATS = Object.freeze(Object.keys(RENDERERS));

// renderReport(format, results, opts) -> { format, content, suites, tests, failures, skipped }
function renderReport(format, results, opts = {}) {
  if (!Object.prototype.hasOwnProperty.call(RENDERERS, format)) {
    throw new TypeError(`unknown report format "${format}"; formats: ${REPORT_FORMATS.join(', ')}`);
  }
  return { format, ...RENDERERS[format](results, opts) };
}

module.exports = { REPORT_FORMATS, renderReport };
