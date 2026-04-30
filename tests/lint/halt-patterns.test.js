const { loadAllCommands, getPromptText } = require('../helpers');

describe('HALT Pattern Validation', () => {
  const commands = loadAllCommands();

  commands.forEach(cmd => {
    describe(cmd.file, () => {
      const prompt = getPromptText(cmd);

      it('should HALT after missing config.json error', () => {
        if (/config\.json.*(?:missing|not found)/i.test(prompt)) {
          expect(prompt).toMatch(/config\.json.*?(?:missing|not found)[\s\S]*?(?:Halt|HALT|halt)/i);
        }
      });

      it('should HALT after missing skill error', () => {
        if (/(?:skill|generator|executor).*(?:not found|not installed)/i.test(prompt)) {
          expect(prompt).toMatch(/(?:skill|generator|executor).*(?:not found|not installed)[\s\S]*?(?:Halt|HALT|halt)/i);
        }
      });

      it('should HALT after no device connected error', () => {
        if (/(?:no device|not.*?connected)/i.test(prompt)) {
          expect(prompt).toMatch(/(?:no device|not.*?connected)[\s\S]*?(?:Halt|HALT|halt)/i);
        }
      });
    });
  });

  describe('setup.toml', () => {
    const prompt = getPromptText(commands.find(c => c.file === 'setup.toml'));

    it('should HALT after script failure', () => {
      expect(prompt).toMatch(/(?:ERROR|error|fails)[\s\S]*?(?:HALT|halt)/i);
    });

    it('should HALT when setup already complete', () => {
      expect(prompt).toMatch(/already.*?(?:initialized|complete)[\s\S]*?(?:Halt|halt)/i);
    });
  });
});
