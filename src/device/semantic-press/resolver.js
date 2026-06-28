'use strict';

const { ALLOW_LABELS, DENY_LABELS, findByLabels } = require('./labels');

// Raised when a semantic action cannot be performed on the current screen/
// platform. `.kind`/`.hint` let the CLI map it onto the `device` envelope.
class SemanticResolutionError extends Error {
  constructor(message, hint) {
    super(message);
    this.name = 'SemanticResolutionError';
    this.kind = 'device';
    this.hint = hint;
  }
}

// iOS return/confirm keys that dismiss the keyboard when tapped.
const IOS_RETURN_KEYS = ['return', 'done', 'go', 'search', 'send', 'next'];

class SemanticResolver {
  constructor(bridge) {
    this.bridge = bridge;
  }

  async _tapByLabels(labels, intent) {
    const el = findByLabels(await this.bridge.listElements(), labels);
    if (!el) {
      throw new SemanticResolutionError(
        `Could not find a "${intent}" affordance on screen.`,
        'Ensure the relevant system dialog/control is visible before this step.'
      );
    }
    await this.bridge.tap({ x: el.element.center[0], y: el.element.center[1] });
    return { mechanism: `tap:${el.label}` };
  }
}

class AndroidResolver extends SemanticResolver {
  async pressBack() {
    await this.bridge.pressButton('BACK');
    return { mechanism: 'button:BACK' };
  }

  // BACK also hides the IME on Android. Caveat: with no keyboard open this pops
  // the screen — accepted; mobile-mcp exposes no reliable IME-visible signal.
  async dismissKeyboard() {
    await this.bridge.pressButton('BACK');
    return { mechanism: 'button:BACK' };
  }

  async grantPermission() {
    return this._tapByLabels(ALLOW_LABELS.android, 'grant permission');
  }

  async denyPermission() {
    return this._tapByLabels(DENY_LABELS.android, 'deny permission');
  }
}

class IOSResolver extends SemanticResolver {
  // No hardware back on iOS: left-edge interactive-pop gesture.
  async pressBack() {
    const { width, height } = await this.bridge.getScreenSize();
    // Without a real screen size the swipe would be a degenerate no-op that
    // still reports success — hard-fail instead of silently doing nothing.
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      throw new SemanticResolutionError(
        `Cannot perform the iOS back gesture without a valid screen size (got ${width}x${height}).`,
        'Ensure a device or simulator is connected.'
      );
    }
    await this.bridge.swipe({
      direction: 'right',
      x: 1,
      y: Math.round(height / 2),
      distance: Math.round(width * 0.6),
    });
    return { mechanism: 'edge_swipe' };
  }

  // Primary: tap a return/Done key. Fallback: swipe down to dismiss.
  async dismissKeyboard() {
    const el = findByLabels(await this.bridge.listElements(), IOS_RETURN_KEYS);
    if (el) {
      await this.bridge.tap({ x: el.element.center[0], y: el.element.center[1] });
      return { mechanism: `tap:${el.label}` };
    }
    await this.bridge.swipe({ direction: 'down' });
    return { mechanism: 'swipe:down' };
  }

  async grantPermission() {
    return this._tapByLabels(ALLOW_LABELS.ios, 'grant permission');
  }

  async denyPermission() {
    return this._tapByLabels(DENY_LABELS.ios, 'deny permission');
  }
}

module.exports = { SemanticResolver, AndroidResolver, IOSResolver, SemanticResolutionError };
