'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { handleResultExport, buildProgram } = require('../../../src/cli');
const { workspaceDir } = require('../../../src/workspace/layout');
const { parseXml, findAll } = require('../../helpers/parse-xml');

const PASSED = require('../run/report/fixtures/passed.json');
const FAILED = require('../run/report/fixtures/failed.json');

function tmpRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-result-export-'));
  fs.mkdirSync(path.join(workspaceDir(root), 'results'), { recursive: true });
  return root;
}

const resultsDir = (root) => path.join(workspaceDir(root), 'results');

function writeResult(root, result, raw) {
  const file = path.join(resultsDir(root), `${result.run_id}.json`);
  fs.writeFileSync(file, raw === undefined ? JSON.stringify(result, null, 2) : raw);
  return file;
}

const exportWith = (root, opts) => handleResultExport({ projectRoot: root, cwd: root }, opts);

describe('handleResultExport', () => {
  test('without --out the XML is returned in data.xml', () => {
    const root = tmpRoot();
    writeResult(root, PASSED);
    const r = exportWith(root, { runIds: [PASSED.run_id], format: 'junit' });
    expect(r.exitKind).toBe('ok');
    expect(r.envelope.ok).toBe(true);
    expect(r.envelope.data).toMatchObject({ format: 'junit', path: null, suites: 1, tests: 2, failures: 0, skipped: 0 });
    const [suite] = findAll(parseXml(r.envelope.data.xml), 'testsuite');
    expect(suite.attrs.name).toBe('login_flow');
  });

  test('--out writes the XML, returns the absolute path and no inline xml', () => {
    const root = tmpRoot();
    writeResult(root, PASSED);
    const r = exportWith(root, { runIds: [PASSED.run_id], format: 'junit', out: 'reports/nested/junit.xml' });
    const expected = path.join(root, 'reports', 'nested', 'junit.xml');
    expect(r.envelope.data).toEqual({ format: 'junit', path: expected, suites: 1, tests: 2, failures: 0, skipped: 0 });
    expect(parseXml(fs.readFileSync(expected, 'utf8')).name).toBe('testsuites');
  });

  test('several run ids render as several suites, in the order given', () => {
    const root = tmpRoot();
    writeResult(root, PASSED);
    writeResult(root, FAILED);
    const r = exportWith(root, { runIds: [FAILED.run_id, PASSED.run_id], format: 'junit' });
    expect(r.envelope.data).toMatchObject({ suites: 2, tests: 6, failures: 3 });
    const names = findAll(parseXml(r.envelope.data.xml), 'testsuite').map((s) => s.attrs.name);
    expect(names).toEqual(['checkout_flow', 'login_flow']);
  });

  test('a run with failures still exports ok: export reports, it does not gate', () => {
    const root = tmpRoot();
    writeResult(root, FAILED);
    const r = exportWith(root, { runIds: [FAILED.run_id], format: 'junit' });
    expect(r.exitKind).toBe('ok');
    expect(r.envelope.data.failures).toBe(3);
  });

  describe('invalid_input', () => {
    const expectInvalid = (r, pattern) => {
      expect(r.exitKind).toBe('invalid_input');
      expect(r.envelope.ok).toBe(false);
      expect(r.envelope.error.kind).toBe('invalid_input');
      expect(`${r.envelope.error.message} ${r.envelope.hint}`).toMatch(pattern);
    };

    test('a missing format names the formats', () => {
      expectInvalid(exportWith(tmpRoot(), { runIds: [PASSED.run_id] }), /junit/);
    });

    test('an unknown format names the formats', () => {
      expectInvalid(exportWith(tmpRoot(), { runIds: [PASSED.run_id], format: 'sarif' }), /sarif[\s\S]*junit/);
    });

    test('no run id', () => {
      expectInvalid(exportWith(tmpRoot(), { runIds: [], format: 'junit' }), /--run-id/);
    });

    test.each(['../../etc/passwd', 'run_2026', 'run_20261027_100000.json'])(
      'a run id that is not run_YYYYMMDD_HHMMSS (%s)',
      (id) => {
        expectInvalid(exportWith(tmpRoot(), { runIds: [id], format: 'junit' }), /run_YYYYMMDD_HHMMSS/);
      }
    );

    test('a run with no result file', () => {
      expectInvalid(exportWith(tmpRoot(), { runIds: ['run_20990101_000000'], format: 'junit' }), /no result file/);
    });

    test('a result file that is not JSON is reported and left untouched', () => {
      const root = tmpRoot();
      const file = writeResult(root, PASSED, '{ not json');
      expectInvalid(exportWith(root, { runIds: [PASSED.run_id], format: 'junit' }), /not valid JSON/);
      expect(fs.readFileSync(file, 'utf8')).toBe('{ not json');
      expect(fs.readdirSync(resultsDir(root))).toEqual([`${PASSED.run_id}.json`]);
    });

    test('a run that was never finalized points at result finalize', () => {
      const root = tmpRoot();
      writeResult(root, { run_id: PASSED.run_id, scenario_id: 's', steps_executed: [], assertion_results: [], _in_progress: true });
      expectInvalid(
        exportWith(root, { runIds: [PASSED.run_id], format: 'junit' }),
        new RegExp(`not finalized[\\s\\S]*mauto result finalize --run-id ${PASSED.run_id}`)
      );
    });

    test('one bad run id fails the whole export, writing nothing', () => {
      const root = tmpRoot();
      writeResult(root, PASSED);
      const r = exportWith(root, { runIds: [PASSED.run_id, 'run_20990101_000000'], format: 'junit', out: 'out.xml' });
      expect(r.exitKind).toBe('invalid_input');
      expect(fs.existsSync(path.join(root, 'out.xml'))).toBe(false);
    });
  });

  test('an unwritable --out fails environment', () => {
    const root = tmpRoot();
    writeResult(root, PASSED);
    fs.writeFileSync(path.join(root, 'a-file'), '');
    const r = exportWith(root, { runIds: [PASSED.run_id], format: 'junit', out: 'a-file/junit.xml' });
    expect(r.exitKind).toBe('environment');
    expect(r.envelope.error.message).toMatch(/could not write/);
  });
});

describe('`result export` registration', () => {
  const exportCmd = buildProgram()
    .commands.find((c) => c.name() === 'result')
    .commands.find((c) => c.name() === 'export');

  test('is registered with --run-id, --format and --out', () => {
    expect(exportCmd).toBeDefined();
    expect(exportCmd.options.map((o) => o.long).sort()).toEqual(['--format', '--out', '--run-id']);
  });
});
