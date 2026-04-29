const { loadAllCommands } = require('../helpers');

describe('TOML Syntax', () => {
  const commands = loadAllCommands();

  it('should have valid TOML for all command files', () => {
    expect(commands.length).toBeGreaterThan(0);
  });

  it('each command should have a description field', () => {
    commands.forEach(cmd => {
      expect(cmd.parsed.description).toBeDefined();
      expect(typeof cmd.parsed.description).toBe('string');
      expect(cmd.parsed.description.length).toBeGreaterThan(0);
    });
  });

  it('each command should have a prompt field', () => {
    commands.forEach(cmd => {
      expect(cmd.parsed.prompt).toBeDefined();
      expect(typeof cmd.parsed.prompt).toBe('string');
      expect(cmd.parsed.prompt.length).toBeGreaterThan(100);
    });
  });

  it('prompt should use triple-quote multiline syntax', () => {
    commands.forEach(cmd => {
      expect(cmd.content).toMatch(/prompt\s*=\s*"""/);
      expect(cmd.content).toMatch(/"""\s*$/m);
    });
  });
});
