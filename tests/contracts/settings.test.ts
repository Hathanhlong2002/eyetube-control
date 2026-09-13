import { describe, expect, it } from 'vitest';

import { DEFAULT_SETTINGS, parseSettings } from '../../src/contracts/settings';

describe('parseSettings', () => {
  it('returns DEFAULT_SETTINGS for null or non-object input', () => {
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings('bad')).toEqual(DEFAULT_SETTINGS);
    expect(parseSettings(123)).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps unsafe account hold duration to safe range [800, 4000]', () => {
    expect(parseSettings({ ...DEFAULT_SETTINGS, accountHoldMs: 100 }).accountHoldMs).toBe(800);
    expect(parseSettings({ ...DEFAULT_SETTINGS, accountHoldMs: 10000 }).accountHoldMs).toBe(4000);
  });

  it('clamps play/pause hold to a range that clears a natural blink [400, 1500]', () => {
    expect(parseSettings({ ...DEFAULT_SETTINGS, playPauseHoldMs: 100 }).playPauseHoldMs).toBe(400);
    expect(parseSettings({ ...DEFAULT_SETTINGS, playPauseHoldMs: 9000 }).playPauseHoldMs).toBe(1500);
  });

  it('clamps navigation hold duration to safe range [200, 1000]', () => {
    expect(parseSettings({ ...DEFAULT_SETTINGS, navigationHoldMs: 50 }).navigationHoldMs).toBe(200);
    expect(parseSettings({ ...DEFAULT_SETTINGS, navigationHoldMs: 5000 }).navigationHoldMs).toBe(1000);
  });

  it('clamps cooldown to safe range [400, 2000]', () => {
    expect(parseSettings({ ...DEFAULT_SETTINGS, cooldownMs: 100 }).cooldownMs).toBe(400);
    expect(parseSettings({ ...DEFAULT_SETTINGS, cooldownMs: 9000 }).cooldownMs).toBe(2000);
  });

  it('drops unknown persisted fields', () => {
    const result = parseSettings({ ...DEFAULT_SETTINGS, uploadFrames: true, trackingId: 'xyz' }) as Record<string, unknown>;
    expect(result).not.toHaveProperty('uploadFrames');
    expect(result).not.toHaveProperty('trackingId');
  });

  it('validates enabledGestures per gesture boolean', () => {
    const result = parseSettings({
      ...DEFAULT_SETTINGS,
      enabledGestures: {
        WINK_LEFT: false,
        WINK_RIGHT: true,
        BOTH_CLOSED: false,
        GAZE_UP: true,
      },
    });
    expect(result.enabledGestures).toEqual({
      WINK_LEFT: false,
      WINK_RIGHT: true,
      BOTH_CLOSED: false,
      GAZE_UP: true,
    });
  });

  it('validates previewState and previewMirror', () => {
    expect(parseSettings({ ...DEFAULT_SETTINGS, previewState: 'MINIMIZED' }).previewState).toBe('MINIMIZED');
    expect(parseSettings({ ...DEFAULT_SETTINGS, previewState: 'INVALID' }).previewState).toBe('SHOWN');
    expect(parseSettings({ ...DEFAULT_SETTINGS, previewMirror: false }).previewMirror).toBe(false);
  });
});
