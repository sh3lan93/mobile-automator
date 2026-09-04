# mauto Observability — Slice 3 Implementation Plan (run traces, measured durations, failure evidence)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the run's self-reported numbers with measured ones. Today `duration_seconds` in every result file is whatever the calling agent passed to `--duration` (`src/cli.js:666` — `durationSeconds: duration === undefined ? 0 : Number(duration)`), and `--attempts` (`src/cli.js:580`) is the same shape: the tool asks a language model with no clock how long a run took and how many times it retried, then writes the answer down as a fact. This slice gives the run a trace — one NDJSON file per run, written by the verbs themselves — and has `result finalize` derive the duration and the failure counts from it. A supplied `--duration` that disagrees with the measured value is recorded and flagged rather than silently overridden, because the disagreement is itself the signal. It also captures a screenshot at device failures, so a failed run carries evidence instead of a narrative, and creates the result-schema additivity guard the design says does not exist and slice 4 will assume does.

**Architecture:** No new correlation flags. Device verbs correlate via the `MAUTO_RUN_ID` environment variable, exported once per run; the three `result` verbs correlate via the `--run-id` they already require (`src/cli.js:1405`, `:1440`, `:1470`). Both resolve in `buildProgram`'s existing `preAction` hook, into a module-level `resolvedRunId` alongside the `resolvedVerb` slice 1 established. `finish()` — the CLI's one process-ending path — then routes each event to `mobile-automator/.logs/run-<runId>.ndjson` *in addition to* `mauto.ndjson`, via a third entry in `defaultSinks`. That trace file is bounded by a **cap**, not by rotation, and the difference is load-bearing (see "The bounded-measurement analysis"). `result finalize` reads the trace through a new read-only `src/observe/trace.js`, derives the run's facts, writes them into a new additive `measurements` object on the result schema, and prunes stale traces. Screenshot-on-failure hooks the one window in `connectBridge` (`src/cli.js:1254`) where a bridge is live and the verdict is known.

**Tech Stack:** Node.js (CommonJS), Commander, Jest, ajv (already a dependency, used by `ScenarioValidator`). No new dependencies — this is a hard constraint, not a preference.

**Spec:** `docs/plans/2026-08-31-observability-design.md` — sections "Making B honest", "Locked invariants" (the result-schema additivity paragraph), and slice 3 of the slice ladder. The plan whose conventions and quality bar this one continues: `docs/plans/2026-09-01-observability-slice-2-plan.md`.

## Global Constraints

- **No new dependencies.** Cold start is ~112ms and one scenario is dozens of process spawns. Nothing may be added to `package.json` `dependencies`. ajv is already there.
- **No `--run-id` flag on device verbs.** Correlation for the twelve device verbs is `MAUTO_RUN_ID` and nothing else. The design says so and it is right: twelve new flags for a value that cannot change inside a run is twelve new places to forget it. `--run-id` stays exactly where it is — a `requiredOption` on `result add-step`, `result add-assertion` and `result finalize`.
- **stdout belongs exclusively to the verb's own output.** No sink may ever write to stdout, at any log level. `tests/integration/stdout-purity.test.js` is the guard and it must stay green with a run id exported.
- **The recorder must never throw and never propagate.** `record()` already guarantees this; the trace sink, the screenshot capture and the trace prune all inherit the obligation. A full disk, a read-only `.logs/`, or a dead daemon must never turn a passing verb into a failing one — and must never turn a *failing* verb into a differently-failing one.
- **The original error is never masked, replaced, or decorated.** The screenshot capture returns a value the call site deliberately ignores, and the envelope `r` reaches `emit()` byte-identical whether the capture succeeded, failed, or never ran.
- **Fields are allowlisted, never denylisted.** Any new field needs an `EVENT_FIELDS` entry in `src/observe/event.js` with `sends` and a `why`, or `makeEvent` drops it silently and `tests/lint/telemetry-redaction.test.js` fails the build. **Slice 3 adds none** — see the field audit in Task 5, which is how that rule is honoured here rather than a reason it does not apply.
- **One rotation policy.** `src/util/log-rotate.js` (`MAX_LOG_BYTES`, `rotateIfLarge`) stays the only one. The run trace uses the same *constant* under a different *action*; it does not get a second constant, a second generation, or a forked rotation function.
- **Bind, do not copy.** The file sink already accepts `logPath`; it gains one `bound` argument, not a sibling module. `defaultSinks` already accepts an options bag; it gains one key, not a `traceSinks()` twin. Two prior reviews on this branch flagged near-copies (see the slice-2 correction note); do not add a third.
- **Backwards compatibility is now enforced, not asserted.** Task 1 creates `tests/lint/result-schema-additive.test.js` and its `tests/fixtures/result_schema_v2.0.json` baseline *before* anything touches the schema. A result file written by 0.24.0 must still validate after this slice.
- **CI version gate:** this touches `src/`, so `package.json` `version` must be bumped to a value not yet in `git tag`. `main` is 0.24.0, slice 1 took the branch to `0.25.0-rc.0`, slice 2 to `0.25.0-rc.1`; neither rc is tagged. Slice 3's target is **`0.25.0-rc.2`**.
- **No `MAUTO_OBSERVE` gate, and the switch that replaces it is `MAUTO_RUN_ID`.** The design gates slices 2–5's *user-visible verbs* behind `MAUTO_OBSERVE=1`. Slice 3 adds no verb and no flag. Its three behaviour changes — a trace file, a derived `duration_seconds`, a screenshot on failure — are all downstream of a run id being present, and a run id is only present because an agent exported one. That is already an opt-in, and it is a *better* one than a second env var: one switch turns the whole slice on, and with it unset the tool behaves exactly as 0.24.0 did. A second gate would mean a user could export `MAUTO_RUN_ID`, see a trace file appear, and still get a self-reported duration — the half-built state the gate exists to prevent.
- **Platform-agnostic:** never emit `resource-id` or OS-specific element IDs in any artifact, and name no OS in `*.agnostic.md`.

---

## The bounded-measurement analysis

The cross-cutting design problem in this slice is not where to hook the trace — it is what a per-run file *is*. `mauto.ndjson` and `daemon.ndjson` are rolling diagnostics: unbounded in time, bounded in size, and the recent past is the part worth keeping. A run trace is not that. It is finite, it belongs to one run, `finalize` is its natural end, and — the fact everything below follows from — **its content is the measurement**. Stating this once here rather than re-deriving it in five task comments.

### 1. The trace must not rotate, and this is the one place the shared policy is wrong

`rotateIfLarge` renames the file at the cap and starts a fresh one. Applied to a trace, that renames the run's *beginning* out of the live file. `finalize` then reads a suffix whose first event is wherever the rotation happened to land, computes `last_ts − first_ts` over it, and writes a three-minute run down as forty seconds.

That is worse than the status quo, not better. Today's `duration_seconds` is a self-report and everyone knows it is a self-report. A rotated trace produces a number that *looks* measured, is presented as measured, and is wrong — which is exactly the failure mode this slice exists to remove, reintroduced through the back door.

So the trace is **capped**: at or past `MAX_LOG_BYTES`, appends stop. Dropping the newest events instead of the oldest keeps a contiguous prefix that starts at the true beginning of the run, so a truncated trace still yields a duration with a stated meaning — a lower bound — rather than a meaningless span. `finalize` detects the cap and records `trace_truncated: true` so nobody has to guess.

This is not a second rotation policy. It is the same constant (`MAX_LOG_BYTES`, imported, not redeclared) under a different action, expressed as one `bound: 'rotate' | 'cap'` argument on the file sink that already takes `logPath`.

### 2. The trace is an additional sink, not a redirect

The alternative — send a run's events to the trace *instead of* `mauto.ndjson` — punches a hole in the maintainer log precisely across the invocations a bug report is about, and makes the trace's cap silently drop CLI history as a side effect of a long run. Dual-writing costs one extra open/write/close of ~300 bytes per verb, against a process that costs ~112ms to start: the same arithmetic slice 2 did for the daemon, with the same answer.

### 3. `tracePath` is injected, never resolved from the environment inside `defaultSinks`

This looks like a style choice and is not. A daemon reads `MAUTO_RUN_ID` from whichever verb happened to spawn it, then outlives that run — slice 2 established that its environment is pinned at spawn and cannot change. If `defaultSinks` resolved the trace from `env`, `boundRecorder` would pick it up and the daemon would file *every subsequent run's* device calls under the first run's id. Quietly-wrong correlation is the class of bug this slice exists to remove, so the trace is opt-in at the call site: `finish()` passes it, `boundRecorder` does not, and the daemon therefore cannot write a trace even by accident.

### 4. The directory is bounded at `finalize`, and the trace is not deleted there

A trace file is capped, but the *directory* is one file per run, forever. Four options, and the reasoning for each:

| Option | Verdict |
|---|---|
| Rotate | Wrong — destroys the measurement's start (§1). |
| Delete this run's trace at finalize | Wrong, and the most tempting. The trace is the evidence behind every number `finalize` just wrote; deleting it there destroys the source at exactly the moment someone starts asking where `duration_seconds: 340` came from. It is also a policy that only cleans up the runs you did not need cleaned up: a run that crashes never reaches finalize, so its trace — the one worth keeping — is the one that survives. |
| Accumulate | Wrong — unbounded growth in a directory the user did not ask us to fill. |
| **Keep the N most recent, pruned at finalize** | **Chosen.** |

Retention is 20 traces, pruned at `finalize` and nowhere else. Finalize is off the hot path (a `readdir` per `mauto tap` would put directory scanning inside the tightest loop the tool has) and it is the only moment a run is known to be over. Keying the prune on *other* runs' traces rather than this one also handles the crashed-run case correctly: an orphaned trace is simply an older file that the next successful finalize sweeps up. The run being finalized is always excluded.

Deletion is confined to files matching `run-*.ndjson` in the resolved logs directory — files this tool created, under a name it owns. There is deliberately no retention knob: a configurable count belongs in `config.json` with the rest of the control surface, and the design's control table does not list one.

### 5. `MAUTO_RUN_ID` unset, and run ids that are not filenames

**Unset** is the common case and must cost nothing. Device verbs record to `mauto.ndjson` exactly as they do today, no trace file is created, no `run_id` field is stamped, no screenshot is captured. `finalize` finds no trace, falls back to `--duration` verbatim, and records `measurements.source: 'none'` (or `'reported'` when `--duration` was given). This is 0.24.0's behaviour, reached deliberately rather than by omission.

**Path separators and traversal.** A run id becomes a filename, and `MAUTO_RUN_ID=../../../../etc/cron.d/x` must not become a write target. The id is therefore **validated, not sanitized**, at exactly one place: `runTracePath()` returns `null` for anything that is not a safe filename, so it is impossible to *construct* a trace path from a hostile id. Sanitizing is the tempting move and is wrong here — replacing the offending characters collapses `login/smoke` and `login-smoke` onto one file, and `finalize` would then derive a duration spanning two unrelated runs. A contaminated measurement presented as measured is the same failure as §1. An id that cannot be a filename simply gets no trace, and everything degrades to the unset case above.

The accepted charset is deliberately wider than the result schema's `^run_\d{8}_\d{6}$`: `MAUTO_RUN_ID` is agent-chosen and this slice is not the place to start enforcing a pattern the CLI has never enforced. It is narrow enough that no accepted value can contain a path separator, a NUL, a drive letter, or a leading dot.

**`MAUTO_LOG_LEVEL=silent`** silences the trace along with everything else, so `finalize` falls back to the reported duration. That is the correct coupling: one switch, no surprise second channel that keeps writing after you asked for silence.

### 6. What the trace can prove, and what it cannot

The design asks for "retry/attempt counts — counted from repeated verb events against the same target". **The trace has no target.** `--at 100,250` is not a recorded field and must not become one — coordinates and element labels are exactly the free text the redaction catalog exists to keep off the wire. Step boundaries could be inferred from where the `result add-step` events fall, but that inference is only sound if the agent records each step immediately after performing it; an agent that batches its `add-step` calls at the end would file every device call under step one. Silently mis-attributing retries is the same category of confident wrongness as §1.

So slice 3 derives what needs no inference: **`device_failures`**, the count of `verb.end` events with `ok: false` and an `error_kind` of `device` or `timeout`. Every one of those is an attempt that did not take, and `deviceFail` (`src/cli.js:245`) is the only producer of those two kinds — so counting them needs no hand-maintained list of which verbs are device verbs, a list that would be wrong the first time someone added a verb and forgot it.

Per-step `retry_count` is **not** rewritten. `--attempts` is supplied by the agent at the moment it has the knowledge, and overwriting persisted steps at finalize would be a worse lie than the one it replaces. Instead the measured count is *compared* to the reported one: when the device failed at least once and every step reports zero retries, that is a provable under-report and it becomes a typed `flakiness` observation. Measurement replaces fiction where it can prove a value, and contradicts it where it can only prove a discrepancy.

---

### Task 1: The result-schema additivity guard and its v2.0 baseline

Written **first**, and against the unchanged schema, because that is the only moment the baseline is a true baseline. A fixture minted after Task 8 adds `measurements` would bake the change into the thing it is supposed to be measured against and guard nothing.

The design is explicit that this does not exist: `tests/lint/schema-additive.test.js` reads only `scenario_schema.json`, and `tests/lint/result-coverage.test.js` guards field→verb *reachability* — "can an agent fill this?" — which is a different question from "did we just invalidate every result file written last month?". Slice 4 adds result-schema fields too and will assume this guard is here.

**Files:**
- Create: `tests/fixtures/result_schema_v2.0.json` (byte-copy of `src/schemas/result_schema.json` as it stands now)
- Create: `tests/lint/result-schema-additive.test.js`

**Interfaces:**
- Consumes: `src/schemas/result_schema.json`, `ajv` (already a dependency).
- Produces: no runtime code. A build failure on any narrowing change to the result schema.

- [ ] **Step 1: Create the baseline fixture**

Copy, do not retype — a hand-transcribed baseline is a baseline that already disagrees with reality:

```bash
cp src/schemas/result_schema.json tests/fixtures/result_schema_v2.0.json
diff src/schemas/result_schema.json tests/fixtures/result_schema_v2.0.json && echo "byte-identical"
```

Expected: `byte-identical`.

- [ ] **Step 2: Write the failing test**

Create `tests/lint/result-schema-additive.test.js`:

