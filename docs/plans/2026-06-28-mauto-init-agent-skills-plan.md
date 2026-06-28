# mauto init — Native Agent Skills Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `mauto init --agent <name>` install native Agent Skills (open-standard `SKILL.md` folders) into each host's skill directory across claude/cursor/gemini/copilot/agents, restoring guaranteed behavior-forcing for the generate/execute/setup workflows.

**Architecture:** A new `skill-renderer` deterministically renders a `SKILL.md` per topic from generic frontmatter (`skill-meta`) plus a placeholder-free invariants snippet (`src/guide/content/<topic>.invariants.md`), with a body that points at `mauto guide <topic>` for the live, mode-aware, interpolated workflow. The `init` vendor adapters write those skill folders into per-agent directories; existing slash-command/rule + MCP-config behavior is preserved. No interpolation happens at install time, so `init` never reads `config.json`.

**Tech Stack:** Node.js (CommonJS), Commander (CLI), Jest (tests). No new dependencies.

## Global Constraints

- Platform-agnostic: never emit `resource-id` / OS-specific element IDs in any artifact.
- Inlined invariants are **placeholder-free** (no `{{` token), contain no `mobile_*` tool names, and name no OS (so one snippet is safe for both aware and agnostic installs).
- Skill frontmatter `name`: lowercase letters/numbers/hyphens only, ≤64 chars, no reserved words `anthropic`/`claude`, equals the skill folder name. `description`: non-empty, ≤1024 chars, no XML tags.
- `init` must not read `config.json` or interpolate; mode is resolved at runtime by `mauto guide`.
- Adapters stay idempotent (re-run yields byte-identical files via `writeIfChanged`) and never touch files outside the skill folders they own (plus the existing single `mauto` MCP key).
- CI "Verify version is bumped" gate: this touches `src/`, so `package.json` `version` must be bumped to a value not yet tagged. Under gate-then-graduate, bump to the next release-candidate semver `0.21.0-rc.0`.
- Existing behavior preserved: `mauto guide`, `mauto mcp`, and the thin slash-commands/rules remain unchanged and keep being written.

---

### Task 1: Invariants snippet files + their guard

**Files:**
- Create: `src/guide/content/generate.invariants.md`
- Create: `src/guide/content/execute.invariants.md`
- Create: `src/guide/content/setup.invariants.md`
- Test: `tests/lint/skill-invariants.test.js`

**Interfaces:**
- Produces: three markdown snippet files read by the renderer in Task 3. Each is a bullet list of placeholder-free, OS-free QA disciplines. No code exports.

- [ ] **Step 1: Write the failing test**

Create `tests/lint/skill-invariants.test.js`:

