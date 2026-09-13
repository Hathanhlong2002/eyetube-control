import { describe, expect, it } from 'vitest';

import {
  classify,
  classifyDetailed,
  DEFAULT_CALIBRATION_PROFILE,
  type FaceFeatures,
} from '../../src/gesture/classifier';

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
  ] as const)('classifies %j as %s', (overrides, expected) => {
    expect(classify(feature(overrides), DEFAULT_CALIBRATION_PROFILE)).toBe(expected);
  });

  it('treats looking down as neutral so reading subtitles fires nothing', () => {
    expect(classify(feature({ gazeVertical: -0.9 }), DEFAULT_CALIBRATION_PROFILE)).toBe('NEUTRAL');
  });

  it('returns NO_FACE when no face is present', () => {
    expect(classify(feature({ faceDetected: false }), DEFAULT_CALIBRATION_PROFILE)).toBe('NO_FACE');
  });

  it.each([
    { confidence: 0.4 },
    { faceSize: 0.005 },
    { eyeVisibility: 0.3 },
    { brightness: 0.02 },
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

describe('classifyDetailed', () => {
  it('reports NONE as the blocker for a usable face', () => {
    expect(classifyDetailed(feature(), DEFAULT_CALIBRATION_PROFILE)).toEqual({
      observation: 'NEUTRAL',
      blocker: 'NONE',
    });
  });

  it.each([
    [{ faceDetected: false }, 'NO_FACE'],
    [{ confidence: 0.4 }, 'LOW_CONFIDENCE'],
    [{ faceSize: 0.005 }, 'FACE_TOO_SMALL'],
    [{ brightness: 0.02 }, 'TOO_DARK'],
    [{ eyeVisibility: 0.3 }, 'EYES_UNCLEAR'],
    [{ headYaw: 0.8 }, 'HEAD_TURNED'],
    [{ headPitch: -0.8 }, 'HEAD_TILTED'],
    [{ leftEyeClosed: 0.45, rightEyeClosed: 0.3 }, 'EYES_UNCLEAR'],
  ] as const)('names %j as the blocker %s', (overrides, blocker) => {
    expect(classifyDetailed(feature(overrides), DEFAULT_CALIBRATION_PROFILE).blocker).toBe(blocker);
  });

  it('accepts a face at a realistic webcam distance', () => {
    // ~0.23 x 0.29 of the frame: an arm's length away from a 640x480 camera.
    expect(classifyDetailed(feature({ faceSize: 0.067 }), DEFAULT_CALIBRATION_PROFILE).observation)
      .toBe('NEUTRAL');
    expect(classifyDetailed(feature({ faceSize: 0.067, leftEyeClosed: 0.9 }), DEFAULT_CALIBRATION_PROFILE).observation)
      .toBe('WINK_LEFT');
  });
});
