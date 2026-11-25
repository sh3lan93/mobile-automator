'use strict';

// Build-time guard over the showcase walkthrough (#312, PRD #304).
//
// The showcase README walks a newcomer from a fresh clone to replaying their
// own recording on the other platform, and three other pages point into it.
// Prose drifts quietly: a step gets renamed or dropped, a scenario is added
// without a row (or a row outlives its file), a link to `#walkthrough` or into
// TROUBLESHOOTING.md dies with a heading rename, or a rewrite starts implying
// the shipped scenarios were recorded or that replay needs an agent. Each rule
// below makes one of those a failure:
//
//   1. the README and the docs page are in the shipping-doc corpus, so every
//      prose guard scans them too;
//   2. the README's numbered `###` steps under `## Walkthrough` are exactly
//      WALKTHROUGH, in order and numbered 1..N;
//   3. docs/examples/showcase.md links to the full walkthrough and is in the
//      mkdocs nav (it is a pointer and restates none of the steps);
//   4. the Scenarios table has one row per file in showcase-app/scenarios/,
//      and no row for a file that is not there;
//   5. README.md and sample-app/README.md link to the walkthrough;
//   6. steps 4, 5 and 7 replay with `mauto run`, step 6 says recording needs an
//      AI agent following `mauto guide generate`, and the walkthrough says the
//      shipped scenarios are curated fixtures, not recordings;
//   7. every TROUBLESHOOTING.md anchor the README links names a real heading.

const fs = require('fs');
const path = require('path');

const { REPO_ROOT, repoFiles, shippingDocs } = require('./docs-corpus');
const { fencedBlocks, headings, requireSection } = require('./markdown');

const README = 'showcase-app/README.md';
const DOCS_PAGE = 'docs/examples/showcase.md';
const MKDOCS = 'mkdocs.yml';
const SCENARIOS = 'showcase-app/scenarios/';
const WALKTHROUGH_URL = 'https://github.com/sh3lan93/mobile-automator/blob/main/showcase-app/README.md#walkthrough';

// The walkthrough's steps, in order: what the README's numbered headings must be.
const WALKTHROUGH = [
  'Clone and add your TMDB key',
  'Build and install on an emulator and a simulator',
  'Install mauto and create a workspace',
  'Replay a shipped scenario on Android',
  'Replay the same file on iOS',
  'Record a flow of your own',
  'Replay your recording on the other platform',
  'Replay in CI',
];

const read = (rel) => fs.readFileSync(path.join(REPO_ROOT, rel), 'utf8');

const readme = read(README);
const walkthrough = requireSection(readme, '## Walkthrough', README);
const steps = headings(walkthrough)
  .filter((h) => h.level === 3)
  .map((h) => /^(\d+)\. (.*)$/.exec(h.text))
  .filter(Boolean)
  .map(([, n, title]) => ({ n: Number(n), title }));
const step = (n) => {
  const s = steps.find((x) => x.n === n);
  if (!s) throw new Error(`${README}: the walkthrough has no step ${n}`);
  return requireSection(walkthrough, `### ${s.n}. ${s.title}`, README);
};

describe('showcase walkthrough — in the shipping-doc corpus', () => {
  test.each([README, DOCS_PAGE])('%s is a shipping doc', (rel) => {
    expect(shippingDocs()).toContain(rel);
  });
});

describe('showcase walkthrough — the steps', () => {
  test('the README walkthrough steps are the expected titles, in order', () => {
    expect(steps.map((s) => s.title)).toEqual(WALKTHROUGH);
  });

  test('the README walkthrough steps are numbered 1..N', () => {
    expect(steps.map((s) => s.n)).toEqual(WALKTHROUGH.map((_, i) => i + 1));
  });
});

describe('showcase walkthrough — the docs-site page', () => {
  const page = read(DOCS_PAGE);

  test('links to the full walkthrough', () => {
    expect(page).toContain(`](${WALKTHROUGH_URL})`);
  });

  test('is in the mkdocs nav', () => {
    expect(read(MKDOCS)).toMatch(/^\s*-\s.*:\s*examples\/showcase\.md\s*$/m);
  });
});

describe('showcase walkthrough — the Scenarios table', () => {
  const files = repoFiles(SCENARIOS)
    .filter((f) => f.endsWith('.json') && !f.slice(SCENARIOS.length).includes('/'))
    .map((f) => f.slice(SCENARIOS.length));
  const rows = [...requireSection(readme, '## Scenarios', README).matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]);

  test('showcase-app/scenarios holds at least one scenario (the rule below is not vacuous)', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  test('every scenario file has a row, and every row names a file that exists', () => {
    expect({
      missingRows: files.filter((f) => !rows.includes(f)),
      rowsWithoutFile: rows.filter((r) => !files.includes(r)),
    }).toEqual({ missingRows: [], rowsWithoutFile: [] });
  });
});

describe('showcase walkthrough — linked from the repo READMEs', () => {
  test.each([
    ['README.md', 'showcase-app/README.md#walkthrough'],
    ['sample-app/README.md', '../showcase-app/README.md#walkthrough'],
  ])('%s links to the walkthrough', (rel, href) => {
    expect(read(rel)).toContain(`](${href})`);
  });
});

describe('showcase walkthrough — replay without an agent, record with one', () => {
  const runsMauto = (body) =>
    fencedBlocks(body).some((b) => b.lines.some((l) => !/^\s*#/.test(l) && /\bmauto run\b/.test(l)));

  test.each([4, 5, 7])('step %i replays with `mauto run` in a fenced block', (n) => {
    expect(runsMauto(step(n))).toBe(true);
  });

  test('step 6 says recording needs an AI agent following `mauto guide generate`', () => {
    const body = step(6);
    expect(body).toMatch(/Recording needs an AI agent/);
    expect(body).toContain('`mauto guide generate`');
  });

  test('the walkthrough says the shipped scenarios are curated fixtures, not recordings', () => {
    expect(walkthrough).toContain('The shipped scenarios are curated fixtures');
    expect(walkthrough).toContain('They are not recordings made with mauto');
  });
});

describe('showcase walkthrough — the troubleshooting link resolves', () => {
  // GitHub's heading anchor: lowercase, drop everything but letters, digits,
  // spaces, `-` and `_`, then spaces to `-`.
  const slug = (text) => text.toLowerCase().replace(/[^a-z0-9 _-]/g, '').replace(/ /g, '-');

  test('every TROUBLESHOOTING.md anchor the README links names a real heading there', () => {
    const anchors = [...readme.matchAll(/\]\(\.\.\/TROUBLESHOOTING\.md#([^)]+)\)/g)].map((m) => m[1]);
    expect(anchors.length).toBeGreaterThan(0);
    const slugs = headings(read('TROUBLESHOOTING.md')).map((h) => slug(h.text));
    expect(anchors.filter((a) => !slugs.includes(a))).toEqual([]);
  });
});
