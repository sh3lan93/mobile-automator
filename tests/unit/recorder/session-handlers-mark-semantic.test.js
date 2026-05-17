'use strict';

const { handleMarkAsSemantic } = require('../../../tools/recorder/src/session-handlers');

function fakeStore() {
  const edits = [];
  return { edits, appendEdit: (e) => edits.push(e) };
}

describe('handleMarkAsSemantic', () => {
  test('appends a mark-as-semantic edit and broadcasts', () => {
    const store = fakeStore();
    const sent = [];
    handleMarkAsSemantic({
      store,
      broadcast: (m) => sent.push(m),
      msg: { step_id: 'tap_done', semantic_action: 'dismiss_keyboard' },
    });
    expect(store.edits).toHaveLength(1);
    expect(store.edits[0]).toMatchObject({
      op: 'mark-as-semantic', target_step_id: 'tap_done', semantic_action: 'dismiss_keyboard',
    });
    expect(typeof store.edits[0].ts).toBe('string');
    expect(sent[0]).toMatchObject({
      type: 'step-marked-semantic', step_id: 'tap_done', semantic_action: 'dismiss_keyboard',
    });
  });

  test('ignores missing step_id or semantic_action', () => {
    const store = fakeStore();
    handleMarkAsSemantic({ store, broadcast: () => {}, msg: { step_id: '', semantic_action: 'dismiss_keyboard' } });
    handleMarkAsSemantic({ store, broadcast: () => {}, msg: { step_id: 'x', semantic_action: '' } });
    expect(store.edits).toHaveLength(0);
  });
});
