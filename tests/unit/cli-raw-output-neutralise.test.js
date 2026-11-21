'use strict';

// #353: the RAW stdout path (`emitRaw`: guide, schema, bootstrap, memory show)
// prints workspace-controlled text — hand-edited memory markdown, config values
// filled into guide placeholders — to a human's terminal. Control characters
// in it must be neutralised by the same `neutraliseControls` every other
// human-facing writer uses (#349), while clean output stays byte-identical.
//
// These tests drive the REAL emitters (no injected `emitters`), so the actual
// emitRaw -> finish -> process.stdout.write path is under test.

const fs = require('fs');
const os = require('os');
const path = require('path');

const cli = require('../../src/cli');
const { MemoryStore } = require('../../src/memory/store');

// eslint-disable-next-line no-control-regex -- matching control chars is the point
const CONTROL = /[\x00-\x08\x0b-\x1f\x7f-\x9f]/;

function makeRoot(config = { mode: 'platform-aware' }) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-s7-')));
  fs.mkdirSync(path.join(root, '.mobile-automator', 'memory'), { recursive: true });
  fs.writeFileSync(path.join(root, '.mobile-automator', 'config.json'), JSON.stringify(config) + '\n');
  return root;
}

async function runCli(root, argv) {
  const writes = [];
  const errWrites = [];
  const exitCodes = [];
  const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation((s) => {
    writes.push(String(s));
    return true;
  });
  const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation((s) => {
    errWrites.push(String(s));
    return true;
  });
  const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
    exitCodes.push(code);
  });
  try {
    await cli.buildProgram({ projectRoot: root }).parseAsync(['node', 'mauto', ...argv]);
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  }
  return { stdout: writes.join(''), stderr: errWrites.join(''), exitCodes };
}

describe('raw output neutralises control characters (#353)', () => {
  test('memory show: escapes C0/C1 in hand-edited run-history, keeps tabs and newlines', async () => {
    const root = makeRoot();
    const history = [
      '# Run History',
      '',
      '- 2026-11-20 login_flow: P\tsteps ok',
      '- 2026-11-21 evil \x1b[2J cleared \u009b31m red',
      '- 2026-11-21 checkout: F',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(root, '.mobile-automator', 'memory', 'run-history.md'), history);

    const { stdout, exitCodes } = await runCli(root, ['memory', 'show', '--kind', 'run-history']);

    expect(exitCodes).toEqual([0]);
    expect(stdout).not.toMatch(CONTROL);
    expect(stdout).toContain('P\tsteps ok');
    expect(stdout).toContain('- 2026-11-21 evil \\x1B[2J cleared \\u009B31m red\n');
    expect(stdout).toContain('- 2026-11-21 checkout: F');
    // Every clean fixture line is still a line of its own: newlines survive.
    const lines = stdout.split('\n');
    for (const line of history.trim().split('\n').filter((l) => !CONTROL.test(l))) {
      expect(lines).toContain(line);
    }
  });

  // A clean memory file prints byte-identical, whatever its line endings: the
  // memory layer reads CRLF (`split(/\r?\n/)`), and CR before LF moves no
  // cursor anywhere a bare LF would not. A lone CR can forge a line, so it is
  // still escaped.
  test.each([
    ['LF', '\n'],
    ['CRLF', '\r\n'],
  ])('memory show on a clean %s file is byte-identical to the file', async (_name, eol) => {
    const root = makeRoot();
    const md = ['# App Knowledge', '', '- [2026-11-20][asserted] login\tbutton is "Sign in"', ''].join(eol);
    fs.writeFileSync(path.join(root, '.mobile-automator', 'memory', 'app-knowledge.md'), md);

    const { raw } = cli.handleMemoryShow(
      { memoryStoreFactory: (args) => new MemoryStore(args), projectRoot: root },
      { kind: 'app-knowledge' }
    );
    // The fixture's body (and its line endings) reaches the handler output, so
    // the comparison below covers the CR the regression would escape.
    expect(raw).toContain(md.trimEnd());

    const { stdout, exitCodes } = await runCli(root, ['memory', 'show', '--kind', 'app-knowledge']);

    expect(exitCodes).toEqual([0]);
    expect(stdout).toBe(raw.endsWith('\n') ? raw : raw + '\n');
  });

  test('memory show: a lone CR (line forging) is still escaped', async () => {
    const root = makeRoot();
    fs.writeFileSync(
      path.join(root, '.mobile-automator', 'memory', 'app-knowledge.md'),
      '# App Knowledge\r\n\r\n- [2026-11-20][asserted] real\rforged\r\n- [2026-11-21][asserted] next\r\n'
    );

    const { stdout } = await runCli(root, ['memory', 'show', '--kind', 'app-knowledge']);

    expect(stdout).toContain('real\\x0Dforged\r\n- [2026-11-21]');
    expect(stdout).not.toMatch(/\r(?!\n)/);
  });

  test('guide execute: a control char in a config-filled placeholder is escaped', async () => {
    const root = makeRoot({ mode: 'platform-aware', project_name: 'Shop\x1b[2J' });

    const { stdout, exitCodes } = await runCli(root, ['guide', 'execute']);

    expect(exitCodes).toEqual([0]);
    expect(stdout).not.toContain('\x1b');
    expect(stdout).toContain('Shop\\x1B[2J');
  });

  test('guide execute on a clean config is byte-identical to the handler output', async () => {
    const root = makeRoot({ mode: 'platform-aware', project_name: 'Shop' });
    const { raw } = cli.handleGuide({ projectRoot: root }, 'execute');

    const { stdout } = await runCli(root, ['guide', 'execute']);

    expect(stdout).toBe(raw.endsWith('\n') ? raw : raw + '\n');
  });

  test('schema scenario is byte-identical to the handler output', async () => {
    const root = makeRoot();
    const { raw } = cli.handleSchema({}, 'scenario');

    const { stdout } = await runCli(root, ['schema', 'scenario']);

    expect(stdout).toBe(raw.endsWith('\n') ? raw : raw + '\n');
  });
});
