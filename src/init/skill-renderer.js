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
