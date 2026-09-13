import type { CalibrationProfile, FaceFeatures } from './classifier';

export type CalibrationSamples = {
  neutral: FaceFeatures[];
  winkLeft: FaceFeatures[];
  winkRight: FaceFeatures[];
  bothClosed: FaceFeatures[];
  gazeUp: FaceFeatures[];
};

export type CalibrationFailure = 'LOW_LIGHT' | 'FACE_TOO_SMALL' | 'UNSTABLE' | 'INDISTINGUISHABLE';
export type CalibrationResult =
  | { status: 'SUCCESS'; profile: CalibrationProfile }
  | { status: 'FAILED'; reason: CalibrationFailure };

const STAGES: ReadonlyArray<keyof CalibrationSamples> = [
  'neutral', 'winkLeft', 'winkRight', 'bothClosed', 'gazeUp',
];

function mean(values: number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function spread(values: number[]): number {
  return Math.max(...values) - Math.min(...values);
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function deriveCalibration(samples: CalibrationSamples): CalibrationResult {
  if (STAGES.some((stage) => samples[stage].length === 0)) {
    return { status: 'FAILED', reason: 'UNSTABLE' };
  }
  const all = STAGES.flatMap((stage) => samples[stage]);
  if (all.some((item) => item.brightness < 0.2)) return { status: 'FAILED', reason: 'LOW_LIGHT' };
  if (all.some((item) => item.faceSize < 0.02)) return { status: 'FAILED', reason: 'FACE_TOO_SMALL' };
  if (all.some((item) => !item.faceDetected
    || !Object.values(item).every((value) => typeof value === 'boolean' || Number.isFinite(value))
    || item.confidence < 0.7
    || Math.abs(item.headYaw) > 0.45
    || Math.abs(item.headPitch) > 0.5)
    || spread(samples.neutral.map((item) => item.gazeVertical)) > 0.15
    || spread(samples.neutral.map((item) => item.leftEyeClosed)) > 0.2
    || spread(samples.neutral.map((item) => item.rightEyeClosed)) > 0.2) {
    return { status: 'FAILED', reason: 'UNSTABLE' };
  }

  const neutralLeft = mean(samples.neutral.map((item) => item.leftEyeClosed));
  const neutralRight = mean(samples.neutral.map((item) => item.rightEyeClosed));
  const neutralGaze = mean(samples.neutral.map((item) => item.gazeVertical));
  const winkLeft = mean(samples.winkLeft.map((item) => item.leftEyeClosed));
  const winkRight = mean(samples.winkRight.map((item) => item.rightEyeClosed));
  const bothClosed = mean(samples.bothClosed.flatMap((item) => [item.leftEyeClosed, item.rightEyeClosed]));
  const gazeUp = mean(samples.gazeUp.map((item) => item.gazeVertical));

  if (winkLeft - neutralLeft < 0.35
    || winkRight - neutralRight < 0.35
    || bothClosed - Math.max(neutralLeft, neutralRight) < 0.35
    || gazeUp - neutralGaze < 0.12) {
    return { status: 'FAILED', reason: 'INDISTINGUISHABLE' };
  }

  const closedSignal = Math.min(winkLeft, winkRight, bothClosed);
  const neutralClosed = Math.max(neutralLeft, neutralRight);
  return {
    status: 'SUCCESS',
    profile: {
      version: 1,
      closedThreshold: clamp((neutralClosed + closedSignal) / 2, 0.45, 0.8),
      openThreshold: clamp(neutralClosed + 0.12, 0.15, 0.35),
      gazeUpThreshold: clamp((neutralGaze + gazeUp) / 2, 0.1, 0.3),
      confidenceFloor: clamp(Math.min(...all.map((item) => item.confidence)) - 0.05, 0.65, 0.85),
      faceSizeFloor: clamp(Math.min(...all.map((item) => item.faceSize)) * 0.65, 0.015, 0.05),
      brightnessFloor: clamp(Math.min(...all.map((item) => item.brightness)) - 0.1, 0.04, 0.2),
      // The Face Landmarker model does not report visibility, so this gate stays open.
      eyeVisibilityFloor: 0,
      maxAbsYaw: 0.45,
      maxAbsPitch: 0.5,
    },
  };
}
