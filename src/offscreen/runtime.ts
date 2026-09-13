import type { PreviewCandidate, PreviewDescription, RuntimeMessage } from '../contracts/messages';
import type { DetectionBlocker, MachineStateName } from '../contracts/status';
import type { Classification, FaceFeatures } from '../gesture/classifier';
import type { HandFeatures } from '../media/hand-landmarker';
import type { ExcludedRegion, MotionSampler } from '../media/frame-motion';
import type { FrameScaler } from '../media/frame-scaler';
import type { GestureEvent, Observation } from '../gesture/types';
import type { PreviewSender } from '../media/local-preview-peer';

function handReadout(hand: HandFeatures | null): string {
  if (!hand?.handDetected) return '-';
  return hand.fullyInFrame ? String(hand.fingerCount) : 'edge';
}

/**
 * Approximate face box in normalised frame coordinates, grown slightly so the
 * jitter around its edges is excluded too.
 */
function faceRegion(face: FaceFeatures): ExcludedRegion | undefined {
  if (!face.faceDetected || !Number.isFinite(face.faceSize) || face.faceSize <= 0) return undefined;
  const edge = Math.min(1, Math.sqrt(face.faceSize) * 1.6);
  const centreX = 0.5 + face.headYaw * edge;
  const centreY = 0.5 + face.headPitch * edge;
  return {
    x: Math.max(0, centreX - edge / 2),
    y: Math.max(0, centreY - edge / 2),
    width: edge,
    height: edge,
  };
}

/**
 * Frame pacing. There is no point sampling faster than the camera delivers, so
 * the active rate matches the capture rate. The idle rate is much slower, and
 * is left the moment an eyelid starts to move rather than once a gesture has
 * already been classified - so a wink is never missed by sampling late.
 */
const ACTIVE_FRAME_DELAY_MS = 66;
const IDLE_FRAME_DELAY_MS = 220;
/** Eyelid score that counts as "an eye is on the move". */
const EYE_STIRRING = 0.25;
const GAZE_STIRRING = 0.12;

export interface CameraSessionLike {
  start(deviceId?: string): Promise<MediaStream>;
  stop(): void;
}

export interface FaceLandmarkerLike {
  detect(video: HTMLVideoElement, timestampMs: number): Promise<FaceFeatures> | FaceFeatures;
  close(): void;
}

export interface HandLandmarkerLike {
  detect(source: TexImageSource, timestampMs: number): Promise<HandFeatures> | HandFeatures;
  close(): void;
}

const HAND_GESTURE_BY_COUNT = ['HAND_1', 'HAND_2', 'HAND_3', 'HAND_4', 'HAND_5'] as const;

/** Share of downscaled cells that must change before hand tracking wakes up. */
const HAND_WAKE_MOTION = 0.08;
/**
 * Once woken, hand tracking stays on long enough to read a gesture that is
 * then held perfectly still - stillness must not switch it back off mid-hold.
 */
const HAND_WAKE_WINDOW_MS = 3_000;
/**
 * Scanning for a hand is the expensive path (MediaPipe re-runs palm detection
 * every call), so it is sampled sparsely; once a hand is actually tracked the
 * rate rises enough to read a changing finger count.
 */
const HAND_SCAN_INTERVAL_MS = 300;
const HAND_TRACK_INTERVAL_MS = 120;

export interface GestureMachineLike {
  readonly stateName: MachineStateName;
  reset(): void;
  update(observation: Observation, timestampMs: number): GestureEvent[];
}

export interface OffscreenRuntimeDependencies {
  camera: CameraSessionLike;
  createPreviewSender: (stream: MediaStream) => PreviewSender;
  createFaceLandmarker: () => Promise<FaceLandmarkerLike>;
  createHandLandmarker?: (() => Promise<HandLandmarkerLike>) | undefined;
  motion?: MotionSampler | undefined;
  scaler?: FrameScaler | undefined;
  classifier: (features: FaceFeatures) => Classification;
  machine: GestureMachineLike;
  video: HTMLVideoElement;
  send: (message: RuntimeMessage) => void;
  scheduleFrame: (callback: FrameRequestCallback, delayMs: number) => number;
  cancelFrame: (handle: number) => void;
}

