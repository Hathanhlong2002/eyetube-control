import { HandLandmarker, FilesetResolver, type HandLandmarkerOptions } from '@mediapipe/tasks-vision';

export type HandPoint = { x: number; y: number };

export type HandFeatures = {
  handDetected: boolean;
  /** Extended fingers, 0-5. Zero means a fist or an unreadable hand. */
  fingerCount: number;
  /**
   * False when the frame edge cuts the hand off. A hand that wandered into
   * shot accidentally is almost always clipped at an edge, while a hand held
   * up on purpose sits well inside the frame.
   */
  fullyInFrame: boolean;
};

/** How far from each edge a hand must stay to count as deliberate. */
export const FRAME_MARGIN = 0.05;

export type HandLandmarkerResultLike = {
  landmarks: HandPoint[][];
};

type LandmarkerLike = {
  detectForVideo(source: TexImageSource, timestampMs: number): HandLandmarkerResultLike;
  close(): void;
};

type AdapterOptions = Pick<HandLandmarkerOptions, 'baseOptions' | 'runningMode' | 'numHands'>;

export type HandLandmarkerDependencies = {
  getUrl(path: string): string;
  create(wasmRoot: string, options: AdapterOptions): Promise<LandmarkerLike>;
};

export interface HandLandmarkerAdapter {
  detect(source: TexImageSource, timestampMs: number): Promise<HandFeatures>;
  close(): void;
}

// MediaPipe hand landmark indices.
const WRIST = 0;
const THUMB_IP = 3;
const THUMB_TIP = 4;
const PINKY_MCP = 17;
const FINGER_PIPS = [6, 10, 14, 18] as const;
const FINGER_TIPS = [8, 12, 16, 20] as const;

const NO_HAND: HandFeatures = { handDetected: false, fingerCount: 0, fullyInFrame: false };

function distance(a: HandPoint | undefined, b: HandPoint | undefined): number {
  if (!a || !b || !Number.isFinite(a.x) || !Number.isFinite(a.y)
    || !Number.isFinite(b.x) || !Number.isFinite(b.y)) {
    return Number.NaN;
  }
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Counts extended fingers from intra-hand distances only, so the result does
 * not depend on which hand it is or how the hand is rotated: a curled finger
 * brings its tip closer to the wrist than its own middle joint, and a folded
 * thumb sits closer to the pinky knuckle than its own joint does.
 */
export function countExtendedFingers(landmarks: readonly HandPoint[]): number {
  if (landmarks.length < 21) return 0;
  const wrist = landmarks[WRIST];
  let count = 0;

  for (let index = 0; index < FINGER_TIPS.length; index += 1) {
    const tip = distance(landmarks[FINGER_TIPS[index]!], wrist);
    const pip = distance(landmarks[FINGER_PIPS[index]!], wrist);
    if (!Number.isFinite(tip) || !Number.isFinite(pip)) return 0;
    if (tip > pip) count += 1;
  }

  const pinkyKnuckle = landmarks[PINKY_MCP];
  const thumbTip = distance(landmarks[THUMB_TIP], pinkyKnuckle);
  const thumbJoint = distance(landmarks[THUMB_IP], pinkyKnuckle);
  if (!Number.isFinite(thumbTip) || !Number.isFinite(thumbJoint)) return count;
  if (thumbTip > thumbJoint) count += 1;

  return count;
}

export function isFullyInFrame(landmarks: readonly HandPoint[], margin = FRAME_MARGIN): boolean {
  if (landmarks.length < 21) return false;
  return landmarks.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)
    && point.x >= margin && point.x <= 1 - margin
    && point.y >= margin && point.y <= 1 - margin);
}

export function extractHandFeatures(result: HandLandmarkerResultLike): HandFeatures {
  const landmarks = result.landmarks?.[0];
  if (!landmarks?.length) return NO_HAND;
  return {
    handDetected: true,
    fingerCount: countExtendedFingers(landmarks),
    fullyInFrame: isFullyInFrame(landmarks),
  };
}

const DEFAULT_DEPENDENCIES: HandLandmarkerDependencies = {
  getUrl: (path) => chrome.runtime.getURL(path),
  create: async (wasmRoot, options) => {
    const wasm = await FilesetResolver.forVisionTasks(wasmRoot);
    return HandLandmarker.createFromOptions(wasm, options);
  },
};

class LocalHandLandmarkerAdapter implements HandLandmarkerAdapter {
  #lastTimestamp: number | null = null;
  #lastFeatures: HandFeatures = NO_HAND;
  #closed = false;

  constructor(private readonly landmarker: LandmarkerLike) {}

  async detect(source: TexImageSource, timestampMs: number): Promise<HandFeatures> {
    if (this.#closed) throw new Error('Hand landmarker is closed');
    if (!Number.isFinite(timestampMs)) return this.#lastFeatures;
    // MediaPipe requires strictly increasing timestamps per graph.
    if (this.#lastTimestamp !== null && timestampMs <= this.#lastTimestamp) return this.#lastFeatures;
    this.#lastTimestamp = timestampMs;
    try {
      this.#lastFeatures = extractHandFeatures(this.landmarker.detectForVideo(source, timestampMs));
    } catch (error) {
      console.warn('[EyeTube] MediaPipe hand frame skipped safely:', error);
      this.#lastFeatures = NO_HAND;
    }
    return this.#lastFeatures;
  }

  close(): void {
    if (this.#closed) return;
    this.#closed = true;
    this.landmarker.close();
    this.#lastFeatures = NO_HAND;
  }
}

export async function createHandLandmarkerAdapter(
  dependencies: Partial<HandLandmarkerDependencies> = {},
): Promise<HandLandmarkerAdapter> {
  const resolved = { ...DEFAULT_DEPENDENCIES, ...dependencies };
  const modelAssetPath = resolved.getUrl('models/hand_landmarker.task');
  console.log('[EyeTube AI] ⏳ Bắt đầu tải mô hình MediaPipe HandLandmarker từ:', modelAssetPath);
  const startedAt = performance.now();
  const landmarker = await resolved.create(resolved.getUrl('wasm'), {
    baseOptions: { modelAssetPath, delegate: 'CPU' },
    runningMode: 'VIDEO',
    numHands: 1,
  });
  console.log(`[EyeTube AI] ✅ Tải mô hình HandLandmarker thành công trong ${(performance.now() - startedAt).toFixed(0)}ms`);
  return new LocalHandLandmarkerAdapter(landmarker);
}
