import {
  FaceLandmarker,
  FilesetResolver,
  type FaceLandmarkerOptions,
} from '@mediapipe/tasks-vision';

import type { FaceFeatures } from '../gesture/classifier';

export const INFERENCE_INTERVAL_MS = 1000 / 15;
export const MIN_INFERENCE_FPS = 10;

type LandmarkLike = {
  x: number;
  y: number;
  z?: number;
  visibility?: number;
};

type CategoryLike = {
  categoryName: string;
  score: number;
};

export type FaceLandmarkerResultLike = {
  faceLandmarks: LandmarkLike[][];
  faceBlendshapes: Array<{ categories: CategoryLike[] }>;
};

type LandmarkerLike = {
  detectForVideo(video: HTMLVideoElement, timestampMs: number): FaceLandmarkerResultLike;
  close(): void;
};

type AdapterOptions = Pick<FaceLandmarkerOptions,
  'baseOptions' | 'runningMode' | 'numFaces' | 'outputFaceBlendshapes'>;

export type FaceLandmarkerDependencies = {
  getUrl(path: string): string;
  create(wasmRoot: string, options: AdapterOptions): Promise<LandmarkerLike>;
  readBrightness(video: HTMLVideoElement): number;
  now(): number;
};

export interface FaceLandmarkerAdapter {
  detect(video: HTMLVideoElement, timestampMs: number): Promise<FaceFeatures>;
  close(): void;
}

function score(categories: CategoryLike[], name: string): number {
  return categories.find((category) => category.categoryName === name)?.score ?? 0;
}

function mean(values: number[]): number {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
}

function absentFace(brightness: number): FaceFeatures {
  return {
    faceDetected: false,
    confidence: 0,
    faceSize: 0,
    brightness,
    headYaw: 0,
    headPitch: 0,
    leftEyeClosed: 0,
    rightEyeClosed: 0,
    eyeVisibility: 0,
    gazeVertical: 0,
  };
}

function extractFeatures(result: FaceLandmarkerResultLike, brightness: number): FaceFeatures {
  const landmarks = result.faceLandmarks[0];
  const categories = result.faceBlendshapes[0]?.categories;
  if (!landmarks?.length || !categories?.length) return absentFace(brightness);

  const x = landmarks.map((point) => point.x).filter(Number.isFinite);
  const y = landmarks.map((point) => point.y).filter(Number.isFinite);
  if (x.length === 0 || y.length === 0) return absentFace(brightness);
  const minX = Math.min(...x);
  const maxX = Math.max(...x);
  const minY = Math.min(...y);
  const maxY = Math.max(...y);
  const width = Math.max(0.001, maxX - minX);
  const height = Math.max(0.001, maxY - minY);
  const nose = landmarks[1];
  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;
  const visibility = landmarks
    .map((point) => point.visibility)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const lookUp = mean([score(categories, 'eyeLookUpLeft'), score(categories, 'eyeLookUpRight')]);
  const lookDown = mean([score(categories, 'eyeLookDownLeft'), score(categories, 'eyeLookDownRight')]);

  return {
    faceDetected: true,
    confidence: 1,
    faceSize: Math.min(1, width * height),
    brightness: Math.min(1, Math.max(0, brightness)),
    headYaw: nose ? (nose.x - centerX) / width : 0,
    headPitch: nose ? (nose.y - centerY) / height : 0,
    leftEyeClosed: score(categories, 'eyeBlinkLeft'),
    rightEyeClosed: score(categories, 'eyeBlinkRight'),
    eyeVisibility: visibility.length > 0 ? mean(visibility) : 1,
    gazeVertical: lookUp - lookDown,
  };
}

function readBrightness(video: HTMLVideoElement): number {
  const canvas = new OffscreenCanvas(16, 12);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) return 0;
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let luminance = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    luminance += 0.2126 * (pixels[index] ?? 0)
      + 0.7152 * (pixels[index + 1] ?? 0)
      + 0.0722 * (pixels[index + 2] ?? 0);
  }
  return luminance / (pixels.length / 4) / 255;
}

const DEFAULT_DEPENDENCIES: FaceLandmarkerDependencies = {
  getUrl: (path) => chrome.runtime.getURL(path),
  create: async (wasmRoot, options) => {
    const wasm = await FilesetResolver.forVisionTasks(wasmRoot);
    return FaceLandmarker.createFromOptions(wasm, options);
  },
  readBrightness,
  now: () => performance.now(),
};

class LocalFaceLandmarkerAdapter implements FaceLandmarkerAdapter {
  #lastTimestamp: number | null = null;
  #lastProcessedAt: number | null = null;
  #lastFeatures: FaceFeatures | null = null;
  #intervalMs = INFERENCE_INTERVAL_MS;
  #overruns = 0;
  #closed = false;
  #inFlight: Promise<FaceFeatures> | null = null;

  constructor(
    private readonly landmarker: LandmarkerLike,
    private readonly dependencies: Pick<FaceLandmarkerDependencies, 'readBrightness' | 'now'>,
  ) {}

  async detect(video: HTMLVideoElement, timestampMs: number): Promise<FaceFeatures> {
    if (this.#closed) throw new Error('Face landmarker is closed');
    if (!Number.isFinite(timestampMs)
      || (this.#lastTimestamp !== null && timestampMs <= this.#lastTimestamp)) {
      throw new RangeError('Face detection timestamps must be monotonically increasing');
    }
    this.#lastTimestamp = timestampMs;

    if (this.#inFlight) return this.#lastFeatures ?? absentFace(0);
    if (this.#lastProcessedAt !== null && timestampMs - this.#lastProcessedAt < this.#intervalMs) {
      return this.#lastFeatures ?? absentFace(0);
    }

    const task = Promise.resolve().then(() => {
      const startedAt = this.dependencies.now();
      const result = this.landmarker.detectForVideo(video, timestampMs);
      const features = extractFeatures(result, this.dependencies.readBrightness(video));
      const duration = this.dependencies.now() - startedAt;
      this.#overruns = duration > this.#intervalMs ? this.#overruns + 1 : 0;
      if (this.#overruns >= 3) this.#intervalMs = 1000 / MIN_INFERENCE_FPS;
      this.#lastProcessedAt = timestampMs;
      this.#lastFeatures = features;
      return features;
    });
    this.#inFlight = task;
    try {
      return await task;
    } finally {
      this.#inFlight = null;
    }
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.landmarker.close();
    this.#lastFeatures = null;
  }
}

export async function createFaceLandmarkerAdapter(
  dependencies: Partial<FaceLandmarkerDependencies> = {},
): Promise<FaceLandmarkerAdapter> {
  const resolved = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  const wasmRoot = resolved.getUrl('wasm');
  const modelAssetPath = resolved.getUrl('models/face_landmarker.task');
  const landmarker = await resolved.create(wasmRoot, {
    baseOptions: {
      modelAssetPath,
      delegate: 'CPU',
    },
    runningMode: 'VIDEO',
    numFaces: 1,
    outputFaceBlendshapes: true,
  });
  return new LocalFaceLandmarkerAdapter(landmarker, resolved);
}