```javascript
'use strict';

const fs = require('fs');
const path = require('path');

const CONTENT_DIR = path.resolve(__dirname, '../../src/guide/content');
const TOPICS = ['generate', 'execute', 'setup'];

// Anchor phrases that MUST appear verbatim in both the invariants snippet and
// the matching guide content (drift guard): if the discipline is removed from
// the guide, the anchor disappears and this test fails.
const ANCHORS = {
  generate: 'do NOT plan or suggest steps',
  execute: 'exactly as written',
  setup: 'Inspect real project files',
};

// OS names forbidden in invariants so one snippet is safe for agnostic installs.
const OS_WORDS = /\b(android|ios|iphone|ipad|xcode|gradle|adb|simulator|emulator|swift|kotlin)\b/i;

describe('skill invariants snippets', () => {
  for (const topic of TOPICS) {
    const file = path.join(CONTENT_DIR, `${topic}.invariants.md`);

    it(`${topic}.invariants.md exists and is non-empty`, () => {
      expect(fs.existsSync(file)).toBe(true);
      expect(fs.readFileSync(file, 'utf8').trim().length).toBeGreaterThan(0);
    });

    it(`${topic}.invariants.md has no {{ placeholder, no mobile_ tool, no OS name`, () => {
      const body = fs.readFileSync(file, 'utf8');
      expect(body).not.toContain('{{');
      expect(body).not.toMatch(/\bmobile_[a-z_]+/);
      expect(body).not.toMatch(OS_WORDS);
    });

    it(`${topic}.invariants.md anchor also appears in both guide variants`, () => {
      const snippet = fs.readFileSync(file, 'utf8');
      const anchor = ANCHORS[topic];
      expect(snippet).toContain(anchor);
      for (const variant of ['aware', 'agnostic']) {
        const guide = fs.readFileSync(path.join(CONTENT_DIR, `${topic}.${variant}.md`), 'utf8');
        expect(guide).toContain(anchor);
      }
    });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/lint/skill-invariants.test.js`
Expected: FAIL — files do not exist yet.

- [ ] **Step 3: Create the three snippet files**

`src/guide/content/generate.invariants.md`:

```markdown
- **You do NOT plan or suggest steps.** The user tells you exactly what to do; you execute, document, and verify — never add extra steps.
- Capture a screenshot after every single step. No exceptions.
- Drive the device **only** through `mauto` verbs; never assume resource-ids or OS-specific element IDs.
- Assemble the scenario JSON to match `mauto schema scenario`: use named string IDs (snake_case, never integers), then validate with `mauto validate <path>` before finishing.
```

`src/guide/content/execute.invariants.md`:

```markdown
- Follow the scenario **exactly as written** — no improvisation, no skipped steps. If something unexpected happens, report it; do not work around it.
- Drive the device **only** through `mauto` verbs; never assume resource-ids or OS-specific element IDs (use the semantic actions in platform-agnostic projects).
- Every assertion is backed by a screenshot; record observations via `mauto result add-step`.
```

`src/guide/content/setup.invariants.md`:

```markdown
- Inspect real project files before inferring any value; never invent a value you cannot find evidence for — ask the user instead.
- Persist every finding with `mauto config set <key> <value>` and verify it with `mauto config get <key>`.
- Do not modify app source code, and do not re-scaffold the workspace — `mauto setup` already created it. This guide only reads the project and writes the workspace config.
```

- [ ] **Step 4: Verify the execute anchor exists in the agnostic guide**

Run: `grep -c "exactly as written" src/guide/content/execute.agnostic.md`
Expected: a count ≥ 1. If it prints `0`, add the phrase to a discipline line in `src/guide/content/execute.agnostic.md` (e.g. ensure a line reads "Follow scenario steps exactly as written.") so the drift anchor is present, then re-run.

- [ ] **Step 5: Run test to verify it passes**

Run: `npx jest tests/lint/skill-invariants.test.js`
Expected: PASS (9 assertions).

- [ ] **Step 6: Commit**

```bash
git add src/guide/content/generate.invariants.md src/guide/content/execute.invariants.md src/guide/content/setup.invariants.md tests/lint/skill-invariants.test.js
git commit -m "feat(init): placeholder-free invariants snippets for skill bodies"
```

---

### Task 2: Skill metadata catalog

**Files:**
- Create: `src/init/skill-meta.js`
- Test: `tests/unit/init/skill-meta.test.js`

**Interfaces:**
- Produces: `SKILL_META` — an object keyed by topic (`generate`/`execute`/`setup`), each `{ name: string, description: string }`. `name` equals `mobile-automator-<topic>`. Consumed by the renderer (Task 3).

- [ ] **Step 1: Write the failing test**

Create `tests/unit/init/skill-meta.test.js`:

```javascript
'use strict';

const { SKILL_META } = require('../../../src/init/skill-meta');

const TOPICS = ['generate', 'execute', 'setup'];
const RESERVED = /\b(anthropic|claude)\b/i;
const NAME_RE = /^[a-z0-9-]+$/;

describe('SKILL_META', () => {
  it('has an entry per topic', () => {
    expect(Object.keys(SKILL_META).sort()).toEqual([...TOPICS].sort());
  });

  for (const topic of TOPICS) {
    it(`${topic} name is valid and topic-derived`, () => {
      const { name } = SKILL_META[topic];
      expect(name).toBe(`mobile-automator-${topic}`);
      expect(name).toMatch(NAME_RE);
      expect(name.length).toBeLessThanOrEqual(64);
      expect(name).not.toMatch(RESERVED);
    });

    it(`${topic} description is non-empty, <=1024 chars, no XML, no placeholder`, () => {
      const { description } = SKILL_META[topic];
      expect(description.length).toBeGreaterThan(0);
      expect(description.length).toBeLessThanOrEqual(1024);
      expect(description).not.toMatch(/[<>]/);
      expect(description).not.toContain('{{');
      // Good discovery descriptions say WHEN to use the skill.
      expect(description.toLowerCase()).toContain('use when');
    });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/init/skill-meta.test.js`
Expected: FAIL — `Cannot find module '.../skill-meta'`.

- [ ] **Step 3: Write the catalog**

Create `src/init/skill-meta.js`:

```javascript
'use strict';

// Frontmatter metadata for the installed Agent Skills. `name` MUST equal the
// skill folder name and satisfy the strictest host rules (lowercase/hyphen,
// <=64 chars, no reserved words). `description` is generic and placeholder-free
// and names WHEN to use the skill so hosts surface it at the right moment.
const SKILL_META = {
  generate: {
    name: 'mobile-automator-generate',
    description:
      'Author a mobile QA test scenario by driving the app on a device and ' +
      'recording each step as structured JSON. Use when the user wants to ' +
      'create, author, record, or generate a mobile test scenario.',
  },
  execute: {
    name: 'mobile-automator-execute',
    description:
      'Execute a saved mobile QA scenario on a device and produce a pass/fail ' +
      'report with diagnostics. Use when the user wants to run, replay, or ' +
      'verify a mobile test scenario.',
  },
  setup: {
    name: 'mobile-automator-setup',
    description:
      'Initialise and configure a mobile-automator workspace by analysing the ' +
      'project. Use when the user wants to set up, configure, or initialise ' +
      'mobile QA automation for this project.',
  },
};

module.exports = { SKILL_META };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/init/skill-meta.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/init/skill-meta.js tests/unit/init/skill-meta.test.js
git commit -m "feat(init): skill metadata catalog (name + discovery description)"
```

---

### Task 3: Skill renderer

**Files:**
- Create: `src/init/skill-renderer.js`
- Test: `tests/unit/init/skill-renderer.test.js`

**Interfaces:**
- Consumes: `SKILL_META` from `src/init/skill-meta.js`; the invariants files from Task 1.
- Produces:
  - `renderSkill(topic) -> { dirName: string, content: string }` where `dirName === SKILL_META[topic].name` and `content` is the full `SKILL.md` text (frontmatter + body).
  - `SKILL_TOPICS` — array `['generate','execute','setup']`.
  Consumed by the adapters in Task 4.

- [ ] **Step 1: Write the failing test**

Create `tests/unit/init/skill-renderer.test.js`:

```javascript
'use strict';

const { renderSkill, SKILL_TOPICS } = require('../../../src/init/skill-renderer');

describe('renderSkill', () => {
  it('exposes the three topics', () => {
    expect(SKILL_TOPICS.sort()).toEqual(['execute', 'generate', 'setup']);
  });

  for (const topic of ['generate', 'execute', 'setup']) {
    const { dirName, content } = renderSkill(topic);

    it(`${topic}: dirName matches the skill name`, () => {
      expect(dirName).toBe(`mobile-automator-${topic}`);
    });

    it(`${topic}: has YAML frontmatter with name and description`, () => {
      expect(content.startsWith('---\n')).toBe(true);
      expect(content).toMatch(new RegExp(`name: mobile-automator-${topic}\\n`));
      expect(content).toMatch(/\ndescription: /);
    });

    it(`${topic}: body inlines invariants and points to the guide`, () => {
      expect(content).toContain('Non-negotiable directives');
      expect(content).toContain(`mauto guide ${topic}`);
    });

    it(`${topic}: leaks no placeholder and no mobile_ tool name`, () => {
      expect(content).not.toContain('{{');
      expect(content).not.toMatch(/\bmobile_[a-z_]+/);
    });
  }

  it('throws on an unknown topic', () => {
    expect(() => renderSkill('nope')).toThrow(/unknown skill topic/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx jest tests/unit/init/skill-renderer.test.js`
Expected: FAIL — module not found.

- [ ] **Step 3: Write the renderer**

Create `src/init/skill-renderer.js`:

```javascript
'use strict';

// Deterministic SKILL.md renderer (option C: hybrid). The body inlines the
// placeholder-free QA invariants (guaranteed forcing the moment a host
// activates the skill) and points to `mauto guide <topic>` for the full,
// mode-aware, interpolated workflow. NO interpolation happens here, so the
// renderer never reads config.json — see docs/plans/2026-06-28-*-design.md §5.
const fs = require('fs');
const path = require('path');

const { SKILL_META } = require('./skill-meta');

const SKILL_TOPICS = ['generate', 'execute', 'setup'];
const CONTENT_DIR = path.resolve(__dirname, '../guide/content');

const TITLES = {
  generate: 'Generate',
  execute: 'Execute',
  setup: 'Setup',
};

function renderSkill(topic) {
  const meta = SKILL_META[topic];
  if (!meta) {
    throw new Error(`unknown skill topic: ${topic}`);
  }
  const invariants = fs
    .readFileSync(path.join(CONTENT_DIR, `${topic}.invariants.md`), 'utf8')
    .trim();

  const content =
    '---\n' +
    `name: ${meta.name}\n` +
    `description: ${meta.description}\n` +
    '---\n\n' +
    `# Mobile Automator — ${TITLES[topic]}\n\n` +
    '## Non-negotiable directives (always apply)\n' +
    `${invariants}\n\n` +
    '## Full workflow\n' +
    'Load the complete, project-configured playbook and follow it step by step:\n\n' +
    `    mauto guide ${topic}\n`;

  // Defensive: the invariants are placeholder-free by construction; never let a
  // stray token reach an installed skill.
  if (content.includes('{{')) {
    throw new Error(`skill ${topic} leaked a placeholder token`);
  }

  return { dirName: meta.name, content };
}

module.exports = { renderSkill, SKILL_TOPICS };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx jest tests/unit/init/skill-renderer.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/init/skill-renderer.js tests/unit/init/skill-renderer.test.js
git commit -m "feat(init): deterministic SKILL.md renderer (inlined invariants + guide pointer)"
```

---

### Task 4: Adapters — install skills for all five agents

**Files:**
- Modify: `src/init/adapters.js` (add gemini/copilot/agents adapters; add skill writing to all)
- Test: `tests/unit/init/adapters.test.js:1-200` (extend; keep existing assertions)

**Interfaces:**
- Consumes: `renderSkill`, `SKILL_TOPICS` from Task 3.
- Produces: `ADAPTERS` now has keys `claude`, `cursor`, `gemini`, `copilot`, `agents`. Each `apply({ projectRoot })` returns `{ agent, written, merged }` and writes a skill folder per topic under that agent's skills dir. `claude`/`cursor` additionally keep writing their slash-command/rule and merging MCP config. New export `SKILL_DEST` maps agent → skills directory (relative).

- [ ] **Step 1: Write the failing tests (append to the existing file)**

Append to `tests/unit/init/adapters.test.js`:

```javascript
const { SKILL_DEST } = require('../../../src/init/adapters');

const ALL_AGENTS = ['claude', 'cursor', 'gemini', 'copilot', 'agents'];
const SKILL_TOPICS = ['generate', 'execute', 'setup'];

describe('skill installation across agents', () => {
  for (const agent of ALL_AGENTS) {
    test(`${agent}: writes a SKILL.md per topic in the agent skills dir`, () => {
      const projectRoot = tmpRoot();
      const res = require('../../../src/init/adapters').ADAPTERS[agent].apply({ projectRoot });
      expect(res.agent).toBe(agent);
      for (const topic of SKILL_TOPICS) {
        const f = path.join(projectRoot, SKILL_DEST[agent], `mobile-automator-${topic}`, 'SKILL.md');
        expect(fs.existsSync(f)).toBe(true);
        const body = fs.readFileSync(f, 'utf8');
        expect(body).toContain(`name: mobile-automator-${topic}`);
        expect(body).toContain(`mauto guide ${topic}`);
        expect(body).not.toContain('{{');
      }
    });

    test(`${agent}: re-running is idempotent (byte-identical SKILL.md)`, () => {
      const projectRoot = tmpRoot();
      const A = require('../../../src/init/adapters').ADAPTERS[agent];
      A.apply({ projectRoot });
      const f = path.join(projectRoot, SKILL_DEST[agent], 'mobile-automator-execute', 'SKILL.md');
      const first = fs.readFileSync(f, 'utf8');
      A.apply({ projectRoot });
      expect(fs.readFileSync(f, 'utf8')).toBe(first);
    });
  }

  test('does not touch a foreign skill folder', () => {
    const projectRoot = tmpRoot();
    const foreign = path.join(projectRoot, '.claude', 'skills', 'someones-skill', 'SKILL.md');
    fs.mkdirSync(path.dirname(foreign), { recursive: true });
    fs.writeFileSync(foreign, 'KEEP ME');
    require('../../../src/init/adapters').ADAPTERS.claude.apply({ projectRoot });
    expect(fs.readFileSync(foreign, 'utf8')).toBe('KEEP ME');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx jest tests/unit/init/adapters.test.js`
Expected: FAIL — `SKILL_DEST` undefined / `ADAPTERS.gemini` undefined.

- [ ] **Step 3: Rewrite `src/init/adapters.js`**

Replace the whole file with:

```javascript
'use strict';

// VendorAdapters — `mauto init --agent <claude|cursor|gemini|copilot|agents>`.
//
// Each adapter installs native Agent Skills (open standard: a SKILL.md folder
// per topic) into the agent's skills directory, and is idempotent (re-running
// yields byte-identical files). claude/cursor additionally keep writing their
// thin slash-command/rule and merging the shared `mauto` MCP server entry.
// Adapters never clobber a file they don't own.

const fs = require('fs');
const path = require('path');

const guideEmitter = require('../guide/emitter');
const { renderSkill, SKILL_TOPICS } = require('./skill-renderer');

const TOPICS = ['generate', 'execute', 'setup'];

// The single mauto MCP server entry merged into a vendor's mcp config.
const MAUTO_SERVER = { command: 'mauto', args: ['mcp'] };

// Per-agent skills directory (relative to projectRoot). claude uses its own
// namespace; cursor/gemini/copilot read their native dir; `agents` targets the
// universal open-standard location read by cursor/gemini/copilot too.
const SKILL_DEST = {
  claude: path.join('.claude', 'skills'),
  cursor: path.join('.cursor', 'skills'),
  gemini: path.join('.gemini', 'skills'),
  copilot: path.join('.github', 'skills'),
  agents: path.join('.agents', 'skills'),
};

function claudeCommandBody(topic) {
  return (
    `Run \`mauto guide ${topic}\` and follow it. ` +
    'Drive the device only through `mauto` verbs (never assume resource-ids).\n'
  );
}

function cursorRuleBody() {
  return (
    '---\n' +
    'description: Mobile Automator — drive mobile QA through the mauto CLI.\n' +
    'alwaysApply: true\n' +
    '---\n\n' +
    guideEmitter.emitBootstrap() +
    '\nRun `mauto guide <topic>` (generate|execute|setup) before a workflow. ' +
    'Drive the device only through `mauto` verbs.\n'
  );
}

function writeIfChanged(filePath, content) {
  const prev = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
  if (prev === content) return false;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
  return true;
}

function mergeMcpConfig(filePath) {
  let doc = {};
  if (fs.existsSync(filePath)) {
    doc = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (doc == null || typeof doc !== 'object' || Array.isArray(doc)) doc = {};
  }
  if (doc.mcpServers == null || typeof doc.mcpServers !== 'object') {
    doc.mcpServers = {};
  }
  doc.mcpServers.mauto = { ...MAUTO_SERVER };
  const next = JSON.stringify(doc, null, 2) + '\n';
  const prev = fs.existsSync(filePath) ? fs.readFileSync(filePath, 'utf8') : null;
  if (prev === next) return { changed: false };
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, next);
  return { changed: true };
}

// Install one SKILL.md folder per topic under the agent's skills dir. Only the
// folders we own are written; foreign skill folders are never touched.
function writeSkills(projectRoot, agent, written) {
  const root = path.join(projectRoot, SKILL_DEST[agent]);
  for (const topic of SKILL_TOPICS) {
    const { dirName, content } = renderSkill(topic);
    const file = path.join(root, dirName, 'SKILL.md');
    writeIfChanged(file, content);
    written.push(file);
  }
}

function makeAdapter(agent, extra) {
  return {
    apply({ projectRoot }) {
      const written = [];
      const merged = [];
      if (extra) extra({ projectRoot, written, merged });
      writeSkills(projectRoot, agent, written);
      return { agent, written, merged };
    },
  };
}

const ADAPTERS = {
  claude: makeAdapter('claude', ({ projectRoot, written, merged }) => {
    const commandsDir = path.join(projectRoot, '.claude', 'commands');
    for (const topic of TOPICS) {
      const file = path.join(commandsDir, `mobile-automator-${topic}.md`);
      writeIfChanged(file, claudeCommandBody(topic));
      written.push(file);
    }
    const mcpPath = path.join(projectRoot, '.mcp.json');
    mergeMcpConfig(mcpPath);
    merged.push(mcpPath);
  }),

  cursor: makeAdapter('cursor', ({ projectRoot, written, merged }) => {
    const rulePath = path.join(projectRoot, '.cursor', 'rules', 'mobile-automator.mdc');
    writeIfChanged(rulePath, cursorRuleBody());
    written.push(rulePath);
    const mcpPath = path.join(projectRoot, '.cursor', 'mcp.json');
    mergeMcpConfig(mcpPath);
    merged.push(mcpPath);
  }),

  gemini: makeAdapter('gemini'),
  copilot: makeAdapter('copilot'),
  agents: makeAdapter('agents'),
};

module.exports = { ADAPTERS, MAUTO_SERVER, SKILL_DEST };
```

- [ ] **Step 4: Run the full init test file to verify pass**

Run: `npx jest tests/unit/init/adapters.test.js`
Expected: PASS — existing slash-command/MCP tests still green, new skill tests green.

- [ ] **Step 5: Commit**

```bash
git add src/init/adapters.js tests/unit/init/adapters.test.js
git commit -m "feat(init): install native Agent Skills for claude/cursor/gemini/copilot/agents"
```

---

### Task 5: CLI wiring — accept the five agents and `all`

**Files:**
- Modify: `src/cli.js:356-369` (handleInit), `src/cli.js:740-747` (command registration)
- Test: `tests/unit/cli.test.js` (append init cases)

**Interfaces:**
- Consumes: `ADAPTERS` (now five keys).
- Produces: `handleInit({ projectRoot, adapters }, agent)` accepts any of the five agent keys or `'all'`. For `'all'` it applies every adapter and returns `ok({ agents: [...] })`. Unknown agent → `fail('invalid_input', ...)` whose hint lists all five.

- [ ] **Step 1: Write the failing test**

Append to `tests/unit/cli.test.js` (place inside the file's top-level `describe`/`require` area; reuse its existing imports of `handleInit` — if not exported, add a focused block):

```javascript
const os = require('os');
const fsForInit = require('fs');
const pathForInit = require('path');
const { handleInit } = require('../../src/cli');

function initTmpRoot() {
  return fsForInit.mkdtempSync(pathForInit.join(os.tmpdir(), 'mauto-cliinit-'));
}

describe('handleInit', () => {
  test('unknown agent fails with a hint listing all five', () => {
    const r = handleInit({ projectRoot: initTmpRoot() }, 'frobnicator');
    expect(r.exitKind).toBe('invalid_input');
    expect(r.envelope.hint).toMatch(/claude.*cursor.*gemini.*copilot.*agents/);
  });

  test('a single agent installs its skills', () => {
    const projectRoot = initTmpRoot();
    const r = handleInit({ projectRoot }, 'gemini');
    expect(r.exitKind).toBe('ok');
    const f = pathForInit.join(projectRoot, '.gemini', 'skills', 'mobile-automator-execute', 'SKILL.md');
    expect(fsForInit.existsSync(f)).toBe(true);
  });

  test('all installs skills for every agent', () => {
    const projectRoot = initTmpRoot();
    const r = handleInit({ projectRoot }, 'all');
    expect(r.exitKind).toBe('ok');
    expect(r.envelope.data.agents.sort()).toEqual(
      ['agents', 'claude', 'copilot', 'cursor', 'gemini']
    );
    for (const [agent, dir] of [
      ['claude', '.claude/skills'],
      ['cursor', '.cursor/skills'],
      ['gemini', '.gemini/skills'],
      ['copilot', '.github/skills'],
      ['agents', '.agents/skills'],
    ]) {
      const f = pathForInit.join(projectRoot, dir, 'mobile-automator-generate', 'SKILL.md');
      expect(fsForInit.existsSync(f)).toBe(true);
    }
  });
});
```

- [ ] **Step 2: Verify `handleInit` is exported; run test to confirm failure**

Run: `npx jest tests/unit/cli.test.js -t handleInit`
Expected: FAIL — either `handleInit` is not exported, or `all`/new agents not handled.

- [ ] **Step 3: Update `handleInit` in `src/cli.js`**

Replace the function body (lines ~356-369) with:

```javascript
function handleInit({ projectRoot, adapters = ADAPTERS }, agent) {
  const known = Object.keys(adapters);
  if (agent === 'all') {
    const results = known.map((a) => adapters[a].apply({ projectRoot }));
    return {
      envelope: ok({
        agents: results.map((r) => r.agent),
        written: results.flatMap((r) => r.written),
        merged: results.flatMap((r) => r.merged),
      }),
      exitKind: 'ok',
    };
  }
  const adapter = adapters[agent];
  if (!adapter) {
    return {
      envelope: fail(
        'invalid_input',
        `unknown agent "${agent}"`,
        `supported: ${known.join(', ')}, all`
      ),
      exitKind: 'invalid_input',
    };
  }
  const r = adapter.apply({ projectRoot });
  return {
    envelope: ok({ agent: r.agent, written: r.written, merged: r.merged }),
    exitKind: 'ok',
  };
}
```

- [ ] **Step 4: Update the command registration (lines ~740-747)**

Replace with:

```javascript
  program
    .command('init')
    .description('Install native Agent Skills (+ slash commands/rules + MCP entry) for an agent')
    .requiredOption('--agent <name>', 'claude | cursor | gemini | copilot | agents | all')
    .action((opts) => {
      const r = handleInit({ projectRoot }, opts.agent);
      emit(r, humanFlag());
    });
```

- [ ] **Step 5: Ensure `handleInit` is exported**

Check the bottom of `src/cli.js` for its `module.exports`. If `handleInit` is not listed, add it:

Run: `grep -n "module.exports" src/cli.js`
Then add `handleInit` to the exported object (e.g. `module.exports = { ...existing, handleInit };`). If the file exports via a different mechanism, mirror how `handleInit` is already referenced by existing tests.

- [ ] **Step 6: Run tests to verify pass**

Run: `npx jest tests/unit/cli.test.js -t handleInit`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/cli.js tests/unit/cli.test.js
git commit -m "feat(cli): init accepts claude|cursor|gemini|copilot|agents|all"
```

---

### Task 6: Lint guards for rendered skills

**Files:**
- Create: `tests/lint/skill-no-placeholder-leak.test.js`
- Create: `tests/lint/skill-frontmatter-valid.test.js`
- Modify: `package.json:scripts` (extend `lint:guides` to include skill guards)

**Interfaces:**
- Consumes: `renderSkill`, `SKILL_TOPICS` from Task 3.
- Produces: CI guards asserting every rendered skill is placeholder-free, `mobile_*`-free, and has valid frontmatter.

- [ ] **Step 1: Write the failing tests**

Create `tests/lint/skill-no-placeholder-leak.test.js`:

```javascript
'use strict';

const { renderSkill, SKILL_TOPICS } = require('../../src/init/skill-renderer');

describe('rendered skills — no placeholder / no mcp tool leak', () => {
  for (const topic of SKILL_TOPICS) {
    it(`${topic} skill has no {{ token and no mobile_ tool name`, () => {
      const { content } = renderSkill(topic);
      expect(content).not.toContain('{{');
      expect(content).not.toMatch(/\bmobile_[a-z_]+/);
    });
  }
});
```

Create `tests/lint/skill-frontmatter-valid.test.js`:

```javascript
'use strict';

const { renderSkill, SKILL_TOPICS } = require('../../src/init/skill-renderer');

const NAME_RE = /^[a-z0-9-]+$/;
const RESERVED = /\b(anthropic|claude)\b/i;

function parseFrontmatter(content) {
  const m = content.match(/^---\n([\s\S]*?)\n---\n/);
  if (!m) throw new Error('no frontmatter');
  const out = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return out;
}

describe('rendered skills — frontmatter validity', () => {
  for (const topic of SKILL_TOPICS) {
    const { dirName, content } = renderSkill(topic);
    const fm = parseFrontmatter(content);

    it(`${topic}: name matches folder, is valid, has no reserved word`, () => {
      expect(fm.name).toBe(dirName);
      expect(fm.name).toMatch(NAME_RE);
      expect(fm.name.length).toBeLessThanOrEqual(64);
      expect(fm.name).not.toMatch(RESERVED);
    });

    it(`${topic}: description non-empty, <=1024, no XML`, () => {
      expect(fm.description.length).toBeGreaterThan(0);
      expect(fm.description.length).toBeLessThanOrEqual(1024);
      expect(fm.description).not.toMatch(/[<>]/);
    });
  }
});
```

- [ ] **Step 2: Run tests to verify they pass (guards over already-correct code)**

Run: `npx jest tests/lint/skill-no-placeholder-leak.test.js tests/lint/skill-frontmatter-valid.test.js`
Expected: PASS (these guard the Task 3 output; they pass immediately and will catch future regressions).

- [ ] **Step 3: Extend the `lint:guides` script**

In `package.json`, change the `lint:guides` script to also run the skill guards:

```json
    "lint:guides": "jest tests/lint/guide-no-mcp-tool-leak.test.js tests/lint/guide-no-placeholder-leak.test.js tests/lint/guide-agnostic-no-os.test.js tests/lint/skill-invariants.test.js tests/lint/skill-no-placeholder-leak.test.js tests/lint/skill-frontmatter-valid.test.js",
```

- [ ] **Step 4: Run the lint script**

Run: `npm run lint:guides`
Expected: PASS (all guide + skill guards).

- [ ] **Step 5: Commit**

```bash
git add tests/lint/skill-no-placeholder-leak.test.js tests/lint/skill-frontmatter-valid.test.js package.json
git commit -m "test(lint): guard rendered skills for placeholders + valid frontmatter"
```

---

### Task 7: Docs, CHANGELOG, version bump

**Files:**
- Modify: `package.json:version`
- Modify: `CHANGELOG.md` (`## [Unreleased]`)
- Modify: `README.md` (init usage)
- Modify: `CLAUDE.md` (Verbs/init description + "Adding a verb or guide topic")

**Interfaces:** None (docs + release metadata).

- [ ] **Step 1: Bump the version**

In `package.json`, change `"version": "0.20.0"` to `"version": "0.21.0-rc.0"`.

Run: `git tag | grep -c "0.21.0-rc.0"`
Expected: `0` (the value is not yet tagged, satisfying the CI gate).

- [ ] **Step 2: Add the CHANGELOG entry**

Under `## [Unreleased]` in `CHANGELOG.md`, add:

```markdown
### ✨ Added

- **`mauto init` installs native Agent Skills.** `mauto init --agent <claude|cursor|gemini|copilot|agents|all>` now installs an Agent Skill (open standard: `SKILL.md` + `name`/`description` frontmatter) per workflow into each host's skills directory (`.claude/skills/`, `.cursor/skills/`, `.gemini/skills/`, `.github/skills/`, `.agents/skills/`). Skills are always discovered by the host and, on activation, inline the non-negotiable QA disciplines (follow scenario exactly, device only via `mauto` verbs, screenshot-backed assertions) while deferring the full mode-aware workflow to `mauto guide <topic>`. Restores guaranteed behavior-forcing without context bloat (progressive disclosure). The existing thin slash-commands/rules and MCP-server entry are still written for claude/cursor. (Refs [#69](https://github.com/sh3lan93/mobile-automator/issues/69))
```

- [ ] **Step 3: Update README init usage**

In `README.md`, find the `mauto init` usage and update the supported agents to `claude | cursor | gemini | copilot | agents | all`, with one line noting it installs native Agent Skills into each host's skills directory.

Run: `grep -n "mauto init" README.md`
Then edit the matched usage line(s) accordingly.

- [ ] **Step 4: Update CLAUDE.md**

In `CLAUDE.md`:
- Under **Verbs → Agent integration**, change the `init` line to: `init --agent <claude|cursor|gemini|copilot|agents|all>` (installs native Agent Skills per host + writes slash-commands/rules + MCP entry for claude/cursor).
- Under **Adding a verb or guide topic**, add a step: "For a topic exposed as a skill, add `src/guide/content/<topic>.invariants.md` (placeholder-free, OS-free) and register the topic in `src/init/skill-meta.js` + `src/init/skill-renderer.js`."

- [ ] **Step 5: Run the entire suite + lint**

Run: `npm test && npm run lint:guides`
Expected: PASS (full unit + integration + lint).

- [ ] **Step 6: Commit**

```bash
git add package.json CHANGELOG.md README.md CLAUDE.md
git commit -m "docs: document skill-installing init; bump 0.21.0-rc.0; changelog"
```

---

## Self-Review

**1. Spec coverage:**
- §1 invariant reversal → documented in Task 7 CHANGELOG + the committed design doc. ✓
- §2 five destinations → Task 4 `SKILL_DEST` + Task 5 `all`. ✓
- §3 three skills → Tasks 1–4 iterate `generate/execute/setup`. ✓
- §4 SKILL.md contents (C model) → Task 3 renderer. ✓
- §5 placeholder mitigation + single source + drift guard → Task 1 snippets + anchor guard; Task 3 defensive assert. ✓
- §6 modules → Tasks 2–5 create exactly those files; `init` never reads config (renderer takes no projectRoot). ✓
- §7 lint guards → Task 1 (invariants/agnostic-no-os/mcp-tool via the combined invariants test) + Task 6 (placeholder + frontmatter-valid). The five guard concerns are covered: placeholder-leak (T6), mcp-tool-leak (T1+T6), frontmatter-valid (T6), invariants-in-guide anchor (T1), agnostic-no-os (T1). ✓
- §8 testing → unit (T2–T5), lint (T1,T6), packaging: skills render from `src/`, already in the `files` allowlist (`bin/`, `src/`) — no packaging change needed; noted here. ✓
- §9 versioning + docs → Task 7. ✓
- §10 out-of-scope → no global installs, slash-commands kept (Task 4 retains them), no extraction refactor. MCP merge limited to claude/cursor (Task 4 — gemini/copilot/agents install skills only), resolving the open question per the recommended default. ✓

**2. Placeholder scan:** No "TBD"/"handle edge cases"/"similar to Task N". Every code step shows complete code. Steps 3 in Tasks 5/7 reference grep-then-edit for files whose exact current text varies (README headings, cli.js export line) — each gives the exact search command and the exact replacement, which is the correct pattern for "locate the spot, apply this concrete change."

**3. Type consistency:** `renderSkill(topic) -> { dirName, content }` defined in Task 3, consumed identically in Tasks 4 and 6. `SKILL_TOPICS` exported from skill-renderer, used in Tasks 4/6. `SKILL_DEST` exported from adapters (Task 4), consumed in adapters test and matches the dirs asserted in Task 5. `SKILL_META[topic] = { name, description }` defined Task 2, consumed Task 3. `handleInit` envelope shapes (`ok({agent,...})` single, `ok({agents,...})` for all) match the Task 5 tests. Consistent. ✓
