'use strict';

const {
  emptyModel,
  parseRunHistory,
  renderRunHistory,
  recordInModel,
  countEntries,
  MAX_RUNS,
  MAX_NOTES,
} = require('../../../src/memory/history');

describe('memory/history', () => {
  test('render→parse round-trips a model', () => {
    let m = emptyModel();
    m = recordInModel(m, {
      scenarioId: 'checkout_flow',
      statusLetter: 'P',
      notes: [{ date: '2026-07-05', text: 'flakiness (tap_pay): passed after 2 attempts' }],
    });
    const md = renderRunHistory(m);
    expect(md).toContain('# Run History');
    expect(md).toContain('## checkout_flow  (last 5 runs: P)');
    expect(md).toContain('- [2026-07-05][observed] flakiness (tap_pay): passed after 2 attempts');

    const reparsed = parseRunHistory(md);
    expect(reparsed.byScenario.checkout_flow.runs).toEqual(['P']);
    expect(reparsed.byScenario.checkout_flow.notes).toHaveLength(1);
  });

  test('runs are capped at MAX_RUNS (oldest dropped)', () => {
    let m = emptyModel();
    for (let i = 0; i < MAX_RUNS + 3; i++) {
      m = recordInModel(m, { scenarioId: 's', statusLetter: i % 2 ? 'F' : 'P', notes: [] });
    }
    expect(m.byScenario.s.runs).toHaveLength(MAX_RUNS);
  });

  test('parse tolerates an empty / missing body', () => {
    expect(parseRunHistory('').order).toEqual([]);
    expect(countEntries(emptyModel())).toBe(0);
  });

  test('parse preserves scenario order and multiple scenarios', () => {
    let m = emptyModel();
    m = recordInModel(m, { scenarioId: 'a', statusLetter: 'P', notes: [] });
    m = recordInModel(m, { scenarioId: 'b', statusLetter: 'F', notes: [] });
    const reparsed = parseRunHistory(renderRunHistory(m));
    expect(reparsed.order).toEqual(['a', 'b']);
  });

  test('parse tolerates CRLF line endings without dropping notes', () => {
    const md = '## s  (last 5 runs: P)\r\n- [2026-07-05][observed] hello\r\n';
    const reparsed = parseRunHistory(md);
    expect(reparsed.byScenario.s.notes).toHaveLength(1);
    expect(reparsed.byScenario.s.notes[0].text).toBe('hello');
  });

  test('notes are capped at MAX_NOTES (oldest dropped)', () => {
    let m = emptyModel();
    const notes = Array.from({ length: MAX_NOTES + 3 }, (_, i) => ({ date: '2026-07-12', text: `n${i}` }));
    m = recordInModel(m, { scenarioId: 's', statusLetter: 'P', notes });
    expect(m.byScenario.s.notes).toHaveLength(MAX_NOTES);
    expect(m.byScenario.s.notes[m.byScenario.s.notes.length - 1].text).toBe(`n${MAX_NOTES + 2}`); // newest kept
  });
});
