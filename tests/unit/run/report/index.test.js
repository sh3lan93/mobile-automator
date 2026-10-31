'use strict';

const { REPORT_FORMATS, renderReport } = require('../../../../src/run/report');
const { toJUnit } = require('../../../../src/run/report/junit');
const PASSED = require('./fixtures/passed.json');

describe('report formats', () => {
  test('junit is the only format', () => {
    expect(REPORT_FORMATS).toEqual(['junit']);
  });

  test('renderReport("junit") is toJUnit with the format named', () => {
    const { xml, ...counts } = toJUnit([PASSED], { executor: { kind: 'x' } });
    expect(renderReport('junit', [PASSED], { executor: { kind: 'x' } })).toEqual({
      format: 'junit',
      content: xml,
      ...counts,
    });
  });

  test('an unknown format throws naming the known ones', () => {
    expect(() => renderReport('sarif', [PASSED])).toThrow(/unknown report format "sarif".*junit/);
  });
});
