'use strict';

// Regression tests for issue #146: commander parse errors (unknown option,
// missing option value, missing argument, unknown subcommand, …) must NOT
// bypass the uniform `{ok,error,hint,schema_version}` envelope contract.
// Without exitOverride, commander printed bare text to stderr and called
// process.exit(1) itself. These tests drive the REAL program through run()
// (which uses the real defaultEmit -> process.exit path) and assert stdout is
// always one JSON envelope with kind `invalid_input` + exit 3 — never bare
// text, never a stack trace.

const fs = require('fs');
const path = require('path');
const { CommanderError } = require('commander');

const cli = require('../../src/cli');

// Run the real CLI entry point with process.stdout.write / process.stderr.write
// / process.exit stubbed (so the process doesn't actually terminate), capturing
// every write + exit code. stderr is captured because `diagnose()` dumps
// `err.stack` there for the `internal` kind — so a misclassified parse failure
// shows up as stderr noise as well as a wrong `error.kind`.
async function runCli(argv) {
  const writes = [];
  const errWrites = [];
  const exitCodes = [];
  const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation((s) => {
    writes.push(s);
    return true;
  });
  const stderrSpy = jest.spyOn(process.stderr, 'write').mockImplementation((s) => {
    errWrites.push(s);
    return true;
  });
  const exitSpy = jest.spyOn(process, 'exit').mockImplementation((code) => {
    exitCodes.push(code);
  });

  try {
    await cli.run(['node', 'mauto', ...argv]);
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  }

  return { writes, errWrites, exitCodes };
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

  // Regression for the gap the original allowlist left open. Distinct from the
  // case above despite the near-identical commander code name: there the
  // required option was never supplied (`missingMandatoryOptionValue`); here it
  // IS supplied and its VALUE is missing (`optionMissingArgument`). That second
  // code was absent from COMMANDER_PARSE_CODES, so this invocation produced
  // `kind:"internal"`, exit 1, and a 10-frame stack trace on stderr.
  test('supplied option with no value: `mauto result add-step --run-id` -> invalid_input, clean stderr', async () => {
    const { writes, errWrites, exitCodes } = await runCli(['result', 'add-step', '--run-id']);

    const env = envelopeLine(writes);
    expect(env.ok).toBe(false);
    expect(env.error.kind).toBe('invalid_input');
    expect(env.error.message).toMatch(/option '--run-id <id>' argument missing/);
    expect(env.hint).toMatch(/^Usage: mauto result add-step/);
    expect(exitCodes).toEqual([3]);
    expect(errWrites.join('')).toBe('');
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

    const text = writes.join('');
    expect(text).toMatch(/Usage: mauto/);
    // Not `/^\s*\{/` — without the `m` flag that only inspects the START of the
    // joined string, which help output never occupies, so it passed vacuously.
    expect(text).not.toContain('"schema_version"');
    expect(exitCodes).toEqual([0]);
  });

  test('subcommand help: `mauto result add-step --help` -> help text + exit 0, no envelope', async () => {
    const { writes, exitCodes } = await runCli(['result', 'add-step', '--help']);

    const text = writes.join('');
    expect(text).toMatch(/Usage: mauto result add-step/);
    expect(text).not.toContain('"schema_version"');
    expect(exitCodes).toEqual([0]);
  });

  test('`mauto --version` keeps human-readable version output + exit 0 (no envelope)', async () => {
    const { writes, exitCodes } = await runCli(['--version']);

    const text = writes.join('');
    expect(text.trim()).toMatch(/^\d+\.\d+\.\d+/); // semver
    expect(text).not.toContain('"schema_version"');
    expect(exitCodes).toEqual([0]);
  });

  test('`--human` renders a parse failure readably (not JSON), still exit 3', async () => {
    const { writes, exitCodes } = await runCli(['elements', '--nonexistent-flag', '--human']);

    const text = writes.join('');
    expect(text).toMatch(/error \[invalid_input\]:/);
    expect(text).toMatch(/hint: Usage: mauto elements/);
    expect(text).not.toContain('"schema_version"');
    expect(exitCodes).toEqual([3]);
  });

  // PROPERTY: every malformed invocation — whatever commander calls it
  // internally — yields exactly one `invalid_input` envelope on stdout, exit 3,
  // and NOTHING on stderr. The previous version of this guard iterated the same
  // four codes the implementation allowlisted, so it could only ever confirm
  // what the code already did; it passed green while `--run-id` (no value)
  // emitted `internal` + a stack trace.
  describe.each([
    ['unknown option', ['elements', '--nonexistent-flag']],
    ['missing argument', ['screenshot']],
    ['unsupplied required option', ['result', 'add-step']],
    ['supplied option with no value', ['result', 'add-step', '--run-id']],
    ['unknown subcommand', ['result', 'nope']],
  ])('malformed invocation: %s', (_label, argv) => {
    test('-> exactly one invalid_input envelope, exit 3, clean stderr', async () => {
      const { writes, errWrites, exitCodes } = await runCli(argv);

      const jsonLines = writes.filter((w) => w.trim().startsWith('{'));
      expect(jsonLines).toHaveLength(1);

      const env = JSON.parse(jsonLines[0]);
      expect(env.ok).toBe(false);
      expect(env.error.kind).toBe('invalid_input');
      expect(exitCodes).toEqual([3]);
      expect(errWrites.join('')).toBe('');
    });
  });

  // DRIFT GUARD: assert against commander's REAL code surface rather than a
  // hand-copied list. Every code commander can emit must be a deliberate
  // decision — either a display outcome (help/version, handled in run()) or a
  // parse failure. None may reach `internal`, which is the panic bucket: it
  // maps to exit 1 and makes `diagnose()` dump a stack trace. A commander
  // upgrade that introduces a new code now fails this test instead of silently
  // turning a user typo into a fake crash.
  test('no commander error code falls through to the `internal` bucket', () => {
    // commander's `exports` map forbids deep subpath requires, so locate
    // lib/command.js relative to the resolved package entry point instead.
    const commanderRoot = path.dirname(require.resolve('commander'));
    const commanderSource = fs.readFileSync(
      path.join(commanderRoot, 'lib', 'command.js'),
      'utf8'
    );
    const codes = [...new Set(commanderSource.match(/'commander\.[a-zA-Z]+'/g) || [])].map((q) =>
      q.slice(1, -1)
    );

    // Sanity-check the scan itself: commander v12 defines 13 codes. If this
    // trips, the source layout changed and the guard below is inspecting air.
    expect(codes.length).toBeGreaterThanOrEqual(10);

    // Display outcomes never reach toEnvelope — run() short-circuits them.
    const DISPLAY_OUTCOMES = new Set([
      'commander.help',
      'commander.helpDisplayed',
      'commander.version',
    ]);

    const misclassified = codes
      .filter((code) => !DISPLAY_OUTCOMES.has(code))
      .filter((code) => cli.toEnvelope(new CommanderError(1, code, 'synthetic')).exitKind !== 'invalid_input');

    expect(misclassified).toEqual([]);
  });
});
