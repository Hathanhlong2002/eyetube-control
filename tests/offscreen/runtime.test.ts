import { describe, expect, it, vi, type Mock } from 'vitest';

import type { RuntimeMessage } from '../../src/contracts/messages';
import type { FaceFeatures } from '../../src/gesture/classifier';
import type { GestureEvent, Observation } from '../../src/gesture/types';
import {
  OffscreenRuntime,
  type FaceLandmarkerLike,
  type HandLandmarkerLike,
} from '../../src/offscreen/runtime';

const neutralFeatures: FaceFeatures = {
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
};

function setup(options: {
  createModel?: () => Promise<FaceLandmarkerLike>;
  events?: Mock<(observation: Observation, timestampMs: number) => GestureEvent[]>;
} = {}) {
  const callbacks: FrameRequestCallback[] = [];
  const stream = {} as MediaStream;
  const sender = {
    createOffer: vi.fn().mockResolvedValue({ type: 'offer', sdp: 'offer-sdp' }),
    acceptAnswer: vi.fn().mockResolvedValue(undefined),
    addRemoteCandidate: vi.fn().mockResolvedValue(true),
    onCandidate: vi.fn(),
    setEnabled: vi.fn(),
    close: vi.fn(),
  };
  const model = { detect: vi.fn().mockResolvedValue(neutralFeatures), close: vi.fn() };
  const camera = { start: vi.fn().mockResolvedValue(stream), stop: vi.fn() };
  const updateFn = options.events ?? vi.fn().mockReturnValue([]);
  const machine = {
    stateName: 'READY' as const,
    reset: vi.fn(),
    update: (observation: Observation, timestampMs: number) => updateFn(observation, timestampMs),
  };
  const sent: RuntimeMessage[] = [];
  const delays: number[] = [];
  const dependencies = {
    camera,
    createPreviewSender: vi.fn().mockReturnValue(sender),
    createFaceLandmarker: vi.fn(options.createModel ?? (() => Promise.resolve(model))),
    // Assigned per test; the runtime reads it when the session connects.
    createHandLandmarker: undefined as undefined | (() => Promise<HandLandmarkerLike>),
    motion: undefined as undefined | { sample: Mock; reset: Mock },
    scaler: undefined as undefined | { surface: Mock },
    classifier: vi.fn().mockReturnValue({ observation: 'NEUTRAL', blocker: 'NONE' } as const),
    machine,
    video: { srcObject: null } as unknown as HTMLVideoElement,
    send: vi.fn((message: RuntimeMessage) => { sent.push(message); }),
    scheduleFrame: vi.fn((callback: FrameRequestCallback, delayMs: number) => {
      callbacks.push(callback);
      delays.push(delayMs);
      return callbacks.length;
    }),
    cancelFrame: vi.fn(),
  };
  return {
    runtime: new OffscreenRuntime(dependencies),
    dependencies,
    camera,
    sender,
    model,
    machine,
    callbacks,
    sent,
    delays,
    async connect() {
      await this.runtime.start({ tabId: 12 });
      await this.runtime.acceptPreviewAnswer({ type: 'answer', sdp: 'answer-sdp' });
    },
  };
}

