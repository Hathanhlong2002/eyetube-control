import type { Command, Gesture } from '../contracts/messages';
import type { GestureEvent, GestureMachineSettings, Observation } from './types';

type MachineState =
  | { type: 'SEARCHING' }
  | { type: 'READY' }
  | { type: 'HOLDING'; gesture: Gesture; startedAt: number }
  | { type: 'COOLDOWN'; emittedAt: number; neutralSince: number | null };

const COMMAND_BY_GESTURE: Record<Gesture, Command> = {
  WINK_RIGHT: 'NEXT_VIDEO',
  WINK_LEFT: 'PREVIOUS_VIDEO',
  BOTH_CLOSED: 'TOGGLE_PLAYBACK',
  GAZE_UP: 'LIKE_VIDEO',
  GAZE_DOWN: 'SUBSCRIBE_CHANNEL',
};

export const DEFAULT_MACHINE_SETTINGS: GestureMachineSettings = {
  navigationHoldMs: 700,
  accountHoldMs: 2_000,
  cooldownMs: 1_500,
  neutralRearmMs: 300,
  enabledGestures: {
    WINK_LEFT: true,
    WINK_RIGHT: true,
    BOTH_CLOSED: true,
    GAZE_UP: true,
    GAZE_DOWN: true,
  },
};

function isGesture(observation: Observation): observation is Gesture {
  return observation !== 'NO_FACE' && observation !== 'NEUTRAL' && observation !== 'UNCERTAIN';
}

export class GestureMachine {
  #state: MachineState = { type: 'READY' };
  #lastTimestamp: number | null = null;

  constructor(private readonly settings: GestureMachineSettings) {}

  reset(): void {
    this.#state = { type: 'SEARCHING' };
    this.#lastTimestamp = null;
  }

  update(observation: Observation, timestampMs: number): GestureEvent[] {
    if (!Number.isFinite(timestampMs)
      || timestampMs < 0
      || (this.#lastTimestamp !== null && timestampMs < this.#lastTimestamp)) {
      const wasHolding = this.#state.type === 'HOLDING';
      this.#state = { type: 'SEARCHING' };
      this.#lastTimestamp = Number.isFinite(timestampMs) && timestampMs >= 0 ? timestampMs : null;
      return wasHolding ? [{ type: 'CANCELLED' }] : [];
    }
    this.#lastTimestamp = timestampMs;

    if (this.#state.type === 'SEARCHING') {
      if (observation === 'NEUTRAL') this.#state = { type: 'READY' };
      return [];
    }

    if (this.#state.type === 'COOLDOWN') {
      if (observation === 'NO_FACE') {
        this.#state = { type: 'SEARCHING' };
        return [];
      }
      if (observation !== 'NEUTRAL') {
        this.#state.neutralSince = null;
        return [];
      }
      this.#state.neutralSince ??= timestampMs;
      if (timestampMs - this.#state.emittedAt >= this.settings.cooldownMs
        && timestampMs - this.#state.neutralSince >= this.settings.neutralRearmMs) {
        this.#state = { type: 'READY' };
      }
      return [];
    }

    if (this.#state.type === 'READY') {
      if (observation === 'NO_FACE') this.#state = { type: 'SEARCHING' };
      else if (isGesture(observation) && this.settings.enabledGestures[observation]) {
        this.#state = { type: 'HOLDING', gesture: observation, startedAt: timestampMs };
        return [{ type: 'PROGRESS', gesture: observation, progress: 0 }];
      }
      return [];
    }

    const holding = this.#state;
    if (!isGesture(observation) || !this.settings.enabledGestures[observation]) {
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

    const holdMs = observation === 'GAZE_UP' || observation === 'GAZE_DOWN'
      ? this.settings.accountHoldMs
      : this.settings.navigationHoldMs;
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
