'use strict';

const { e2eEngine, assertSessionEngine } = require('../../../sample-app/scripts/lib/engine');

const ENGINES = ['mobilecli', 'legacy'];

describe('e2eEngine', () => {
  test('defaults to mobilecli when E2E_ENGINE is unset or blank', () => {
    expect(e2eEngine({}, ENGINES)).toBe('mobilecli');
    expect(e2eEngine({ E2E_ENGINE: '  ' }, ENGINES)).toBe('mobilecli');
  });

  test('accepts every engine the install under test declares', () => {
    expect(e2eEngine({ E2E_ENGINE: 'legacy' }, ENGINES)).toBe('legacy');
    expect(e2eEngine({ E2E_ENGINE: ' mobilecli ' }, ENGINES)).toBe('mobilecli');
  });

  test('rejects an unknown engine loudly, naming the valid ones', () => {
    expect(() => e2eEngine({ E2E_ENGINE: 'adb' }, ENGINES)).toThrow(/E2E_ENGINE=adb.*mobilecli, legacy/);
  });

  test('a default the install does not declare is an error, not a silent fallback', () => {
    expect(() => e2eEngine({}, ['legacy'])).toThrow(/mobilecli/);
  });
});

describe('assertSessionEngine', () => {
  test('passes when the workspace resolves the requested engine from config', () => {
    expect(() =>
      assertSessionEngine({ resolved_engine: 'legacy', resolved_engine_source: 'config' }, 'legacy')
    ).not.toThrow();
  });

  test('fails when the workspace resolves a different engine', () => {
    expect(() =>
      assertSessionEngine({ resolved_engine: 'mobilecli', resolved_engine_source: 'config' }, 'legacy')
    ).toThrow(/resolves mobilecli.*E2E_ENGINE=legacy/);
  });

  test('fails when the engine comes from anywhere but the config (the path under test)', () => {
    expect(() =>
      assertSessionEngine({ resolved_engine: 'legacy', resolved_engine_source: 'env' }, 'legacy')
    ).toThrow(/from env/);
  });

  test('fails when a running daemon is on another engine', () => {
    expect(() =>
      assertSessionEngine(
        { running: true, engine: 'mobilecli', resolved_engine: 'legacy', resolved_engine_source: 'config' },
        'legacy'
      )
    ).toThrow(/running session uses mobilecli/);
  });

  test('fails on a status that does not report the engine (an install predating #251)', () => {
    expect(() => assertSessionEngine({ running: false }, 'mobilecli')).toThrow(/resolved_engine/);
  });
});