export class OffscreenRuntime {
  #activeTabId: number | null = null;
  #sender: PreviewSender | null = null;
  #model: FaceLandmarkerLike | null = null;
  #handModel: HandLandmarkerLike | null = null;
  #frameHandle: number | null = null;
  #isVisible = true;
  #isDetecting = false;
  #isAcceptingAnswer = false;
  #lastDiagnosticAt = 0;
  #lastDiagnosticKey = '';
  #lastObservation: Observation = 'NO_FACE';
  #lastHand: HandFeatures | null = null;
  #lastFace: FaceFeatures | null = null;
  #handAwakeUntil = 0;
  #handSampledAt: number | null = null;
  /**
   * Set once a hand command fires. A hand resting in shot keeps changing its
   * apparent finger count, which used to re-arm and fire again every couple of
   * seconds, so the hand must leave the frame before it can command anything.
   */
  #handLockedUntilAbsent = false;
  #lastProgressPercent = -1;

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
      if (this.dependencies.createHandLandmarker) {
        try {
          this.#handModel = await this.dependencies.createHandLandmarker();
        } catch (error) {
          // Hand control is additive: eye control must still work without it.
          console.warn('[EyeTube Offscreen] Hand model unavailable:', error);
          this.#handModel = null;
        }
      }
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
    // Nobody can see the tile while the tab is hidden, so the preview encode is
    // pure waste there - and it used to keep running after inference stopped.
    this.#sender?.setEnabled(isVisible);
    if (!isVisible) {
      this.#cancelInference();
    } else if (this.#model && this.#frameHandle === null) {
      this.#scheduleInference();
    }
  }

  /**
   * Hand tracking is the most expensive stage, so it only runs when something
   * moved in frame recently. A still room keeps it switched off entirely.
   */
  async #detectHand(time: number, face: FaceFeatures): Promise<HandFeatures | null> {
    if (!this.#handModel) return null;
    const surface = this.dependencies.scaler
      ? this.dependencies.scaler.surface(this.dependencies.video)
      : this.dependencies.video;
    if (!surface) return null;

    const motion = this.dependencies.motion?.sample(surface, faceRegion(face)) ?? 1;
    if (motion >= HAND_WAKE_MOTION) this.#handAwakeUntil = time + HAND_WAKE_WINDOW_MS;
    if (time >= this.#handAwakeUntil) return null;

    const interval = this.#lastHand?.handDetected ? HAND_TRACK_INTERVAL_MS : HAND_SCAN_INTERVAL_MS;
    if (this.#handSampledAt !== null && time - this.#handSampledAt < interval) return this.#lastHand;
    this.#handSampledAt = time;

    const hand = await this.#handModel.detect(surface, time);
    if (hand.handDetected) this.#handAwakeUntil = time + HAND_WAKE_WINDOW_MS;
    return hand;
  }

  /**
   * Detection telemetry is the only way a user can tell a silent classifier
   * rejection (face too small, room too dark) from a working session, so it is
   * routed to the YouTube tab rather than the offscreen console nobody opens.
   */
  #reportDiagnostic(
    tabId: number,
    observation: Observation,
    blocker: DetectionBlocker,
    features: FaceFeatures,
    time: number,
  ): void {
    const state = this.dependencies.machine.stateName;
    const key = `${observation}|${blocker}|${state}`;
    if (key === this.#lastDiagnosticKey && time - this.#lastDiagnosticAt < 1_000) return;
    this.#lastDiagnosticKey = key;
    this.#lastDiagnosticAt = time;
    this.dependencies.send({
      version: 1,
      type: 'DIAGNOSTIC',
      tabId,
      observation,
      blocker,
      state,
      metrics: `size=${features.faceSize.toFixed(3)} light=${features.brightness.toFixed(2)}`
        + ` L=${features.leftEyeClosed.toFixed(2)} R=${features.rightEyeClosed.toFixed(2)}`
        + ` gaze=${features.gazeVertical.toFixed(2)} vis=${features.eyeVisibility.toFixed(2)}`
        + ` yaw=${features.headYaw.toFixed(2)} pitch=${features.headPitch.toFixed(2)}`
        + ` fingers=${handReadout(this.#lastHand)}`
        + ` hand=${this.#handLockedUntilAbsent ? 'locked' : time < this.#handAwakeUntil ? 'scan' : 'idle'}`,
    });
  }

  /**
   * Inference is the extension's whole CPU cost, so the loop only runs fast
   * while something is actually happening: a gesture being held, or an eye
   * signal that has left neutral. A settled face is sampled at a third of that.
   */
  #inferenceDelay(): number {
    if (this.dependencies.machine.stateName === 'HOLDING') return ACTIVE_FRAME_DELAY_MS;
    if (this.#lastObservation !== 'NEUTRAL' && this.#lastObservation !== 'NO_FACE') {
      return ACTIVE_FRAME_DELAY_MS;
    }
    const face = this.#lastFace;
    if (face?.faceDetected
      && (Math.max(face.leftEyeClosed, face.rightEyeClosed) >= EYE_STIRRING
        || Math.abs(face.gazeVertical) >= GAZE_STIRRING)) {
      return ACTIVE_FRAME_DELAY_MS;
    }
    return IDLE_FRAME_DELAY_MS;
  }

  #scheduleInference(): void {
    if (!this.#isVisible || !this.#model || this.#frameHandle !== null) return;
    this.#frameHandle = this.dependencies.scheduleFrame((time) => {
      this.#frameHandle = null;
      void this.#infer(time);
    }, this.#inferenceDelay());
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
      const face = this.dependencies.classifier(features);
      const hand = this.#handModel ? await this.#detectHand(time, features) : null;
      // A raised hand is unambiguous and deliberate, so it outranks whatever the
      // eyes happen to be doing while the hand is being held up.
      if (!hand?.handDetected) this.#handLockedUntilAbsent = false;
      const handReadable = Boolean(hand?.handDetected)
        && hand!.fullyInFrame
        && !this.#handLockedUntilAbsent
        && hand!.fingerCount >= 1
        && hand!.fingerCount <= 5;
      const handGesture = handReadable ? HAND_GESTURE_BY_COUNT[hand!.fingerCount - 1]! : null;
      const observation: Observation = handGesture ?? face.observation;
      const blocker = handGesture ? 'NONE' : face.blocker;
      this.#lastObservation = observation;
      this.#lastHand = hand;
      this.#lastFace = features;
      this.#reportDiagnostic(tabId, observation, blocker, features, time);

      const events = this.dependencies.machine.update(observation, time);
      for (const event of events) {
        if (event.type === 'PROGRESS') {
          // The overlay renders whole percent, so identical frames would only
          // cost a message hop and a re-render.
          const percent = Math.round(event.progress * 100);
          if (percent === this.#lastProgressPercent) continue;
          this.#lastProgressPercent = percent;
          this.dependencies.send({
            version: 1,
            type: 'GESTURE_PROGRESS',
            tabId,
            gesture: event.gesture,
            progress: event.progress,
          });
        } else if (event.type === 'CANCELLED') {
          this.#lastProgressPercent = -1;
          this.dependencies.send({
            version: 1,
            type: 'GESTURE_CANCELLED',
            tabId,
          });
        } else if (event.type === 'COMMAND') {
          this.#lastProgressPercent = -1;
          if (event.gesture.startsWith('HAND_')) this.#handLockedUntilAbsent = true;
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
    this.#handModel?.close();
    this.#handModel = null;
    this.#sender?.close();
    this.#sender = null;
    this.dependencies.camera.stop();
    this.dependencies.video.srcObject = null;
    this.#activeTabId = null;
    this.#isAcceptingAnswer = false;
    this.#lastDiagnosticAt = 0;
    this.#lastDiagnosticKey = '';
    this.#lastObservation = 'NO_FACE';
    this.#lastHand = null;
    this.#lastFace = null;
    this.#handAwakeUntil = 0;
    this.#handSampledAt = null;
    this.#handLockedUntilAbsent = false;
    this.dependencies.motion?.reset();
    this.#lastProgressPercent = -1;
  }
}