describe('OffscreenRuntime', () => {
  it('starts camera and preview before loading the model or inference', async () => {
    const test = setup();
    await test.runtime.start({ tabId: 12 });

    expect(test.camera.start).toHaveBeenCalledOnce();
    expect(test.dependencies.createPreviewSender).toHaveBeenCalledOnce();
    expect(test.sender.createOffer).toHaveBeenCalledOnce();
    expect(test.dependencies.createFaceLandmarker).not.toHaveBeenCalled();
    expect(test.sent).toContainEqual({
      version: 1,
      type: 'PREVIEW_OFFER',
      tabId: 12,
      description: { type: 'offer', sdp: 'offer-sdp' },
    });
  });

  it('loads the model and schedules inference only after the preview answer', async () => {
    const test = setup();
    await test.connect();

    expect(test.sender.acceptAnswer).toHaveBeenCalledWith({ type: 'answer', sdp: 'answer-sdp' });
    expect(test.dependencies.createFaceLandmarker).toHaveBeenCalledOnce();
    expect(test.machine.reset).toHaveBeenCalledOnce();
    expect(test.dependencies.scheduleFrame).toHaveBeenCalledOnce();
  });

  it('pauses inference while hidden and resumes without reacquiring camera', async () => {
    const test = setup();
    await test.connect();
    test.runtime.setVisibility(false);
    expect(test.dependencies.cancelFrame).toHaveBeenCalled();
    test.runtime.setVisibility(true);
    expect(test.dependencies.scheduleFrame).toHaveBeenCalledTimes(2);
    expect(test.camera.start).toHaveBeenCalledOnce();
  });

  it('publishes only semantic cancellation and command messages', async () => {
    const events = vi.fn()
      .mockReturnValueOnce([{ type: 'CANCELLED' }])
      .mockReturnValueOnce([{
        type: 'COMMAND', gesture: 'WINK_RIGHT', command: 'NEXT_VIDEO', commandId: 'generated-id',
      }]);
    const test = setup({ events });
    test.dependencies.classifier
      .mockReturnValueOnce({ observation: 'NO_FACE', blocker: 'NO_FACE' })
      .mockReturnValueOnce({ observation: 'WINK_RIGHT', blocker: 'NONE' });
    await test.connect();

    await test.callbacks.shift()!(100);
    await test.callbacks.shift()!(200);

    expect(test.sent).toContainEqual({ version: 1, type: 'GESTURE_CANCELLED', tabId: 12 });
    expect(test.sent).toContainEqual({
      version: 1, type: 'COMMAND', tabId: 12, command: 'NEXT_VIDEO', commandId: 'generated-id',
    });
    expect(JSON.stringify(test.sent)).not.toContain('leftEyeClosed');
    expect(JSON.stringify(test.sent)).not.toContain('landmark');
  });

  it('unwinds peer and tracks when model loading fails', async () => {
    const test = setup({ createModel: () => Promise.reject(new Error('model failed')) });
    await test.runtime.start({ tabId: 12 });
    await test.runtime.acceptPreviewAnswer({ type: 'answer', sdp: 'answer-sdp' });

    expect(test.sender.close).toHaveBeenCalledOnce();
    expect(test.camera.stop).toHaveBeenCalled();
    expect(test.sent).toContainEqual({
      version: 1, type: 'STATUS', tabId: 12, status: 'ERROR', reason: 'MODEL_LOAD_FAILED',
    });
  });

  it('unwinds tracks when preview signaling fails', async () => {
    const test = setup();
    test.sender.createOffer.mockRejectedValue(new Error('offer failed'));
    await test.runtime.start({ tabId: 12 });

    expect(test.sender.close).toHaveBeenCalledOnce();
    expect(test.camera.stop).toHaveBeenCalledOnce();
    expect(test.sent).toContainEqual({
      version: 1, type: 'STATUS', tabId: 12, status: 'ERROR', reason: 'PREVIEW_FAILED',
    });
  });

  it('stop closes model, peer, frame and every camera track owner', async () => {
    const test = setup();
    await test.connect();
    test.runtime.stop();

    expect(test.dependencies.cancelFrame).toHaveBeenCalled();
    expect(test.model.close).toHaveBeenCalledOnce();
    expect(test.sender.close).toHaveBeenCalledOnce();
    expect(test.camera.stop).toHaveBeenCalled();
    expect(test.dependencies.video.srcObject).toBeNull();
  });
});

describe('OffscreenRuntime inference pacing', () => {
  it('samples slowly while the face sits neutral and speeds up on a gesture', async () => {
    const test = setup();
    await test.connect();
    // Nothing observed yet, and a settled face with open eyes, sample slowly.
    expect(test.delays.at(-1)).toBe(220);

    await test.callbacks.shift()!(100);
    expect(test.delays.at(-1)).toBe(220);

    test.dependencies.classifier.mockReturnValue({ observation: 'WINK_RIGHT', blocker: 'NONE' });
    await test.callbacks.shift()!(200);
    expect(test.delays.at(-1)).toBe(66);
  });

  it('speeds up as soon as an eyelid starts to move, before any gesture is classified', async () => {
    const test = setup();
    await test.connect();
    await test.callbacks.shift()!(100);
    expect(test.delays.at(-1)).toBe(220);

    // Still classified NEUTRAL, but an eye is already halfway shut.
    test.model.detect.mockResolvedValue({ ...neutralFeatures, leftEyeClosed: 0.3 });
    await test.callbacks.shift()!(200);
    expect(test.delays.at(-1)).toBe(66);
  });

  it('speeds up when the gaze leaves centre', async () => {
    const test = setup();
    await test.connect();
    await test.callbacks.shift()!(100);

    test.model.detect.mockResolvedValue({ ...neutralFeatures, gazeVertical: 0.15 });
    await test.callbacks.shift()!(200);
    expect(test.delays.at(-1)).toBe(66);
  });

  it('does not resend a gesture progress value the overlay already shows', async () => {
    const events = vi.fn().mockReturnValue([{ type: 'PROGRESS', gesture: 'WINK_RIGHT', progress: 0.5 }]);
    const test = setup({ events });
    test.dependencies.classifier.mockReturnValue({ observation: 'WINK_RIGHT', blocker: 'NONE' });
    await test.connect();

    await test.callbacks.shift()!(100);
    await test.callbacks.shift()!(200);
    await test.callbacks.shift()!(300);

    const progress = test.sent.filter((message) => message.type === 'GESTURE_PROGRESS');
    expect(progress).toHaveLength(1);
  });
});

