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

  test('onError fires when bridge rejects, with the err object', async () => {
    const errors = [];
    const boom = new Error('device disconnected');
    const fakeBridge = { listElementsOnScreen: async () => { throw boom; } };
    const poller = new HierarchyPoller({
      bridge: fakeBridge,
      intervalMs: 9999,
      capacity: 4,
      onError: (err) => errors.push(err),
    });
    poller.start();
    await new Promise((r) => setTimeout(r, 20));
    poller.stop();
    expect(errors.length).toBeGreaterThanOrEqual(1);
    expect(errors[0]).toBe(boom);
  });

  test('onSuccess fires when bridge resolves', async () => {
    let successes = 0;
    const fakeBridge = { listElementsOnScreen: async () => ({ elements: [] }) };
    const poller = new HierarchyPoller({
      bridge: fakeBridge,
      intervalMs: 9999,
      capacity: 4,
      onSuccess: () => { successes += 1; },
    });
    poller.start();
    await new Promise((r) => setTimeout(r, 20));
    poller.stop();
    expect(successes).toBeGreaterThanOrEqual(1);
  });

  test('a throwing onError does not break the poller', async () => {
    let tickCount = 0;
    const fakeBridge = {
      listElementsOnScreen: async () => { tickCount += 1; throw new Error('fail'); },
    };
    const poller = new HierarchyPoller({
      bridge: fakeBridge,
      intervalMs: 20,
      capacity: 4,
      onError: () => { throw new Error('hook blew up'); },
    });
    poller.start();
    await new Promise((r) => setTimeout(r, 80));
    poller.stop();
    expect(tickCount).toBeGreaterThanOrEqual(2);
  });

  test('a throwing onSuccess does not break the poller', async () => {
    let tickCount = 0;
    const fakeBridge = {
      listElementsOnScreen: async () => { tickCount += 1; return { elements: [] }; },
    };
    const poller = new HierarchyPoller({
      bridge: fakeBridge,
      intervalMs: 20,
      capacity: 10,
      onSuccess: () => { throw new Error('hook blew up'); },
    });
    poller.start();
    await new Promise((r) => setTimeout(r, 80));
    poller.stop();
    expect(tickCount).toBeGreaterThanOrEqual(2);
    // Snapshots are still appended despite the throwing hook.
    expect(poller.size()).toBeGreaterThanOrEqual(2);
  });

  test('back-compat: no hooks provided, append/swallow contract preserved', async () => {
    // Mix of resolves and rejects; default hooks (no-op) must not interfere.
    let call = 0;
    const fakeBridge = {
      listElementsOnScreen: async () => {
        call += 1;
        if (call % 2 === 0) throw new Error('intermittent');
        return { elements: [{ id: `snap-${call}` }] };
      },
    };
    const poller = new HierarchyPoller({ bridge: fakeBridge, intervalMs: 20, capacity: 10 });
    poller.start();
    await new Promise((r) => setTimeout(r, 120));
    poller.stop();
    // Only successful ticks append snapshots; failures are swallowed.
    expect(poller.size()).toBeGreaterThanOrEqual(1);
    expect(poller.size()).toBeLessThanOrEqual(call);
  });
});
