'use strict';

// Regression tests for issue #146: commander parse errors (unknown option,
// missing required option/argument, unknown subcommand) must NOT bypass the
// uniform `{ok,error,hint,schema_version}` envelope contract. Without
// exitOverride, commander printed bare text to stderr and called process.exit(1)
// itself. These tests drive the REAL program through run() (which uses the real
// defaultEmit -> process.exit path) and assert stdout is always one JSON
// envelope with kind `invalid_input` + exit 3 — never bare text.

const cli = require('../../src/cli');

// Run the real CLI entry point with process.stdout.write / process.exit stubbed
// (so the process doesn't actually terminate), capturing every write + exit code.
async function runCli(argv) {
  const writes = [];
  const exitCodes = [];
  const stdoutSpy = jest
    .spyOn(process.stdout, 'write')
    .mockImplementation((s) => {
      writes.push(s);
      return true;
    });
  const exitSpy = jest
    .spyOn(process, 'exit')
    .mockImplementation((code) => {
      exitCodes.push(code);
    });

  try {
    await cli.run(['node', 'mauto', ...argv]);
  } finally {
    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
  }

  return { writes, exitCodes };
}

// The single JSON envelope line on stdout (everything else is ignored).
function envelopeLine(writes) {
  const json = writes.find((w) => w.trim().startsWith('{'));
  expect(json).toBeDefined();
  return JSON.parse(json);
}

describe('commander parse errors -> envelope (#146)', () => {
  test('unknown option: `mauto elements --nonexistent-flag` -> invalid_input envelope, exit 3', async () => {
    const { writes, exitCodes } = await runCli(['elements', '--nonexistent-flag']);

    const env = envelopeLine(writes);
    expect(env.ok).toBe(false);
    expect(env.error.kind).toBe('invalid_input');
    expect(env.error.message).toMatch(/unknown option '--nonexistent-flag'/);
    expect(env.hint).toMatch(/^Usage: mauto elements/);
    expect(env.schema_version).toBe('2.1');
    expect(exitCodes).toEqual([3]);
  });

  test('missing requiredOption: `mauto result add-step` (no --run-id) -> envelope, not bare text', async () => {
    const { writes, exitCodes } = await runCli(['result', 'add-step']);

    const env = envelopeLine(writes);
    expect(env.ok).toBe(false);
    expect(env.error.kind).toBe('invalid_input');
    expect(env.error.message).toMatch(/required option '--run-id <id>' not specified/);
    expect(env.hint).toMatch(/^Usage: mauto result add-step/);
    expect(exitCodes).toEqual([3]);
  });

  test('unknown subcommand: `mauto result nope` -> envelope', async () => {
    const { writes, exitCodes } = await runCli(['result', 'nope']);

    const env = envelopeLine(writes);
    expect(env.ok).toBe(false);
    expect(env.error.kind).toBe('invalid_input');
    expect(env.error.message).toMatch(/unknown command 'nope'/);
    expect(exitCodes).toEqual([3]);
  });

  test('missing required argument: `mauto screenshot` (needs <path>) -> envelope', async () => {
    const { writes, exitCodes } = await runCli(['screenshot']);

    const env = envelopeLine(writes);
    expect(env.ok).toBe(false);
    expect(env.error.kind).toBe('invalid_input');
    expect(env.error.message).toMatch(/required argument 'path'/);
    expect(exitCodes).toEqual([3]);
  });

  test('`mauto --help` keeps human-readable help output + exit 0 (no envelope)', async () => {
    const { writes, exitCodes } = await runCli(['--help']);

    const text = writes.map((w) => w).join('');
    expect(text).toMatch(/Usage: mauto/);
    expect(text).not.toMatch(/^\s*\{/); // no JSON envelope
    expect(exitCodes).toEqual([0]);
  });

  test('`mauto --version` keeps human-readable version output + exit 0 (no envelope)', async () => {
    const { writes, exitCodes } = await runCli(['--version']);

    const text = writes.map((w) => w).join('');
    expect(text.trim()).toMatch(/^\d+\.\d+\.\d+/); // semver
    expect(text).not.toMatch(/^\s*\{/); // no JSON envelope
    expect(exitCodes).toEqual([0]);
  });

  test('`--human` renders a parse failure readably (not JSON), still exit 3', async () => {
    const { writes, exitCodes } = await runCli(['elements', '--nonexistent-flag', '--human']);

    const text = writes.map((w) => w).join('');
    expect(text).toMatch(/error \[invalid_input\]:/);
    expect(text).toMatch(/hint: Usage: mauto elements/);
    expect(text).not.toMatch(/^\s*\{/); // human mode, not JSON
    expect(exitCodes).toEqual([3]);
  });

  test('guard: every parse-failure class produces JSON-parseable stdout', async () => {
    // One representative argv per commander parse-failure class.
    const cases = [
      ['elements', '--nonexistent-flag'], // commander.unknownOption
      ['screenshot'], // commander.missingArgument
      ['result', 'add-step'], // commander.missingMandatoryOptionValue
      ['result', 'nope'], // commander.unknownCommand
    ];

    for (const argv of cases) {
      const { writes, exitCodes } = await runCli(argv);
      // Must be exactly one JSON line and it must parse.
      const jsonLines = writes.filter((w) => w.trim().startsWith('{'));
      expect(jsonLines).toHaveLength(1);
      const env = JSON.parse(jsonLines[0]);
      expect(env.ok).toBe(false);
      expect(env.error.kind).toBe('invalid_input');
      expect(exitCodes).toEqual([3]);
    }
  });
});
