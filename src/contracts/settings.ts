import type { Gesture } from './messages';

export type PreviewState = 'SHOWN' | 'MINIMIZED';

export type EyeControlSettings = {
  navigationHoldMs: number;
  playPauseHoldMs: number;
  handHoldMs: number;
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
  // A hand drifts through many shapes on its way to the intended one.
  handHoldMs: { min: 500, max: 2000, default: 900 },
  // Liking touches the account, so it stays the most deliberate gesture.
  accountHoldMs: { min: 800, max: 4000, default: 1200 },
  cooldownMs: { min: 400, max: 2000, default: 800 },
} as const;

export const DEFAULT_SETTINGS: EyeControlSettings = {
  navigationHoldMs: SETTINGS_LIMITS.navigationHoldMs.default,
  playPauseHoldMs: SETTINGS_LIMITS.playPauseHoldMs.default,
  handHoldMs: SETTINGS_LIMITS.handHoldMs.default,
  accountHoldMs: SETTINGS_LIMITS.accountHoldMs.default,
  cooldownMs: SETTINGS_LIMITS.cooldownMs.default,
  previewState: 'SHOWN',
  previewMirror: true,
  enabledGestures: {
    WINK_LEFT: true,
    WINK_RIGHT: true,
    BOTH_CLOSED: true,
    GAZE_UP: true,
    HAND_1: true,
    HAND_2: true,
    HAND_3: true,
    HAND_4: true,
    HAND_5: true,
  },
};

const ALL_GESTURES: readonly Gesture[] = [
  'WINK_LEFT',
  'WINK_RIGHT',
  'BOTH_CLOSED',
  'GAZE_UP',
  'HAND_1',
  'HAND_2',
  'HAND_3',
  'HAND_4',
  'HAND_5',
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

  const handHoldMs = clampNumber(
    raw.handHoldMs,
    SETTINGS_LIMITS.handHoldMs.min,
    SETTINGS_LIMITS.handHoldMs.max,
    DEFAULT_SETTINGS.handHoldMs,
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
    HAND_1: typeof rawGestures.HAND_1 === 'boolean' ? rawGestures.HAND_1 : true,
    HAND_2: typeof rawGestures.HAND_2 === 'boolean' ? rawGestures.HAND_2 : true,
    HAND_3: typeof rawGestures.HAND_3 === 'boolean' ? rawGestures.HAND_3 : true,
    HAND_4: typeof rawGestures.HAND_4 === 'boolean' ? rawGestures.HAND_4 : true,
    HAND_5: typeof rawGestures.HAND_5 === 'boolean' ? rawGestures.HAND_5 : true,
  };

  return {
    navigationHoldMs,
    playPauseHoldMs,
    handHoldMs,
    accountHoldMs,
    cooldownMs,
    previewState,
    previewMirror,
    enabledGestures,
  };
}
