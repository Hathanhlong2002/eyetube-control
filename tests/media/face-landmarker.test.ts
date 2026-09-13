import { describe, expect, it, vi } from 'vitest';

import {
  createFaceLandmarkerAdapter,
  INFERENCE_INTERVAL_MS,
  MIN_INFERENCE_FPS,
  type FaceLandmarkerResultLike,
} from '../../src/media/face-landmarker';

function result(): FaceLandmarkerResultLike {
  const landmarks = Array.from({ length: 478 }, (_, index) => ({
    x: index === 1 ? 0.53 : 0.2 + (index % 20) * 0.03,
    y: index === 1 ? 0.48 : 0.2 + (index % 15) * 0.04,
    z: 0,
    visibility: 0.95,
  }));
  return {
    faceLandmarks: [landmarks],
    faceBlendshapes: [{
      categories: [
        { categoryName: 'eyeBlinkLeft', score: 0.81 },
        { categoryName: 'eyeBlinkRight', score: 0.12 },
        { categoryName: 'eyeLookUpLeft', score: 0.3 },
        { categoryName: 'eyeLookUpRight', score: 0.28 },
        { categoryName: 'eyeLookDownLeft', score: 0.02 },
        { categoryName: 'eyeLookDownRight', score: 0.01 },
      ],
    }],
  };
}

function setup(detection: FaceLandmarkerResultLike = result()) {
  const landmarker = {
    detectForVideo: vi.fn().mockReturnValue(detection),
    close: vi.fn(),
  };
  const create = vi.fn().mockResolvedValue(landmarker);
  const getUrl = vi.fn((path: string) => `chrome-extension://id/${path}`);
  return { landmarker, create, getUrl };
}

describe('FaceLandmarkerAdapter', () => {
  it('loads bundled WASM/model URLs with one-face video options', async () => {
    const deps = setup();
    await createFaceLandmarkerAdapter({ ...deps, readBrightness: () => 0.72 });

    expect(deps.getUrl).toHaveBeenCalledWith('wasm');
    expect(deps.getUrl).toHaveBeenCalledWith('models/face_landmarker.task');
    expect(deps.create).toHaveBeenCalledWith(
      'chrome-extension://id/wasm',
      expect.objectContaining({
        baseOptions: { modelAssetPath: 'chrome-extension://id/models/face_landmarker.task' },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
      }),
    );
  });

  it('converts a result to minimal numeric features without exposing landmarks', async () => {
    const deps = setup();
    const adapter = await createFaceLandmarkerAdapter({ ...deps, readBrightness: () => 0.72 });

    const features = await adapter.detect({} as HTMLVideoElement, 100);

    expect(features).toEqual(expect.objectContaining({
      faceDetected: true,
      brightness: 0.72,
      leftEyeClosed: 0.81,
      rightEyeClosed: 0.12,
      gazeVertical: expect.any(Number),
      faceSize: expect.any(Number),
    }));
    expect(Object.keys(features).sort()).toEqual([
      'brightness', 'confidence', 'eyeVisibility', 'faceDetected', 'faceSize',
      'gazeVertical', 'headPitch', 'headYaw', 'leftEyeClosed', 'rightEyeClosed',
    ].sort());
    expect(JSON.stringify(features)).not.toContain('landmark');
  });

  it('returns NO_FACE-compatible features when MediaPipe finds no face', async () => {
    const deps = setup({ faceLandmarks: [], faceBlendshapes: [] });
    const adapter = await createFaceLandmarkerAdapter({ ...deps, readBrightness: () => 0.8 });

    await expect(adapter.detect({} as HTMLVideoElement, 100)).resolves.toEqual(expect.objectContaining({
      faceDetected: false,
    }));
  });

  it('rejects non-monotonic timestamps and throttles frames above 15 FPS', async () => {
    const deps = setup();
    const adapter = await createFaceLandmarkerAdapter({ ...deps, readBrightness: () => 0.8 });
    const video = {} as HTMLVideoElement;

    await adapter.detect(video, 100);
    await adapter.detect(video, 120);
    await adapter.detect(video, 200);

    expect(deps.landmarker.detectForVideo).toHaveBeenCalledTimes(2);
    await expect(adapter.detect(video, 199)).rejects.toThrow('monotonically increasing');
  });

  it('closes the local landmarker', async () => {
    const deps = setup();
    const adapter = await createFaceLandmarkerAdapter({ ...deps, readBrightness: () => 0.8 });
    adapter.close();
    expect(deps.landmarker.close).toHaveBeenCalledOnce();
  });

  it('defines the 10–15 FPS inference budget', () => {
    expect(INFERENCE_INTERVAL_MS).toBeCloseTo(1000 / 15);
    expect(MIN_INFERENCE_FPS).toBe(10);
  });
});