```js
'use strict';

// Structural guard: the result schema may only ever GROW.
//
// tests/lint/schema-additive.test.js does this for the SCENARIO schema. The
// result schema had no equivalent, and result-coverage.test.js is not one: it
// asks "can an agent fill this field?", not "did this change invalidate result
// files that are already on disk?".
//
// Result files are the tool's durable output. A user's CI keeps last month's
// runs and src/memory/store.js harvests them into run-history, so narrowing a
// type, dropping an enum value, or adding a `required` field retroactively
// breaks data nobody can regenerate.
//
// The baseline is tests/fixtures/result_schema_v2.0.json — a byte-copy of the
// schema as it stood before slice 3 added anything, created FIRST for exactly
// that reason.

const fs = require('fs');
const path = require('path');
const Ajv = require('ajv');

const BASELINE = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'fixtures', 'result_schema_v2.0.json'), 'utf8')
);
const CURRENT = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'schemas', 'result_schema.json'), 'utf8')
);

// Walk both trees in lockstep, yielding one entry per OBJECT node the baseline
// defines. `cur` is undefined wherever the current schema has dropped that node
// — which every check below treats as a failure rather than as "nothing to
// compare", because a silently absent node is the whole thing being prevented.
function* walk(base, cur, pointer = '') {
  if (base === null || typeof base !== 'object' || Array.isArray(base)) return;
  yield { pointer: pointer || '/', base, cur };
  for (const key of Object.keys(base)) {
    const child = base[key];
    if (child === null || typeof child !== 'object' || Array.isArray(child)) continue;
    yield* walk(child, cur && typeof cur === 'object' ? cur[key] : undefined, `${pointer}/${key}`);
  }
}

// A JSON Schema `type` is a string or an array of strings. Normalize so
// "widened" and "narrowed" are set questions rather than two shapes.
function typeSet(node) {
  if (!node || node.type === undefined) return null;
  return new Set(Array.isArray(node.type) ? node.type : [node.type]);
}

const nodes = [...walk(BASELINE, CURRENT)];

describe('result schema is additive over v2.0', () => {
  it('has a non-trivial baseline to compare against', () => {
    // Guards the guard: an empty or truncated fixture would make every check
    // below vacuously pass.
    expect(Object.keys(BASELINE.properties).length).toBeGreaterThan(10);
    expect(nodes.length).toBeGreaterThan(20);
  });

  it('every v2.0 node still exists at the same pointer', () => {
    const dropped = nodes.filter((n) => n.cur === undefined).map((n) => n.pointer);
    expect(dropped).toEqual([]);
  });

  it('no v2.0 enum value was removed', () => {
    const removed = [];
    for (const { pointer, base, cur } of nodes) {
      if (!Array.isArray(base.enum) || !cur) continue;
      const current = Array.isArray(cur.enum) ? cur.enum : [];
      for (const value of base.enum) {
        if (!current.includes(value)) removed.push(`${pointer}/enum: ${value}`);
      }
    }
    expect(removed).toEqual([]);
  });

  it('no v2.0 type was narrowed', () => {
    const narrowed = [];
    for (const { pointer, base, cur } of nodes) {
      const before = typeSet(base);
      if (!before || !cur) continue;
      const after = typeSet(cur) || new Set();
      for (const t of before) {
        if (!after.has(t)) narrowed.push(`${pointer}/type: ${t}`);
      }
    }
    expect(narrowed).toEqual([]);
  });

  // `required` is checked for EQUALITY, not containment, because the two
  // directions break different readers and both are breaking. Growing it
  // retroactively invalidates every result file already on disk; shrinking it
  // lets a new file omit a field every consumer is entitled to assume is there.
  it('no required list grew or shrank', () => {
    const changed = [];
    for (const { pointer, base, cur } of nodes) {
      if (!Array.isArray(base.required) || !cur) continue;
      const before = [...base.required].sort();
      const after = [...(cur.required || [])].sort();
      if (JSON.stringify(before) !== JSON.stringify(after)) {
        changed.push(`${pointer}/required: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`);
      }
    }
    expect(changed).toEqual([]);
  });

  it('still accepts schema_version "2.0"', () => {
    // const today, enum if a 2.1 ever lands — same shape the scenario guard
    // uses, so a future version bump extends this rather than rewriting it.
    const node = CURRENT.properties.schema_version;
    const accepted = node.const !== undefined ? [node.const] : node.enum || [];
    expect(accepted).toContain('2.0');
  });

  // The checks above are structural. This one is behavioural, and it is the
  // one that would actually have caught a subtle break: a schema can satisfy
  // every rule above and still reject a document, through a keyword none of
  // them models. A file that used to validate and now does not IS the failure.
  it('a v2.0-era result document still validates against the current schema', () => {
    // validateFormats:false — ajv 8 ships no format implementations, and this
    // guard is about structure, not about whether `date-time` parses.
    const ajv = new Ajv({ strict: false, validateFormats: false });
    const validate = ajv.compile(CURRENT);
    const legacy = {
      run_id: 'run_20260101_120000',
      schema_version: '2.0',
      scenario_id: 'login_smoke',
      metadata: {
        app_version: '1.0.0',
        device_model: 'Pixel 7',
        api_level: '34',
        environment: 'staging',
        timestamp: '2026-01-01T12:00:00.000Z',
      },
      status: 'passed',
      total_assertions: 1,
      passed_assertions: 1,
      failed_assertions: 0,
      duration_seconds: 42,
      captured_variables: {},
      steps_executed: [
        {
          step_id: 'tap_login',
          status: 'passed',
          screenshot: null,
          error_message: null,
          retried: false,
          retry_count: 0,
          observations: null,
        },
      ],
      assertion_results: [
        { assertion_id: 'a1', status: 'passed', expected: null, actual: null, message: 'ok' },
      ],
      observations: [],
      summary: 'passed: 1/1 assertion(s) passed across 1 step(s).',
    };
    validate(legacy);
    expect(validate.errors || []).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the test**

```bash
npx jest tests/lint/result-schema-additive.test.js
```

Expected: PASS, 7 tests. Unlike a normal TDD step this one passes immediately, and that is the point: the guard is calibrated against an unchanged schema, so a green run here proves the *comparison* works before anything relies on it. Prove it can fail, then restore:

```bash
node -e "const f='src/schemas/result_schema.json';const s=JSON.parse(require('fs').readFileSync(f));s.properties.status.enum=['passed'];require('fs').writeFileSync(f,JSON.stringify(s,null,2))"
npx jest tests/lint/result-schema-additive.test.js   # expect FAIL: enum + document checks
git checkout src/schemas/result_schema.json
npx jest tests/lint/result-schema-additive.test.js   # expect PASS again
```

- [ ] **Step 4: Wire it into the lint script**

Check whether `npm run lint:guides` already globs `tests/lint/`:

```bash
node -e "console.log(require('./package.json').scripts)"
```

If the script names files individually, add `tests/lint/result-schema-additive.test.js` to it. If it points at the directory, nothing to do — say which it was in the commit body rather than guessing.

- [ ] **Step 5: Commit**

```bash
git add tests/fixtures/result_schema_v2.0.json tests/lint/result-schema-additive.test.js package.json
git commit -m "test(lint): guard the result schema against non-additive change

Created against the UNCHANGED schema so the fixture is a true baseline. The
scenario schema has had this guard since 2.1; the result schema — the tool's
durable output, which src/memory/store.js reads back across sessions — has
never had one."
```

---

### Task 2: Run-id resolution and the run-trace path

The run id is the slice's single switch and its single injection risk, so both live here: one resolver that says whether a run id exists, one path builder that is the *only* thing permitted to turn one into a filename, and which refuses.

**Files:**
- Modify: `src/observe/paths.js` (add `RUN_TRACE_PREFIX`, `isValidRunId`, `runTracePath`)
- Modify: `src/observe/settings.js` (add `resolveRunId`)
- Test: `tests/unit/observe/paths.test.js` (extend)
- Test: `tests/unit/observe/settings.test.js` (extend)

**Interfaces:**
- Consumes: `logsDir` from `src/observe/paths.js`.
- Produces:
  - `paths.RUN_TRACE_PREFIX: 'run-'`
  - `paths.isValidRunId(runId: unknown) => boolean`
  - `paths.runTracePath(projectRoot: string, runId: unknown, env?: object) => string | null`
  - `settings.resolveRunId(env?: object) => string | null`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/observe/paths.test.js`:

```js
describe('run trace paths', () => {
  const path = require('path');
  const { RUN_TRACE_PREFIX, isValidRunId, runTracePath } = require('../../../src/observe/paths');

  it('names the trace after the run, inside the logs dir', () => {
    const p = runTracePath('/proj', 'run_20260905_141500', {});
    expect(p).toBe(path.join('/proj', 'mobile-automator', '.logs', 'run-run_20260905_141500.ndjson'));
    expect(path.basename(p).startsWith(RUN_TRACE_PREFIX)).toBe(true);
  });

  it('honours MAUTO_LOG_DIR like every other log path', () => {
    const p = runTracePath('/proj', 'smoke', { MAUTO_LOG_DIR: '/tmp/elsewhere' });
    expect(p).toBe(path.join('/tmp/elsewhere', 'run-smoke.ndjson'));
  });

  it('accepts the ids agents actually use', () => {
    for (const id of ['run_20260905_141500', 'login-smoke-0031', 'a', 'v1.2.3_run', 'A0']) {
      expect(isValidRunId(id)).toBe(true);
    }
  });

  // The value reaches us from an environment variable and becomes a filename.
  // Rejecting is deliberate: sanitizing would collapse two distinct runs onto
  // one trace and produce a duration spanning both.
  it('refuses anything that is not a safe filename', () => {
    const hostile = [
      '../../../../etc/cron.d/x',
      '..',
      '.',
      '.hidden',
      'a/b',
      'a\\b',
      'C:\\runs\\x',
      '/absolute',
      'has space',
      'nul\u0000byte',
      '',
      '   ',
      'x'.repeat(200),
    ];
    for (const id of hostile) {
      expect(isValidRunId(id)).toBe(false);
      expect(runTracePath('/proj', id, {})).toBeNull();
    }
    for (const id of [undefined, null, 42, {}, []]) {
      expect(isValidRunId(id)).toBe(false);
      expect(runTracePath('/proj', id, {})).toBeNull();
    }
  });
});
```

Append to `tests/unit/observe/settings.test.js`:

```js
describe('resolveRunId', () => {
  const { resolveRunId } = require('../../../src/observe/settings');

  it('returns the exported run id', () => {
    expect(resolveRunId({ MAUTO_RUN_ID: 'run_20260905_141500' })).toBe('run_20260905_141500');
  });

  it('trims incidental whitespace from a shell export', () => {
    expect(resolveRunId({ MAUTO_RUN_ID: '  smoke \n' })).toBe('smoke');
  });

  it('returns null when unset, empty, blank or non-string', () => {
    expect(resolveRunId({})).toBeNull();
    expect(resolveRunId({ MAUTO_RUN_ID: '' })).toBeNull();
    expect(resolveRunId({ MAUTO_RUN_ID: '   ' })).toBeNull();
    expect(resolveRunId({ MAUTO_RUN_ID: 7 })).toBeNull();
    expect(resolveRunId()).toBeNull();
  });

  // Validation deliberately does NOT live here. resolveRunId answers "is there
  // a run id", runTracePath answers "can it name a file" — one gate, at the
  // point where the value becomes a path. A second predicate here could
  // disagree with that one, and the disagreement would be silent.
  it('does not validate — a hostile id is still returned, and refused downstream', () => {
    expect(resolveRunId({ MAUTO_RUN_ID: '../../etc' })).toBe('../../etc');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/unit/observe/paths.test.js tests/unit/observe/settings.test.js`
Expected: FAIL — `runTracePath is not a function`, `resolveRunId is not a function`.

- [ ] **Step 3: Write the implementations**

In `src/observe/paths.js`, add after `DAEMON_LOG_NAME`:

```js
const RUN_TRACE_PREFIX = 'run-';
```

and append before `module.exports`:

```js
// A run id becomes a FILENAME, so it is validated rather than sanitized.
//
// Sanitizing — replacing the offending characters — is the tempting move and it
// is wrong here: `login/smoke` and `login-smoke` would collapse onto one trace,
// and `result finalize` would then derive a duration spanning two unrelated
// runs. A contaminated measurement presented as measured is worse than no
// measurement, which is the whole premise of this slice. An id that cannot be a
// filename gets NO trace and everything degrades to the MAUTO_RUN_ID-unset
// case, which is 0.24.0's behaviour.
//
// The charset is deliberately WIDER than the result schema's
// ^run_\d{8}_\d{6}$: MAUTO_RUN_ID is agent-chosen and this is not the place to
// start enforcing a pattern the CLI has never enforced. It is narrow enough
// that no accepted value can contain a path separator, a NUL, a drive colon or
// a leading dot, so `..`, `../../etc/x`, `/etc/x` and `C:\x` are all rejected
// by construction rather than by a list of cases someone has to keep complete.
const RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;

function isValidRunId(runId) {
  if (typeof runId !== 'string' || !RUN_ID_PATTERN.test(runId)) return false;
  // Belt and braces against a future widening of the charset: an accepted id
  // must survive path.basename unchanged, so it can never be a path.
  return path.basename(runId) === runId;
}

// The per-run trace file, or null when the id cannot safely name one.
//
// Returning null rather than throwing is what lets every call site treat "no
// usable run id" and "no run id at all" as one already-handled case, and makes
// this the SINGLE gate: a hostile id cannot be turned into a write target
// anywhere in the codebase, because this is the only function that builds the
// path. src/observe/failure-capture.js reuses it as its own safety check for
// exactly that reason.
function runTracePath(projectRoot, runId, env = process.env) {
  if (!isValidRunId(runId)) return null;
  return path.join(logsDir(projectRoot, env), `${RUN_TRACE_PREFIX}${runId}.ndjson`);
}
```

Extend `module.exports` with `RUN_TRACE_PREFIX`, `isValidRunId`, `runTracePath`.

In `src/observe/settings.js`, add before `module.exports`:

```js
// MAUTO_RUN_ID is the ONLY correlation input for device verbs — deliberately no
// --run-id flag on the twelve of them. The agent exports it once per run; a
// value that cannot change inside a run does not want twelve flags, each of
// which is another place to forget it. The three `result` verbs correlate
// through the --run-id they already require, which cli.js prefers over this.
//
// This answers "is there a run id", not "is it usable as a filename" — that is
// runTracePath's job, and keeping it there means one gate rather than two that
// can drift apart.
function resolveRunId(env = process.env) {
  const raw = env && env.MAUTO_RUN_ID;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed === '' ? null : trimmed;
}
```

Extend `module.exports` with `resolveRunId`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/unit/observe/`
Expected: PASS. `paths.test.js` gains 4 tests, `settings.test.js` gains 4.

- [ ] **Step 5: Commit**

```bash
git add src/observe/paths.js src/observe/settings.js tests/unit/observe/paths.test.js tests/unit/observe/settings.test.js
git commit -m "feat(observe): resolve a run id and build its trace path, refusing hostile ids

runTracePath is the single gate that turns a run id into a filename, and it
returns null rather than sanitizing: two distinct ids collapsed onto one trace
would produce a duration spanning two runs, which is exactly the confident
wrongness this slice exists to remove."
```

---

### Task 3: The file sink learns a second bounding mode

**Files:**
- Modify: `src/observe/sinks/file.js`
- Test: `tests/unit/observe/sinks.test.js` (extend)

**Interfaces:**
- Consumes: `MAX_LOG_BYTES`, `rotateIfLarge` from `src/util/log-rotate.js` (already imported there).
- Produces:
  - `fileSink.write(event, { projectRoot, env, fs, logPath, bound })` where `bound` is `'rotate'` (default, today's behaviour) or `'cap'`.
  - `fileSink.atCap(target, { fs, maxBytes }) => boolean`

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/observe/sinks.test.js`:

```js
describe('file sink bounding modes', () => {
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  const fileSink = require('../../../src/observe/sinks/file');
  const { MAX_LOG_BYTES } = require('../../../src/util/log-rotate');

  function workspace() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-sink-bound-'));
    fs.mkdirSync(path.join(root, 'mobile-automator'), { recursive: true });
    return root;
  }

  const event = { ts: '2026-09-05T10:00:00.000Z', v: 1, level: 'info', event: 'verb.end' };

  it("defaults to 'rotate' — unchanged behaviour for mauto.ndjson", () => {
    const root = workspace();
    const target = path.join(root, 'mobile-automator', '.logs', 'mauto.ndjson');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, 'x'.repeat(MAX_LOG_BYTES));

    fileSink.write(event, { projectRoot: root, env: {}, logPath: target });

    expect(fs.existsSync(`${target}.1`)).toBe(true);
    expect(fs.readFileSync(target, 'utf8').trim().split('\n')).toHaveLength(1);
  });

  // The one place the shared rotation policy is wrong. A trace's CONTENT is the
  // measurement: rotating renames the run's beginning away, so the next
  // finalize would compute the span of an arbitrary suffix and report a
  // three-minute run as forty seconds — measured-looking fiction.
  it("'cap' stops appending instead of rotating the run's beginning away", () => {
    const root = workspace();
    const target = path.join(root, 'mobile-automator', '.logs', 'run-smoke.ndjson');
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const original = 'x'.repeat(MAX_LOG_BYTES);
    fs.writeFileSync(target, original);

    fileSink.write(event, { projectRoot: root, env: {}, logPath: target, bound: 'cap' });

    expect(fs.existsSync(`${target}.1`)).toBe(false);
    expect(fs.readFileSync(target, 'utf8')).toBe(original);
  });

  it("'cap' appends normally below the cap", () => {
    const root = workspace();
    const target = path.join(root, 'mobile-automator', '.logs', 'run-smoke.ndjson');

    fileSink.write(event, { projectRoot: root, env: {}, logPath: target, bound: 'cap' });
    fileSink.write(event, { projectRoot: root, env: {}, logPath: target, bound: 'cap' });

    const lines = fs.readFileSync(target, 'utf8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).event).toBe('verb.end');
  });

  it('atCap answers the same question finalize needs to ask', () => {
    const root = workspace();
    const target = path.join(root, 'mobile-automator', '.logs', 'run-smoke.ndjson');
    fs.mkdirSync(path.dirname(target), { recursive: true });

    expect(fileSink.atCap(target)).toBe(false); // no file yet
    fs.writeFileSync(target, 'small');
    expect(fileSink.atCap(target)).toBe(false);
    fs.writeFileSync(target, 'x'.repeat(MAX_LOG_BYTES));
    expect(fileSink.atCap(target)).toBe(true);
  });

  it("'cap' still respects the no-workspace rule", () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-sink-bare-'));
    const target = path.join(bare, 'mobile-automator', '.logs', 'run-smoke.ndjson');

    fileSink.write(event, { projectRoot: bare, env: {}, logPath: target, bound: 'cap' });

    expect(fs.existsSync(target)).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/unit/observe/sinks.test.js`
