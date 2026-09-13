import type { DetectionBlocker } from '../contracts/status';
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
  confidenceFloor: number;
  faceSizeFloor: number;
  brightnessFloor: number;
  eyeVisibilityFloor: number;
  maxAbsYaw: number;
  maxAbsPitch: number;
};

export type Classification = {
  observation: Observation;
  blocker: DetectionBlocker;
};

// Floors are deliberately permissive: a face filling a normal webcam frame at
// arm's length only covers ~3% of the normalised frame area, so a stricter
// faceSizeFloor silently rejects every frame and no gesture can ever fire.
export const DEFAULT_CALIBRATION_PROFILE: CalibrationProfile = {
  version: 1,
  closedThreshold: 0.50,
  openThreshold: 0.40,
  gazeUpThreshold: 0.2,
  confidenceFloor: 0.7,
  faceSizeFloor: 0.015,
  brightnessFloor: 0.04,
  eyeVisibilityFloor: 0.5,
  maxAbsYaw: 0.45,
  maxAbsPitch: 0.5,
};

function hasFiniteFeatures(features: FaceFeatures): boolean {
  return Object.entries(features).every(([key, value]) => key === 'faceDetected' || Number.isFinite(value));
}

function findBlocker(features: FaceFeatures, profile: CalibrationProfile): DetectionBlocker {
  if (!hasFiniteFeatures(features) || features.confidence < profile.confidenceFloor) return 'LOW_CONFIDENCE';
  if (features.faceSize < profile.faceSizeFloor) return 'FACE_TOO_SMALL';
  if (features.brightness < profile.brightnessFloor) return 'TOO_DARK';
  if (features.eyeVisibility < profile.eyeVisibilityFloor) return 'EYES_UNCLEAR';
  if (Math.abs(features.headYaw) > profile.maxAbsYaw) return 'HEAD_TURNED';
  if (Math.abs(features.headPitch) > profile.maxAbsPitch) return 'HEAD_TILTED';
  return 'NONE';
}

export function classifyDetailed(features: FaceFeatures, profile: CalibrationProfile): Classification {
  if (!features.faceDetected) return { observation: 'NO_FACE', blocker: 'NO_FACE' };

  const blocker = findBlocker(features, profile);
  if (blocker !== 'NONE') return { observation: 'UNCERTAIN', blocker };

  const leftClosed = features.leftEyeClosed >= profile.closedThreshold;
  const rightClosed = features.rightEyeClosed >= profile.closedThreshold;
  const leftOpen = features.leftEyeClosed <= profile.openThreshold;
  const rightOpen = features.rightEyeClosed <= profile.openThreshold;

  if (leftClosed && rightClosed) return { observation: 'BOTH_CLOSED', blocker: 'NONE' };

  // Wink detection: one eye closed while opposing eye open, or distinct asymmetry
  const isWinkLeft = (leftClosed && rightOpen)
    || (features.leftEyeClosed >= 0.40 && (features.leftEyeClosed - features.rightEyeClosed) >= 0.18);
  const isWinkRight = (rightClosed && leftOpen)
    || (features.rightEyeClosed >= 0.40 && (features.rightEyeClosed - features.leftEyeClosed) >= 0.18);

  if (isWinkLeft && !isWinkRight) return { observation: 'WINK_LEFT', blocker: 'NONE' };
  if (isWinkRight && !isWinkLeft) return { observation: 'WINK_RIGHT', blocker: 'NONE' };
  if (!leftOpen || !rightOpen) return { observation: 'UNCERTAIN', blocker: 'EYES_UNCLEAR' };

  if (features.gazeVertical >= profile.gazeUpThreshold) return { observation: 'GAZE_UP', blocker: 'NONE' };
  // Looking down is deliberately NOT a gesture: subtitles sit at the bottom of
  // the frame, so reading them would fire a command on every line.
  return { observation: 'NEUTRAL', blocker: 'NONE' };
}

export function classify(features: FaceFeatures, profile: CalibrationProfile): Observation {
  return classifyDetailed(features, profile).observation;
}
