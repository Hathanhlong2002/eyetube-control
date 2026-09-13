import type { Observation } from './types';

export type FaceFeatures = {
  faceDetected: boolean;
  confidence: number;
  faceSize: number;
  brightness: number;
  headYaw: number;
  headPitch: number;
  leftEyeClosed: number;
  rightEyeClosed: number;
  eyeVisibility: number;
  gazeVertical: number;
};

export type CalibrationProfile = {
  version: 1;
  closedThreshold: number;
  openThreshold: number;
  gazeUpThreshold: number;
  gazeDownThreshold: number;
  confidenceFloor: number;
  faceSizeFloor: number;
  brightnessFloor: number;
  eyeVisibilityFloor: number;
  maxAbsYaw: number;
  maxAbsPitch: number;
};

export const DEFAULT_CALIBRATION_PROFILE: CalibrationProfile = {
  version: 1,
  closedThreshold: 0.50,
  openThreshold: 0.40,
  gazeUpThreshold: 0.2,
  gazeDownThreshold: -0.2,
  confidenceFloor: 0.7,
  faceSizeFloor: 0.07,
  brightnessFloor: 0.12,
  eyeVisibilityFloor: 0.5,
  maxAbsYaw: 0.45,
  maxAbsPitch: 0.35,
};

function hasFiniteFeatures(features: FaceFeatures): boolean {
  return Object.entries(features).every(([key, value]) => key === 'faceDetected' || Number.isFinite(value));
}

export function classify(features: FaceFeatures, profile: CalibrationProfile): Observation {
  if (!features.faceDetected) return 'NO_FACE';
  if (!hasFiniteFeatures(features)
    || features.confidence < profile.confidenceFloor
    || features.faceSize < profile.faceSizeFloor
    || features.brightness < profile.brightnessFloor
    || features.eyeVisibility < profile.eyeVisibilityFloor
    || Math.abs(features.headYaw) > profile.maxAbsYaw
    || Math.abs(features.headPitch) > profile.maxAbsPitch) {
    return 'UNCERTAIN';
  }

  const leftClosed = features.leftEyeClosed >= profile.closedThreshold;
  const rightClosed = features.rightEyeClosed >= profile.closedThreshold;
  const leftOpen = features.leftEyeClosed <= profile.openThreshold;
  const rightOpen = features.rightEyeClosed <= profile.openThreshold;

  if (leftClosed && rightClosed) return 'BOTH_CLOSED';

  // Wink detection: one eye closed while opposing eye open, or distinct asymmetry
  const isWinkLeft = (leftClosed && rightOpen)
    || (features.leftEyeClosed >= 0.40 && (features.leftEyeClosed - features.rightEyeClosed) >= 0.18);
  const isWinkRight = (rightClosed && leftOpen)
    || (features.rightEyeClosed >= 0.40 && (features.rightEyeClosed - features.leftEyeClosed) >= 0.18);

  if (isWinkLeft && !isWinkRight) return 'WINK_LEFT';
  if (isWinkRight && !isWinkLeft) return 'WINK_RIGHT';
  if (!leftOpen || !rightOpen) return 'UNCERTAIN';

  if (features.gazeVertical >= profile.gazeUpThreshold) return 'GAZE_UP';
  if (features.gazeVertical <= profile.gazeDownThreshold) return 'GAZE_DOWN';
  return 'NEUTRAL';
}
