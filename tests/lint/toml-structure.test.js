const { loadAllCommands, getPromptText } = require('../helpers');

describe('TOML Structure', () => {
  const commands = loadAllCommands();

  describe('every command', () => {
    it('should have a SYSTEM DIRECTIVE section', () => {
      commands.forEach(cmd => {
        expect(getPromptText(cmd)).toMatch(/SYSTEM DIRECTIVE/i);
      });
    });

    it('should have a CRITICAL or HALT directive', () => {
      commands.forEach(cmd => {
        const prompt = getPromptText(cmd);
        const hasCritical = /CRITICAL:/i.test(prompt);
        const hasHaltDirective = /halt\b/i.test(prompt);
        expect(hasCritical || hasHaltDirective).toBe(true);
      });
    });

    it('should have at least 2 numbered sections', () => {
      commands.forEach(cmd => {
        const sections = getPromptText(cmd).match(/^##\s+\d+\.\d*/gm) || [];
        expect(sections.length).toBeGreaterThanOrEqual(2);
      });
    });
  });

  describe('setup.toml', () => {
    const setup = commands.find(c => c.file === 'setup.toml');
    const prompt = getPromptText(setup);

    it('should have sections 1.0 through 7.0', () => {
      for (let i = 1; i <= 7; i++) {
        expect(prompt).toMatch(new RegExp(`^##\\s+${i}\\.0\\b`, 'm'));
      }
    });

    it('should have no gaps in section numbering', () => {
      const sections = prompt.match(/^##\s+(\d+)\.\d+/gm) || [];
      const numbers = [...new Set(sections.map(s => parseInt(s.match(/\d+/)[0])))].sort((a, b) => a - b);
      numbers.forEach((n, i) => expect(n).toBe(i + 1));
    });

    it('should have resume check', () => {
      expect(prompt).toMatch(/RESUME CHECK/i);
      expect(prompt).toMatch(/setup_state\.json/i);
    });

    it('should reference install-skills.js', () => {
      expect(prompt).toMatch(/install-skills\.js/);
    });
  });

  describe('generate.toml', () => {
    const prompt = getPromptText(commands.find(c => c.file === 'generate.toml'));

    it('should have environment resolution section', () => {
      expect(prompt).toMatch(/ENVIRONMENT RESOLUTION/i);
    });

    it('should have pre-flight checks', () => {
      expect(prompt).toMatch(/PRE-FLIGHT/i);
    });

    it('should hand off to generator skill', () => {
      expect(prompt).toMatch(/HAND OFF TO GENERATOR/i);
      expect(prompt).toMatch(/mobile-automator-generator\/SKILL\.md/i);
    });
  });

  describe('execute.toml', () => {
    const prompt = getPromptText(commands.find(c => c.file === 'execute.toml'));

    it('should have device resolution section', () => {
      expect(prompt).toMatch(/DEVICE RESOLUTION/i);
    });

    it('should have scenario selection section', () => {
      expect(prompt).toMatch(/SCENARIO SELECTION/i);
    });

    it('should hand off to executor skill', () => {
      expect(prompt).toMatch(/HAND OFF TO EXECUTOR/i);
      expect(prompt).toMatch(/mobile-automator-executor\/SKILL\.md/i);
    });
  });

  describe('report.toml', () => {
    const prompt = getPromptText(commands.find(c => c.file === 'report.toml'));

    it('should support table, json, and html output formats', () => {
      expect(prompt).toMatch(/FORMAT OUTPUT/i);
      expect(prompt).toMatch(/\btable\b/i);
      expect(prompt).toMatch(/\bjson\b/i);
      expect(prompt).toMatch(/\bhtml\b/i);
    });
  });

  describe('list-tags.toml', () => {
    const prompt = getPromptText(commands.find(c => c.file === 'list-tags.toml'));

    it('should scan scenarios directory for tags', () => {
      expect(prompt).toMatch(/scenarios/i);
      expect(prompt).toMatch(/tags/i);
    });
  });
});
