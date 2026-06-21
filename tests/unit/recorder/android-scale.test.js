'use strict';

const { computeAndroidScale, matchAbsMax } = require('../../../tools/recorder/src/capture/android-scale');

// Synthetic getevent -lp output containing ABS_MT_POSITION_X/Y blocks
const LP_NORMAL = `
  add device 1: /dev/input/event3
    name:     "touchscreen"
    events:
      ABS (0003): ABS_MT_POSITION_X       : value 0, min 0, max 1079, fuzz 0, flat 0, resolution 0
                  ABS_MT_POSITION_Y       : value 0, min 0, max 2399, fuzz 0, flat 0, resolution 0
`;

const LP_HALF = `
      ABS (0003): ABS_MT_POSITION_X       : value 0, min 0, max 539, fuzz 0, flat 0, resolution 0
                  ABS_MT_POSITION_Y       : value 0, min 0, max 1199, fuzz 0, flat 0, resolution 0
`;

const WM_PHYSICAL = 'Physical size: 1080x2400\n';
const WM_PHYSICAL_ONLY = 'Physical size: 1080x2400\n';
const WM_BOTH = 'Override size: 720x1280\nPhysical size: 1080x2400\n';
const WM_OVERRIDE_ONLY = 'Override size: 720x1280\n';

function makeRunAdb(wmOutput, lpOutput) {
  return (args) => Promise.resolve(
    args[0] === 'wm' ? wmOutput : lpOutput
  );
}

describe('matchAbsMax', () => {
  test('returns max value for a present axis code', () => {
    expect(matchAbsMax(LP_NORMAL, 'ABS_MT_POSITION_X')).toBe(1079);
    expect(matchAbsMax(LP_NORMAL, 'ABS_MT_POSITION_Y')).toBe(2399);
  });

  test('returns null when axis code is absent', () => {
    expect(matchAbsMax(LP_NORMAL, 'ABS_MT_SLOT')).toBeNull();
  });

  test('returns null for empty/garbage input', () => {
    expect(matchAbsMax('', 'ABS_MT_POSITION_X')).toBeNull();
    expect(matchAbsMax(null, 'ABS_MT_POSITION_X')).toBeNull();
    expect(matchAbsMax('garbage data here', 'ABS_MT_POSITION_X')).toBeNull();
  });
});

describe('computeAndroidScale', () => {
  test('computes 1:1 scale when raw maxima match screen dims minus 1', async () => {
    const runAdb = makeRunAdb(WM_PHYSICAL, LP_NORMAL);
    const { scaleX, scaleY } = await computeAndroidScale({ runAdb });
    // screenW=1080, xMax=1079 → scaleX = 1080/1080 = 1
    expect(scaleX).toBeCloseTo(1, 5);
    expect(scaleY).toBeCloseTo(1, 5);
  });

  test('computes 2:1 scale when raw maxima are half of screen dims', async () => {
    const runAdb = makeRunAdb(WM_PHYSICAL, LP_HALF);
    const { scaleX, scaleY } = await computeAndroidScale({ runAdb });
    // screenW=1080, xMax=539 → scaleX = 1080/540 = 2
    expect(scaleX).toBeCloseTo(2, 5);
    expect(scaleY).toBeCloseTo(2, 5);
  });

  test('falls back to 1:1 when wm size returns empty', async () => {
    const runAdb = makeRunAdb('', LP_NORMAL);
    const { scaleX, scaleY } = await computeAndroidScale({ runAdb });
    expect(scaleX).toBe(1);
    expect(scaleY).toBe(1);
  });

  test('falls back to 1:1 when getevent -lp returns empty', async () => {
    const runAdb = makeRunAdb(WM_PHYSICAL, '');
    const { scaleX, scaleY } = await computeAndroidScale({ runAdb });
    expect(scaleX).toBe(1);
    expect(scaleY).toBe(1);
  });

  test('falls back to 1:1 when both outputs are garbage', async () => {
    const runAdb = makeRunAdb('no match here', 'also garbage');
    const { scaleX, scaleY } = await computeAndroidScale({ runAdb });
    expect(scaleX).toBe(1);
    expect(scaleY).toBe(1);
  });

  test('prefers Physical size line over Override size when both present', async () => {
    const runAdb = makeRunAdb(WM_BOTH, LP_NORMAL);
    const { scaleX, scaleY } = await computeAndroidScale({ runAdb });
    // Physical size 1080x2400 wins over Override 720x1280 → 1:1 scale
    expect(scaleX).toBeCloseTo(1, 5);
    expect(scaleY).toBeCloseTo(1, 5);
  });

  test('falls back to first WxH match (Override) when no Physical size line', async () => {
    const runAdb = makeRunAdb(WM_OVERRIDE_ONLY, LP_HALF);
    const { scaleX, scaleY } = await computeAndroidScale({ runAdb });
    // Override 720x1280; xMax=539 → scaleX = 720/540 ≈ 1.333; yMax=1199 → scaleY = 1280/1200 ≈ 1.067
    expect(scaleX).toBeCloseTo(720 / 540, 5);
    expect(scaleY).toBeCloseTo(1280 / 1200, 5);
  });
});
