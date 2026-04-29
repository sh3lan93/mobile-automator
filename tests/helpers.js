const fs = require('fs');
const path = require('path');
const TOML = require('toml');

const COMMANDS_DIR = path.resolve(__dirname, '..', 'commands', 'mobile-automator');

function loadAllCommands() {
  const files = fs.readdirSync(COMMANDS_DIR).filter(f => f.endsWith('.toml'));
  return files.map(file => {
    const content = fs.readFileSync(path.join(COMMANDS_DIR, file), 'utf8');
    return { file, content, parsed: TOML.parse(content) };
  });
}

function getPromptText(command) {
  return command.content.match(/prompt\s*=\s*"""([\s\S]*?)"""/)?.[1] || '';
}

module.exports = { COMMANDS_DIR, loadAllCommands, getPromptText };
