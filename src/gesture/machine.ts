import type { Command, Gesture } from '../contracts/messages';
import type { MachineStateName } from '../contracts/status';
import type { GestureEvent, GestureMachineSettings, Observation } from './types';

type MachineState =
  | { type: 'SEARCHING' }
  | { type: 'READY' }
  | { type: 'HOLDING'; gesture: Gesture; startedAt: number }
  | { type: 'COOLDOWN'; emittedAt: number; neutralSince: number | null };

// The easiest gesture carries the most-used, self-correcting action; the
// account-touching one carries the most deliberate gesture.
const COMMAND_BY_GESTURE: Record<Gesture, Command> = {
  BOTH_CLOSED: 'TOGGLE_PLAYBACK',
  WINK_RIGHT: 'NEXT_VIDEO',
  WINK_LEFT: 'PREVIOUS_VIDEO',
  GAZE_UP: 'LIKE_VIDEO',
  HAND_1: 'OPEN_RELATED_1',
  HAND_2: 'OPEN_RELATED_2',
  HAND_3: 'OPEN_RELATED_3',
  HAND_4: 'OPEN_RELATED_4',
  HAND_5: 'OPEN_RELATED_5',
};

// A face that never classifies as a clean NEUTRAL (glasses, side lighting, an
// eyelid resting between the open and closed thresholds) must not strand the
// machine: arm once the face has simply been present for this long.
const PRESENCE_REARM_MS = 1_000;
// Same guard for the cooldown state, which otherwise waits forever for a clean
// neutral and makes eye control appear to work exactly once per session. It
// deliberately does not apply while a gesture is still being held.
const COOLDOWN_ESCAPE_MS = 2_000;

export const DEFAULT_MACHINE_SETTINGS: GestureMachineSettings = {
  navigationHoldMs: 400,
  playPauseHoldMs: 700,
  handHoldMs: 900,
  accountHoldMs: 1_200,
  cooldownMs: 800,
  neutralRearmMs: 200,
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

function holdMsFor(gesture: Gesture, settings: GestureMachineSettings): number {
  if (gesture.startsWith('HAND_')) return settings.handHoldMs;
  if (gesture === 'BOTH_CLOSED') return settings.playPauseHoldMs;
  if (gesture === 'GAZE_UP') return settings.accountHoldMs;
  return settings.navigationHoldMs;
}

function isGesture(observation: Observation): observation is Gesture {
  return observation !== 'NO_FACE' && observation !== 'NEUTRAL' && observation !== 'UNCERTAIN';
}

export class GestureMachine {
  #state: MachineState = { type: 'READY' };
  #lastTimestamp: number | null = null;
  #presenceSince: number | null = null;
  #settings: GestureMachineSettings;

  constructor(settings: GestureMachineSettings) {
    this.#settings = { ...settings, enabledGestures: { ...settings.enabledGestures } };
  }

  get stateName(): MachineStateName {
    return this.#state.type;
  }

  get settings(): GestureMachineSettings {
    return this.#settings;
  }

  /** Applies popup settings to a running session without dropping the camera. */
  configure(settings: Partial<GestureMachineSettings>): void {
    this.#settings = {
      ...this.#settings,
      ...settings,
      enabledGestures: {
        ...this.#settings.enabledGestures,
        ...(settings.enabledGestures ?? {}),
      },
    };
  }

  reset(): void {
    this.#state = { type: 'SEARCHING' };
    this.#lastTimestamp = null;
    this.#presenceSince = null;
  }

  update(observation: Observation, timestampMs: number): GestureEvent[] {
    if (!Number.isFinite(timestampMs)
      || timestampMs < 0
      || (this.#lastTimestamp !== null && timestampMs < this.#lastTimestamp)) {
      const wasHolding = this.#state.type === 'HOLDING';
      this.#state = { type: 'SEARCHING' };
      this.#lastTimestamp = Number.isFinite(timestampMs) && timestampMs >= 0 ? timestampMs : null;
      this.#presenceSince = null;
      return wasHolding ? [{ type: 'CANCELLED' }] : [];
    }
    this.#lastTimestamp = timestampMs;

    if (observation === 'NO_FACE') this.#presenceSince = null;
    else this.#presenceSince ??= timestampMs;

    if (this.#state.type === 'SEARCHING') {
      const presentLongEnough = this.#presenceSince !== null
        && timestampMs - this.#presenceSince >= PRESENCE_REARM_MS;
      if (observation === 'NEUTRAL' || presentLongEnough) this.#state = { type: 'READY' };
      return [];
    }

    if (this.#state.type === 'COOLDOWN') {
      if (observation === 'NO_FACE') {
        this.#state = { type: 'SEARCHING' };
        return [];
      }
      const elapsed = timestampMs - this.#state.emittedAt;
      if (observation !== 'NEUTRAL') {
        this.#state.neutralSince = null;
        // Escape only when the signal is merely unreadable. Escaping while the
        // same deliberate gesture is still held would fire it a second time,
        // which for a raised hand means navigating twice.
        if (!isGesture(observation) && elapsed >= this.#settings.cooldownMs + COOLDOWN_ESCAPE_MS) {
          this.#state = { type: 'READY' };
        }
        return [];
      }
      this.#state.neutralSince ??= timestampMs;
      if (elapsed >= this.#settings.cooldownMs
        && timestampMs - this.#state.neutralSince >= this.#settings.neutralRearmMs) {
        this.#state = { type: 'READY' };
      }
      return [];
    }

    if (this.#state.type === 'READY') {
      if (observation === 'NO_FACE') this.#state = { type: 'SEARCHING' };
      else if (isGesture(observation) && this.#settings.enabledGestures[observation]) {
        this.#state = { type: 'HOLDING', gesture: observation, startedAt: timestampMs };
        return [{ type: 'PROGRESS', gesture: observation, progress: 0 }];
      }
      return [];
    }

    const holding = this.#state;
    if (!isGesture(observation) || !this.#settings.enabledGestures[observation]) {
      this.#state = observation === 'NO_FACE' ? { type: 'SEARCHING' } : { type: 'READY' };
      return [{ type: 'CANCELLED' }];
    }

    if (observation !== holding.gesture) {
      this.#state = { type: 'HOLDING', gesture: observation, startedAt: timestampMs };
      return [
        { type: 'CANCELLED' },
        { type: 'PROGRESS', gesture: observation, progress: 0 },
      ];
    }

    const holdMs = holdMsFor(observation, this.#settings);
    const progress = Math.min(1, Math.max(0, (timestampMs - holding.startedAt) / holdMs));
    const events: GestureEvent[] = [{ type: 'PROGRESS', gesture: observation, progress }];
    if (progress === 1) {
      this.#state = { type: 'COOLDOWN', emittedAt: timestampMs, neutralSince: null };
      events.push({
        type: 'COMMAND',
        gesture: observation,
        command: COMMAND_BY_GESTURE[observation],
        commandId: crypto.randomUUID(),
      });
    }
    return events;
  }
}
