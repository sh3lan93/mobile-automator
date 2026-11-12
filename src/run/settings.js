'use strict';

// The timings and limits of `mauto run`, resolved once per run from the
// optional `run` block of .mobile-automator/config.json and the --timeout-ms
// flag. Pure: nothing here reads a file. A key that is absent, or holds
// something the config schema would refuse, falls back to its default, so an
// old workspace (or a hand-edited bad value) runs exactly as before.

const DEFAULTS = Object.freeze({
  pollMs: 1500,
  defaultTimeoutMs: 30000,
  scrollMaxSwipes: 10,
});

const positiveInt = (v) => Number.isInteger(v) && v > 0;

// `timeoutMs` (the --timeout-ms flag) is a CAP on every per-step wait, never
// a lengthening: null when not given.
function runSettings(config, { timeoutMs = null } = {}) {
  const run = (config && typeof config === 'object' && config.run && typeof config.run === 'object') ? config.run : {};
  const labels = Array.isArray(run.loading_indicator_labels)
    ? run.loading_indicator_labels.filter((l) => typeof l === 'string' && l.trim() !== '')
    : [];
  return {
    pollMs: positiveInt(run.poll_ms) ? run.poll_ms : DEFAULTS.pollMs,
    defaultTimeoutMs: positiveInt(run.default_timeout_ms) ? run.default_timeout_ms : DEFAULTS.defaultTimeoutMs,
    scrollMaxSwipes: Number.isInteger(run.scroll_max_swipes) && run.scroll_max_swipes >= 0
      ? run.scroll_max_swipes
      : DEFAULTS.scrollMaxSwipes,
    loadingLabels: labels,
    timeoutCapMs: positiveInt(timeoutMs) ? timeoutMs : null,
  };
}

// The settings on a handler's ctx, or the defaults for a ctx built without
// any (a unit test driving one handler).
function settingsOf(ctx) {
  return (ctx && ctx.settings) || runSettings(null);
}

module.exports = { runSettings, settingsOf, DEFAULTS };
