'use strict';

const { HierarchyPoller } = require('../../../tools/recorder/src/capture/hierarchy-poller');

describe('HierarchyPoller', () => {
  test('captures snapshots at specified interval', async () => {
    let count = 0;
    const fakeBridge = {
      listElementsOnScreen: async () => {
        count += 1;
        return { elements: [{ type: 'View', bounds: [0, 0, 10, 10], text: `s${count}` }] };
      },
    };
    const poller = new HierarchyPoller({ bridge: fakeBridge, intervalMs: 50, capacity: 4 });
    poller.start();
    await new Promise((r) => setTimeout(r, 220));
    poller.stop();
    expect(poller.size()).toBeGreaterThanOrEqual(3);
    expect(poller.size()).toBeLessThanOrEqual(4);
  });

  test('findSnapshotBefore returns the most-recent snapshot at or before t', async () => {
    const fakeBridge = { listElementsOnScreen: async () => ({ elements: [] }) };
    const poller = new HierarchyPoller({ bridge: fakeBridge, intervalMs: 9999, capacity: 5 });
    poller._appendForTest({ t: 100, elements: [{ id: 'a' }] });
    poller._appendForTest({ t: 200, elements: [{ id: 'b' }] });
    poller._appendForTest({ t: 300, elements: [{ id: 'c' }] });

    expect(poller.findSnapshotBefore(250).elements[0].id).toBe('b');
    expect(poller.findSnapshotBefore(300).elements[0].id).toBe('c');
    expect(poller.findSnapshotBefore(50)).toBeNull();
  });

  test('ring buffer drops oldest when capacity exceeded', async () => {
    const fakeBridge = { listElementsOnScreen: async () => ({ elements: [] }) };
    const poller = new HierarchyPoller({ bridge: fakeBridge, intervalMs: 9999, capacity: 2 });
    poller._appendForTest({ t: 1, elements: [] });
    poller._appendForTest({ t: 2, elements: [] });
    poller._appendForTest({ t: 3, elements: [] });
    expect(poller.size()).toBe(2);
    expect(poller.findSnapshotBefore(2).t).toBe(2);
  });

  test('stop halts polling', async () => {
    let count = 0;
    const fakeBridge = {
      listElementsOnScreen: async () => { count += 1; return { elements: [] }; },
    };
    const poller = new HierarchyPoller({ bridge: fakeBridge, intervalMs: 20, capacity: 10 });
    poller.start();
    await new Promise((r) => setTimeout(r, 60));
    poller.stop();
    const countAtStop = count;
    await new Promise((r) => setTimeout(r, 60));
    expect(count).toBe(countAtStop);
  });
});
