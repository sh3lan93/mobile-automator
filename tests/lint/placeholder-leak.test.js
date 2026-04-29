const fs = require('fs');
const path = require('path');
const { loadAllCommands, getPromptText } = require('../helpers');

describe('Placeholder Leak', () => {
  const commands = loadAllCommands();

  it('commands should not contain template placeholders', () => {
    commands.forEach(cmd => {
      const matches = getPromptText(cmd).match(/\{\{[^}]+\}\}/g) || [];
      expect(matches).toEqual([]);
    });
  });

  it('templates should contain placeholders', () => {
    const templatesDir = path.resolve(__dirname, '..', '..', 'templates');
    const skillFiles = [
      'mobile-automator-generator/SKILL.md',
      'mobile-automator-executor/SKILL.md',
    ];
    skillFiles.forEach(file => {
      const content = fs.readFileSync(path.join(templatesDir, file), 'utf8');
      const matches = content.match(/\{\{[^}]+\}\}/g) || [];
      expect(matches.length).toBeGreaterThan(0);
    });
  });
});