describe('OffscreenRuntime hand gestures', () => {
  // Inference awaits the face model and then the hand model, so the assertions
  // have to wait for both microtask hops before the messages are out.
  const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

  function withHand(fingerCount: number) {
    const handModel = {
      detect: vi.fn().mockResolvedValue({ handDetected: fingerCount > 0, fingerCount }),
      close: vi.fn(),
    };
    const test = setup();
    test.dependencies.createHandLandmarker = vi.fn().mockResolvedValue(handModel);
    return { test, handModel };
  }

  it('lets a raised hand outrank whatever the eyes are doing', async () => {
    const { test } = withHand(3);
    test.dependencies.classifier.mockReturnValue({ observation: 'WINK_RIGHT', blocker: 'NONE' });
    await test.connect();

    await test.callbacks.shift()!(100);
    await flush();
    const diagnostic = test.sent.find((message) => message.type === 'DIAGNOSTIC');
    expect(diagnostic).toMatchObject({ observation: 'HAND_3' });
  });

  it('falls back to the eyes when no hand is in frame', async () => {
    const { test } = withHand(0);
    test.dependencies.classifier.mockReturnValue({ observation: 'WINK_RIGHT', blocker: 'NONE' });
    await test.connect();

    await test.callbacks.shift()!(100);
    await flush();
    expect(test.sent.find((message) => message.type === 'DIAGNOSTIC'))
      .toMatchObject({ observation: 'WINK_RIGHT' });
  });

  it('keeps eye control working when the hand model cannot load', async () => {
    const test = setup();
    test.dependencies.createHandLandmarker = vi.fn().mockRejectedValue(new Error('no hand model'));
    test.dependencies.classifier.mockReturnValue({ observation: 'NEUTRAL', blocker: 'NONE' });

    await test.connect();
    expect(test.sent).toContainEqual({ version: 1, type: 'STATUS', tabId: 12, status: 'READY' });
    await test.callbacks.shift()!(100);
    await flush();
    expect(test.sent.find((message) => message.type === 'DIAGNOSTIC'))
      .toMatchObject({ observation: 'NEUTRAL' });
  });
});

describe('OffscreenRuntime hand tracking cost gate', () => {
  const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

  function withMotion(motionValues: number[], fingerCount = 2) {
    const handModel = {
      detect: vi.fn().mockResolvedValue({ handDetected: fingerCount > 0, fingerCount }),
      close: vi.fn(),
    };
    const test = setup();
    let call = 0;
    test.dependencies.createHandLandmarker = vi.fn().mockResolvedValue(handModel);
    test.dependencies.motion = {
      sample: vi.fn(() => motionValues[Math.min(call++, motionValues.length - 1)] ?? 0),
      reset: vi.fn(),
    };
    return { test, handModel };
  }

  it('does not run the hand model while the frame is still', async () => {
    const { test, handModel } = withMotion([0.001, 0.001, 0.001]);
    await test.connect();

    // The first sample wakes it, so run past the wake window.
    for (const time of [100, 200, 4_000, 8_000]) {
      await test.callbacks.shift()!(time);
      await flush();
    }
    const callsAfterWindow = handModel.detect.mock.calls.filter(([, time]) => time >= 4_000);
    expect(callsAfterWindow).toHaveLength(0);
  });

  it('wakes the hand model as soon as something moves', async () => {
    const { test, handModel } = withMotion([0.001, 0.001, 0.5]);
    await test.connect();

    await test.callbacks.shift()!(100);
    await flush();
    handModel.detect.mockClear();
    await test.callbacks.shift()!(10_000);
    await flush();
    expect(handModel.detect).not.toHaveBeenCalled();

    await test.callbacks.shift()!(10_100);
    await flush();
    expect(handModel.detect).toHaveBeenCalledOnce();
  });

  it('keeps scanning while a detected hand is held perfectly still', async () => {
    const { test, handModel } = withMotion([0.5, 0, 0, 0, 0]);
    await test.connect();

    await test.callbacks.shift()!(100);
    await flush();
    expect(handModel.detect).toHaveBeenCalledOnce();

    // Motion is now zero, but a hand was seen, so tracking must stay awake.
    await test.callbacks.shift()!(900);
    await flush();
    expect(handModel.detect).toHaveBeenCalledTimes(2);
  });
});

