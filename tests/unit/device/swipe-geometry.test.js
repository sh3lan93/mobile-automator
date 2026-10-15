'use strict';

const { centredSwipe } = require('../../../src/device/swipe-geometry');

// The endpoint a {direction,x,y,distance} swipe lands on: every mobile-mcp
// robot (0.0.55 and 1.0.5) moves the start `distance` pixels in `direction`.
function endOf({ x, y, distance }, direction) {
  switch (direction) {
    case 'up': return [x, y - distance];
    case 'down': return [x, y + distance];
    case 'left': return [x - distance, y];
    case 'right': return [x + distance, y];
    default: throw new Error(direction);
  }
}

// mobile-mcp 0.0.55 AndroidRobot's direction-only endpoints, restated:
// centre ± 30% of the axis dimension.
function adbEndpoints({ width, height }, direction) {
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  const hi = (n) => Math.floor(n * 0.8);
  const lo = (n) => Math.floor(n * 0.2);
  switch (direction) {
    case 'up': return [[cx, hi(height)], [cx, lo(height)]];
    case 'down': return [[cx, lo(height)], [cx, hi(height)]];
    case 'left': return [[hi(width), cy], [lo(width), cy]];
    case 'right': return [[lo(width), cy], [hi(width), cy]];
    default: throw new Error(direction);
  }
}

describe('centredSwipe', () => {
  test('1080x2400 up is (540,1920) -> (540,480)', () => {
    const g = centredSwipe({ width: 1080, height: 2400 }, 'up');
    expect(g).toEqual({ x: 540, y: 1920, distance: 1440 });
    expect(endOf(g, 'up')).toEqual([540, 480]);
  });

  test.each([
    [1080, 2400],
    [1179, 2556],
  ])('all four directions at %ix%i match the pre-1.x adb endpoints exactly', (width, height) => {
    for (const direction of ['up', 'down', 'left', 'right']) {
      const g = centredSwipe({ width, height }, direction);
      const [start, end] = adbEndpoints({ width, height }, direction);
      expect([direction, [g.x, g.y]]).toEqual([direction, start]);
      expect([direction, endOf(g, direction)]).toEqual([direction, end]);
      expect(Number.isInteger(g.distance) && g.distance > 0).toBe(true);
    }
  });

  test('odd size 1179x2556 concrete values', () => {
    expect(centredSwipe({ width: 1179, height: 2556 }, 'down')).toEqual({ x: 589, y: 511, distance: 1533 });
    expect(centredSwipe({ width: 1179, height: 2556 }, 'left')).toEqual({ x: 943, y: 1278, distance: 708 });
  });

  test('throws on an unknown direction', () => {
    expect(() => centredSwipe({ width: 1080, height: 2400 }, 'sideways')).toThrow(/direction/i);
    expect(() => centredSwipe({ width: 1080, height: 2400 }, undefined)).toThrow(/direction/i);
  });
});
