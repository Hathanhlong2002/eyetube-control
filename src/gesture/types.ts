import type { Command, Gesture } from '../contracts/messages';

export type Observation = Gesture | 'NO_FACE' | 'NEUTRAL' | 'UNCERTAIN';

export type GestureEvent =
  | { type: 'PROGRESS'; gesture: Gesture; progress: number }
  | { type: 'CANCELLED' }
  | { type: 'COMMAND'; gesture: Gesture; command: Command; commandId: string };

export type GestureMachineSettings = {
  navigationHoldMs: number;
  accountHoldMs: number;
  cooldownMs: number;
  neutralRearmMs: number;
  enabledGestures: Record<Gesture, boolean>;
};
