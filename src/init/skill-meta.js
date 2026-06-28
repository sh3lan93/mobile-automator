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
