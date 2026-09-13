import type { Gesture } from './messages';

export type PreviewState = 'SHOWN' | 'MINIMIZED';

export type EyeControlSettings = {
  navigationHoldMs: number;
  playPauseHoldMs: number;
  accountHoldMs: number;
  cooldownMs: number;
  previewState: PreviewState;
  previewMirror: boolean;
  enabledGestures: Record<Gesture, boolean>;
};

export const SETTINGS_LIMITS = {
  // Winks are deliberate by nature, so they need no long hold.
  navigationHoldMs: { min: 200, max: 1000, default: 400 },
  // Must stay clear of a natural blink, which runs 100-400 ms.
  playPauseHoldMs: { min: 400, max: 1500, default: 700 },
  // Liking touches the account, so it stays the most deliberate gesture.
  accountHoldMs: { min: 800, max: 4000, default: 1200 },
  cooldownMs: { min: 400, max: 2000, default: 800 },
} as const;

export const DEFAULT_SETTINGS: EyeControlSettings = {
  navigationHoldMs: SETTINGS_LIMITS.navigationHoldMs.default,
  playPauseHoldMs: SETTINGS_LIMITS.playPauseHoldMs.default,
  accountHoldMs: SETTINGS_LIMITS.accountHoldMs.default,
  cooldownMs: SETTINGS_LIMITS.cooldownMs.default,
  previewState: 'SHOWN',
  previewMirror: true,
  enabledGestures: {
    WINK_LEFT: true,
    WINK_RIGHT: true,
    BOTH_CLOSED: true,
    GAZE_UP: true,
  },
};

const ALL_GESTURES: readonly Gesture[] = [
  'WINK_LEFT',
  'WINK_RIGHT',
  'BOTH_CLOSED',
  'GAZE_UP',
];

function clampNumber(value: unknown, min: number, max: number, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

export function parseSettings(input: unknown): EyeControlSettings {
  if (typeof input !== 'object' || input === null) return { ...DEFAULT_SETTINGS };
  const raw = input as Record<string, unknown>;

  const navigationHoldMs = clampNumber(
    raw.navigationHoldMs,
    SETTINGS_LIMITS.navigationHoldMs.min,
    SETTINGS_LIMITS.navigationHoldMs.max,
    DEFAULT_SETTINGS.navigationHoldMs,
  );

  const playPauseHoldMs = clampNumber(
    raw.playPauseHoldMs,
    SETTINGS_LIMITS.playPauseHoldMs.min,
    SETTINGS_LIMITS.playPauseHoldMs.max,
    DEFAULT_SETTINGS.playPauseHoldMs,
  );

  const accountHoldMs = clampNumber(
    raw.accountHoldMs,
    SETTINGS_LIMITS.accountHoldMs.min,
    SETTINGS_LIMITS.accountHoldMs.max,
    DEFAULT_SETTINGS.accountHoldMs,
  );

  const cooldownMs = clampNumber(
    raw.cooldownMs,
    SETTINGS_LIMITS.cooldownMs.min,
    SETTINGS_LIMITS.cooldownMs.max,
    DEFAULT_SETTINGS.cooldownMs,
  );

  const previewState: PreviewState = raw.previewState === 'MINIMIZED' ? 'MINIMIZED' : 'SHOWN';
  const previewMirror = typeof raw.previewMirror === 'boolean' ? raw.previewMirror : DEFAULT_SETTINGS.previewMirror;

  const rawGestures = (typeof raw.enabledGestures === 'object' && raw.enabledGestures !== null)
    ? (raw.enabledGestures as Record<string, unknown>)
    : {};

  const enabledGestures: Record<Gesture, boolean> = {
    WINK_LEFT: typeof rawGestures.WINK_LEFT === 'boolean' ? rawGestures.WINK_LEFT : true,
    WINK_RIGHT: typeof rawGestures.WINK_RIGHT === 'boolean' ? rawGestures.WINK_RIGHT : true,
    BOTH_CLOSED: typeof rawGestures.BOTH_CLOSED === 'boolean' ? rawGestures.BOTH_CLOSED : true,
    GAZE_UP: typeof rawGestures.GAZE_UP === 'boolean' ? rawGestures.GAZE_UP : true,
  };

  return {
    navigationHoldMs,
    playPauseHoldMs,
    accountHoldMs,
    cooldownMs,
    previewState,
    previewMirror,
    enabledGestures,
  };
}
