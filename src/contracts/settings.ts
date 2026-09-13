import type { Gesture } from './messages';

export type PreviewState = 'SHOWN' | 'MINIMIZED';

export type EyeControlSettings = {
  navigationHoldMs: number;
  accountHoldMs: number;
  cooldownMs: number;
  previewState: PreviewState;
  previewMirror: boolean;
  enabledGestures: Record<Gesture, boolean>;
};

export const SETTINGS_LIMITS = {
  navigationHoldMs: { min: 200, max: 1000, default: 300 },
  accountHoldMs: { min: 1500, max: 4000, default: 2000 },
  cooldownMs: { min: 400, max: 2000, default: 800 },
} as const;

export const DEFAULT_SETTINGS: EyeControlSettings = {
  navigationHoldMs: SETTINGS_LIMITS.navigationHoldMs.default,
  accountHoldMs: SETTINGS_LIMITS.accountHoldMs.default,
  cooldownMs: SETTINGS_LIMITS.cooldownMs.default,
  previewState: 'SHOWN',
  previewMirror: true,
  enabledGestures: {
    WINK_LEFT: true,
    WINK_RIGHT: true,
    BOTH_CLOSED: true,
    GAZE_UP: true,
    GAZE_DOWN: true,
  },
};

const ALL_GESTURES: readonly Gesture[] = [
  'WINK_LEFT',
  'WINK_RIGHT',
  'BOTH_CLOSED',
  'GAZE_UP',
  'GAZE_DOWN',
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
    GAZE_DOWN: typeof rawGestures.GAZE_DOWN === 'boolean' ? rawGestures.GAZE_DOWN : true,
  };

  return {
    navigationHoldMs,
    accountHoldMs,
    cooldownMs,
    previewState,
    previewMirror,
    enabledGestures,
  };
}
