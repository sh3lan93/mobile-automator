'use strict';

const { SEMANTIC_ACTIONS, pressSemantic } = require('../../device/semantic-press');

// The four agnostic semantic actions, each resolved to per-platform mechanics
// by the same pressSemantic that backs `mauto press <action>`.
const SEMANTIC_HANDLERS = Object.fromEntries(
  SEMANTIC_ACTIONS.map((action) => [
    action,
    async (_step, { bridge }) => {
      await pressSemantic(bridge, action);
    },
  ])
);

module.exports = { SEMANTIC_HANDLERS };