Expected: FAIL — `fileSink.atCap is not a function`, and the `'cap'` write rotates because `bound` is ignored.

- [ ] **Step 3: Write the implementation**

In `src/observe/sinks/file.js`, change the rotate import to also take the constant:

```js
const { MAX_LOG_BYTES, rotateIfLarge } = require('../../util/log-rotate');
```

Add above `write`:

```js
// True when the file is at or past the cap, i.e. the next event would be
// dropped. Exported because `result finalize` has to ask the same question
// about a trace it is about to read, and a second copy of the comparison would
// be a second policy that can drift from this one.
function atCap(target, { fs = realFs, maxBytes = MAX_LOG_BYTES } = {}) {
  try {
    return fs.statSync(target).size >= maxBytes;
  } catch (_) {
    // No file yet, or unreadable: nothing has been dropped.
    return false;
  }
}

// How a log file is kept bounded. TWO modes, ONE constant — this is not a
// second rotation policy, it is the same MAX_LOG_BYTES under a different
// action.
//
// 'rotate' is the shared policy: at the cap, rename to `<log>.1` and start
// fresh. Right for mauto.ndjson and daemon.ndjson, rolling diagnostics where
// the recent past is the part worth keeping.
//
// 'cap' stops appending at the cap, and the difference is not a preference. A
// per-run trace is not a rolling log: its whole CONTENT is a measurement, and
// finalize derives the run duration from its FIRST and last events. Rotating it
// renames the run's beginning out of the live file, so the next finalize would
// compute the span of an arbitrary suffix and write a three-minute run down as
// forty seconds — a number that looks measured, is reported as measured, and is
// wrong, which is strictly worse than the self-report this slice replaces.
// Dropping the NEWEST events instead keeps a contiguous prefix from the true
// start, so a truncated trace still yields a duration with a stated meaning: a
// lower bound, flagged as one via `trace_truncated`.
function shouldAppend(target, bound, fs) {
  if (bound !== 'cap') {
    rotateIfLarge(target, { fs });
    return true;
  }
  return !atCap(target, { fs });
}
```

Change `write`'s signature and body:

```js
function write(event, { projectRoot, env = process.env, fs = realFs, logPath, bound = 'rotate' } = {}) {
  try {
    if (!allowed(projectRoot, env, fs)) return;
    const target = logPath || mainLogPath(projectRoot, env);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (!shouldAppend(target, bound, fs)) return;
    fs.appendFileSync(target, format(event));
  } catch (_) {
    // Observability must never be load-bearing. Losing a log line is always
    // preferable to failing the verb the user actually asked for.
  }
}
```

Extend `module.exports` to `{ format, write, atCap }`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/unit/observe/sinks.test.js tests/unit/observe/recorder.test.js`
Expected: PASS. `sinks.test.js` gains 5 tests; `recorder.test.js` unchanged and still green (the default `bound` preserves today's behaviour exactly).

- [ ] **Step 5: Commit**

```bash
git add src/observe/sinks/file.js tests/unit/observe/sinks.test.js
git commit -m "feat(observe): give the file sink a cap mode alongside rotation

Same MAX_LOG_BYTES, different action. Rotating a run trace renames the run's
beginning away, and the beginning is where the measured duration starts."
```

---

### Task 4: The trace sink in the sink list

**Files:**
- Modify: `src/observe/recorder.js`
- Test: `tests/unit/observe/recorder.test.js` (extend)

**Interfaces:**
- Consumes: `fileSink.write`'s new `bound` argument.
- Produces:
  - `defaultSinks(projectRoot, env, { logPath, tracePath })` — 3 sinks when `tracePath` is given, 2 otherwise.
  - `record(fields, { projectRoot, env, sinks, tracePath })`.
  - `boundRecorder` unchanged and deliberately unable to trace.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/observe/recorder.test.js`:

```js
describe('run trace sink', () => {
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  const { record, defaultSinks, boundRecorder } = require('../../../src/observe/recorder');

  function workspace() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-trace-sink-'));
    fs.mkdirSync(path.join(root, 'mobile-automator'), { recursive: true });
    return root;
  }

  const lines = (p) =>
    fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim().split('\n').filter(Boolean) : [];

  it('adds a third sink only when a trace path is given', () => {
    expect(defaultSinks('/proj', {}, {})).toHaveLength(2);
    expect(defaultSinks('/proj', {}, { tracePath: '/proj/x/run-a.ndjson' })).toHaveLength(3);
  });

  // The trace is an ADDITIONAL file, not a redirect. Sending run events to the
  // trace instead would punch a hole in mauto.ndjson across exactly the
  // invocations a maintainer reading a bug report cares about.
  it('writes the event to BOTH the main log and the trace', () => {
    const root = workspace();
    const main = path.join(root, 'mobile-automator', '.logs', 'mauto.ndjson');
    const trace = path.join(root, 'mobile-automator', '.logs', 'run-smoke.ndjson');

    record(
      { level: 'info', src: 'cli', event: 'verb.end', verb: 'tap', ok: true, run_id: 'smoke' },
      { projectRoot: root, env: { MAUTO_LOG_LEVEL: 'info' }, tracePath: trace }
    );

    expect(lines(main)).toHaveLength(1);
    expect(lines(trace)).toHaveLength(1);
    expect(JSON.parse(lines(trace)[0])).toMatchObject({ verb: 'tap', run_id: 'smoke' });
  });

  it('silences the trace along with everything else at MAUTO_LOG_LEVEL=silent', () => {
    const root = workspace();
    const trace = path.join(root, 'mobile-automator', '.logs', 'run-smoke.ndjson');

    record(
      { level: 'info', src: 'cli', event: 'verb.end' },
      { projectRoot: root, env: { MAUTO_LOG_LEVEL: 'silent' }, tracePath: trace }
    );

    expect(lines(trace)).toHaveLength(0);
  });

  it('never lets a failing trace sink cost the main log its event', () => {
    const root = workspace();
    const main = path.join(root, 'mobile-automator', '.logs', 'mauto.ndjson');
    // A directory where the trace file should be: appendFileSync throws EISDIR.
    const trace = path.join(root, 'mobile-automator', '.logs', 'run-smoke.ndjson');
    fs.mkdirSync(trace, { recursive: true });

    expect(() =>
      record(
        { level: 'info', src: 'cli', event: 'verb.end' },
        { projectRoot: root, env: { MAUTO_LOG_LEVEL: 'info' }, tracePath: trace }
      )
    ).not.toThrow();
    expect(lines(main)).toHaveLength(1);
  });

  // Load-bearing, not stylistic. A daemon inherits MAUTO_RUN_ID from whichever
  // verb spawned it and then OUTLIVES that run (slice 2: its environment is
  // pinned at spawn). If defaultSinks resolved the trace from env, every later
  // run's device calls would be filed under the first run's id.
  it('cannot be reached by boundRecorder — the daemon can never write a trace', () => {
    const root = workspace();
    const observe = boundRecorder({
      projectRoot: root,
      env: { MAUTO_LOG_LEVEL: 'info', MAUTO_RUN_ID: 'smoke' },
      logPath: path.join(root, 'mobile-automator', '.logs', 'daemon.ndjson'),
      fields: { src: 'daemon' },
    });

    observe({ level: 'info', event: 'call.end', ok: true });

    expect(lines(path.join(root, 'mobile-automator', '.logs', 'run-smoke.ndjson'))).toHaveLength(0);
    expect(lines(path.join(root, 'mobile-automator', '.logs', 'daemon.ndjson'))).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/unit/observe/recorder.test.js`
Expected: FAIL — `defaultSinks(..., { tracePath })` returns 2 sinks and no trace file is written.

- [ ] **Step 3: Write the implementation**

In `src/observe/recorder.js`, replace `defaultSinks`:

```js
// `logPath` is passed straight through to the file sink, which already takes it
// and falls back to mauto.ndjson when it is undefined. So omitting it is
// exactly today's CLI behaviour, and naming it is how a writer with its own log
// file (the daemon's daemon.ndjson) gets one without a second copy of this list.
//
// `tracePath` adds a THIRD sink — the per-run trace — and two things about it
// are deliberate:
//
//   ADDITIONAL, not a redirect. Sending a run's events to the trace instead of
//   mauto.ndjson would punch a hole in the maintainer log across exactly the
//   invocations a bug report is about, and would let the trace's cap silently
//   drop CLI history. The cost of writing both is one extra ~300-byte
//   open/write/close per verb against a 112ms process start.
//
//   INJECTED, never resolved from `env` here. A daemon reads MAUTO_RUN_ID from
//   whichever verb spawned it and then outlives that run — its environment is
//   pinned at spawn and cannot change. Resolving the trace from `env` would
//   make boundRecorder pick it up, and the daemon would file every later run's
//   device calls under the first run's id. Only cli.js's finish() passes this.
function defaultSinks(projectRoot, env, { logPath, tracePath } = {}) {
  const levels = resolveLevels(env);
  const sinks = [
    { threshold: levels.stderr, write: (e) => stderrSink.write(e) },
    { threshold: levels.file, write: (e) => fileSink.write(e, { projectRoot, env, logPath }) },
  ];
  if (tracePath) {
    sinks.push({
      threshold: levels.file,
      // bound:'cap' — a trace must not rotate; see sinks/file.js.
      write: (e) => fileSink.write(e, { projectRoot, env, logPath: tracePath, bound: 'cap' }),
    });
  }
  return sinks;
}
```

and thread `tracePath` through `record`:

```js
function record(
  fields = {},
  { projectRoot = process.cwd(), env = process.env, sinks, tracePath } = {}
) {
  try {
    const level = fields.level || 'info';
    const list = sinks || defaultSinks(projectRoot, env, { tracePath });
```

`boundRecorder` is unchanged: it calls `defaultSinks(projectRoot, env, { logPath })` with no `tracePath` and passes `{ projectRoot, env, sinks }` to `record`, so the trace is unreachable from it by construction rather than by convention.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/unit/observe/ tests/unit/device/`
Expected: PASS. `recorder.test.js` gains 5 tests; the daemon suites are untouched.

- [ ] **Step 5: Commit**

```bash
git add src/observe/recorder.js tests/unit/observe/recorder.test.js
git commit -m "feat(observe): route events to a per-run trace alongside the main log

