import { describe, expect, it } from 'vitest';

import {
  countExtendedFingers,
  extractHandFeatures,
  isFullyInFrame,
  type HandPoint,
} from '../../src/media/hand-landmarker';

type Finger = 'thumb' | 'index' | 'middle' | 'ring' | 'pinky';

const WRIST: HandPoint = { x: 0.5, y: 0.9 };
const PINKY_KNUCKLE: HandPoint = { x: 0.65, y: 0.75 };

/**
 * Builds a synthetic right hand: a curled finger puts its tip closer to the
 * wrist than its own middle joint, and a folded thumb tucks toward the pinky
 * knuckle. Column positions keep the fingers apart but do not affect counting.
 */
function hand(extended: readonly Finger[]): HandPoint[] {
  const points: HandPoint[] = Array.from({ length: 21 }, () => ({ ...WRIST }));
  points[17] = PINKY_KNUCKLE;

  const thumbOut = extended.includes('thumb');
  points[3] = thumbOut ? { x: 0.35, y: 0.78 } : { x: 0.45, y: 0.78 };
  points[4] = thumbOut ? { x: 0.20, y: 0.74 } : { x: 0.57, y: 0.73 };

  const joints = {
    index: { pip: 6, tip: 8, x: 0.44 },
    middle: { pip: 10, tip: 12, x: 0.50 },
    ring: { pip: 14, tip: 16, x: 0.56 },
    pinky: { pip: 18, tip: 20, x: 0.62 },
  } as const;

  for (const finger of ['index', 'middle', 'ring', 'pinky'] as const) {
    const { pip, tip, x } = joints[finger];
    points[pip] = { x, y: 0.70 };
    points[tip] = extended.includes(finger) ? { x, y: 0.55 } : { x, y: 0.80 };
  }
  return points;
}

describe('countExtendedFingers', () => {
  it.each([
    [[], 0],
    [['index'], 1],
    [['index', 'middle'], 2],
    [['index', 'middle', 'ring'], 3],
    [['index', 'middle', 'ring', 'pinky'], 4],
    [['thumb', 'index', 'middle', 'ring', 'pinky'], 5],
  ] as const)('counts %j as %i', (extended, expected) => {
    expect(countExtendedFingers(hand(extended))).toBe(expected);
  });

  it('counts the same total however the fingers are chosen', () => {
    // A "three" made with thumb, index and middle must read the same as one
    // made with index, middle and ring.
    expect(countExtendedFingers(hand(['thumb', 'index', 'middle']))).toBe(3);
    expect(countExtendedFingers(hand(['index', 'middle', 'ring']))).toBe(3);
  });

  it('returns zero for a truncated or non-finite landmark set', () => {
    expect(countExtendedFingers(hand(['index']).slice(0, 12))).toBe(0);
    const broken = hand(['index', 'middle']);
    broken[8] = { x: Number.NaN, y: 0.5 };
    expect(countExtendedFingers(broken)).toBe(0);
  });
});

describe('isFullyInFrame', () => {
  it('accepts a hand held well inside the frame', () => {
    expect(isFullyInFrame(hand(['index']))).toBe(true);
  });

  it.each([
    ['left', (p: HandPoint) => ({ ...p, x: p.x - 0.5 })],
    ['right', (p: HandPoint) => ({ ...p, x: p.x + 0.5 })],
    ['top', (p: HandPoint) => ({ ...p, y: p.y - 0.9 })],
    ['bottom', (p: HandPoint) => ({ ...p, y: p.y + 0.1 })],
  ])('rejects a hand clipped by the %s edge', (_edge, move) => {
    expect(isFullyInFrame(hand(['index']).map(move))).toBe(false);
  });

  it('rejects a truncated landmark set', () => {
    expect(isFullyInFrame(hand(['index']).slice(0, 10))).toBe(false);
  });
});

describe('extractHandFeatures', () => {
  it('reports no hand when the model returns nothing', () => {
    expect(extractHandFeatures({ landmarks: [] }))
      .toEqual({ handDetected: false, fingerCount: 0, fullyInFrame: false });
  });

  it('reads the first hand the model returns', () => {
    expect(extractHandFeatures({ landmarks: [hand(['index', 'middle'])] }))
      .toEqual({ handDetected: true, fingerCount: 2, fullyInFrame: true });
  });

  it('marks a hand the frame edge cuts off, which is how a stray hand appears', () => {
    const straying = hand(['index', 'middle']).map((point) => ({ ...point, x: point.x - 0.48 }));
    const features = extractHandFeatures({ landmarks: [straying] });
    expect(features.handDetected).toBe(true);
    expect(features.fullyInFrame).toBe(false);
  });
});
