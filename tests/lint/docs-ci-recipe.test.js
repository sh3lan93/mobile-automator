'use strict';

// tests/lint/docs-ci-recipe.test.js
//
// #277: the FAQ's CI recipe never ran a test. Where the run belonged stood a
// comment ("your agent replays the scenario"), the GitHub Actions example
// had no device and executed no scenario, and it pinned `actions/checkout@v3`,
// `actions/setup-node@v3` and `actions/upload-artifact@v3` while this repo's
// own workflows had long moved on. Before that the same recipe told CI to
// `cat .mobile-automator/results/latest.json`, a file mauto never writes.
// Nothing failed, because a fenced block in a doc is executed by nobody.
//
// Three rules keep the recipe honest now that `mauto run` (#284) can do the
// work unattended:
//
//   1. An action a doc pins inside a fenced block, when our own workflows use
//      that action too, pins a ref our workflows use. The refs are read from
//      `.github/workflows/`, never restated here, so Dependabot bumping a
//      workflow turns the doc red in the same PR instead of leaving it behind.
//   2. Both FAQ CI answers run `mauto run … --junit` inside a fenced block, and
//      the Actions example uploads its artifacts with `if: always()` (the
//      report matters most when the run failed, which is when a plain upload
//      step is skipped).
//   3. No shipping doc mentions `latest.json`.

const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const { REPO_ROOT, shippingDocs } = require('./docs-corpus');
const { loadWorkflow, runs } = require('./workflow-guard');

const FAQ = 'docs/faq.md';
const WORKFLOW_DIR = '.github/workflows';
const CI_ANSWER = 'How do I integrate with CI/CD?';
const ACTIONS_ANSWER = 'Can I use mobile-automator with GitHub Actions?';

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

// --- Derived truth: the refs our own workflows pin ---------------------------

// `owner/action@ref` → Map(action → Set(ref)). A sub-path action
// (`owner/repo/path@ref`) keeps its path, so it is compared like for like.
const USES = /^([\w.-]+\/[\w./-]+)@(\S+)$/;

function workflowRefs() {
  const refs = new Map();
  const files = fs
    .readdirSync(path.join(REPO_ROOT, WORKFLOW_DIR))
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
  for (const file of files) {
    const wf = loadWorkflow(`${WORKFLOW_DIR}/${file}`);
    for (const job of Object.values((wf && wf.jobs) || {})) {
      for (const step of (job.steps || []).filter(Boolean)) {
        const m = USES.exec(String(step.uses || ''));
        if (!m) continue;
        if (!refs.has(m[1])) refs.set(m[1], new Set());
        refs.get(m[1]).add(m[2]);
      }
    }
  }
  return refs;
}

// --- Fenced blocks ----------------------------------------------------------

/**
 * Every fenced code block in a blob of markdown, as
 * `{ lang, startLine, lines }`; `startLine` is the 1-based line of the first
 * line inside the fence.
 */