tracePath is injected rather than resolved from env, so boundRecorder — and
therefore the daemon, whose environment is pinned at spawn — cannot file a
later run's device calls under the run id it happened to inherit."
```

---

### Task 5: Wire the CLI — run id, session id, and the trace at every exit path

The three module-level `let`s here follow `resolvedVerb`'s pattern for `resolvedVerb`'s reason: `finish()` is module-level and is reached from inside commander's own call stack, so there is nowhere else to put them.

**The field audit.** This slice records `run_id`, `session_id`, `path`, `verb`, `ok`, `error_kind`, `exit_code`, `dur_ms`, `level`, `src`, `event` and `message`. Every one already has an `EVENT_FIELDS` entry from slices 1–2, so **slice 3 adds no catalog field and no change to `tests/lint/telemetry-redaction.test.js`**. That is the rule being honoured, not skipped: `run_id` and `path` are already `sends: false` with stated reasons ("agent-chosen; routinely names an unreleased feature", "leaks usernames and project layout"), and `session_id` is already `sends: true` on the strength of `newSessionId`'s zero-arity CSPRNG. Step 1 pins the audit with a test so a later field cannot arrive unclassified.

**Files:**
- Modify: `src/cli.js` (module-level state, `preAction` hook, `connectBridge`, `finish`)
- Test: `tests/unit/cli/` — extend the suite that covers `buildProgram`'s hooks (locate with `grep -rl "preAction\|resolvedVerb" tests/`)
- Test: `tests/integration/cli-observability.test.js` (extend)

**Interfaces:**
- Consumes: `settings.resolveRunId`, `paths.runTracePath`, `session-handle.readSessionId`.
- Produces: every CLI event carries `run_id` when a run id resolved, and `session_id` when the verb reached the device. A `run-<id>.ndjson` exists after any verb run with a run id.

- [ ] **Step 1: Write the failing tests**

Append to `tests/integration/cli-observability.test.js` (the harness `runCli` already spawns the real bin and reads `mauto.ndjson`; add a trace reader beside it):

```js
describe('run traces (integration)', () => {
  function traceOf(runId, logDir) {
    const file = path.join(logDir, `run-${runId}.ndjson`);
    return fs.existsSync(file)
      ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
      : [];
  }

  // Same shape as runCli above, but hands back the log dir so the trace beside
  // mauto.ndjson can be read too.
  function runTraced(args, env = {}) {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-trace-cli-'));
    const logDir = path.join(cwd, 'logs');
    const res = spawnSync(process.execPath, [CLI, ...args], {
      cwd,
      encoding: 'utf8',
      env: { ...process.env, MAUTO_LOG_DIR: logDir, MAUTO_LOG_LEVEL: 'info', ...env },
    });
    return { status: res.status, stdout: res.stdout || '', logDir };
  }

  it('writes the verb into the trace named by MAUTO_RUN_ID', () => {
    const run = runTraced(['config', 'get', 'mode'], { MAUTO_RUN_ID: 'run_20260905_141500' });
    const events = traceOf('run_20260905_141500', run.logDir);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event: 'verb.end', verb: 'config', run_id: 'run_20260905_141500' });
  });

  it('writes no trace when MAUTO_RUN_ID is unset', () => {
    const run = runTraced(['config', 'get', 'mode']);
    expect(fs.readdirSync(run.logDir).filter((n) => n.startsWith('run-'))).toEqual([]);
  });

  // The result verbs correlate through the --run-id they ALREADY require, so a
  // step lands in the same trace as the device verbs around it with no new flag
  // and no environment variable.
  it('files a result verb under its --run-id with no env var set', () => {
    const run = runTraced([
      'result', 'add-step', '--run-id', 'run_20260905_141500',
      '--step-id', 'tap_login', '--status', 'pass',
    ]);
    const events = traceOf('run_20260905_141500', run.logDir);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ verb: 'result', run_id: 'run_20260905_141500' });
  });

  it('prefers an explicit --run-id over an ambient MAUTO_RUN_ID', () => {
    const run = runTraced(
      ['result', 'add-step', '--run-id', 'explicit', '--step-id', 's', '--status', 'pass'],
      { MAUTO_RUN_ID: 'ambient' }
    );
    expect(traceOf('explicit', run.logDir)).toHaveLength(1);
    expect(traceOf('ambient', run.logDir)).toHaveLength(0);
  });

  // A parse failure reaches no action and has no verb (#146) — but it is still
  // part of the run, and it is the class of failure this instrumentation exists
  // to see, so it must reach the trace too.
  it('traces a parse failure, with no verb name', () => {
    const run = runTraced(['tap', '--nonsense'], { MAUTO_RUN_ID: 'smoke' });
    const events = traceOf('smoke', run.logDir);
    expect(events).toHaveLength(1);
    expect(events[0].ok).toBe(false);
    expect(events[0]).not.toHaveProperty('verb');
  });

  // The hostile-id case, end to end: nothing is written outside the log dir and
  // the verb itself is completely unaffected.
  it('refuses a traversing run id without failing the verb', () => {
    const run = runTraced(['config', 'get', 'mode'], { MAUTO_RUN_ID: '../../escaped' });
    expect(run.status).toBe(0);
    expect(JSON.parse(run.stdout).ok).toBe(true);
    expect(fs.readdirSync(run.logDir).filter((n) => n.startsWith('run-'))).toEqual([]);
    expect(fs.existsSync(path.join(run.logDir, '..', '..', 'escaped.ndjson'))).toBe(false);
  });

  it('keeps stdout to exactly one JSON object with a run id exported', () => {
    const run = runTraced(['config', 'get', 'mode'], {
      MAUTO_RUN_ID: 'smoke',
      MAUTO_LOG_LEVEL: 'debug',
    });
    expect(() => JSON.parse(run.stdout)).not.toThrow();
  });
});
```

And pin the field audit — append to `tests/unit/observe/event.test.js`:

```js
it('already classifies every field slice 3 records', () => {
  // Slice 3 adds NO new catalog field, and this is what keeps that true: a
  // later change that starts recording something unclassified fails here
  // rather than having makeEvent drop it silently.
  const { EVENT_FIELDS } = require('../../../src/observe/event');
  for (const f of ['run_id', 'session_id', 'path', 'verb', 'ok', 'error_kind', 'dur_ms', 'message']) {
    expect(EVENT_FIELDS[f]).toBeDefined();
    expect(typeof EVENT_FIELDS[f].why).toBe('string');
  }
  expect(EVENT_FIELDS.run_id.sends).toBe(false);
  expect(EVENT_FIELDS.path.sends).toBe(false);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/integration/cli-observability.test.js tests/unit/observe/event.test.js`
Expected: FAIL — no `run-*.ndjson` is produced by any invocation. The `event.test.js` addition passes immediately, which is the audit's result, not a gap.

- [ ] **Step 3: Write the implementation**

In `src/cli.js`, extend the imports:

```js
const { record } = require('./observe/recorder');
const { resolveRunId } = require('./observe/settings');
const { runTracePath } = require('./observe/paths');
const { readSessionId } = require('./device/session-handle');
```

Add beside `resolvedVerb` (after its existing comment block):

```js
// The run this invocation belongs to, and the daemon lifetime it used.
//
// Both follow resolvedVerb's pattern for resolvedVerb's reason: finish() is
// module-level and the three exit paths reach it from inside commander's own
// call stack, so there is nowhere else to put them. Both are reset per
// buildProgram() so a test that builds two programs in one process cannot
// inherit the previous run's correlation.
//
// resolvedRunId is NOT validated here. It becomes a filename in exactly one
// place — runTracePath — which refuses anything unsafe and returns null, so a
// second predicate here could only disagree with that one.
let resolvedRunId = null;
// Set ONLY by connectBridge, and only after a successful connect. That is what
// makes `session_id` on a CLI event mean "this verb reached the device through
// that daemon", which in turn is why deriving device work from the trace needs
// no hand-maintained list of which verbs are device verbs.
let resolvedSessionId = null;
```

Extend the `preAction` registration in `buildProgram`:

```js
  resolvedVerb = null;
  resolvedRunId = null;
  resolvedSessionId = null;
  program.hook('preAction', (_thisCommand, actionCommand) => {
    // Read --run-id off the INNERMOST command (`add-step`) before walking up to
    // name the verb (`result`). The three result verbs already require it, so
    // they correlate with no new flag and no environment variable; an explicit
    // flag beats the ambient MAUTO_RUN_ID because it is scoped to this
    // invocation and the environment is not.
    const opts = actionCommand.opts();
    resolvedRunId =
      (typeof opts.runId === 'string' && opts.runId ? opts.runId : null) || resolveRunId(process.env);
    let command = actionCommand;
    while (command.parent && command.parent.parent) command = command.parent;
    resolvedVerb = command.name();
  });
```

`preAction` fires only on a successful parse, so a parse failure never reaches it. `finish()` therefore falls back to the environment on its own — see below — which is what makes the parse-failure trace test pass.

In `connectBridge`, add the handle read after a successful connect:

```js
    try {
      ({ bridge, close } = await deviceBridgeFactory({ device, projectRoot }));
      // AFTER the connect, deliberately: the handle is written when the daemon
      // starts listening, so before this point it may legitimately not exist
      // yet. Best-effort — readSessionId never throws and returns null for an
      // absent or malformed handle, which is a normal state (a one-shot
      // fallback connection has no daemon at all).
      resolvedSessionId = readSessionId(projectRoot);
    } catch (err) {
      emit(deviceFail(err), humanFlag());
      return;
    }
```

Rewrite `finish()`'s `record` call:

```js
function finish({ text, exitKind, ok, errorKind }) {
  // process.cwd() is stated rather than left to record()'s default so the same
  // root reaches BOTH the main log and the trace. It is the same value the
  // default produced, so this is not a behaviour change — it is making an
  // existing default visible at the one call site that now depends on it.
  const projectRoot = process.cwd();
  // The flag-resolved id when a command parsed, the environment otherwise: a
  // parse failure reaches no preAction hook and so has no flag, but it is still
  // part of the run and is exactly the class of failure (#146) this
  // instrumentation exists to see.
  const runId = resolvedRunId || resolveRunId(process.env);
  // null for an id that cannot safely name a file. Every hostile MAUTO_RUN_ID
  // lands here as "no trace", indistinguishable from having exported none.
  const tracePath = runTracePath(projectRoot, runId);

  // Record BEFORE the write: process.exit() below is immediate and would cut
  // off any work queued after it.
  record(
    {
      event: 'verb.end',
      level: 'info',
      src: 'cli',
      verb: resolvedVerb || undefined,
      // Recorded even when the id could not name a trace file: the correlation
      // still belongs in mauto.ndjson, where it is the only thing tying this
      // line to a run. sends:false in the event catalog.
      run_id: runId || undefined,
      session_id: resolvedSessionId || undefined,
      ok,
      error_kind: errorKind,
      exit_code: exitCodeFor(exitKind),
      dur_ms: Math.round(process.uptime() * 1000),
    },
    { projectRoot, tracePath: tracePath || undefined }
  );
  process.stdout.write(text.endsWith('\n') ? text : text + '\n');
  process.exit(exitCodeFor(exitKind));
}
```

The `level: 'info'` comment block above the field stays as-is; it is unchanged and still correct.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest tests/integration/ tests/unit/observe/ tests/unit/cli
```

Expected: PASS. `cli-observability.test.js` gains 7 tests; `stdout-purity.test.js` unchanged and green.

- [ ] **Step 5: Commit**

```bash
git add src/cli.js tests/integration/cli-observability.test.js tests/unit/observe/event.test.js
git commit -m "feat(cli): correlate every exit path into a per-run trace

MAUTO_RUN_ID for device verbs, the --run-id the result verbs already require
for those, and no new flag anywhere. Parse failures fall back to the
environment because they never reach a preAction hook — and they are the class
of failure this instrumentation exists to see."
```

---

### Task 6: Screenshot-on-failure at the one live-bridge window

`connectBridge` has two failure paths and only one is usable. The first `catch` handles a *connect* failure: there is no bridge there, so there is nothing to take a picture with. The capture belongs in the second `try`, after `fn(bridge)` has produced a device-kind fail envelope and **before** `finally` calls `close()` — the only window where the bridge is live and the verdict is known.

**Files:**
- Create: `src/observe/failure-capture.js`
- Modify: `src/cli.js` (`connectBridge`)
- Test: `tests/unit/observe/failure-capture.test.js` (create)

**Interfaces:**
- Consumes: `record` from `src/observe/recorder.js`, `runTracePath` from `src/observe/paths.js`, a `DeviceBridge` with `screenshot(destPath)`.
- Produces: `captureOnFailure({ bridge, result, projectRoot, runId, verb, env, fs }) => Promise<string|null>`, and a `screenshot.on_failure` (or `screenshot.capture_failed`) event in the trace.

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/observe/failure-capture.test.js`:

```js
'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

const { captureOnFailure } = require('../../../src/observe/failure-capture');

function workspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-failcap-'));
  fs.mkdirSync(path.join(root, 'mobile-automator'), { recursive: true });
  return root;
}

function traceEvents(root, runId) {
  const file = path.join(root, 'mobile-automator', '.logs', `run-${runId}.ndjson`);
  return fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l))
    : [];
}

const ENV = { MAUTO_LOG_LEVEL: 'info' };

const failing = (kind) => ({
  envelope: { ok: false, error: { kind, message: 'element not found' } },
  exitKind: kind,
});
const passing = () => ({ envelope: { ok: true, data: {} }, exitKind: 'ok' });

function fakeBridge() {
  const calls = [];
  return {
    calls,
    async screenshot(dest) {
      calls.push(dest);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.writeFileSync(dest, 'PNG');
      return dest;
    },
  };
}

describe('screenshot on device failure', () => {
  it('captures on a device failure and records the path in the trace', async () => {
    const root = workspace();
    const bridge = fakeBridge();

    const shot = await captureOnFailure({
      bridge, result: failing('device'), projectRoot: root, runId: 'smoke', verb: 'tap', env: ENV,
    });

    expect(shot).toBeTruthy();
    expect(fs.existsSync(shot)).toBe(true);
    // Under screenshots/, which mobile-automator/.gitignore covers.
    expect(shot.startsWith(path.join(root, 'mobile-automator', 'screenshots', 'smoke'))).toBe(true);

    const events = traceEvents(root, 'smoke');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      event: 'screenshot.on_failure', verb: 'tap', run_id: 'smoke', error_kind: 'device', path: shot,
    });
  });

  // A timed-out call may have PARTIALLY executed — session-client says so in
  // its own hint — so the screen is the only way to learn what happened. It is
  // arguably the more valuable of the two kinds.
  it('captures on a timeout too', async () => {
    const root = workspace();
    const shot = await captureOnFailure({
      bridge: fakeBridge(), result: failing('timeout'), projectRoot: root, runId: 'smoke', verb: 'type', env: ENV,
    });
    expect(shot).toBeTruthy();
    expect(traceEvents(root, 'smoke')[0].error_kind).toBe('timeout');
  });

  it('captures nothing on success, invalid_input or internal', async () => {
    const root = workspace();
    for (const result of [passing(), failing('invalid_input'), failing('internal')]) {
      const bridge = fakeBridge();
      const shot = await captureOnFailure({
        bridge, result, projectRoot: root, runId: 'smoke', verb: 'tap', env: ENV,
      });
      expect(shot).toBeNull();
      expect(bridge.calls).toEqual([]);
    }
    expect(traceEvents(root, 'smoke')).toEqual([]);
  });

  // No run id means no trace to reference the file from and no finalize to
  // collect it, so the PNG would be litter in a directory the user did not ask
  // us to fill. It also makes the run id the single switch for this slice.
  it('captures nothing without a usable run id', async () => {
    const root = workspace();
    for (const runId of [null, undefined, '', '../../escaped', 'a/b']) {
      const bridge = fakeBridge();
      const shot = await captureOnFailure({
        bridge, result: failing('device'), projectRoot: root, runId, verb: 'tap', env: ENV,
      });
      expect(shot).toBeNull();
      expect(bridge.calls).toEqual([]);
    }
  });

  // THE property. The capture is itself a daemon round-trip and can fail for
  // exactly the reasons the original call failed.
  it('records and discards its own failure, never throwing and never touching the result', async () => {
    const root = workspace();
    const result = failing('device');
    const before = JSON.stringify(result);
    const bridge = {
      async screenshot() {
        const e = new Error('daemon socket closed');
        e.kind = 'device';
        throw e;
      },
    };

    let shot;
    await expect(
      (async () => {
        shot = await captureOnFailure({
          bridge, result, projectRoot: root, runId: 'smoke', verb: 'tap', env: ENV,
        });
      })()
    ).resolves.toBeUndefined();

    expect(shot).toBeNull();
    expect(JSON.stringify(result)).toBe(before);

    const events = traceEvents(root, 'smoke');
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ event: 'screenshot.capture_failed', verb: 'tap' });
    expect(events[0].message).toContain('daemon socket closed');
  });

  it('survives a bridge with no screenshot method and an unwritable workspace', async () => {
    const root = workspace();
    await expect(
      captureOnFailure({ bridge: {}, result: failing('device'), projectRoot: root, runId: 'smoke', env: ENV })
    ).resolves.toBeNull();
    await expect(
      captureOnFailure({ bridge: null, result: failing('device'), projectRoot: root, runId: 'smoke', env: ENV })
    ).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/unit/observe/failure-capture.test.js`
Expected: FAIL — `Cannot find module '../../../src/observe/failure-capture'`.

- [ ] **Step 3: Write the implementation**

Create `src/observe/failure-capture.js`:

```js
'use strict';

// Photograph a device failure while the bridge is still live.
//
// The value is in what it replaces: today a failed run's result file carries
// the agent's NARRATIVE of what the screen looked like. This makes it carry the
// screen.
//
// It is a module rather than four lines inside connectBridge because every one
// of its rules is a rule about failure handling, and they are easier to state —
// and to test — where they are not interleaved with commander:
//
//   1. It never throws. A capture is a daemon round-trip and can fail for
//      exactly the reasons the original call failed.
//   2. It never touches the caller's result. The original error is what the
//      agent needs; the screenshot is a footnote. The return value is
//      deliberately ignored at the call site, and the envelope reaches emit()
//      byte-identical whether this succeeded, failed, or never ran.
//   3. It captures only what it can correlate. With no run id there is no trace
//      to reference the file from and no finalize to collect it, so the PNG
//      would be litter in a directory the user did not ask us to fill — the
//      same argument the file sink already makes about creating
//      mobile-automator/. It also makes the run id the single switch for this
//      whole slice: export it and you get traces, measured durations and
//      failure evidence; leave it unset and 0.24.0's behaviour is unchanged.

const realFs = require('fs');
const path = require('path');

const { record } = require('./recorder');
const { runTracePath } = require('./paths');

// The failure kinds worth a picture.
//
// `device` is the ordinary "the device said no". `timeout` is included
// deliberately and is arguably the more valuable of the two: a timed-out call
// may have PARTIALLY executed — session-client's own hint says so — and the
// screen is the only way to find out what actually happened.
//
// `invalid_input` is excluded: nothing reached the device, so the picture would
// show the state BEFORE the verb and be evidence of nothing. `internal` is
// excluded for the same reason, and because a crashed CLI has a stack trace,
// which is the artifact that actually helps.
const CAPTURED_KINDS = new Set(['device', 'timeout']);

function isCapturable(result) {
  return Boolean(
    result && result.envelope && result.envelope.ok === false && CAPTURED_KINDS.has(result.exitKind)
  );
}

// mobile-automator/screenshots/<runId>/<verb>-<ts>.png.
//
// Under screenshots/, NOT results/<run_id>/screenshots/ which the execute guide
// uses for agent-directed captures, because `mauto setup` writes
// mobile-automator/.gitignore covering `screenshots/` and not the results tree.
// A photograph of a failing app is precisely the artifact that must not ride
// into a user's commit on a `git add -A`.
function failureShotPath(projectRoot, runId, verb) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  return path.join(
    projectRoot,
    'mobile-automator',
    'screenshots',
    runId,
    `${verb || 'device'}-${stamp}.png`
  );
}

async function captureOnFailure({
  bridge,
  result,
  projectRoot,
  runId,
  verb,
  env = process.env,
  fs = realFs,
} = {}) {
  // Resolved once and reused as BOTH the trace target and the is-this-id-safe
  // predicate — one gate rather than a second check that can disagree with it.
  const tracePath = runTracePath(projectRoot, runId, env);
  try {
    if (!isCapturable(result)) return null;
    if (!tracePath) return null;
    if (!bridge || typeof bridge.screenshot !== 'function') return null;

    const dest = failureShotPath(projectRoot, runId, verb);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    // Bounded by the layers below, not here: the daemon fails a call at
    // DAEMON_CALL_TIMEOUT_MS and the client gives up on a reply at its own
    // timeout, so this cannot wait forever. A third bound would be a third
    // policy to keep in step with the other two.
    const saved = (await bridge.screenshot(dest)) || dest;

    record(
      {
        // info, not warn — the inverse of slice 2's daemon choice, for slice
        // 2's own reason. The daemon's stderr is a log file; the CLI's is a
        // human's terminal, and the envelope has already told them the verb
        // failed. A second line about the screenshot is noise on top of noise.
        level: 'info',
        src: 'cli',
        event: 'screenshot.on_failure',
        verb,
        run_id: runId,
        error_kind: result.envelope.error && result.envelope.error.kind,
        // sends:false in the event catalog — a path leaks usernames and project
        // layout, so it stays local. `result finalize` reads it back from here.
        path: saved,
      },
      { projectRoot, env, tracePath }
    );
    return saved;
  } catch (err) {
    // Recorded and discarded. Replacing the original error with "could not take
    // a screenshot" would answer a question nobody asked and lose the answer to
    // the one they did.
    try {
      record(
        {
          level: 'info',
          src: 'cli',
          event: 'screenshot.capture_failed',
          verb,
          run_id: runId,
          message: (err && (err.message || String(err))) || 'unknown capture failure',
        },
        { projectRoot, env, tracePath }
      );
    } catch (_) {
      // record() is already total; this exists so the outer catch cannot itself
      // be the thing that throws.
    }
    return null;
  }
}

module.exports = { captureOnFailure, isCapturable, CAPTURED_KINDS };
```

In `src/cli.js`, import it and hook the one usable window:

```js
const { captureOnFailure } = require('./observe/failure-capture');
```

```js
    try {
      const r = await fn(bridge);
      // The ONE window where a device failure can still be photographed: after
      // fn(bridge) has produced its verdict and before `finally` closes the
      // connection. The connect-failure catch above cannot do this — there is
      // no bridge there — which is why this is here and not wrapped around the
      // whole function.
      //
      // The return value is deliberately unused. `r` reaches emit() untouched
      // whether the capture succeeded, failed, or never ran; a screenshot must
      // never mask or replace the error the caller actually asked about.
      await captureOnFailure({
        bridge,
        result: r,
        projectRoot,
        runId: resolvedRunId,
        verb: resolvedVerb,
      });
      emit(r, humanFlag());
    } finally {
      if (typeof close === 'function') await close();
    }
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest tests/unit/observe/failure-capture.test.js tests/unit/cli tests/integration/
```

Expected: PASS. `failure-capture.test.js` 6 tests; the existing device-verb CLI tests still green — they inject a `deviceBridgeFactory` whose bridge has no `screenshot`, or a run id that never resolves, so the capture short-circuits.

- [ ] **Step 5: Commit**

```bash
git add src/observe/failure-capture.js src/cli.js tests/unit/observe/failure-capture.test.js
git commit -m "feat(observe): capture a screenshot at device failures

Hooked in the one window where the bridge is live and the verdict is known:
after fn(bridge) returns, before finally closes it. The connect-failure catch
has no bridge to photograph with. The capture is itself a daemon round-trip, so
its own failure is recorded and discarded — it never masks the original error."
```

---

### Task 7: Reading a trace and deriving what it can prove

**Files:**
- Create: `src/observe/trace.js`
- Test: `tests/unit/observe/trace.test.js` (create)

**Interfaces:**
- Consumes: `atCap` from `src/observe/sinks/file.js`, `logsDir` / `runTracePath` / `RUN_TRACE_PREFIX` from `src/observe/paths.js`.
- Produces:
  - `readTrace(tracePath, { fs }) => { events, truncated } | null`
  - `deriveRun(trace) => { duration_seconds, trace_events, device_failures, trace_truncated, failure_screenshots } | null`
  - `pruneRunTraces(projectRoot, { keep, except, env, fs }) => number`
  - `KEEP_RUN_TRACES`

- [ ] **Step 1: Write the failing tests**

Create `tests/unit/observe/trace.test.js`:

```js
'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

const { readTrace, deriveRun, pruneRunTraces, KEEP_RUN_TRACES } = require('../../../src/observe/trace');
const { MAX_LOG_BYTES } = require('../../../src/util/log-rotate');

function logsRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-trace-'));
  fs.mkdirSync(path.join(root, 'mobile-automator', '.logs'), { recursive: true });
  return root;
}

