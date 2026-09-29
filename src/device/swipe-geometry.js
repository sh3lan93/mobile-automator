'use strict';

// Geometry for a direction-only swipe: start at centre + 30% of the axis
// dimension and travel 60% of it, i.e. centre ± 30% (#199).
//
// Why mauto computes this instead of letting the engine choose: mobile-mcp
// 0.0.55's adb and WDA robots used exactly this proportional travel, but 1.0.5
// routes every device through mobilecli, whose direction-only swipe is a fixed
// 400px centred stroke — about a third of the old travel on a phone, so
// scroll-to-element needs ~3x the swipes. Every robot in both versions reads an
// explicit {x, y, distance} the same way (start at x,y; move `distance` px in
// `direction`), so sending it pins identical behaviour on either pin.
//
// Kept pure and in its own module (not inside DeviceBridge) so the arithmetic
// is testable without an engine fake and the bridge stays a thin wrapper.
// There is deliberately no platform branch: proportional geometry is what makes
// it platform-agnostic.
//
// The integer formulas mirror 0.0.55's AndroidRobot (`Math.floor(n * 0.8)`,
// `Math.floor(n * 0.2)`, centre `floor(n / 2)`) so the endpoints match its old
// ones pixel-for-pixel, floating-point rounding included.
function centredSwipe({ width, height }, direction) {
  const hi = (n) => Math.floor(n * 0.8);
  const lo = (n) => Math.floor(n * 0.2);
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  switch (direction) {
    case 'up': return { x: cx, y: hi(height), distance: hi(height) - lo(height) };
    case 'down': return { x: cx, y: lo(height), distance: hi(height) - lo(height) };
    case 'left': return { x: hi(width), y: cy, distance: hi(width) - lo(width) };
    case 'right': return { x: lo(width), y: cy, distance: hi(width) - lo(width) };
    default:
      // The CLI validates directions first; this guards other callers from a
      // swipe with undefined geometry.
      throw new Error(`Unknown swipe direction "${direction}".`);
  }
}

module.exports = { centredSwipe };