describe('OffscreenRuntime face-aware motion gate', () => {
  const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

  it('asks the sampler to ignore the region the face occupies', async () => {
    const handModel = {
      detect: vi.fn().mockResolvedValue({ handDetected: false, fingerCount: 0 }),
      close: vi.fn(),
    };
    const surface = {} as TexImageSource;
    const test = setup();
    test.dependencies.createHandLandmarker = vi.fn().mockResolvedValue(handModel);
    test.dependencies.scaler = { surface: vi.fn(() => surface) };
    test.dependencies.motion = { sample: vi.fn(() => 1), reset: vi.fn() };
    await test.connect();

    await test.callbacks.shift()!(100);
    await flush();

    // neutralFeatures has faceSize 0.3 centred in frame.
    expect(test.dependencies.motion.sample).toHaveBeenCalledWith(surface, expect.objectContaining({
      x: expect.any(Number), y: expect.any(Number), width: expect.any(Number), height: expect.any(Number),
    }));
    const [, region] = test.dependencies.motion.sample.mock.calls[0]!;
    expect(region!.width).toBeCloseTo(Math.sqrt(0.3) * 1.6, 5);
    expect(region!.x).toBeCloseTo(0.5 - region!.width / 2, 5);
  });

  it('feeds the hand model the downscaled surface, not the full frame', async () => {
    const handModel = {
      detect: vi.fn().mockResolvedValue({ handDetected: true, fingerCount: 1 }),
      close: vi.fn(),
    };
    const surface = {} as TexImageSource;
    const test = setup();
    test.dependencies.createHandLandmarker = vi.fn().mockResolvedValue(handModel);
    test.dependencies.scaler = { surface: vi.fn(() => surface) };
    test.dependencies.motion = { sample: vi.fn(() => 1), reset: vi.fn() };
    await test.connect();

    await test.callbacks.shift()!(100);
    await flush();
    expect(handModel.detect).toHaveBeenCalledWith(surface, 100);
  });

  it('skips hand work entirely while the video has no frame to scale', async () => {
    const handModel = {
      detect: vi.fn().mockResolvedValue({ handDetected: true, fingerCount: 1 }),
      close: vi.fn(),
    };
    const test = setup();
    test.dependencies.createHandLandmarker = vi.fn().mockResolvedValue(handModel);
    test.dependencies.scaler = { surface: vi.fn(() => null) };
    test.dependencies.motion = { sample: vi.fn(() => 1), reset: vi.fn() };
    await test.connect();

    await test.callbacks.shift()!(100);
    await flush();
    expect(test.dependencies.motion.sample).not.toHaveBeenCalled();
    expect(handModel.detect).not.toHaveBeenCalled();
  });

  it('scans sparsely for a hand and tracks a found one more often', async () => {
    const handModel = {
      detect: vi.fn().mockResolvedValue({ handDetected: false, fingerCount: 0 }),
      close: vi.fn(),
    };
    const test = setup();
    test.dependencies.createHandLandmarker = vi.fn().mockResolvedValue(handModel);
    test.dependencies.scaler = { surface: vi.fn(() => ({} as TexImageSource)) };
    test.dependencies.motion = { sample: vi.fn(() => 1), reset: vi.fn() };
    await test.connect();

    await test.callbacks.shift()!(100);
    await flush();
    expect(handModel.detect).toHaveBeenCalledTimes(1);

    // 200 ms later is still inside the 300 ms scan interval.
    await test.callbacks.shift()!(300);
    await flush();
    expect(handModel.detect).toHaveBeenCalledTimes(1);

    await test.callbacks.shift()!(450);
    await flush();
    expect(handModel.detect).toHaveBeenCalledTimes(2);

    // Now a hand is present, so the shorter tracking interval applies.
    handModel.detect.mockResolvedValue({ handDetected: true, fingerCount: 2 });
    await test.callbacks.shift()!(800);
    await flush();
    await test.callbacks.shift()!(950);
    await flush();
    expect(handModel.detect).toHaveBeenCalledTimes(4);
  });
});

describe('OffscreenRuntime preview cost while hidden', () => {
  it('pauses and resumes the preview encode with tab visibility', async () => {
    const test = setup();
    await test.connect();

    test.runtime.setVisibility(false);
    expect(test.sender.setEnabled).toHaveBeenLastCalledWith(false);

    test.runtime.setVisibility(true);
    expect(test.sender.setEnabled).toHaveBeenLastCalledWith(true);
  });
});
