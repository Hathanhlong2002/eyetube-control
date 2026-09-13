import { describe, expect, it, vi, type Mock } from 'vitest';

import type { RuntimeMessage } from '../../src/contracts/messages';
import type { FaceFeatures } from '../../src/gesture/classifier';
import type { GestureEvent, Observation } from '../../src/gesture/types';
import { OffscreenRuntime, type FaceLandmarkerLike } from '../../src/offscreen/runtime';

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
    // Nothing observed yet, and a settled face, both sample slowly.
    expect(test.delays.at(-1)).toBe(140);

    await test.callbacks.shift()!(100);
    expect(test.delays.at(-1)).toBe(140);

    test.dependencies.classifier.mockReturnValue({ observation: 'WINK_RIGHT', blocker: 'NONE' });
    await test.callbacks.shift()!(200);
    expect(test.delays.at(-1)).toBe(50);
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
