'use strict';

/**
 * Pure reconcile engine for recorder user-edits. Replays an append-only
 * edits.jsonl in chronological (`ts`) order over the captured events and
 * assertions, returning the effective lists plus a report of skips/drops.
 *
 * This is the executable specification the aware-mode recorder SKILL.md
 * prose mirrors 1:1 (step 2 "Reconcile edits"). Final step_id re-derivation
 * and after_step rewriting remain the AI's job at schema emission; here we
 * only mutate the effective display_name / value / nl_text / anchor_step_id.
 */
function applyEdits({ events, assertions, edits }) {
  const report = [];
  let steps = (events || []).map((e) => ({ ...e }));
  let asserts = (assertions || []).map((a) => ({ ...a }));

  // ISO-8601 Z timestamps sort lexically == chronologically. Array.sort is
  // stable in V8, so equal-ts edits keep append (chronological) order.
  const sorted = (edits || []).slice().sort((a, b) => {
    const at = a && a.ts ? String(a.ts) : '';
    const bt = b && b.ts ? String(b.ts) : '';
    return at < bt ? -1 : at > bt ? 1 : 0;
  });

  for (const ed of sorted) {
    if (!ed || typeof ed !== 'object') {
      report.push({ skipped: 'unparseable', edit: ed });
      continue;
    }
    if (ed.op === 'rename') {
      const s = steps.find((x) => x.step_id === ed.target_step_id);
      if (!s) { report.push({ ignored: 'rename', target: ed.target_step_id }); continue; }
      s.display_name = ed.new_display_name;
    } else if (ed.op === 'edit-value') {
      const s = steps.find((x) => x.step_id === ed.target_step_id);
      if (!s) { report.push({ ignored: 'edit-value', target: ed.target_step_id }); continue; }
      s.value = ed.new_value;
    } else if (ed.op === 'edit-assertion-text') {
      const a = asserts.find((x) => x.id === ed.target_assertion_id);
      if (!a) { report.push({ ignored: 'edit-assertion-text', target: ed.target_assertion_id }); continue; }
      a.nl_text = ed.new_nl_text;
    } else if (ed.op === 'delete') {
      const idx = steps.findIndex((x) => x.step_id === ed.target_step_id);
      if (idx === -1) { report.push({ ignored: 'delete', target: ed.target_step_id }); continue; }
      const removedId = steps[idx].step_id;
      const anchored = asserts.filter((a) => a.anchor_step_id === removedId);
      if (anchored.length > 0) {
        if (ed.assertion_policy === 'cascade') {
          asserts = asserts.filter((a) => a.anchor_step_id !== removedId);
        } else if (ed.assertion_policy === 'reanchor') {
          const prev = idx > 0 ? steps[idx - 1] : null;
          const next = idx + 1 < steps.length ? steps[idx + 1] : null;
          const target = prev || next || null;
          if (!target) {
            asserts = asserts.filter((a) => a.anchor_step_id !== removedId);
            report.push({ dropped: 'assertions', reason: 'no surviving step', count: anchored.length });
          } else {
            for (const a of asserts) {
              if (a.anchor_step_id === removedId) a.anchor_step_id = target.step_id;
            }
          }
        } else {
          report.push({ note: 'delete policy=none but step had anchored assertions', target: removedId });
        }
      }
      steps.splice(idx, 1);
    } else {
      report.push({ ignored: 'unrecognized-op', op: ed.op });
    }
  }

  return { steps, assertions: asserts, report };
}

module.exports = { applyEdits };
