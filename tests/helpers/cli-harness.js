'use strict';

// Drive a real CLI invocation in-process: `invoke` is whatever entry point the
// test exercises (`cli.run(argv)`, `buildProgram(deps).parseAsync(argv)`).
// process.stdout.write / process.stderr.write / process.exit are stubbed for
// its duration, so finish() runs its real write + exit path without ending the
// test process, and every write and exit code is captured. stderr matters:
// `diagnose()` writes `err.stack` there for the `internal` kind.

async function captureProcessIO(invoke) {
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
    await invoke();
  } finally {
    stdoutSpy.mockRestore();
    stderrSpy.mockRestore();
    exitSpy.mockRestore();
  }

  return { writes, errWrites, exitCodes };
}

module.exports = { captureProcessIO };
