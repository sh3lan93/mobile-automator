'use strict';

// One-shot `mauto` invocations for the real-device E2E harness.
//
// The harness exists to prove the SHIPPED CLI drives a device (#94), so it
// never talks to mobile-mcp itself: every device action is a `mauto <verb>`
// subprocess, and every answer is read off the uniform envelope
// `{ok,data,error,hint,schema_version}` — exactly what an agent sees.
//
// A failure is loud and self-describing. `ok:false`, stdout that is not an
// envelope, and a non-zero exit all throw a MautoError carrying the verb, the
// envelope's error and hint, and the tail of stderr (where the CLI's own
// diagnostics go), so a red CI log says WHICH verb broke and why without
// re-running anything.
//
// One exception, opted into per call: `opts.acceptKinds`. Since #273 a failed
// `mauto assert` and the `result finalize` of a failed run answer `ok:false`
// with `error.kind: 'test_failed'`, exit 6, and the verdict / full result in
// `data` — so CI can tell "the app is broken" from "the tool is broken". For
// those calls the test outcome IS the answer, not a tool error, so an accepted
// kind returns `envelope.data`. It must still look like the contract says: a
// non-zero exit and a `data` key. An accepted kind that exited 0, or that
// carries no data, throws — the same spirit as "reported ok but exited N".

const { execFile } = require('child_process');

// Enough stderr to show a stack or a daemon complaint, not a whole log.
const STDERR_TAIL_LINES = 15;

const LEGACY_ROBOT_ENV = 'MOBILEMCP_LEGACY_ROBOT';

class MautoError extends Error {
  constructor(message, { verb, args, envelope = null, stderr = '', code = null } = {}) {
    super(message);
    this.name = 'MautoError';
    this.verb = verb;
    this.args = args;
    this.envelope = envelope;
    this.stderr = stderr;
    this.code = code;
  }
}

// Resolve to `{ stdout, stderr, code }` for every outcome, including a
// non-zero exit: the envelope on stdout is the thing worth reading, and
// execFile's rejection would hide it. A spawn failure (ENOENT, EACCES) has no
// numeric exit code and reports as -1 with the reason in stderr.
function defaultExec(file, args, options) {
  return new Promise((resolve) => {
    execFile(file, args, { ...options, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
      let code = 0;
      if (err) code = typeof err.code === 'number' ? err.code : -1;
      const errText = err && code === -1 ? `${err.message}\n` : '';
      resolve({ stdout: String(stdout || ''), stderr: errText + String(stderr || ''), code });
    });
  });
}

// `result add-step` → "result add-step"; `tap --at 1,2` → "tap". Verbs with a
// subcommand are named by both words so the error points at the right one.
const NESTED = new Set(['result', 'session', 'devices', 'config', 'memory', 'crash', 'telemetry']);
function verbOf(args) {
  if (NESTED.has(args[0]) && args[1] && !String(args[1]).startsWith('-')) return `${args[0]} ${args[1]}`;
  return String(args[0]);
}

function tail(text, lines = STDERR_TAIL_LINES) {
  return String(text || '').trimEnd().split('\n').slice(-lines).join('\n');
}

function parseEnvelope(stdout) {
  const trimmed = String(stdout || '').trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed);
    return parsed && typeof parsed === 'object' && typeof parsed.ok === 'boolean' ? parsed : null;
  } catch (_e) {
    return null;
  }
}

function describeError(error) {
  if (!error) return 'no error reported';
  if (typeof error === 'string') return error;
  return error.kind ? `${error.kind}: ${error.message}` : String(error.message || JSON.stringify(error));
}

function createMauto({ bin, cwd, env = {}, log = () => {}, exec = defaultExec } = {}) {
  if (!bin) throw new Error('createMauto requires the path to the mauto binary');

  async function run(args, opts = {}) {
    const verb = verbOf(args);
    log(`$ mauto ${args.join(' ')}`);
    const childEnv = {
      ...process.env,
      ...env,
      ...(opts.env || {}),
      // Never phone home from CI, whatever the caller's environment says.
      MOBILEMCP_DISABLE_TELEMETRY: '1',
      MAUTO_TELEMETRY: '0',
    };
    // The engine is selected through the workspace's `engine` config key
    // (lib/engine.js, #251). An exported MOBILEMCP_LEGACY_ROBOT overrides that
    // key, so it would make a legacy run test the variable, not the config.
    delete childEnv[LEGACY_ROBOT_ENV];
    const { stdout, stderr, code } = await exec(bin, args, { cwd, env: childEnv });

    const envelope = parseEnvelope(stdout);
    const stderrTail = tail(stderr);
    const context = { verb, args, envelope, stderr, code };
    const withStderr = (msg) => (stderrTail ? `${msg}\n  stderr (tail):\n${stderrTail}` : msg);

    if (!envelope) {
      throw new MautoError(
        withStderr(`mauto ${verb}: stdout is not a JSON envelope (exit ${code}): ${tail(stdout, 5) || '<empty>'}`),
        context
      );
    }
    const kind = envelope.error && typeof envelope.error === 'object' ? envelope.error.kind : undefined;
    const acceptKinds = Array.isArray(opts.acceptKinds) ? opts.acceptKinds : [];
    if (!envelope.ok && kind && acceptKinds.includes(kind)) {
      if (code === 0) {
        throw new MautoError(withStderr(`mauto ${verb} reported ${kind} but exited 0`), context);
      }
      if (!Object.prototype.hasOwnProperty.call(envelope, 'data')) {
        throw new MautoError(withStderr(`mauto ${verb} reported ${kind} (exit ${code}) with no data`), context);
      }
      return envelope.data;
    }
    if (!envelope.ok) {
      const hint = envelope.hint ? `\n  hint: ${envelope.hint}` : '';
      throw new MautoError(withStderr(`mauto ${verb} failed: ${describeError(envelope.error)}${hint}`), context);
    }
    if (code !== 0) {
      throw new MautoError(withStderr(`mauto ${verb} reported ok but exited ${code}`), context);
    }
    return envelope.data;
  }

  return { run };
}

module.exports = { createMauto, MautoError, defaultExec };
