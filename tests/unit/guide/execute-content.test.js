'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

const { emitGuide } = require('../../../src/guide/emitter');
const { EXIT } = require('../../../src/output/envelope');
const { RUN_DATA_KEYS } = require('../../../src/run/summary');

function tmpProject(config) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-exec-'));
  if (config) {
    const dir = path.join(root, '.mobile-automator');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'config.json'), JSON.stringify(config, null, 2));
  }
  return root;
}

const MCP_TOOL = /\bmobile_[a-z_]+/;

describe('guide emitter — real execute content', () => {
  describe('aware mode', () => {
    let out;
    beforeAll(() => {
      out = emitGuide('execute', { mode: 'platform-aware' });
    });

    it('preserves the Mobile QA Executor persona', () => {
      expect(out).toMatch(/Mobile QA Executor/);
    });

    it('preserves the three Observer behaviors', () => {
      expect(out).toMatch(/Regression Spotter/);
      expect(out).toMatch(/Flakiness Detector/);
      expect(out).toMatch(/State Detective/);
    });

    it('uses the mauto verb vocabulary', () => {
      expect(out).toMatch(/mauto elements/);
      expect(out).toMatch(/mauto tap/);
      expect(out).toMatch(/mauto type/);
      expect(out).toMatch(/mauto swipe/);
      expect(out).toMatch(/mauto press/);
      expect(out).toMatch(/mauto screenshot/);
      expect(out).toMatch(/mauto devices/);
      expect(out).toMatch(/mauto assert/);
    });

    it('uses mauto result bookkeeping verbs', () => {
      expect(out).toMatch(/mauto result add-step/);
      expect(out).toMatch(/mauto result finalize/);
    });

    it('obtains schemas via mauto schema (scenario + result)', () => {
      expect(out).toMatch(/mauto schema scenario/);
      expect(out).toMatch(/mauto schema result/);
    });

    it('preserves the 27-type assertion taxonomy hallmarks', () => {
      expect(out).toMatch(/element_exists/);
      expect(out).toMatch(/screenshot_match/);
      expect(out).toMatch(/element_state/);
      expect(out).toMatch(/value_matches_variable/);
      expect(out).toMatch(/permission_dialog_shown/);
    });

    it('describes the mechanical (CLI-decided) vs needs-agent (visual) split', () => {
      expect(out).toMatch(/Tier 1/);
      expect(out).toMatch(/Tier 2/);
      // mechanical assertions go through `mauto assert` and return pass/fail JSON
      expect(out).toMatch(/mauto assert/);
      // Tier-2 visual checks are judged by the agent from a screenshot
      expect(out).toMatch(/needs_agent|judge|visual analysis|the agent/i);
    });

    it('references capture_to / variable_name as literal backticked names, not placeholders', () => {
      expect(out).toMatch(/`capture_to`/);
      expect(out).toMatch(/`variable_name`/);
    });

    it('contains no leaked mobile_* tool name', () => {
      expect(out).not.toMatch(MCP_TOOL);
    });

    it('contains no surviving {{ placeholder token (interpolation + fallback)', () => {
      expect(out).not.toContain('{{');
    });

    it('contains no leftover Gemini framing or ask_user tool', () => {
      expect(out).not.toMatch(/Gemini/);
      expect(out).not.toMatch(/ask_user/);
      expect(out).not.toMatch(/\.gemini\//);
      expect(out).not.toMatch(/GEMINI\.md/);
    });

    it('interpolates config values when a project config exists', () => {
      const root = tmpProject({
        mode: 'platform-aware',
        knowledge: { project_name: 'PaymentsApp' },
        app: { android_package: 'com.acme.payments' },
      });
      const withCfg = emitGuide('execute', { mode: 'platform-aware', projectRoot: root });
      expect(withCfg).toMatch(/PaymentsApp/);
      expect(withCfg).toMatch(/com\.acme\.payments/);
      expect(withCfg).not.toContain('{{');
    });
  });

  describe('agnostic mode', () => {
    let out;
    beforeAll(() => {
      out = emitGuide('execute', { mode: 'platform-agnostic' });
    });

    it('preserves the QA Executor persona', () => {
      expect(out).toMatch(/QA Executor/);
    });

    it('preserves the Observer behaviors (Regression Spotter / Flakiness / State Detective)', () => {
      expect(out).toMatch(/Regression Spotter/);
      expect(out).toMatch(/Flakiness Detector/);
      expect(out).toMatch(/State Detective/);
    });

    it('uses the mauto verb vocabulary', () => {
      expect(out).toMatch(/mauto elements/);
      expect(out).toMatch(/mauto screenshot/);
      expect(out).toMatch(/mauto assert/);
      expect(out).toMatch(/mauto result/);
    });

    it('obtains schemas via mauto schema (scenario + result)', () => {
      expect(out).toMatch(/mauto schema scenario/);
      expect(out).toMatch(/mauto schema result/);
    });

    it('names the four semantic actions', () => {
      for (const act of ['press_back', 'dismiss_keyboard', 'grant_permission', 'deny_permission']) {
        expect(out).toContain(act);
      }
    });

    it('preserves the assertion-taxonomy hallmarks', () => {
      expect(out).toMatch(/element_exists/);
      expect(out).toMatch(/screenshot_match/);
    });

    it('describes the mechanical vs needs-agent split', () => {
      expect(out).toMatch(/Tier 1/);
      expect(out).toMatch(/Tier 2/);
      expect(out).toMatch(/mauto assert/);
    });

    it('references capture_to / variable_name as literal backticked names', () => {
      expect(out).toMatch(/`capture_to`/);
      expect(out).toMatch(/`variable_name`/);
    });

    it('names no OS / OS-specific tooling', () => {
      const FORBIDDEN = [
        /\bAndroid\b/i, /\biOS\b/i, /\badb\b/i, /\bxcrun\b/i, /\bresource[ -]?id\b/i,
        /\bFlutter\b/i, /\bReact[ -]?Native\b/i, /\bKotlin\b/i, /\bCompose\b/i,
        /\bxcode\b/i, /\bsimulator\b/i, /\bemulator\b/i,
      ];
      const violations = FORBIDDEN.filter((p) => p.test(out)).map((p) => p.toString());
      expect(violations).toEqual([]);
    });

    it('contains no leaked mobile_* tool name', () => {
      expect(out).not.toMatch(MCP_TOOL);
    });

    it('contains no surviving {{ placeholder token', () => {
      expect(out).not.toContain('{{');
    });

    it('contains no leftover Gemini framing', () => {
      expect(out).not.toMatch(/Gemini/);
      expect(out).not.toMatch(/ask_user/);
      expect(out).not.toMatch(/\.gemini\//);
    });
  });
});

describe('execute guide — hidden workspace', () => {
  const BARE = /(^|[^.\w])mobile-automator\//m;
  for (const mode of ['platform-aware', 'platform-agnostic']) {
    describe(mode, () => {
      const out = emitGuide('execute', { mode });
      it('names the workspace as .mobile-automator/ and never the bare name', () => {
        expect(out).toContain('.mobile-automator/scenarios/');
        expect(out).not.toMatch(BARE);
      });
      it('tells the agent to list the scenarios directory directly', () => {
        expect(out).toMatch(/list `?\.mobile-automator\/scenarios\/`? directly/i);
        expect(out).toMatch(/hidden/i);
      });
    });
  }
});

// Graduation (#284): the guide starts with the unattended runner and falls
// back to per-step replay; the old recipe stays, demoted, as section 4.
describe('execute guide — starts with mauto run', () => {
  const HEADINGS = [
    '### 1. Pre-flight',
    '### 2. Replay with mauto run',
    '### 3. Handle needs_agent',
    '### 4. Manual per-step replay',
    '### 5. Validate Assertions (27 types)',
    '### 6. Generate the Result Report',
  ];
  for (const mode of ['platform-aware', 'platform-agnostic']) {
    describe(mode, () => {
      const out = emitGuide('execute', { mode });

      it('names mauto run and needs_agent', () => {
        expect(out).toMatch(/mauto run/);
        expect(out).toMatch(/needs_agent/);
      });

      it('carries the numbered sections, in order', () => {
        const at = HEADINGS.map((h) => out.indexOf(`\n${h}\n`));
        expect(at.every((i) => i > -1)).toBe(true);
        expect([...at].sort((a, b) => a - b)).toEqual(at);
      });

      it('numbers no other section 1-6', () => {
        const numbered = out.split('\n').filter((l) => /^### [1-6]\. /.test(l));
        expect(numbered).toEqual(HEADINGS);
      });

      it('runs with the exported run id and offers the JUnit report', () => {
        expect(out).toContain('mauto run <scenario path> --run-id $MAUTO_RUN_ID');
        expect(out).toContain('--junit <path>');
      });

      it('branches on the three outcomes by their real names and exit codes', () => {
        const start = out.indexOf('### 2. Replay with mauto run');
        const section = out.slice(start, out.indexOf('### 3. Handle needs_agent'));
        // The codes and the data keys are the runner's own (EXIT,
        // RUN_DATA_KEYS), never restated here: a renumbered exit or a new
        // key turns the guide red instead of leaving it stale.
        expect(section).toContain(`exit code \`${EXIT.OK}\``);
        expect(section).toMatch(new RegExp(`\`test_failed\`[^\\n]*\`${EXIT.TEST_FAILED}\``));
        expect(section).toMatch(new RegExp(`\`incomplete\`[^\\n]*\`${EXIT.INCOMPLETE}\``));
        expect(section).toContain(RUN_DATA_KEYS.map((k) => `\`${k}\``).join(', '));
      });

      it('completes an incomplete run with the hinted commands', () => {
        const start = out.indexOf('### 3. Handle needs_agent');
        const section = out.slice(start, out.indexOf('### 4. Manual per-step replay'));
        expect(section).toContain('data.pending');
        expect(section).toContain('--judge agent');
        expect(section).toMatch(/mauto result finalize[^\n]*--scenario/);
      });

      // #329: a pending step is finished in the SAME run — add-step replaces
      // its needs_agent record — never by a replay under a new run id.
      it('finishes a pending step in the same run with add-step', () => {
        const start = out.indexOf('**A pending step.**');
        expect(start).toBeGreaterThan(-1);
        const section = out.slice(start, out.indexOf('### 4. Manual per-step replay'));
        expect(section).toContain('mauto result add-step --run-id <run id> --step-id <step_id> --status <pass|fail|skipped>');
        // A condition the runner could not evaluate may not hold (#329 review).
        expect(section).toMatch(/does not hold[^\n]*`skipped`[^\n]*assertions/);
        // A pending sub-step leaves its parent pending: record the parent.
        expect(section).toMatch(/sub-step[^\n]*record the parent/);
        expect(section).toMatch(/replaces the pending one in place/);
        expect(section).toMatch(/every later step/);
        expect(section).toMatch(/mauto result finalize[^\n]*--scenario/);
        expect(section).not.toMatch(/new run id|new `MAUTO_RUN_ID`/);
      });

      it('keeps the per-step recipe as the fallback', () => {
        const section = out.slice(out.indexOf('### 4. Manual per-step replay'), out.indexOf('### 5. Validate Assertions'));
        expect(section).toContain('mauto tap --at <x,y>');
        expect(section).toContain('#### When a step fails, find out whether the app is still alive');
        expect(section).toContain('#### When the element list looks wrong, check the engine');
      });

      it('prefers the runner and forbids re-judging its verdicts', () => {
        const boundaries = out.slice(out.indexOf('## Operational Boundaries'));
        expect(boundaries).toMatch(/Prefer `mauto run`/);
        expect(boundaries).toMatch(/re-judge/i);
        expect(out).toMatch(/one `mauto run` per scenario file/i);
      });
    });
  }
});

describe('execute invariants — start with mauto run', () => {
  it('points at the runner without flags or exit codes', () => {
    const body = fs.readFileSync(path.resolve(__dirname, '../../../src/guide/content/execute.invariants.md'), 'utf8');
    const line = body.split('\n').find((l) => l.includes('mauto run'));
    expect(line).toBeDefined();
    expect(line).toContain('`incomplete`');
    expect(line).not.toMatch(/--[a-z]/);
    expect(line).not.toMatch(/\bexit(s)? (code )?`?\d/);
  });
});