function writeTrace(root, runId, events) {
  const file = path.join(root, 'mobile-automator', '.logs', `run-${runId}.ndjson`);
  fs.writeFileSync(file, events.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return file;
}

const at = (iso, extra = {}) => ({ ts: iso, v: 1, src: 'cli', event: 'verb.end', ok: true, ...extra });

describe('readTrace', () => {
  it('returns null for a run that left no trace', () => {
    expect(readTrace(path.join(logsRoot(), 'nope.ndjson'))).toBeNull();
    expect(readTrace(null)).toBeNull();
  });

  // A trailing partial line is NORMAL, not corruption: a SIGKILLed process can
  // be interrupted mid-append, and the trace of a run that died is the trace
  // most worth reading.
  it('skips unparseable lines rather than failing', () => {
    const root = logsRoot();
    const file = path.join(root, 'mobile-automator', '.logs', 'run-x.ndjson');
    fs.writeFileSync(file, `${JSON.stringify(at('2026-09-05T10:00:00.000Z'))}\n{"ts":"2026-09`);
    const trace = readTrace(file);
    expect(trace.events).toHaveLength(1);
    expect(trace.truncated).toBe(false);
  });

  it('reports a trace that reached its cap', () => {
    const root = logsRoot();
    const file = path.join(root, 'mobile-automator', '.logs', 'run-x.ndjson');
    fs.writeFileSync(file, `${JSON.stringify(at('2026-09-05T10:00:00.000Z'))}\n`.padEnd(MAX_LOG_BYTES, ' '));
    expect(readTrace(file).truncated).toBe(true);
  });
});

describe('deriveRun', () => {
  it('measures the span between the first and last recorded event', () => {
    const root = logsRoot();
    const file = writeTrace(root, 'x', [
      at('2026-09-05T10:00:00.000Z', { verb: 'launch' }),
      at('2026-09-05T10:00:41.500Z', { verb: 'tap' }),
      at('2026-09-05T10:02:20.250Z', { verb: 'result' }),
    ]);
    const d = deriveRun(readTrace(file));
    expect(d.duration_seconds).toBe(140.25);
    expect(d.trace_events).toBe(3);
    expect(d.trace_truncated).toBe(false);
  });

  // Counted from the envelope's own taxonomy, which deviceFail is the only
  // producer of — so this needs no hand-maintained list of device verbs.
  it('counts device and timeout failures and nothing else', () => {
    const root = logsRoot();
    const file = writeTrace(root, 'x', [
      at('2026-09-05T10:00:00.000Z', { verb: 'tap', ok: false, error_kind: 'device' }),
      at('2026-09-05T10:00:05.000Z', { verb: 'type', ok: false, error_kind: 'timeout' }),
      at('2026-09-05T10:00:06.000Z', { verb: 'tap', ok: false, error_kind: 'invalid_input' }),
      at('2026-09-05T10:00:07.000Z', { verb: 'tap', ok: true }),
    ]);
    expect(deriveRun(readTrace(file)).device_failures).toBe(2);
  });

  it('collects the failure screenshots the capture recorded', () => {
    const root = logsRoot();
    const file = writeTrace(root, 'x', [
      at('2026-09-05T10:00:00.000Z'),
      { ts: '2026-09-05T10:00:01.000Z', event: 'screenshot.on_failure', path: '/p/a.png' },
      { ts: '2026-09-05T10:00:02.000Z', event: 'screenshot.capture_failed', message: 'boom' },
      at('2026-09-05T10:00:03.000Z'),
    ]);
    expect(deriveRun(readTrace(file)).failure_screenshots).toEqual(['/p/a.png']);
  });

  // Two stamps or nothing. A single-event trace spans zero time, and reporting
  // 0 as a MEASURED duration would be a confident lie where "we did not
  // measure" is the truth — finalize falls back to the reported value.
  it('refuses to measure a duration from fewer than two stamps', () => {
    const root = logsRoot();
    const file = writeTrace(root, 'x', [at('2026-09-05T10:00:00.000Z')]);
    const d = deriveRun(readTrace(file));
    expect(d.duration_seconds).toBeNull();
    expect(d.trace_events).toBe(1);
  });

  it('ignores events with a missing or unparseable timestamp', () => {
    const root = logsRoot();
    const file = writeTrace(root, 'x', [
      at('2026-09-05T10:00:00.000Z'),
      { event: 'verb.end', ok: true },
      { ts: 'not-a-date', event: 'verb.end', ok: true },
      at('2026-09-05T10:00:10.000Z'),
    ]);
    expect(deriveRun(readTrace(file)).duration_seconds).toBe(10);
  });

  it('returns null for no trace and for an empty one', () => {
    expect(deriveRun(null)).toBeNull();
    expect(deriveRun({ events: [], truncated: false })).toBeNull();
  });
});

describe('pruneRunTraces', () => {
  function seed(root, count) {
    const dir = path.join(root, 'mobile-automator', '.logs');
    for (let i = 0; i < count; i += 1) {
      const file = path.join(dir, `run-old${i}.ndjson`);
      fs.writeFileSync(file, '{}\n');
      // Oldest first, so the sort under test has something to sort.
      fs.utimesSync(file, new Date(1e9 + i * 1000), new Date(1e9 + i * 1000));
    }
  }

  it('keeps the most recent traces and deletes the rest', () => {
    const root = logsRoot();
    seed(root, KEEP_RUN_TRACES + 5);
    const removed = pruneRunTraces(root, { except: 'current', env: {} });
    const left = fs.readdirSync(path.join(root, 'mobile-automator', '.logs')).filter((n) => n.startsWith('run-'));
    expect(removed).toBe(6); // keep-1 slots, because `current` holds one
    expect(left).toHaveLength(KEEP_RUN_TRACES - 1);
    expect(left).toContain(`run-old${KEEP_RUN_TRACES + 4}.ndjson`);
    expect(left).not.toContain('run-old0.ndjson');
  });

  // The trace is the evidence behind every number finalize just wrote.
  it('never deletes the trace of the run being finalized', () => {
    const root = logsRoot();
    seed(root, KEEP_RUN_TRACES + 5);
    writeTrace(root, 'current', [at('2026-09-05T10:00:00.000Z')]);
    pruneRunTraces(root, { except: 'current', env: {} });
    expect(fs.existsSync(path.join(root, 'mobile-automator', '.logs', 'run-current.ndjson'))).toBe(true);
  });

  it('touches nothing that is not a run trace', () => {
    const root = logsRoot();
    const dir = path.join(root, 'mobile-automator', '.logs');
    fs.writeFileSync(path.join(dir, 'mauto.ndjson'), '{}\n');
    fs.writeFileSync(path.join(dir, 'daemon.ndjson'), '{}\n');
    fs.writeFileSync(path.join(dir, 'run-notes.txt'), 'x');
    seed(root, KEEP_RUN_TRACES + 3);

    pruneRunTraces(root, { except: 'current', env: {} });

    expect(fs.existsSync(path.join(dir, 'mauto.ndjson'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'daemon.ndjson'))).toBe(true);
    expect(fs.existsSync(path.join(dir, 'run-notes.txt'))).toBe(true);
  });

  it('is never load-bearing — a missing or unreadable logs dir is a no-op', () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-trace-bare-'));
    expect(() => pruneRunTraces(bare, { except: 'x', env: {} })).not.toThrow();
    expect(pruneRunTraces(bare, { except: 'x', env: {} })).toBe(0);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/unit/observe/trace.test.js`
Expected: FAIL — `Cannot find module '../../../src/observe/trace'`.

- [ ] **Step 3: Write the implementation**

Create `src/observe/trace.js`:

```js
'use strict';

// The READ side of a run trace: turn the NDJSON a run left behind into the
// handful of facts `result finalize` is allowed to state as measured.
//
// Deliberately separate from the sink that writes it, because the two have
// opposite constraints. Writing happens on every verb and must be as close to
// free as an append can be. Reading happens once, in finalize, and can afford
// to parse the whole file. Nothing here is ever called on the hot path — which
// is also why the directory prune lives here rather than in the sink.

const realFs = require('fs');
const path = require('path');

const { atCap } = require('./sinks/file');
const { logsDir, runTracePath, RUN_TRACE_PREFIX } = require('./paths');

// A device failure in the envelope's own taxonomy. `deviceFail` (src/cli.js) is
// the ONLY producer of these two kinds, so counting them needs no list of which
// verbs are device verbs — a list that would have to be maintained by hand
// alongside connectBridge and would be wrong the first time someone forgot.
const DEVICE_FAILURE_KINDS = new Set(['device', 'timeout']);

// How many run traces .logs/ keeps. See the plan's bounded-measurement analysis:
// a trace is capped individually, but the DIRECTORY is one file per run forever.
const KEEP_RUN_TRACES = 20;

// Parse NDJSON leniently. A trailing partial line is NORMAL, not corruption: a
// SIGKILLed process can be interrupted mid-append, and the trace of a run that
// died is the trace most worth reading. Unparseable lines are skipped.
function parseTrace(text) {
  const events = [];
  for (const line of String(text).split('\n')) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e && typeof e === 'object') events.push(e);
    } catch (_) {
      /* partial or corrupt line; the rest of the trace is still evidence */
    }
  }
  return events;
}

function readTrace(tracePath, { fs = realFs } = {}) {
  if (!tracePath) return null;
  let text;
  try {
    text = fs.readFileSync(tracePath, 'utf8');
  } catch (_) {
    // No trace for this run: an ordinary, expected state (MAUTO_RUN_ID unset,
    // logging silenced, no workspace, or an id that could not name a file).
    return null;
  }
  return { events: parseTrace(text), truncated: atCap(tracePath, { fs }) };
}

function millis(event) {
  const t = event && event.ts ? Date.parse(event.ts) : NaN;
  return Number.isFinite(t) ? t : null;
}

// The facts a trace can PROVE, and deliberately nothing else.
//
// Absent by design: per-step attempt counts. The design asks for "retry counts
// … counted from repeated verb events against the same target", and the trace
// has no target — `--at 100,250` is not a recorded field and must not become
// one, because coordinates and element labels are exactly the free text the
// redaction catalog exists to keep off the wire. Step boundaries could be
// inferred from where the `result add-step` events fall, but that is only sound
// if the agent records each step immediately after performing it; an agent that
// batches its add-step calls at the end would file every device call under step
// one. Silently mis-attributing retries is the same confident wrongness this
// slice exists to remove.
//
// So this counts what needs no inference — run-wide device failures, each of
// which is an attempt that did not take. finalize COMPARES that against what
// the agent said rather than overwriting the per-step numbers.
function deriveRun(trace) {
  if (!trace || !Array.isArray(trace.events) || trace.events.length === 0) return null;

  const truncated = Boolean(trace.truncated);
  const device_failures = trace.events.filter(
    (e) => e.event === 'verb.end' && e.ok === false && DEVICE_FAILURE_KINDS.has(e.error_kind)
  ).length;
  const failure_screenshots = trace.events
    .filter((e) => e.event === 'screenshot.on_failure' && typeof e.path === 'string')
    .map((e) => e.path);

  // reduce, not Math.min(...stamps): a 1 MiB trace is a few thousand lines
  // today, but spreading an array into a call is an argument-count limit
  // waiting to be hit by a future, larger cap.
  let first = null;
  let last = null;
  for (const event of trace.events) {
    const t = millis(event);
    if (t === null) continue;
    if (first === null || t < first) first = t;
    if (last === null || t > last) last = t;
  }

  // Two stamps or nothing. A single-event trace spans zero time, and writing 0
  // down as a MEASURED duration would be a confident lie where "we did not
  // measure" is the truth — finalize falls back to the reported value.
  const measurable = first !== null && last !== null && last > first;

  return {
    // Milliseconds to seconds: the trace's resolution is 1ms, and rounding to
    // whole seconds would report every fast run as 0.
    duration_seconds: measurable ? (last - first) / 1000 : null,
    trace_events: trace.events.length,
    device_failures,
    trace_truncated: truncated,
    failure_screenshots,
  };
}

// Keep the `keep` most recent run traces; delete the rest.
//
// Called at finalize and NOWHERE else. Off the hot path — a readdir per
// `mauto tap` would put directory scanning inside the tightest loop the tool
// has — and finalize is the only moment a run is known to be over. Keying the
// prune on OTHER runs' traces also handles the crashed-run case: a run that
// never finalized leaves an orphan, which is simply an older file the next
// successful finalize sweeps up.
//
// The trace of the run being finalized is always excluded. Deleting it there is
// the one option that is clearly wrong: it is the evidence behind every number
// finalize just wrote, destroyed at exactly the moment someone starts asking
// where duration_seconds came from.
//
// Deletion is confined to `run-*.ndjson` in the resolved logs dir — files this
// tool created, under a name it owns. Best-effort throughout: pruning a log
// directory must never be the reason a finalize fails.
function pruneRunTraces(projectRoot, { keep = KEEP_RUN_TRACES, except, env = process.env, fs = realFs } = {}) {
  try {
    const dir = logsDir(projectRoot, env);
    const exceptPath = except ? runTracePath(projectRoot, except, env) : null;
    const exceptName = exceptPath ? path.basename(exceptPath) : null;

    const traces = fs
      .readdirSync(dir)
      .filter((n) => n.startsWith(RUN_TRACE_PREFIX) && n.endsWith('.ndjson') && n !== exceptName)
      .map((name) => {
        const full = path.join(dir, name);
        let mtime = 0;
        try {
          mtime = fs.statSync(full).mtimeMs;
        } catch (_) {
          /* raced with another process; treat as oldest */
        }
        return { full, mtime };
      })
      .sort((a, b) => b.mtime - a.mtime);

    // keep - 1: the run being finalized is excluded from `traces` above and
    // occupies one of the retained slots.
    let removed = 0;
    for (const trace of traces.slice(Math.max(0, keep - 1))) {
      try {
        fs.unlinkSync(trace.full);
        removed += 1;
      } catch (_) {
        /* raced, or already gone */
      }
    }
    return removed;
  } catch (_) {
    // No .logs/ yet, or an unreadable directory. Pruning is never load-bearing.
    return 0;
  }
}

module.exports = { readTrace, deriveRun, pruneRunTraces, KEEP_RUN_TRACES, DEVICE_FAILURE_KINDS };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx jest tests/unit/observe/trace.test.js`
Expected: PASS, 13 tests.

- [ ] **Step 5: Commit**

```bash
git add src/observe/trace.js tests/unit/observe/trace.test.js
git commit -m "feat(observe): read a run trace, derive what it can prove, prune the rest

Deliberately no per-step attempt derivation: the trace has no target, and
inferring step boundaries from where add-step lands is only sound if the agent
never batches. Run-wide device failures need no inference, so that is what this
counts. Pruning runs at finalize — off the hot path, and the only moment a run
is known to be over — and never deletes the trace it just measured."
```

---

### Task 8: The `measurements` field — schema, store, catalog

**Files:**
- Modify: `src/schemas/result_schema.json`
- Modify: `src/result/store.js`
- Modify: `src/result/capability-catalog.js`
- Test: `tests/unit/result/store.test.js` (extend)
- Test: `tests/lint/result-coverage.test.js` (extend)

**Interfaces:**
- Consumes: the measurement object Task 9 builds.
- Produces:
  - `result_schema.json` gains an additive, non-required `measurements` object.
  - `ResultStore.finalize({ …, measurements })` writes it when present and omits it when absent.
  - `NO_FLAG_ALLOWLIST` gains `measurements` with its justification.

- [ ] **Step 1: Write the failing tests**

Append to `tests/unit/result/store.test.js`:

```js
describe('measurements', () => {
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  const { ResultStore } = require('../../../src/result/store');

  const root = () => fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-measure-'));

  const measured = (over = {}) => ({
    source: 'trace',
    reported_duration_seconds: 30,
    duration_disagreement: false,
    trace_events: 12,
    device_failures: 0,
    trace_truncated: false,
    failure_screenshots: [],
    ...over,
  });

  it('writes the measurement block when one is supplied', () => {
    const store = new ResultStore({ runId: 'run_20260905_000001', scenarioId: 's', projectRoot: root() });
    store.addStep({ step_id: 'a', status: 'pass' });
    const result = store.finalize({ durationSeconds: 140.25, measurements: measured() });
    expect(result.duration_seconds).toBe(140.25);
    expect(result.measurements).toMatchObject({ source: 'trace', trace_events: 12 });
  });

  // A run with no trace must produce a file shaped exactly as 0.24.0 wrote it,
  // so an absent measurement is OMITTED rather than emitted as an empty
  // placeholder object.
  it('omits the key entirely when there is nothing measured', () => {
    const store = new ResultStore({ runId: 'run_20260905_000002', scenarioId: 's', projectRoot: root() });
    store.addStep({ step_id: 'a', status: 'pass' });
    const result = store.finalize({ durationSeconds: 30 });
    expect(result).not.toHaveProperty('measurements');
  });

  // Disagreements land in the TYPED observation array as well as in
  // `measurements`, because src/memory/store.js harvests observations into
  // run-history — so a scenario whose reported durations are chronically wrong
  // becomes a cross-session fact rather than a per-file one.
  it('notes a duration disagreement as a typed observation', () => {
    const store = new ResultStore({ runId: 'run_20260905_000003', scenarioId: 's', projectRoot: root() });
    store.addStep({ step_id: 'a', status: 'pass' });
    const result = store.finalize({
      durationSeconds: 140.25,
      measurements: measured({ duration_disagreement: true, reported_duration_seconds: 30 }),
    });
    const note = result.observations.find((o) => o.type === 'state_context');
    expect(note.message).toContain('30');
    expect(note.message).toContain('140.25');
  });

  it('notes under-reported retries when the device failed and no step admits it', () => {
    const store = new ResultStore({ runId: 'run_20260905_000004', scenarioId: 's', projectRoot: root() });
    store.addStep({ step_id: 'a', status: 'pass', attempts: 1 });
    const result = store.finalize({ durationSeconds: 10, measurements: measured({ device_failures: 3 }) });
    const note = result.observations.find((o) => o.type === 'flakiness');
    expect(note.message).toContain('3 device call');
  });

  it('stays quiet when the reported attempts already account for the failures', () => {
    const store = new ResultStore({ runId: 'run_20260905_000005', scenarioId: 's', projectRoot: root() });
    store.addStep({ step_id: 'a', status: 'pass', attempts: 3 });
    const result = store.finalize({ durationSeconds: 10, measurements: measured({ device_failures: 2 }) });
    expect(result.observations.filter((o) => o.message.includes('device call'))).toEqual([]);
  });

  // finalize is re-runnable — the guide tells an agent to retry a failed one.
  it('does not stack duplicate notes when finalize runs twice', () => {
    const projectRoot = root();
    const args = { runId: 'run_20260905_000006', scenarioId: 's', projectRoot };
    new ResultStore(args).addStep({ step_id: 'a', status: 'pass' });
    const m = measured({ duration_disagreement: true });
    new ResultStore(args).finalize({ durationSeconds: 140.25, measurements: m });
    const second = new ResultStore(args).finalize({ durationSeconds: 140.25, measurements: m });
    expect(second.observations.filter((o) => o.type === 'state_context')).toHaveLength(1);
  });
});
```

Append to `tests/lint/result-coverage.test.js`, inside the existing `behavioral:` describe block:

```js
    // `measurements` has no flag by design (see NO_FLAG_ALLOWLIST), so the
    // catalog cannot bind it to one. This is the #140 check in its place:
    // a home the store can actually fill.
    test('a supplied measurement reaches the finalized result', () => {
      const store = new ResultStore({ runId: 'run_20260101_000006', scenarioId: 's', projectRoot: tmpProjectRoot() });
      store.addStep({ step_id: 'step_1', status: 'pass' });
      const result = store.finalize({
        durationSeconds: 12.5,
        measurements: {
          source: 'trace',
          reported_duration_seconds: null,
          duration_disagreement: false,
          trace_events: 4,
          device_failures: 0,
          trace_truncated: false,
          failure_screenshots: [],
        },
      });
      expect(result.measurements.source).toBe('trace');
      expect(result.duration_seconds).toBe(12.5);
    });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/unit/result/store.test.js tests/lint/result-coverage.test.js tests/lint/result-schema-additive.test.js`
Expected: FAIL — `result.measurements` is undefined; `result-coverage.test.js`'s completeness check has not yet seen a `measurements` property so it is still green, and `result-schema-additive.test.js` is green (nothing has changed yet).

- [ ] **Step 3: Write the implementations**

In `src/schemas/result_schema.json`, add after the `observations` property and before `summary`. **Not** added to the top-level `required` array — that is what makes the change additive and keeps `result-schema-additive.test.js` green:

```json
    "measurements": {
      "type": "object",
      "description": "Facts MEASURED from the run's event trace (mobile-automator/.logs/run-<run_id>.ndjson) rather than self-reported by the executing agent. Absent when no trace was available — MAUTO_RUN_ID unset, logging silenced, no workspace, or a run id that could not name a file.",
      "properties": {
        "source": {
          "type": "string",
          "enum": ["trace", "reported", "none"],
          "description": "Where duration_seconds came from: measured from the trace, taken from --duration, or neither."
        },
        "reported_duration_seconds": {
          "type": ["number", "null"],
          "description": "What --duration claimed, retained even when the measured value was written to duration_seconds instead."
        },
        "duration_disagreement": {
          "type": "boolean",
          "description": "True when the reported and measured durations differ by more than the tolerance. The disagreement is itself a signal and is recorded rather than silently resolved."
        },
        "trace_events": {
          "type": "integer",
          "minimum": 0,
          "description": "Number of events in the run trace."
        },
        "device_failures": {
          "type": "integer",
          "minimum": 0,
          "description": "Device-kind and timeout-kind verb failures recorded during the run. Every one is an attempt that did not take."
        },
        "trace_truncated": {
          "type": "boolean",
          "description": "True when the trace reached its size cap, so the measured duration is a lower bound rather than the run's full span."
        },
        "failure_screenshots": {
          "type": "array",
          "items": { "type": "string" },
          "description": "Screenshots captured automatically at device failures during this run."
        }
      }
    },
```

In `src/result/store.js`, add the derivation helper as a method on `ResultStore`, above `finalize`:

```js
  // Typed observations derived from the measurement.
  //
  // They go in the observations array as well as in `measurements` because
  // src/memory/store.js harvests observations into run-history: a scenario
  // whose reported durations are chronically wrong, or whose steps claim no
  // retries while the device kept failing, is a CROSS-RUN fact, and
  // `measurements` is only ever read one file at a time.
  //
  // `state_context` for the duration case rather than a new observation type:
  // extending the enum would mean changing OBSERVATION_TYPES and the schema
  // together for a fact the existing vocabulary already describes — the agent's
  // model of the run disagreed with the machine's.
  _measurementObservations(measurements, measuredSeconds) {
    const notes = [];
    if (!measurements) return notes;

    if (measurements.duration_disagreement) {
      notes.push({
        type: 'state_context',
        step_id: null,
        message:
          `Reported duration ${measurements.reported_duration_seconds}s disagrees with ` +
          `${measuredSeconds}s measured from the run trace; the measured value was recorded.`,
      });
    }

    // Provable under-report: the device failed, and not one step admits to a
    // retry. `_steps.length > 0` because `every` on an empty array is true, and
    // a run with no steps has nothing to under-report.
    if (
      measurements.device_failures > 0 &&
      this._steps.length > 0 &&
      this._steps.every((s) => (s.retry_count || 0) === 0)
    ) {
      notes.push({
        type: 'flakiness',
        step_id: null,
        message:
          `${measurements.device_failures} device call(s) failed during this run, but no step ` +
          `reported a retry; the recorded attempt counts under-report what the device saw.`,
      });
    }

    return notes;
  }
```

In `finalize`, change the signature and add the two blocks. **`duration_seconds`'s write site is unchanged** — `durationSeconds` is simply now derived by the caller — so `capability-catalog.js`'s `writes: 'duration_seconds: Number(durationSeconds) || 0'` token stays valid and `result-coverage.test.js` keeps passing:

```js
  finalize({ status, durationSeconds = 0, summary, metadata, measurements } = {}) {
    return withLock(this._lock, () => {
      this._refreshFromDisk();

      // Appended INSIDE the lock and deduped by (type, message), so re-running
      // finalize — which the execute guide tells an agent to do after a failed
      // one — cannot stack duplicates.
      for (const note of this._measurementObservations(measurements, Number(durationSeconds) || 0)) {
        const already = this._observations.some(
          (o) => o.type === note.type && o.message === note.message
        );
        if (!already) this._observations.push(note);
      }

      const passed = this._assertions.filter((a) => a.status === 'passed').length;
```

and after the `result` object literal, before `this._atomicWrite(...)`:

```js
      // Additive and OMITTED when absent: a result file from a run with no
      // trace must stay shaped exactly as 0.24.0 wrote it, so finalize never
      // emits an empty measurements object as a placeholder.
      if (measurements) result.measurements = measurements;
```

In `src/result/capability-catalog.js`, add to `NO_FLAG_ALLOWLIST`:

```js
  measurements: 'derived by ResultStore.finalize from the run trace (src/observe/trace.js); deliberately has NO flag — an agent-supplied measurement is precisely the self-report this field exists to replace',
```

and extend the `duration` capability's comment (its `flags`, `store`, `writes` and `schemaPointer` are unchanged):

```js
  duration: {
    verb: 'finalize',
    // --duration is now the REPORTED value, not the recorded one. When a run
    // trace exists, finalize writes the measured duration to duration_seconds
    // and keeps this flag's value in measurements.reported_duration_seconds,
    // flagging a disagreement rather than silently discarding either number.
    // The store's write site is unchanged — the caller derives the value.
    flags: ['--duration'],
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest tests/unit/result/ tests/lint/
```

Expected: PASS. `store.test.js` gains 6 tests; `result-coverage.test.js` gains 1 and its completeness check now covers `measurements` through the allowlist; `result-schema-additive.test.js` still 7 green, which is the additivity claim being *proven* rather than asserted.

- [ ] **Step 5: Commit**

```bash
git add src/schemas/result_schema.json src/result/store.js src/result/capability-catalog.js tests/unit/result/store.test.js tests/lint/result-coverage.test.js
git commit -m "feat(result): add an additive measurements block to the result schema

Not in required, so every result file already on disk still validates — proven
by tests/lint/result-schema-additive.test.js, not asserted. It lands in
NO_FLAG_ALLOWLIST rather than RESULT_CAPABILITIES because an agent-supplied
measurement is exactly the self-report it exists to replace."
```

---

### Task 9: `finalize` derives the duration instead of trusting the flag

**Files:**
- Modify: `src/cli.js` (`handleResultFinalize` and a new `measureRun` helper)
- Test: `tests/unit/cli/` — the suite covering `handleResultFinalize` (locate with `grep -rl handleResultFinalize tests/`)
- Test: `tests/integration/cli-observability.test.js` (extend)

**Interfaces:**
- Consumes: `readTrace`, `deriveRun`, `pruneRunTraces` from `src/observe/trace.js`; `runTracePath` from `src/observe/paths.js`.
- Produces: `duration_seconds` measured from the trace; `measurements` on the result; stale traces pruned.

- [ ] **Step 1: Write the failing tests**

Append to the `handleResultFinalize` unit suite:

```js
describe('measured duration', () => {
  const os = require('os');
  const fs = require('fs');
  const path = require('path');
  const { handleResultFinalize } = require('../../src/cli');
  const { ResultStore } = require('../../src/result/store');

  function project() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-finalize-'));
    fs.mkdirSync(path.join(root, 'mobile-automator', '.logs'), { recursive: true });
    return root;
  }

  function trace(root, runId, stamps) {
    fs.writeFileSync(
      path.join(root, 'mobile-automator', '.logs', `run-${runId}.ndjson`),
      stamps
        .map((s) => JSON.stringify({ ts: s.ts, v: 1, src: 'cli', event: s.event || 'verb.end', ...s }))
        .join('\n') + '\n'
    );
  }

  const deps = (projectRoot) => ({
    resultStoreFactory: (a) => new ResultStore(a),
    memoryStoreFactory: null,
    projectRoot,
  });

  it('measures the duration from the trace when one exists', () => {
    const root = project();
    trace(root, 'run_20260905_141500', [
      { ts: '2026-09-05T14:15:00.000Z', ok: true },
      { ts: '2026-09-05T14:17:20.250Z', ok: true },
    ]);
    const r = handleResultFinalize(deps(root), { runId: 'run_20260905_141500' });
    expect(r.envelope.data.duration_seconds).toBe(140.25);
    expect(r.envelope.data.measurements.source).toBe('trace');
  });

  // The point of the slice: a supplied --duration that DISAGREES is recorded
  // and flagged, not silently believed and not silently discarded.
  it('flags a reported duration that disagrees with the measured one', () => {
    const root = project();
    trace(root, 'run_20260905_141501', [
      { ts: '2026-09-05T14:15:00.000Z', ok: true },
      { ts: '2026-09-05T14:17:20.250Z', ok: true },
    ]);
    const r = handleResultFinalize(deps(root), { runId: 'run_20260905_141501', duration: '30' });
    const m = r.envelope.data.measurements;
    expect(r.envelope.data.duration_seconds).toBe(140.25);
    expect(m.reported_duration_seconds).toBe(30);
    expect(m.duration_disagreement).toBe(true);
    expect(r.envelope.data.observations.some((o) => o.type === 'state_context')).toBe(true);
  });

  it('does not flag a reported duration inside the tolerance', () => {
    const root = project();
    trace(root, 'run_20260905_141502', [
      { ts: '2026-09-05T14:15:00.000Z', ok: true },
      { ts: '2026-09-05T14:15:10.000Z', ok: true },
    ]);
    const r = handleResultFinalize(deps(root), { runId: 'run_20260905_141502', duration: '10.5' });
    expect(r.envelope.data.measurements.duration_disagreement).toBe(false);
  });

  // MAUTO_RUN_ID unset, logging silenced, or no workspace: 0.24.0's behaviour,
  // reached deliberately rather than by omission.
  it('falls back to the reported duration with no trace', () => {
    const root = project();
    const r = handleResultFinalize(deps(root), { runId: 'run_20260905_141503', duration: '42' });
    expect(r.envelope.data.duration_seconds).toBe(42);
    expect(r.envelope.data.measurements).toMatchObject({
      source: 'reported',
      reported_duration_seconds: 42,
      duration_disagreement: false,
      trace_events: 0,
    });
  });

  it('records source "none" with neither a trace nor a --duration', () => {
    const root = project();
    const r = handleResultFinalize(deps(root), { runId: 'run_20260905_141504' });
    expect(r.envelope.data.duration_seconds).toBe(0);
    expect(r.envelope.data.measurements.source).toBe('none');
  });

  it('carries the failure screenshots and the device failure count through', () => {
    const root = project();
    trace(root, 'run_20260905_141505', [
      { ts: '2026-09-05T14:15:00.000Z', ok: false, error_kind: 'device' },
      { ts: '2026-09-05T14:15:01.000Z', event: 'screenshot.on_failure', path: '/p/tap.png' },
      { ts: '2026-09-05T14:15:09.000Z', ok: true },
    ]);
    const r = handleResultFinalize(deps(root), { runId: 'run_20260905_141505' });
    expect(r.envelope.data.measurements.device_failures).toBe(1);
    expect(r.envelope.data.measurements.failure_screenshots).toEqual(['/p/tap.png']);
  });

  it('never lets an unreadable trace fail the finalize', () => {
    const root = project();
    // A directory where the trace file should be: readFileSync throws EISDIR.
    fs.mkdirSync(path.join(root, 'mobile-automator', '.logs', 'run-run_20260905_141506.ndjson'));
    const r = handleResultFinalize(deps(root), { runId: 'run_20260905_141506', duration: '9' });
    expect(r.exitKind).toBe('ok');
    expect(r.envelope.data.duration_seconds).toBe(9);
  });

  it('prunes stale traces but never the one it just measured', () => {
    const root = project();
    const dir = path.join(root, 'mobile-automator', '.logs');
    for (let i = 0; i < 25; i += 1) {
      const f = path.join(dir, `run-old${i}.ndjson`);
      fs.writeFileSync(f, '{}\n');
      fs.utimesSync(f, new Date(1e9 + i * 1000), new Date(1e9 + i * 1000));
    }
    trace(root, 'run_20260905_141507', [
      { ts: '2026-09-05T14:15:00.000Z', ok: true },
      { ts: '2026-09-05T14:15:05.000Z', ok: true },
    ]);

    handleResultFinalize(deps(root), { runId: 'run_20260905_141507' });

    const left = fs.readdirSync(dir).filter((n) => n.startsWith('run-'));
    expect(left).toHaveLength(20);
    expect(left).toContain('run-run_20260905_141507.ndjson');
  });
});
```

And one end-to-end check — append to `tests/integration/cli-observability.test.js`'s run-trace describe:

```js
  it('measures a real run end to end', () => {
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-e2e-measure-'));
    fs.mkdirSync(path.join(cwd, 'mobile-automator', 'results'), { recursive: true });
    const runId = 'run_20260905_141500';
    const env = { ...process.env, MAUTO_LOG_LEVEL: 'info', MAUTO_RUN_ID: runId };
    const call = (args) => spawnSync(process.execPath, [CLI, ...args], { cwd, encoding: 'utf8', env });

    call(['result', 'add-step', '--run-id', runId, '--step-id', 'a', '--status', 'pass']);
    call(['result', 'add-step', '--run-id', runId, '--step-id', 'b', '--status', 'pass']);
    // --duration 999 is a self-report no trace could support.
    const out = call(['result', 'finalize', '--run-id', runId, '--duration', '999']);

    const data = JSON.parse(out.stdout).data;
    expect(data.measurements.source).toBe('trace');
    expect(data.measurements.reported_duration_seconds).toBe(999);
    expect(data.measurements.duration_disagreement).toBe(true);
    // Two add-step invocations milliseconds apart: measured, small, and real.
    expect(data.duration_seconds).toBeLessThan(60);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx jest tests/unit/cli tests/integration/cli-observability.test.js`
Expected: FAIL — `duration_seconds` is 0 or the reported value in every case, and `measurements` is undefined.

- [ ] **Step 3: Write the implementation**

In `src/cli.js`, add the imports:

```js
const { readTrace, deriveRun, pruneRunTraces } = require('./observe/trace');
```

Add above `handleResultFinalize`:

```js
// Tolerance for calling a reported duration wrong.
//
// The measured value is a wall-clock span between two recorded events, so
// sub-second differences are rounding rather than disagreement, and 10% absorbs
// the honest gap between "the run" and "the part of the run mauto saw" —
// setup before the first verb, and finalize's own execution after the last.
//
// Symmetric on purpose. An UNDER-claim means the agent lost track of its own
// retries; an OVER-claim means it counted its planning as run time. Both are
// worth a human seeing, and one rule is two tests instead of four.
const DURATION_TOLERANCE_SECONDS = 1;
const DURATION_TOLERANCE_RATIO = 0.1;

// Turn the run's trace into the duration to record and the measurement block to
// record beside it. Total: an unreadable, absent or unmeasurable trace yields
// the reported value and a `measurements` block that says so, never an error.
function measureRun({ projectRoot, runId, reported }) {
  const derived = deriveRun(readTrace(runTracePath(projectRoot, runId)));
  const reportedSeconds = reported === undefined ? null : Number(reported);
  const hasReported = reportedSeconds !== null && Number.isFinite(reportedSeconds);

  const base = {
    reported_duration_seconds: hasReported ? reportedSeconds : null,
    trace_events: derived ? derived.trace_events : 0,
    device_failures: derived ? derived.device_failures : 0,
    trace_truncated: derived ? derived.trace_truncated : false,
    failure_screenshots: derived ? derived.failure_screenshots : [],
  };

  // No trace, or a trace too short to span any time. Falling back to the flag
  // is 0.24.0's behaviour, and `source` records that it IS a fallback rather
  // than dressing a self-report as a measurement.
  if (!derived || derived.duration_seconds === null) {
    return {
      durationSeconds: hasReported ? reportedSeconds : 0,
      measurements: { source: hasReported ? 'reported' : 'none', duration_disagreement: false, ...base },
    };
  }

  const measured = derived.duration_seconds;
  const tolerance = Math.max(DURATION_TOLERANCE_SECONDS, measured * DURATION_TOLERANCE_RATIO);
  return {
    durationSeconds: measured,
    measurements: {
      source: 'trace',
      duration_disagreement: hasReported && Math.abs(reportedSeconds - measured) > tolerance,
      ...base,
    },
  };
}
```

In `handleResultFinalize`, replace the store construction and `finalize` call:

```js
  // Measure BEFORE constructing the store: the trace is read-only here, and
  // deriving first keeps the store's lock window as small as it already is.
  const measured = measureRun({ projectRoot, runId, reported: duration });

  const store = resultStoreFactory({ runId, scenarioId, projectRoot });
  const result = store.finalize({
    status,
    // Derived, not trusted. `--duration` survives in
    // measurements.reported_duration_seconds and, when it disagrees with the
    // clock, in a typed state_context observation — the disagreement is a
    // signal about the agent, so it is recorded rather than resolved.
    durationSeconds: measured.durationSeconds,
    metadata,
    measurements: measured.measurements,
    // Undefined when --summary is omitted; ResultStore.finalize's own
    // `summary || <generated default>` already treats that as "no override",
    // so no provided-keys-only guard is needed here (unlike metadata, whose
    // sub-fields default independently to 'unknown').
    summary: opts.summary,
  });

  // Retention, at the only moment a run is known to be over and the only place
  // off the hot path. Never this run's own trace — it is the evidence behind
  // every number just written. Best-effort by construction; pruneRunTraces
  // swallows everything and returns a count.
  pruneRunTraces(projectRoot, { except: runId });
```

The rest of `handleResultFinalize` — the memory harvest, the hints, the return — is unchanged.

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npx jest tests/unit/cli tests/unit/result tests/integration/ tests/lint/
```

Expected: PASS. 8 new unit tests, 1 new integration test.

- [ ] **Step 5: Commit**

```bash
git add src/cli.js tests/unit/cli tests/integration/cli-observability.test.js
git commit -m "feat(cli): derive duration_seconds from the run trace at finalize

--duration becomes the REPORTED value: kept, compared, and flagged when it
disagrees with the clock, because the disagreement is a signal about the agent
rather than noise to resolve. No trace means 0.24.0's behaviour, recorded as a
fallback rather than dressed up as a measurement."
```

---

### Task 10: Teach the agent to export `MAUTO_RUN_ID`

Without this the slice is dead code: nothing exports the variable, no trace is ever written, and every `duration_seconds` stays a self-report. This is layer 2/3 work in the three-layer model — the guide prose tells the agent *how to invoke*, and must state no contract of its own.

**Files:**
- Modify: `src/guide/content/execute.aware.md`
- Modify: `src/guide/content/execute.agnostic.md`
- Modify: `src/guide/content/execute.invariants.md`
- Test: `tests/lint/` (the existing guide guards run unchanged; add one assertion)

**Interfaces:**
- Consumes: nothing.
- Produces: the execute guide instructs the agent to export `MAUTO_RUN_ID` before the first verb.

- [ ] **Step 1: Write the failing test**

Create `tests/lint/guide-run-correlation.test.js`:

```js
'use strict';

// The slice's switch is an environment variable the AGENT has to export. If the
// guide never says so, nothing exports it, no trace is ever written, and every
// duration_seconds stays the self-report this work exists to replace — with the
// whole mechanism present, green, and unreachable.
//
// Deliberately asserts on the EMITTED guide, not the source file, so
// placeholder interpolation cannot swallow the instruction.

const { emitGuide } = require('../../src/guide/emitter');

describe('execute guide teaches run correlation', () => {
  for (const mode of ['platform-aware', 'platform-agnostic']) {
    it(`${mode} tells the agent to export MAUTO_RUN_ID before the first verb`, () => {
      const out = emitGuide('execute', { mode });
      expect(out).toContain('MAUTO_RUN_ID');
      // The same id must reach --run-id, or finalize looks for a trace that
      // does not exist. That equality IS the correlation.
      expect(out).toMatch(/MAUTO_RUN_ID[\s\S]{0,400}--run-id/);
    });

    it(`${mode} no longer presents --duration as the recorded value`, () => {
      const out = emitGuide('execute', { mode });
      expect(out).toMatch(/measured|measurement/i);
    });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx jest tests/lint/guide-run-correlation.test.js`
Expected: FAIL — neither guide mentions `MAUTO_RUN_ID`.

- [ ] **Step 3: Write the guide changes**

In `src/guide/content/execute.aware.md`, insert as the **first** bullet of `### 1. Pre-flight`, before `- Verify a device is available with \`mauto devices\`.`:

```markdown
- **Name the run first.** Choose the run identifier for this execution (format `run_YYYYMMDD_HHMMSS`) and export it as `MAUTO_RUN_ID` before running any other verb — `export MAUTO_RUN_ID=run_20260905_141500`. Every verb then records into a trace for that run, and `mauto result finalize --run-id <the same id>` measures the run's duration from it instead of taking your word for it. Use the *same* id in both places; a different one means no trace to measure.
```

In `src/guide/content/execute.aware.md`, replace the `### 6. Generate the Result Report` paragraph's final sentence — currently ending `...gathered by the Observer traits above.` — by appending:

```markdown
 `--duration` is now a cross-check rather than the recorded value: when a run trace exists the duration is measured from it, your figure is kept as `measurements.reported_duration_seconds`, and a disagreement beyond the tolerance is recorded as a `state_context` observation. Report the duration you believe is right and let the two be compared; do not reverse-engineer a number to match.
```

In `src/guide/content/execute.agnostic.md`, insert as a new step `1.` in `### 1. Pre-flight`, renumbering the existing 1–5 to 2–6:

```markdown
1. **Name the run first.** Choose the run identifier for this execution (format `run_YYYYMMDD_HHMMSS`) and export it as `MAUTO_RUN_ID` before running any other verb — `export MAUTO_RUN_ID=run_20260905_141500`. Every verb then records into a trace for that run, and `mauto result finalize --run-id <the same id>` measures the run's duration from it instead of taking your word for it. Use the *same* id in both places; a different one means no trace to measure.
```

Append the same `--duration` sentence to `src/guide/content/execute.agnostic.md:158`'s paragraph.

In `src/guide/content/execute.invariants.md`, add a line to the invariants list (placeholder-free and naming no OS, as that file requires):

```markdown
- Export `MAUTO_RUN_ID` before the first verb of a run, and pass the same identifier to every `mauto result` verb. Verb events are correlated by that value; without it the run has no trace and its recorded duration is your own estimate rather than a measurement.
```

- [ ] **Step 4: Run the guide guards and verify they pass**

```bash
npx jest tests/lint/guide-run-correlation.test.js
npm run lint:guides
```

Expected: PASS. In particular `guide-no-placeholder-leak.test.js` (the inserted text has no `{{...}}`), `guide-agnostic-no-os.test.js` (no OS is named), `guide-no-mcp-tool-leak.test.js` (no `mobile_*` name), `skill-invariants.test.js` and `skill-no-placeholder-leak.test.js`. Re-run `guide-artifact-reuse.test.js` specifically — its `preflightSection` helper slices between `### 1. Pre-flight` and the first `\n|` or `\n### `, and the new bullet is inside that window, so it must still find `**App under test.**` and `mauto install`.

- [ ] **Step 5: Commit**

```bash
git add src/guide/content/execute.aware.md src/guide/content/execute.agnostic.md src/guide/content/execute.invariants.md tests/lint/guide-run-correlation.test.js
git commit -m "docs(guide): tell the agent to export MAUTO_RUN_ID before the first verb

Without this the whole slice is present, green and unreachable: nothing exports
the variable, no trace is written, and every duration stays a self-report. The
lint guard asserts on the EMITTED guide so interpolation cannot swallow it."
```

---

### Task 11: Version bump, changelog, troubleshooting, verification, PR

**Files:**
- Modify: `package.json` (version), `package-lock.json`
- Modify: `CHANGELOG.md`
- Modify: `TROUBLESHOOTING.md`

**Interfaces:**
- Consumes: everything above.
- Produces: no code.

- [ ] **Step 1: Bump the version**

The CI gate `Verify version is bumped` fails any PR touching `src/`, `bin/` or `package.json` without a version not already in `git tag`. `main` is 0.24.0, slice 1 took this branch to `0.25.0-rc.0` and slice 2 to `0.25.0-rc.1`; neither rc is tagged. Slice 3 increments the rc counter.

Confirm first, do not assume:

```bash
node -e "console.log(require('./package.json').version)"   # expect 0.25.0-rc.1
git tag --list 'v0.25.0*'                                   # expect empty
```

Set `"version": "0.25.0-rc.2"` in `package.json`, then:

```bash
npm install --package-lock-only
```

- [ ] **Step 2: Write the changelog**

Append to the existing `### ✨ Added` block under `## [Unreleased]` in `CHANGELOG.md` (slices 1 and 2's entries stay; under gate-then-graduate each slice appends and the graduation PR collapses the block into a release section):

```markdown
- Run traces and **measured** run durations. Export `MAUTO_RUN_ID` before a run
  and every `mauto` invocation records into
  `mobile-automator/.logs/run-<run_id>.ndjson`; the three `mauto result` verbs
  join the same trace through the `--run-id` they already require, so no verb
  gained a flag. `mauto result finalize` then derives `duration_seconds` from
  the trace instead of taking `--duration` at face value. Previously that field
  — and `--attempts` — were whatever number the executing agent supplied,
  which is to say the tool asked a language model with no clock how long a run
  took and wrote the answer down as a fact.
- A supplied `--duration` is no longer silently trusted **or** silently
  discarded. It is kept as `measurements.reported_duration_seconds` and, when
  it differs from the measured value by more than the tolerance, flagged as
  `measurements.duration_disagreement` and recorded as a typed `state_context`
  observation. The disagreement is a signal about the run, not noise to
  resolve.
- New additive `measurements` object on the result schema, carrying where the
  duration came from (`trace` / `reported` / `none`), the reported figure, the
  trace event count, the run's device and timeout failures, whether the trace
  hit its size cap, and any screenshots captured at failures. A run with no
  trace omits the key entirely, so result files written without `MAUTO_RUN_ID`
  are shaped exactly as 0.24.0 wrote them.
- Screenshot-on-failure. When a device verb fails with a `device` or `timeout`
  error and a run id is set, `mauto` captures the screen into
  `mobile-automator/screenshots/<run_id>/` — the directory `mauto setup`'s
  `.gitignore` already covers — and records the path in the trace, so
  `finalize` can list it. The capture is itself a device round-trip and can
  fail; when it does, the failure is recorded and discarded. It never masks or
  replaces the original error.
- Run traces are bounded differently from the other logs, deliberately. They do
  not rotate: rotation renames the run's beginning out of the live file, and
  the beginning is where the measured duration starts — a rotated trace would
  report a three-minute run as forty seconds, which is measured-looking fiction
  and worse than the self-report it replaces. Instead a trace stops growing at
  the same 1 MiB cap, `finalize` records `trace_truncated` so the duration is
  read as the lower bound it is, and `finalize` prunes all but the 20 most
  recent traces — never the one it just measured, which is the evidence behind
  every number it wrote.
- A run id that cannot safely name a file (`../../etc/x`, `a/b`, a leading dot)
  is refused rather than sanitized, and the run simply gets no trace.
  Sanitizing would collapse two distinct runs onto one file and produce a
  duration spanning both.
- New `tests/lint/result-schema-additive.test.js` plus a
  `tests/fixtures/result_schema_v2.0.json` baseline. The result schema — the
  tool's durable output, which `mauto`'s cross-session memory reads back — had
  no additivity guard; the scenario schema has had one since 2.1. It fails the
  build on a dropped node, a removed enum value, a narrowed type or a changed
  `required` list, and validates a v2.0-era result document against the current
  schema.
```

- [ ] **Step 3: Document the trace in TROUBLESHOOTING.md**

Add a new subsection under `## Test Execution Issues`, after `### ❌ "Test is flaky"`:

````markdown
### ❌ "duration_seconds looks wrong"

Since 0.25.0 that field is measured from the run trace rather than taken from
`--duration`, but only when the run had a trace. Check which:

```bash
jq '.measurements' mobile-automator/results/<run_id>.json
```

- `"source": "trace"` — measured. If `duration_disagreement` is `true`, the
  agent's `--duration` and the clock disagreed; both numbers are in the file.
- `"source": "reported"` — no trace, so `--duration` was used. Almost always
  because `MAUTO_RUN_ID` was not exported before the run, or was exported with
  a different value than the one passed to `mauto result finalize --run-id`.
- `"source": "none"` — no trace and no `--duration`.
- `"trace_truncated": true` — the trace hit its 1 MiB cap, so the duration is a
  lower bound, not the run's full span.

The trace itself is one JSON object per line, next to the other logs:

```bash
# Everything mauto did during that run, in order
cat mobile-automator/.logs/run-<run_id>.ndjson

# Just the failures, and any screenshots taken at them
jq 'select(.ok == false or .event == "screenshot.on_failure")' \
  mobile-automator/.logs/run-<run_id>.ndjson
```

`mauto result finalize` keeps the 20 most recent traces and deletes older ones,
so a trace from a run several sessions ago may be gone.
````

- [ ] **Step 4: Run the full verification set and SHOW the output**

```bash
npm test
npm run lint:guides
npm run lint:schema-additive
./scripts/pack-smoke.sh
```

Expected: all green. Do not claim completion without pasting this output — the project's workflow requires evidence before any success claim.

- [ ] **Step 5: Commit and push**

```bash
git add package.json package-lock.json CHANGELOG.md TROUBLESHOOTING.md
git commit -m "chore(release): bump to 0.25.0-rc.2 for run traces and measured durations"
git push -u origin sh3lan93/observability-slice-2
```

- [ ] **Step 6: Open the draft PR**

Fill the test-plan numbers from the Step 4 output — do not invent them.

```bash
gh pr create --draft \
  --title "feat(observe): run traces, measured durations, screenshot-on-failure" \
  --body "$(cat <<'BODY'
## What

Slice 3 of the observability design. `duration_seconds` in a result file used
to be whatever number the calling agent passed to `--duration`, and
`--attempts` likewise — the tool asked a language model with no clock how long
a run took, then wrote the answer down as a fact. This replaces that with a
measurement.

- **Run traces.** Export `MAUTO_RUN_ID` and every verb records into
  `mobile-automator/.logs/run-<run_id>.ndjson`, alongside `mauto.ndjson` rather
  than instead of it. The three `mauto result` verbs join the same trace
  through the `--run-id` they already require. **No verb gained a flag.**
- **Measured `duration_seconds`.** `finalize` derives it from the trace. A
  supplied `--duration` is neither trusted nor discarded: it is kept as
  `measurements.reported_duration_seconds` and flagged when it disagrees.
- **Screenshot-on-failure**, captured in the one window where the bridge is
  live and the verdict is known.
- **A new additive `measurements` object** on the result schema.
- **A new result-schema additivity guard** and its v2.0 baseline fixture.

## Why

The design's domain B — "how long did that tap take, is this scenario flaking"
— was answerable only by asking the agent, and the agent was guessing. A QA
tool whose timing data is a language model's estimate cannot detect a
degrading scenario or a slow device, which is most of what timing data is for.

## Design notes

- **A run trace must NOT rotate, and this is the one place the shared policy is
  wrong.** `rotateIfLarge` renames the file's beginning away, and the beginning
  is where the measured duration starts — a rotated trace reports a
  three-minute run as forty seconds. That is measured-looking fiction, strictly
  worse than the self-report it replaces. Traces are capped instead
  (`bound: 'cap'` on the existing file sink, same `MAX_LOG_BYTES`, no second
  constant), dropping the newest events so a truncated trace still starts at
  the run's true beginning and yields an honest lower bound, flagged as one.
- **Bounded in three ways, each answering a different question.** Per file: the
  1 MiB cap. Per directory: `finalize` keeps the 20 most recent traces — off
  the hot path, at the only moment a run is known to be over, and it collects
  the traces of runs that crashed before finalizing as a side effect. Per run:
  nothing, deliberately — `finalize` does **not** delete the trace it just
  measured, because that is the evidence behind every number it wrote,
  destroyed at the exact moment someone asks where the number came from.
- **`tracePath` is injected, never resolved from `env` inside `defaultSinks`.**
  A daemon inherits `MAUTO_RUN_ID` from whichever verb spawned it and outlives
  that run; an env-resolved trace would file every later run's device calls
  under the first run's id. `boundRecorder` does not pass it, so the daemon
  cannot trace even by accident. Pinned by a test.
- **Hostile run ids are refused, not sanitized.** `runTracePath` is the single
  gate that turns a run id into a filename and returns `null` for anything
  unsafe; `failure-capture.js` reuses it as its own predicate rather than
  adding a second one that could disagree. Sanitizing would collapse
  `login/smoke` and `login-smoke` onto one trace and yield a duration spanning
  two runs.
- **The screenshot hooks the second `try` in `connectBridge`, not the first.**
  The first `catch` handles a *connect* failure, where there is no bridge to
  photograph with. The capture is itself a daemon round-trip, so its own
  failure is recorded and discarded; the fail envelope reaches `emit()`
  untouched, and the capture's return value is deliberately unused at the call
  site.
- **Only `device` and `timeout` kinds are captured.** `invalid_input` never
  reached the device, so a picture of the screen before the verb is evidence of
  nothing.
- **What the trace can prove, and what it cannot.** The design asks for retry
  counts "against the same target"; the trace has no target, and coordinates
  must not become a recorded field. Inferring step boundaries from where
  `add-step` lands is only sound if the agent never batches. So per-step
  `retry_count` is not rewritten — instead run-wide device failures are counted
  (which needs no inference, since `deviceFail` is the only producer of those
  kinds) and *compared* to what the steps claimed. When the device failed and
  no step admits a retry, that is a typed `flakiness` observation.
- **`measurements` is in `NO_FLAG_ALLOWLIST`, not `RESULT_CAPABILITIES`**, with
  the justification that an agent-supplied measurement is precisely the
  self-report the field exists to replace. A behavioural test in
  `result-coverage.test.js` covers the #140 shape it would otherwise miss.
- **The additivity guard was written FIRST, against the unchanged schema.** A
  baseline minted after the change would bake the change in and guard nothing.
- **No new `EVENT_FIELDS`.** Every fact this slice records — `run_id`,
  `session_id`, `path`, `error_kind`, `dur_ms`, `message` — already has a
  classified catalog entry from slices 1–2. An audit test pins that.
- **No new dependencies.**

## Test plan

`npm test`, `npm run lint:guides`, `npm run lint:schema-additive` and
`./scripts/pack-smoke.sh` all pass. New coverage: the result-schema additivity
guard and its v2.0 baseline; run-id resolution and hostile-id refusal; the file
sink's cap mode and `atCap`; the trace sink's dual-write, its silence at
`MAUTO_LOG_LEVEL=silent`, its failure isolation, and its unreachability from
`boundRecorder`; CLI correlation across all three exit paths including parse
failures; screenshot-on-failure across capturable and non-capturable kinds,
missing run ids, and a capture that throws; trace parsing with a partial
trailing line, duration derivation, device-failure counting, and directory
pruning; the `measurements` schema/store/catalog binding with observation
dedupe across a re-run finalize; and an end-to-end run where a `--duration 999`
self-report is measured against the clock and flagged.

Refs #168
BODY
)"
```

Reference the gate issue with `Refs`, never `Closes` — slice 3 is one slice of five and the gate closes when its last slice merges.

---

## Slices 4–5

Not planned here, for the reason slices 1 and 2 both gave: detail written now goes stale exactly as this design's pre-#176 assumptions did.

| Slice | Content | Version |
|---|---|---|
| 4 | `mauto crash` verb, failure-path auto-check, result-schema crash record, capability-catalog entry. Adds `mobile_get_crash`/`mobile_list_crashes` to `mobile-mcp-tools.js` in the same change as the bridge methods, and **uses the additivity guard this slice created**. | `0.25.0-rc.3` |
| 5 | Opt-in PostHog spool + daemon flush, consent UX, privacy docs; removes the gate | `0.25.0` |

Two hooks slice 4 should know about:

- `src/observe/failure-capture.js` already owns "what do we do when a device verb fails, in the one window where the bridge is live". The crash auto-check belongs beside the screenshot in that module, sharing the same guard and the same never-mask contract — not as a second wrapper around `connectBridge`.
- `measurements.failure_screenshots` establishes the pattern for a derived, flag-less result field: a `NO_FLAG_ALLOWLIST` entry with a stated justification, plus a behavioural test in `result-coverage.test.js`. The crash record can follow it or take a real capability entry, but it must do one of the two or `result-coverage.test.js` fails the build.

---

## Self-review

Run before handing this plan to an implementer; recorded here so the checks are visible rather than claimed.

**Spec coverage.** The design's slice-3 row is "Run traces, measured `duration_seconds` and retry counts in `finalize`, screenshot-on-failure, new result-schema additivity guard + fixture". Traces: Tasks 2–5. Measured duration: Tasks 7, 9. Retry counts: Task 7 (`device_failures`) and Task 8 (the flakiness cross-check) — with §6 of the analysis stating plainly that the design's literal phrasing ("against the same target") is not implementable, since the trace has no target, and saying what is done instead. Screenshot-on-failure: Task 6, at the seam the design names. Additivity guard + fixture: Task 1. The design's "`session_id` on device-verb events via `readSessionId`" (slice-2 plan's forward table) is Task 5.

**Placeholder scan.** No `TODO`, no "add appropriate error handling", no "similar to Task N". Every test and implementation block is complete code. Two deliberate lookups rather than guesses — the `lint:guides` script's shape (Task 1 Step 4) and which test file holds the `handleResultFinalize` suite (Task 9) — each with the command to resolve it, because inventing a path is worse than naming the `grep`.

**Type consistency.** `runTracePath` returns `string | null` and every consumer treats `null` as "no trace" (`finish`, `captureOnFailure`, `measureRun`, `pruneRunTraces`). `readTrace` returns `{events, truncated} | null`; `deriveRun` accepts that union and returns `null` for null/empty, with `duration_seconds: number | null` inside a non-null result — `measureRun` branches on both. `resolveRunId` returns `string | null`. `captureOnFailure` returns `Promise<string|null>` and its call site ignores it. `fileSink.write`'s `bound` defaults to `'rotate'`, so every existing caller is behaviour-identical.

**Catalog obligations.** No new `EVENT_FIELDS` (audited in Task 5 Step 1). No `action-catalog.js` entry — slice 3 adds no verb and no scenario action. One `capability-catalog.js` change: `measurements` in `NO_FLAG_ALLOWLIST` with a justification, which is what `result-coverage.test.js`'s completeness check requires. The `duration` capability's `writes` token is deliberately unchanged, because the store's write site is unchanged — only the caller's derivation of the value moved.
