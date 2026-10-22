'use strict';

// The golden gate decides from the scenario's `golden` tag — never a naming
// convention on the id — and is loud in both directions: a tagged scenario
// without a fixture is a missing golden, an untagged scenario with one is a
// stray. The diff runs only for a run that passed, so a known failure's early
// stop never buries the failure that matters under unreached-step mismatches.

const fs = require('fs');
const os = require('os');
const path = require('path');

const { goldenProblems } = require('../../../sample-app/scripts/lib/golden');
const { normalizeResult } = require('../../../sample-app/scripts/lib/normalize-result');

let goldenDir;
let resultDir;
beforeEach(() => {
  goldenDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-golden-'));
  resultDir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-result-'));
});
afterEach(() => {
  fs.rmSync(goldenDir, { recursive: true, force: true });
  fs.rmSync(resultDir, { recursive: true, force: true });
});

const writeJson = (p, body) => {
  fs.writeFileSync(p, JSON.stringify(body, null, 2));
  return p;
};

// A result file `result finalize` could have written; only the fields
// normalizeResult keeps matter here.
const runResult = () => ({
  run_id: 'run_20261021_120000',
  scenario_id: 'demo',
  status: 'passed',
  steps_executed: [{ step_id: 'launch', status: 'passed' }],
  assertion_results: [],
});

// A result file for a run whose first step failed.
const failedResult = () => ({
  ...runResult(),
  status: 'failed',
  steps_executed: [{ step_id: 'launch', status: 'failed' }],
});

describe('goldenProblems', () => {
  test('an untagged scenario with no fixture gets no golden check', () => {
    const r = goldenProblems({
      scenarioId: 'smoke_nav',
      tags: ['smoke', 'p0'],
      goldenDir,
      resultPath: writeJson(path.join(resultDir, 'r.json'), runResult()),
      passed: true,
    });
    expect(r).toEqual([]);
  });

  test('an untagged scenario with a fixture is a stray golden', () => {
    writeJson(path.join(goldenDir, 'smoke_nav.result.json'), normalizeResult(runResult()));
    const r = goldenProblems({
      scenarioId: 'smoke_nav',
      tags: ['smoke', 'p0'],
      goldenDir,
      resultPath: writeJson(path.join(resultDir, 'r.json'), runResult()),
      passed: true,
    });
    expect(r).toHaveLength(1);
    expect(r[0]).toMatch(/exists but scenario "smoke_nav" is not tagged golden/);
  });

  test('a tagged scenario with no fixture is a missing golden, whatever the run did', () => {
    // The save-as-golden helper prints the normalized result; silence it.
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      for (const body of [runResult(), failedResult()]) {
        const r = goldenProblems({
          scenarioId: 'demo',
          tags: ['golden'],
          goldenDir,
          resultPath: writeJson(path.join(resultDir, 'r.json'), body),
          passed: body.status === 'passed',
        });
        expect(r[0]).toMatch(/golden fixture missing/);
        expect(r[0]).toContain('demo');
      }
    } finally {
      consoleSpy.mockRestore();
    }
  });

  test('a missing golden prints the run\'s normalized result so it can be saved as the fixture', () => {
    const printed = [];
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    try {
      const r = goldenProblems({
        scenarioId: 'demo',
        tags: ['golden'],
        goldenDir,
        resultPath: writeJson(path.join(resultDir, 'r.json'), runResult()),
        passed: true,
        log: (m) => printed.push(m),
      });
      expect(r).toHaveLength(2);
      expect(r[1]).toMatch(/save its normalized JSON/);
      expect(printed.join('\n')).toMatch(/no golden for demo/);
      // The dump is the normalized result — exactly what the fixture wants.
      expect(JSON.parse(consoleSpy.mock.calls.map((c) => c[0]).join(''))).toEqual(normalizeResult(runResult()));
    } finally {
      consoleSpy.mockRestore();
    }
  });

  test('a tagged scenario with a fixture is not diffed unless the run passed', () => {
    writeJson(path.join(goldenDir, 'demo.result.json'), {
      ...normalizeResult(runResult()),
      steps_executed: [{ step_id: 'launch', status: 'failed' }], // would mismatch
    });
    const r = goldenProblems({
      scenarioId: 'demo',
      tags: ['golden'],
      goldenDir,
      resultPath: writeJson(path.join(resultDir, 'r.json'), failedResult()),
      passed: false,
    });
    expect(r).toEqual([]);
  });

  test('a tagged passing run is diffed against the fixture, mismatch lines and all', () => {
    // Matching fixture: no problems.
    writeJson(path.join(goldenDir, 'demo.result.json'), normalizeResult(runResult()));
    expect(
      goldenProblems({
        scenarioId: 'demo',
        tags: ['golden'],
        goldenDir,
        resultPath: writeJson(path.join(resultDir, 'r.json'), runResult()),
        passed: true,
      })
    ).toEqual([]);

    // Mismatching fixture: one golden mismatch line addressing the leaf.
    writeJson(path.join(goldenDir, 'demo.result.json'), {
      ...normalizeResult(runResult()),
      steps_executed: [{ step_id: 'launch', status: 'failed' }],
    });
    const r = goldenProblems({
      scenarioId: 'demo',
      tags: ['golden'],
      goldenDir,
      resultPath: writeJson(path.join(resultDir, 'r.json'), runResult()),
      passed: true,
    });
    expect(r).toEqual(['golden mismatch: steps_executed[0].status: expected "failed", got "passed"']);
  });

  test('a scenario without tags is not golden', () => {
    const r = goldenProblems({
      scenarioId: 'demo',
      goldenDir,
      resultPath: writeJson(path.join(resultDir, 'r.json'), runResult()),
      passed: true,
    });
    expect(r).toEqual([]);
  });
});