function fencedBlocks(text) {
  const blocks = [];
  let open = null;
  text.split('\n').forEach((line, i) => {
    const m = /^\s*(`{3,}|~{3,})\s*([\w-]*)/.exec(line);
    if (!open) {
      if (m) open = { fence: m[1], lang: m[2], startLine: i + 2, lines: [] };
      return;
    }
    if (m && m[1][0] === open.fence[0] && m[1].length >= open.fence.length && !m[2]) {
      blocks.push({ lang: open.lang, startLine: open.startLine, lines: open.lines });
      open = null;
      return;
    }
    open.lines.push(line);
  });
  return blocks;
}

/**
 * The body of one `### <heading>` answer: everything up to the next heading
 * of the same or a higher level (outside a fence). Throws when the heading is gone, so a renamed
 * question fails with its name rather than as "expected 0 to be 1".
 */
function answer(text, heading) {
  const lines = text.split('\n');
  const start = lines.findIndex((l) => l.trim() === `### ${heading}`);
  if (start === -1) throw new Error(`${FAQ}: no "### ${heading}" answer found`);
  const rest = lines.slice(start + 1);
  // A `# comment` inside a fenced shell block is not a heading.
  let fence = null;
  const end = rest.findIndex((l) => {
    const m = /^\s*(`{3,}|~{3,})/.exec(l);
    if (m) fence = fence === null ? m[1][0] : fence === m[1][0] ? null : fence;
    return fence === null && !m && /^#{1,3} /.test(l);
  });
  return (end === -1 ? rest : rest.slice(0, end)).join('\n');
}

const runsMautoWithJunit = (block) =>
  block.lines.some((l) => !/^\s*#/.test(l) && /\bmauto run\b/.test(l) && /--junit\b/.test(l));

// --- Rule 1 -----------------------------------------------------------------

describe('action refs in shipping docs match this repo\'s workflows (#277)', () => {
  const refs = workflowRefs();

  test('the workflows pin at least one action (the guard is not vacuous)', () => {
    expect(refs.size).toBeGreaterThan(0);
    expect(refs.has('actions/checkout')).toBe(true);
  });

  test('the FAQ is part of the shipping doc corpus', () => {
    expect(shippingDocs()).toContain(FAQ);
  });

  test('every `uses:` in a fenced block pins a ref the workflows use', () => {
    const offenders = [];
    for (const rel of shippingDocs()) {
      for (const block of fencedBlocks(read(rel))) {
        block.lines.forEach((line, i) => {
          const m = /^\s*(?:-\s*)?uses:\s*['"]?([\w.-]+\/[\w./-]+)@([^\s'"#]+)/.exec(line);
          if (!m) return;
          const [, action, ref] = m;
          const ours = refs.get(action);
          if (!ours || ours.has(ref)) return;
          offenders.push(
            `${rel}:${block.startLine + i}: ${action}@${ref} — ${WORKFLOW_DIR} pins ` +
              `${[...ours].sort().map((r) => `${action}@${r}`).join(' or ')}`
          );
        });
      }
    }
    expect(offenders).toEqual([]);
  });
});

// --- Rule 2 -----------------------------------------------------------------

describe('the FAQ CI answers execute a scenario (#277)', () => {
  const faq = read(FAQ);

  test.each([CI_ANSWER, ACTIONS_ANSWER])('"%s" runs `mauto run … --junit` in a fenced block', (heading) => {
    const blocks = fencedBlocks(answer(faq, heading));
    const found = blocks.some(runsMautoWithJunit);
    if (!found) {
      throw new Error(
        `${FAQ}: the "${heading}" answer has no fenced block with a \`mauto run <scenario> --junit <path>\` ` +
          `line (${blocks.length} fenced block(s) checked). A CI recipe that never runs a scenario is #277.`
      );
    }
  });

  describe('the GitHub Actions example', () => {
    const blocks = fencedBlocks(answer(faq, ACTIONS_ANSWER)).filter((b) => /^ya?ml$/.test(b.lang));
    const workflows = blocks.map((b) => yaml.load(b.lines.join('\n')));
    const steps = workflows.flatMap((wf) =>
      Object.values((wf && wf.jobs) || {}).flatMap((job) => (job.steps || []).filter(Boolean))
    );

    test('is one parseable workflow with jobs and steps', () => {
      expect(blocks).toHaveLength(1);
      expect(steps.length).toBeGreaterThan(0);
    });

    test('runs the scenario in a step, not in a comment', () => {
      // The emulator runner takes its commands as `with.script`, so both the
      // `run:` of a plain step and that script count as executed text.
      const executed = [...runs(steps), ...steps.map((s) => String((s.with && s.with.script) || ''))];
      const hits = executed.filter((cmd) => /\bmauto run\b[^\n]*--junit\b/.test(cmd));
      expect(hits.length).toBeGreaterThan(0);
    });

    test('uploads its artifacts with `if: always()`', () => {
      const uploads = steps.filter((s) => String(s.uses || '').startsWith('actions/upload-artifact@'));
      if (uploads.length === 0) {
        throw new Error(`${FAQ}: the GitHub Actions example has no actions/upload-artifact step`);
      }
      const conditional = uploads.filter((s) => !/^(\$\{\{\s*)?always\(\)(\s*\}\})?$/.test(String(s.if || '').trim()));
      expect(conditional.map((s) => `${s.name || s.uses}: if: ${s.if === undefined ? '(none)' : s.if}`)).toEqual([]);
    });
  });
});

// --- Rule 3 -----------------------------------------------------------------

describe('no shipping doc reads latest.json (#277)', () => {
  test('`latest.json` is named nowhere: mauto writes results as <run_id>.json', () => {
    const offenders = [];
    for (const rel of shippingDocs()) {
      read(rel).split('\n').forEach((line, i) => {
        if (/\blatest\.json\b/.test(line)) offenders.push(`${rel}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});

// --- The parsers, pinned ----------------------------------------------------

describe('docs-ci-recipe helpers', () => {
  test('fencedBlocks reports language, first line and body', () => {
    const md = ['intro', '```yaml', 'a: 1', 'b: 2', '```', 'text', '~~~', 'x', '~~~'].join('\n');
    expect(fencedBlocks(md)).toEqual([
      { lang: 'yaml', startLine: 3, lines: ['a: 1', 'b: 2'] },
      { lang: '', startLine: 8, lines: ['x'] },
    ]);
  });

  test('answer stops at the next heading and throws on a missing one', () => {
    const md = ['### A?', 'one', '### B?', 'two', '## C', 'three'].join('\n');
    expect(answer(md, 'A?')).toBe('one');
    expect(answer(md, 'B?')).toBe('two');
    expect(() => answer(md, 'Z?')).toThrow(/no "### Z\?" answer/);
    const fenced = ['### A?', '```bash', '# not a heading', 'x', '```', '### B?'].join('\n');
    expect(answer(fenced, 'A?')).toBe(['```bash', '# not a heading', 'x', '```'].join('\n'));
  });

  test('a commented-out run does not count as running the scenario', () => {
    expect(runsMautoWithJunit({ lines: ['# mauto run a.json --junit r.xml'] })).toBe(false);
    expect(runsMautoWithJunit({ lines: ['mauto run a.json --junit r.xml'] })).toBe(true);
  });
});
