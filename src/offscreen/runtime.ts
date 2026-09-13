import type { PreviewCandidate, PreviewDescription, RuntimeMessage } from '../contracts/messages';
import type { FaceFeatures } from '../gesture/classifier';
import type { GestureEvent, Observation } from '../gesture/types';
import type { PreviewSender } from '../media/local-preview-peer';

export interface CameraSessionLike {
  start(deviceId?: string): Promise<MediaStream>;
  stop(): void;
}

export interface FaceLandmarkerLike {
  detect(video: HTMLVideoElement, timestampMs: number): Promise<FaceFeatures> | FaceFeatures;
  close(): void;
}

export interface GestureMachineLike {
  reset(): void;
  update(observation: Observation, timestampMs: number): GestureEvent[];
}

export interface OffscreenRuntimeDependencies {
  camera: CameraSessionLike;
  createPreviewSender: (stream: MediaStream) => PreviewSender;
  createFaceLandmarker: () => Promise<FaceLandmarkerLike>;
  classifier: (features: FaceFeatures) => Observation;
  machine: GestureMachineLike;
  video: HTMLVideoElement;
  send: (message: RuntimeMessage) => void;
  scheduleFrame: (callback: FrameRequestCallback) => number;
  cancelFrame: (handle: number) => void;
}

export class OffscreenRuntime {
  #activeTabId: number | null = null;
  #sender: PreviewSender | null = null;
  #model: FaceLandmarkerLike | null = null;
  #frameHandle: number | null = null;
  #isVisible = true;
  #isDetecting = false;
  #isAcceptingAnswer = false;

  constructor(private readonly dependencies: OffscreenRuntimeDependencies) {}

  get activeTabId(): number | null {
    return this.#activeTabId;
  }

  async start(config: { tabId: number; deviceId?: string }): Promise<void> {
    if (this.#activeTabId !== null || this.#sender !== null) {
      this.stop();
    }
    this.#activeTabId = config.tabId;
    try {
      const stream = await this.dependencies.camera.start(config.deviceId);
      this.dependencies.video.srcObject = stream;
      void this.dependencies.video.play?.().catch?.(() => {});
      this.#sender = this.dependencies.createPreviewSender(stream);
      this.#sender.onCandidate((candidate) => {
        if (this.#activeTabId !== null) {
          this.dependencies.send({
            version: 1,
            type: 'PREVIEW_CANDIDATE',
            tabId: this.#activeTabId,
            candidate,
          });
        }
      });
      const description = await this.#sender.createOffer();
      this.dependencies.send({
        version: 1,
        type: 'PREVIEW_OFFER',
        tabId: config.tabId,
        description,
      });
    } catch (error) {
      this.stop();
      const isDenied = (error as Error)?.name === 'NotAllowedError'
        || (error as Error)?.name === 'PermissionDeniedError';
      this.dependencies.send({
        version: 1,
        type: 'STATUS',
        tabId: config.tabId,
        status: 'ERROR',
        reason: isDenied ? 'CAMERA_DENIED' : 'PREVIEW_FAILED',
      });
    }
  }

  async acceptPreviewAnswer(description: PreviewDescription): Promise<void> {
    if (!this.#sender || this.#activeTabId === null || this.#model !== null || this.#isAcceptingAnswer) return;
    this.#isAcceptingAnswer = true;
    const tabId = this.#activeTabId;
    try {
      await this.#sender.acceptAnswer(description);
      this.#model = await this.dependencies.createFaceLandmarker();
      this.dependencies.machine.reset();
      this.dependencies.send({
        version: 1,
        type: 'STATUS',
        tabId,
        status: 'READY',
      });
      this.#scheduleInference();
    } catch (error) {
      console.error('[EyeTube Offscreen] Error in acceptPreviewAnswer:', error);
      this.stop();
      this.dependencies.send({
        version: 1,
        type: 'STATUS',
        tabId,
        status: 'ERROR',
        reason: 'MODEL_LOAD_FAILED',
      });
    } finally {
      this.#isAcceptingAnswer = false;
    }
  }

  async addRemoteCandidate(candidate: PreviewCandidate): Promise<boolean> {
    if (!this.#sender) return false;
    return this.#sender.addRemoteCandidate(candidate);
  }

  setVisibility(isVisible: boolean): void {
    this.#isVisible = isVisible;
    if (!isVisible) {
      this.#cancelInference();
    } else if (this.#model && this.#frameHandle === null) {
      this.#scheduleInference();
    }
  }

  #scheduleInference(): void {
    if (!this.#isVisible || !this.#model || this.#frameHandle !== null) return;
    this.#frameHandle = this.dependencies.scheduleFrame((time) => {
      this.#frameHandle = null;
      void this.#infer(time);
    });
  }

  #cancelInference(): void {
    if (this.#frameHandle !== null) {
      this.dependencies.cancelFrame(this.#frameHandle);
      this.#frameHandle = null;
    }
  }

  async #infer(time: DOMHighResTimeStamp): Promise<void> {
    if (!this.#isVisible || !this.#model || this.#activeTabId === null || this.#isDetecting) return;
    const tabId = this.#activeTabId;
    this.#isDetecting = true;
    try {
      const features = await this.#model.detect(this.dependencies.video, time);
      const observation = this.dependencies.classifier(features);
      const events = this.dependencies.machine.update(observation, time);
      for (const event of events) {
        if (event.type === 'PROGRESS') {
          this.dependencies.send({
            version: 1,
            type: 'GESTURE_PROGRESS',
            tabId,
            gesture: event.gesture,
            progress: event.progress,
          });
        } else if (event.type === 'CANCELLED') {
          this.dependencies.send({
            version: 1,
            type: 'GESTURE_CANCELLED',
            tabId,
          });
        } else if (event.type === 'COMMAND') {
          this.dependencies.send({
            version: 1,
            type: 'COMMAND',
            tabId,
            command: event.command,
            commandId: event.commandId,
          });
        }
      }
    } finally {
      this.#isDetecting = false;
      if (this.#isVisible && this.#model && this.#activeTabId !== null) {
        this.#scheduleInference();
      }
    }
  }

  stop(): void {
    this.#cancelInference();
    this.#model?.close();
    this.#model = null;
    this.#sender?.close();
    this.#sender = null;
    this.dependencies.camera.stop();
    this.dependencies.video.srcObject = null;
    this.#activeTabId = null;
    this.#isAcceptingAnswer = false;
  }
}
