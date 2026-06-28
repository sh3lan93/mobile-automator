'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');

const { buildPromptHandlers, PROMPT_TOPICS } = require('../../../src/mcp/prompts');

// A fake emitGuide records the (topic, opts) it was called with and returns a
// deterministic, topic+mode-stamped string so tests can assert the guide
// content is what flows into the prompt message.
function fakeEmitGuide(calls) {
  return (topic, opts = {}) => {
    calls.push({ topic, opts });
    return `GUIDE<${topic}|${opts.mode}>`;
  };
}

function tmpRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mauto-prompts-'));
}

describe('buildPromptHandlers', () => {
  describe('listPrompts', () => {
    test('exposes exactly the four workflow topics', () => {
      const { listPrompts } = buildPromptHandlers({
        projectRoot: tmpRoot(),
        emitGuide: fakeEmitGuide([]),
      });
      const prompts = listPrompts();
      expect(prompts.map((p) => p.name).sort()).toEqual(
        ['execute', 'generate', 'setup'].sort()
      );
      expect(PROMPT_TOPICS.sort()).toEqual(['execute', 'generate', 'setup'].sort());
    });

    test('each prompt has a non-empty description and empty arguments', () => {
      const { listPrompts } = buildPromptHandlers({
        projectRoot: tmpRoot(),
        emitGuide: fakeEmitGuide([]),
      });
      for (const p of listPrompts()) {
        expect(typeof p.description).toBe('string');
        expect(p.description.length).toBeGreaterThan(0);
        expect(p.arguments).toEqual([]);
      }
    });
  });

  describe('getPrompt', () => {
    test('returns a user message carrying the guide content for the topic', () => {
      const calls = [];
      const { getPrompt } = buildPromptHandlers({
        projectRoot: tmpRoot(),
        emitGuide: fakeEmitGuide(calls),
      });
      const res = getPrompt('generate');
      expect(res.messages).toHaveLength(1);
      expect(res.messages[0].role).toBe('user');
      expect(res.messages[0].content.type).toBe('text');
      expect(res.messages[0].content.text).toBe('GUIDE<generate|platform-aware>');
      expect(calls[0].topic).toBe('generate');
    });

    test('resolves mode from the workspace config', () => {
      const calls = [];
      const projectRoot = tmpRoot();
      fs.mkdirSync(path.join(projectRoot, 'mobile-automator'), { recursive: true });
      fs.writeFileSync(
        path.join(projectRoot, 'mobile-automator', 'config.json'),
        JSON.stringify({ mode: 'platform-agnostic' })
      );
      const { getPrompt } = buildPromptHandlers({ projectRoot, emitGuide: fakeEmitGuide(calls) });
      const res = getPrompt('execute');
      expect(calls[0].opts.mode).toBe('platform-agnostic');
      expect(res.messages[0].content.text).toBe('GUIDE<execute|platform-agnostic>');
    });

    test('defaults to platform-aware when no config exists', () => {
      const calls = [];
      const { getPrompt } = buildPromptHandlers({
        projectRoot: tmpRoot(),
        emitGuide: fakeEmitGuide(calls),
      });
      getPrompt('setup');
      expect(calls[0].opts.mode).toBe('platform-aware');
    });

    test('passes projectRoot through to emitGuide', () => {
      const calls = [];
      const projectRoot = tmpRoot();
      const { getPrompt } = buildPromptHandlers({ projectRoot, emitGuide: fakeEmitGuide(calls) });
      getPrompt('setup');
      expect(calls[0].opts.projectRoot).toBe(projectRoot);
    });

    test('unknown prompt name throws', () => {
      const { getPrompt } = buildPromptHandlers({
        projectRoot: tmpRoot(),
        emitGuide: fakeEmitGuide([]),
      });
      expect(() => getPrompt('bogus')).toThrow();
    });
  });

  test('defaults emitGuide to the real emitter when not injected', () => {
    const { getPrompt } = buildPromptHandlers({ projectRoot: tmpRoot() });
    const res = getPrompt('execute');
    // Real guide content mentions the mauto CLI.
    expect(res.messages[0].content.text).toContain('mauto');
  });
});
