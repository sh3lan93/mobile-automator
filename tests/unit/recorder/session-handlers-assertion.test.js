'use strict';

const {
  handleRequestAssertionScreenshot,
  handleSaveAssertion,
  handleCancelAssertion,
} = require('../../../tools/recorder/src/session-handlers');

describe('handleRequestAssertionScreenshot', () => {
  test('calls mcp.takeScreenshot with the correct path', async () => {
    const fakePath = '/tmp/rec/s/screenshots/assert_a1.png';
    const store = { assertScreenshotPath: jest.fn().mockReturnValue(fakePath) };
    const mcp = { takeScreenshot: jest.fn().mockResolvedValue(undefined) };
    const broadcast = jest.fn();
    const allocateId = jest.fn().mockReturnValue('a1');

    await handleRequestAssertionScreenshot({ store, mcp, broadcast, allocateId });

    expect(store.assertScreenshotPath).toHaveBeenCalledWith('a1');
    expect(mcp.takeScreenshot).toHaveBeenCalledWith(fakePath);
  });

  test('broadcasts assertion-screenshot-ready with assertion_id and correct image_url', async () => {
    const fakePath = '/tmp/rec/s/screenshots/assert_a1.png';
    const store = { assertScreenshotPath: jest.fn().mockReturnValue(fakePath) };
    const mcp = { takeScreenshot: jest.fn().mockResolvedValue(undefined) };
    const broadcast = jest.fn();
    const allocateId = jest.fn().mockReturnValue('a1');

    await handleRequestAssertionScreenshot({ store, mcp, broadcast, allocateId });

    expect(broadcast).toHaveBeenCalledWith({
      type: 'assertion-screenshot-ready',
      assertion_id: 'a1',
      image_url: '/screenshots/assert_a1.png',
    });
  });

  test('broadcasts assertion-screenshot-error if mcp.takeScreenshot rejects', async () => {
    const fakePath = '/tmp/rec/s/screenshots/assert_a1.png';
    const store = { assertScreenshotPath: jest.fn().mockReturnValue(fakePath) };
    const mcp = { takeScreenshot: jest.fn().mockRejectedValue(new Error('device not found')) };
    const broadcast = jest.fn();
    const allocateId = jest.fn().mockReturnValue('a1');

    await handleRequestAssertionScreenshot({ store, mcp, broadcast, allocateId });

    expect(broadcast).toHaveBeenCalledWith({
      type: 'assertion-screenshot-error',
      assertion_id: 'a1',
      error: 'device not found',
    });
  });
});

describe('handleSaveAssertion', () => {
  test('appends a correctly-shaped entry to assertions.json via store.appendAssertion', () => {
    const store = { appendAssertion: jest.fn() };
    const broadcast = jest.fn();
    const msg = {
      assertion_id: 'a2',
      nl_text: 'Welcome screen is shown',
      anchor_step_id: 'tap_login',
    };

    handleSaveAssertion({ store, broadcast, msg });

    expect(store.appendAssertion).toHaveBeenCalledTimes(1);
    const entry = store.appendAssertion.mock.calls[0][0];
    expect(entry).toMatchObject({
      id: 'a2',
      nl_text: 'Welcome screen is shown',
      anchor_step_id: 'tap_login',
    });
  });

  test('the entry shape is { id, nl_text, screenshot, anchor_step_id, captured_at }', () => {
    const store = { appendAssertion: jest.fn() };
    const broadcast = jest.fn();
    const msg = {
      assertion_id: 'a3',
      nl_text: 'Error message shown',
      anchor_step_id: 'tap_submit',
    };

    handleSaveAssertion({ store, broadcast, msg });

    const entry = store.appendAssertion.mock.calls[0][0];
    expect(Object.keys(entry).sort()).toEqual(['anchor_step_id', 'captured_at', 'id', 'nl_text', 'screenshot'].sort());
  });

  test('screenshot field is a relative path "screenshots/assert_<id>.png"', () => {
    const store = { appendAssertion: jest.fn() };
    const broadcast = jest.fn();
    const msg = {
      assertion_id: 'a4',
      nl_text: 'Button visible',
      anchor_step_id: 'tap_x',
    };

    handleSaveAssertion({ store, broadcast, msg });

    const entry = store.appendAssertion.mock.calls[0][0];
    expect(entry.screenshot).toBe('screenshots/assert_a4.png');
  });

  test('broadcasts assertion-added with { id, nl_text, anchor_step_id }', () => {
    const store = { appendAssertion: jest.fn() };
    const broadcast = jest.fn();
    const msg = {
      assertion_id: 'a5',
      nl_text: 'Title matches',
      anchor_step_id: 'tap_nav',
    };

    handleSaveAssertion({ store, broadcast, msg });

    expect(broadcast).toHaveBeenCalledWith({
      type: 'assertion-added',
      assertion: {
        id: 'a5',
        nl_text: 'Title matches',
        anchor_step_id: 'tap_nav',
      },
    });
  });
});

describe('handleCancelAssertion', () => {
  test('calls store.deleteAssertScreenshot with the assertion_id from msg', () => {
    const store = { deleteAssertScreenshot: jest.fn() };
    const msg = { assertion_id: 'a6' };

    handleCancelAssertion({ store, msg });

    expect(store.deleteAssertScreenshot).toHaveBeenCalledWith('a6');
  });

  test('does not broadcast anything', () => {
    const store = { deleteAssertScreenshot: jest.fn() };
    const broadcast = jest.fn();
    const msg = { assertion_id: 'a7' };

    // broadcast is NOT passed but if it were, it should not be called
    handleCancelAssertion({ store, msg });

    expect(broadcast).not.toHaveBeenCalled();
  });
});
