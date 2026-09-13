import { describe, expect, it } from 'vitest';

import { deriveCalibration, type CalibrationSamples } from '../../src/gesture/calibration';
import type { FaceFeatures } from '../../src/gesture/classifier';

function feature(overrides: Partial<FaceFeatures> = {}): FaceFeatures {
  return {
    faceDetected: true,
    confidence: 0.96,
    faceSize: 0.3,
    brightness: 0.7,
    headYaw: 0.01,
    headPitch: 0.01,
    leftEyeClosed: 0.05,
    rightEyeClosed: 0.05,
    eyeVisibility: 0.95,
    gazeVertical: 0,
    ...overrides,
  };
}

function samples(): CalibrationSamples {
  return {
    neutral: [feature(), feature({ leftEyeClosed: 0.07, gazeVertical: 0.01 })],
    winkLeft: [feature({ leftEyeClosed: 0.84 }), feature({ leftEyeClosed: 0.88 })],
    winkRight: [feature({ rightEyeClosed: 0.83 }), feature({ rightEyeClosed: 0.89 })],
    bothClosed: [feature({ leftEyeClosed: 0.9, rightEyeClosed: 0.91 })],
    gazeUp: [feature({ gazeVertical: 0.3 }), feature({ gazeVertical: 0.32 })],
    gazeDown: [feature({ gazeVertical: -0.29 }), feature({ gazeVertical: -0.33 })],
  };
}

describe('deriveCalibration', () => {
  it('derives bounded numeric thresholds without retaining samples', () => {
    const result = deriveCalibration(samples());

    expect(result).toEqual(expect.objectContaining({ status: 'SUCCESS' }));
    if (result.status === 'SUCCESS') {
      expect(result.profile).toEqual(expect.objectContaining({
        version: 1,
        closedThreshold: expect.any(Number),
        gazeUpThreshold: expect.any(Number),
        gazeDownThreshold: expect.any(Number),
      }));
      expect(Object.values(result.profile).every((value) => Number.isFinite(value))).toBe(true);
    }
    expect(JSON.stringify(result)).not.toContain('neutral');
    expect(JSON.stringify(result)).not.toContain('landmark');
  });

  it('fails closed in low light', () => {
    const input = samples();
    input.neutral = [feature({ brightness: 0.1 })];
    expect(deriveCalibration(input)).toEqual({ status: 'FAILED', reason: 'LOW_LIGHT' });
  });

  it('fails closed when the face is too small', () => {
    const input = samples();
    input.neutral = [feature({ faceSize: 0.05 })];
    expect(deriveCalibration(input)).toEqual({ status: 'FAILED', reason: 'FACE_TOO_SMALL' });
  });

  it('fails closed for missing, low-confidence or unstable samples', () => {
    const input = samples();
    input.neutral = [feature(), feature({ confidence: 0.4 })];
    expect(deriveCalibration(input)).toEqual({ status: 'FAILED', reason: 'UNSTABLE' });
  });

  it('fails closed when gestures cannot be distinguished', () => {
    const input = samples();
    input.winkLeft = [feature({ leftEyeClosed: 0.12 })];
    expect(deriveCalibration(input)).toEqual({ status: 'FAILED', reason: 'INDISTINGUISHABLE' });
  });

  it('rejects empty calibration stages as unstable', () => {
    const input = samples();
    input.gazeUp = [];
    expect(deriveCalibration(input)).toEqual({ status: 'FAILED', reason: 'UNSTABLE' });
  });
});
