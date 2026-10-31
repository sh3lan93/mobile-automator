'use strict';

// The one walk over a scenario's step tree. Steps nest freely through
// `sub_steps` (the schema types them as steps), and every check that cares
// about step order reads it from this list: an entry's index is its position
// in depth-first document order, so "earlier step" means a lower index.

// Returns `[{ step, path, isFirstTopLevel }]`, parents before their sub_steps.
// Null steps and non-array step lists are skipped; a skipped step keeps its
// slot in the paths of its siblings. Only the scenario's first top-level step
// is `isFirstTopLevel`.
function flattenSteps(scenario) {
  const entries = [];
  const walk = (steps, basePath, topLevel) => {
    if (!Array.isArray(steps)) return;
    steps.forEach((step, i) => {
      if (!step) return;
      const path = `${basePath}[${i}]`;
      entries.push({ step, path, isFirstTopLevel: topLevel && i === 0 });
      walk(step.sub_steps, `${path}.sub_steps`, false);
    });
  };
  walk(scenario && scenario.steps, 'steps', true);
  return entries;
}

module.exports = { flattenSteps };
