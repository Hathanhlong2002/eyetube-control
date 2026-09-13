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
        baseOptions: {
          modelAssetPath: 'chrome-extension://id/models/face_landmarker.task',
          delegate: 'CPU',
        },
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

describe('eye visibility reported by the Face Landmarker model', () => {
  function withVisibility(visibility?: number): FaceLandmarkerResultLike {
    const base = result();
    return {
      ...base,
      faceLandmarks: [base.faceLandmarks[0]!.map(({ x, y }) => (
        visibility === undefined ? { x, y, z: 0 } : { x, y, z: 0, visibility }
      ))],
    };
  }

  async function detectWith(model: FaceLandmarkerResultLike) {
    const adapter = await createFaceLandmarkerAdapter({
      getUrl: (path) => path,
      create: async () => ({ detectForVideo: () => model, close: vi.fn() }),
      readBrightness: () => 0.6,
      now: () => 0,
    });
    const video = { readyState: 4, videoWidth: 640, videoHeight: 480 } as HTMLVideoElement;
    return adapter.detect(video, 1);
  }

  // The model leaves visibility at 0 on every landmark; averaging those zeros in
  // used to drive eyeVisibility to 0 and reject every real face as EYES_UNCLEAR.
  it('treats an all-zero visibility field as "not reported"', async () => {
    expect((await detectWith(withVisibility(0))).eyeVisibility).toBe(1);
  });

  it('treats a missing visibility field as "not reported"', async () => {
    expect((await detectWith(withVisibility())).eyeVisibility).toBe(1);
  });

  it('still averages a genuine visibility signal', async () => {
    expect((await detectWith(withVisibility(0.4))).eyeVisibility).toBeCloseTo(0.4, 5);
  });
});

describe('brightness sampling cadence', () => {
  it('reads brightness on its own slow cadence, not once per inference', async () => {
    const readBrightness = vi.fn().mockReturnValue(0.6);
    let clock = 0;
    const adapter = await createFaceLandmarkerAdapter({
      getUrl: (path) => path,
      create: async () => ({ detectForVideo: () => result(), close: vi.fn() }),
      readBrightness,
      now: () => clock,
    });
    const video = { readyState: 4, videoWidth: 640, videoHeight: 480 } as HTMLVideoElement;

    // Six inferences spread across 400 ms stay inside one brightness window.
    for (let index = 1; index <= 6; index += 1) {
      clock = index * 80;
      await adapter.detect(video, index * 80);
    }
    expect(readBrightness).toHaveBeenCalledTimes(1);

    clock = 900;
    await adapter.detect(video, 900);
    expect(readBrightness).toHaveBeenCalledTimes(2);
  });
});
