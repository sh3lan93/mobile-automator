'use strict';

const { AndroidResolver, IOSResolver, SemanticResolutionError } = require('./resolver');

const ACTION_METHOD = {
  press_back: 'pressBack',
  dismiss_keyboard: 'dismissKeyboard',
  grant_permission: 'grantPermission',
  deny_permission: 'denyPermission',
};

const SEMANTIC_ACTIONS = Object.keys(ACTION_METHOD);

function isSemanticAction(token) {
  return Object.prototype.hasOwnProperty.call(ACTION_METHOD, token);
}

const STRATEGIES = { android: AndroidResolver, ios: IOSResolver };

// Pick the per-platform resolver, or hard-fail (never silently forward).
function selectResolver(platform, bridge) {
  const Strategy = STRATEGIES[platform];
  if (!Strategy) {
    throw new SemanticResolutionError(
      `No semantic-action resolver for platform "${platform}".`,
      'Connect a supported Android or iOS device/simulator.'
    );
  }
  return new Strategy(bridge);
}

module.exports = {
  SEMANTIC_ACTIONS,
  ACTION_METHOD,
  isSemanticAction,
  selectResolver,
  SemanticResolutionError,
};
