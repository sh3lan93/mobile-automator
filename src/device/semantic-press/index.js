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

// Perform one semantic action on the bridge's device: ask the device its
// platform, pick that platform's resolver, run the action's method. Returns
// what was done, `{ platform, mechanism }`. The one implementation behind
// `mauto press <action>` and `mauto run`; a non-semantic token or an
// unsupported platform throws SemanticResolutionError before any device input.
async function pressSemantic(bridge, action) {
  if (!isSemanticAction(action)) {
    throw new SemanticResolutionError(
      `"${action}" is not a semantic action.`,
      `Semantic actions: ${SEMANTIC_ACTIONS.join(', ')}.`
    );
  }
  const platform = await bridge.getPlatform();
  const resolver = selectResolver(platform, bridge);
  const { mechanism } = await resolver[ACTION_METHOD[action]]();
  return { platform, mechanism };
}

module.exports = {
  SEMANTIC_ACTIONS,
  ACTION_METHOD,
  isSemanticAction,
  selectResolver,
  pressSemantic,
  SemanticResolutionError,
};
