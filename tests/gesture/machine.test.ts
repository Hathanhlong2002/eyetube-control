import { describe, expect, it } from 'vitest';

import { DEFAULT_MACHINE_SETTINGS, GestureMachine } from '../../src/gesture/machine';
import type { GestureEvent, Observation } from '../../src/gesture/types';

function commands(events: GestureEvent[]): GestureEvent[] {
  return events.filter((event) => event.type === 'COMMAND');
}

function hold(machine: GestureMachine, observation: Observation, start: number, end: number): GestureEvent[] {
  machine.update(observation, start);
  return machine.update(observation, end);
}

describe('GestureMachine', () => {
  it('ignores a natural 200 ms both-eye blink', () => {
    const machine = new GestureMachine(DEFAULT_MACHINE_SETTINGS);

    expect(machine.update('BOTH_CLOSED', 0)).toContainEqual({
      type: 'PROGRESS', gesture: 'BOTH_CLOSED', progress: 0,
    });
    expect(machine.update('NEUTRAL', 200)).toContainEqual({ type: 'CANCELLED' });
  });

  it('emits play/pause once after 700 ms while the gesture remains held', () => {
    const machine = new GestureMachine(DEFAULT_MACHINE_SETTINGS);

    expect(hold(machine, 'BOTH_CLOSED', 0, 700)).toContainEqual(expect.objectContaining({
      type: 'COMMAND', command: 'TOGGLE_PLAYBACK', gesture: 'BOTH_CLOSED',
    }));
    expect(commands(machine.update('BOTH_CLOSED', 2_500))).toHaveLength(0);
  });

  it.each([
    ['WINK_RIGHT', 'NEXT_VIDEO'],
    ['WINK_LEFT', 'PREVIOUS_VIDEO'],
  ] as const)('maps %s to %s after the navigation hold', (gesture, command) => {
    const machine = new GestureMachine(DEFAULT_MACHINE_SETTINGS);
    expect(hold(machine, gesture, 0, 700)).toContainEqual(expect.objectContaining({ type: 'COMMAND', command }));
  });

  it.each([
    ['GAZE_UP', 'LIKE_VIDEO'],
    ['GAZE_DOWN', 'SUBSCRIBE_CHANNEL'],
  ] as const)('requires the longer account hold for %s', (gesture, command) => {
    const machine = new GestureMachine(DEFAULT_MACHINE_SETTINGS);
    machine.update(gesture, 0);
    expect(commands(machine.update(gesture, 1_999))).toHaveLength(0);
    expect(machine.update(gesture, 2_000)).toContainEqual(expect.objectContaining({ type: 'COMMAND', command }));
  });

  it.each(['UNCERTAIN', 'NO_FACE'] as const)('%s cancels an active hold', (observation) => {
    const machine = new GestureMachine(DEFAULT_MACHINE_SETTINGS);
    machine.update('WINK_RIGHT', 0);

    expect(machine.update(observation, 400)).toContainEqual({ type: 'CANCELLED' });
    expect(commands(machine.update('WINK_RIGHT', 1_500))).toHaveLength(0);
  });

  it('requires both 1,500 ms cooldown and 300 ms continuous neutral before rearming', () => {
    const machine = new GestureMachine(DEFAULT_MACHINE_SETTINGS);
    hold(machine, 'BOTH_CLOSED', 0, 700);

    machine.update('NEUTRAL', 800);
    machine.update('NEUTRAL', 1_100);
    expect(commands(machine.update('BOTH_CLOSED', 1_101))).toHaveLength(0);

    machine.update('NEUTRAL', 2_200);
    machine.update('NEUTRAL', 2_500);
    expect(machine.update('BOTH_CLOSED', 2_501)).toContainEqual({
      type: 'PROGRESS', gesture: 'BOTH_CLOSED', progress: 0,
    });
    expect(machine.update('BOTH_CLOSED', 3_201)).toContainEqual(expect.objectContaining({
      type: 'COMMAND', command: 'TOGGLE_PLAYBACK',
    }));
  });

  it('clamps progress and gives every emitted command a UUID', () => {
    const machine = new GestureMachine(DEFAULT_MACHINE_SETTINGS);
    const events = hold(machine, 'WINK_RIGHT', 0, 5_000);
    const progress = events.find((event) => event.type === 'PROGRESS');
    const command = events.find((event) => event.type === 'COMMAND');

    expect(progress).toEqual({ type: 'PROGRESS', gesture: 'WINK_RIGHT', progress: 1 });
    expect(command).toEqual(expect.objectContaining({ commandId: expect.stringMatching(/^[0-9a-f-]{36}$/i) }));
  });

  it('resets to searching on a decreasing timestamp', () => {
    const machine = new GestureMachine(DEFAULT_MACHINE_SETTINGS);
    machine.update('WINK_RIGHT', 500);

    expect(machine.update('WINK_RIGHT', 400)).toContainEqual({ type: 'CANCELLED' });
    expect(machine.update('WINK_RIGHT', 1_500)).toEqual([]);
    machine.update('NEUTRAL', 1_501);
    expect(machine.update('WINK_RIGHT', 1_502)).toContainEqual(expect.objectContaining({ type: 'PROGRESS' }));
  });

  it('does not start a disabled gesture', () => {
    const machine = new GestureMachine({
      ...DEFAULT_MACHINE_SETTINGS,
      enabledGestures: { ...DEFAULT_MACHINE_SETTINGS.enabledGestures, GAZE_UP: false },
    });

    expect(machine.update('GAZE_UP', 0)).toEqual([]);
    expect(machine.update('GAZE_UP', 4_000)).toEqual([]);
  });

  it('reset requires a neutral observation before another hold', () => {
    const machine = new GestureMachine(DEFAULT_MACHINE_SETTINGS);
    machine.update('WINK_RIGHT', 0);
    machine.reset();

    expect(machine.update('WINK_RIGHT', 800)).toEqual([]);
    machine.update('NEUTRAL', 900);
    expect(machine.update('WINK_RIGHT', 901)).toContainEqual(expect.objectContaining({ type: 'PROGRESS' }));
  });
});
