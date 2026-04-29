const { loadAllCommands, getPromptText } = require('../helpers');

describe('Cross-Reference Validation', () => {
  const commands = loadAllCommands();
  const allPrompts = commands.map(c => getPromptText(c)).join('\n');

  describe('file path consistency', () => {
    const filePaths = [
      'mobile-automator/config.json',
      'mobile-automator/setup_state.json',
      'mobile-automator/scenarios/',
      'mobile-automator/results/',
      '.gemini/skills/mobile-automator-generator/SKILL.md',
      '.gemini/skills/mobile-automator-executor/SKILL.md',
    ];

    filePaths.forEach(filePath => {
      it(`should reference "${filePath}"`, () => {
        expect(allPrompts).toContain(filePath);
      });
    });
  });

  describe('skill references', () => {
    it('generate should reference generator skill', () => {
      expect(getPromptText(commands.find(c => c.file === 'generate.toml')))
        .toMatch(/mobile-automator-generator\/SKILL\.md/);
    });

    it('execute should reference executor skill', () => {
      expect(getPromptText(commands.find(c => c.file === 'execute.toml')))
        .toMatch(/mobile-automator-executor\/SKILL\.md/);
    });

    it('setup should reference install-skills.js', () => {
      expect(getPromptText(commands.find(c => c.file === 'setup.toml')))
        .toMatch(/install-skills\.js/);
    });
  });

  describe('MCP tool usage', () => {
    it('generate and execute should call mobile_list_available_devices', () => {
      ['generate.toml', 'execute.toml'].forEach(file => {
        expect(getPromptText(commands.find(c => c.file === file)))
          .toMatch(/mobile_list_available_devices/);
      });
    });
  });
});
