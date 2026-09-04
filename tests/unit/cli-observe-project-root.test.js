'use strict';

// `buildProgram({ projectRoot })` is the CLI's dependency injection seam: every
// handler resolves `mobile-automator/` through it. The observability seam has
// to resolve through the SAME root, or a program executes its verbs against one
// tree and writes its record of them into another.
//
// This is in-process rather than spawned because the injection is the point:
// `bin/mauto.js` never passes a root, so a spawned CLI can never exercise the
// divergence. The harness therefore sets cwd to a SUBDIRECTORY of the injected
// workspace — the case where "projectRoot" and "process.cwd()" disagree while
// both are real, plausible directories.

const os = require('os');
const fs = require('fs');
const path = require('path');

const { buildProgram } = require('../../src/cli');

// A workspace `mauto setup` would have created, plus a subdirectory to stand in.
function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-observe-root-'));
  fs.mkdirSync(path.join(root, 'mobile-automator'), { recursive: true });
  const sub = path.join(root, 'sub', 'deeper');
  fs.mkdirSync(sub, { recursive: true });
  return { root, sub };
}

function readEvents(root) {
  const logFile = path.join(root, 'mobile-automator', '.logs', 'mauto.ndjson');
  if (!fs.existsSync(logFile)) return [];
  return fs
    .readFileSync(logFile, 'utf8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

// Drive the real program through its real emit path (so finish() actually
// runs), with process.exit / stdout stubbed so the test process survives.
async function runProgram(argv, { projectRoot, cwd }) {
  const originalCwd = process.cwd();
  const stdoutSpy = jest.spyOn(process.stdout, 'write').mockImplementation(() => true);
  const exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
  process.chdir(cwd);
  try {
    const program = buildProgram({ projectRoot });
    await program.parseAsync(['node', 'mauto', ...argv]);
  } finally {
    process.chdir(originalCwd);
    stdoutSpy.mockRestore();
    exitSpy.mockRestore();
  }
}

describe('the observability seam honours the injected projectRoot', () => {
  const originalLevel = process.env.MAUTO_LOG_LEVEL;

  beforeEach(() => {
    // The file sink's own default is already `info`; set it explicitly so the
    // test does not silently depend on that default staying put.
    process.env.MAUTO_LOG_LEVEL = 'info';
  });

  afterEach(() => {
    if (originalLevel === undefined) delete process.env.MAUTO_LOG_LEVEL;
    else process.env.MAUTO_LOG_LEVEL = originalLevel;
  });

  it('writes verb.end into the injected workspace, not into cwd', async () => {
    const { root, sub } = makeWorkspace();

    await runProgram(['config', 'get', 'mode'], { projectRoot: root, cwd: sub });

    const events = readEvents(root).filter((e) => e.event === 'verb.end');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ src: 'cli', verb: 'config', ok: true });
  });

  it('creates no log tree under cwd', async () => {
    const { root, sub } = makeWorkspace();

    await runProgram(['config', 'get', 'mode'], { projectRoot: root, cwd: sub });

    expect(fs.existsSync(path.join(sub, 'mobile-automator'))).toBe(false);
  });
});
