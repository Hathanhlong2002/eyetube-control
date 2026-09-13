import { describe, expect, it } from 'vitest';

import { classify, DEFAULT_CALIBRATION_PROFILE, type FaceFeatures } from '../../src/gesture/classifier';

function feature(overrides: Partial<FaceFeatures> = {}): FaceFeatures {
  return {
    faceDetected: true,
    confidence: 0.95,
    faceSize: 0.3,
    brightness: 0.7,
    headYaw: 0,
    headPitch: 0,
    leftEyeClosed: 0.05,
    rightEyeClosed: 0.05,
    eyeVisibility: 0.95,
    gazeVertical: 0,
    ...overrides,
  };
}

describe('classify', () => {
  it('classifies a clear neutral face', () => {
    expect(classify(feature(), DEFAULT_CALIBRATION_PROFILE)).toBe('NEUTRAL');
  });

  it.each([
    [{ leftEyeClosed: 0.9 }, 'WINK_LEFT'],
    [{ rightEyeClosed: 0.9 }, 'WINK_RIGHT'],
    [{ leftEyeClosed: 0.9, rightEyeClosed: 0.9 }, 'BOTH_CLOSED'],
    [{ gazeVertical: 0.3 }, 'GAZE_UP'],
    [{ gazeVertical: -0.3 }, 'GAZE_DOWN'],
  ] as const)('classifies %j as %s', (overrides, expected) => {
    expect(classify(feature(overrides), DEFAULT_CALIBRATION_PROFILE)).toBe(expected);
  });

  it('returns NO_FACE when no face is present', () => {
    expect(classify(feature({ faceDetected: false }), DEFAULT_CALIBRATION_PROFILE)).toBe('NO_FACE');
  });

  it.each([
    { confidence: 0.4 },
    { faceSize: 0.05 },
    { eyeVisibility: 0.3 },
    { brightness: 0.1 },
    { headYaw: 0.8 },
    { headPitch: -0.8 },
    { leftEyeClosed: 0.45, rightEyeClosed: 0.3 },
  ])('returns UNCERTAIN for unsafe features %j', (overrides) => {
    expect(classify(feature(overrides), DEFAULT_CALIBRATION_PROFILE)).toBe('UNCERTAIN');
  });

  it('prioritizes both-closed and wink above gaze', () => {
    expect(classify(feature({
      leftEyeClosed: 0.9,
      rightEyeClosed: 0.9,
      gazeVertical: 0.4,
    }), DEFAULT_CALIBRATION_PROFILE)).toBe('BOTH_CLOSED');
    expect(classify(feature({ leftEyeClosed: 0.9, gazeVertical: 0.4 }), DEFAULT_CALIBRATION_PROFILE))
      .toBe('WINK_LEFT');
  });

  it('does not mutate the feature input or profile', () => {
    const input = Object.freeze(feature());
    const profile = Object.freeze({ ...DEFAULT_CALIBRATION_PROFILE });
    expect(() => classify(input, profile)).not.toThrow();
  });
});
