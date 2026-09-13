import { parseRuntimeMessage, type RuntimeMessage } from '../contracts/messages';
import { classifyDetailed, DEFAULT_CALIBRATION_PROFILE } from '../gesture/classifier';
import { DEFAULT_MACHINE_SETTINGS, GestureMachine } from '../gesture/machine';
import { CameraSession } from '../media/camera-session';
import { createFaceLandmarkerAdapter } from '../media/face-landmarker';
import { createPreviewSender } from '../media/local-preview-peer';
import { OffscreenRuntime } from './runtime';

const cameraElement = document.querySelector<HTMLVideoElement>('#camera');
if (!cameraElement) {
  throw new Error('Camera preview element missing');
}

// Offscreen documents may only use chrome.runtime, so the service worker reads
// chrome.storage on our behalf and pushes settings in as SETTINGS messages.
const machine = new GestureMachine(DEFAULT_MACHINE_SETTINGS);

const runtime = new OffscreenRuntime({
  camera: new CameraSession(),
  createPreviewSender,
  createFaceLandmarker: () => createFaceLandmarkerAdapter(),
  classifier: (features) => classifyDetailed(features, DEFAULT_CALIBRATION_PROFILE),
  machine,
  video: cameraElement,
  send: (message: RuntimeMessage) => {
    try {
      void chrome.runtime.sendMessage(message).catch(() => {});
    } catch {
      // Extension context might be invalidated during reload
    }
  },
  scheduleFrame: (callback: FrameRequestCallback, delayMs: number) => {
    // requestAnimationFrame is heavily throttled or frozen in Chrome Offscreen
    // Documents, so the loop is driven by setTimeout at the rate the runtime asks for.
    return setTimeout(() => callback(performance.now()), delayMs) as unknown as number;
  },
  cancelFrame: (handle: number) => clearTimeout(handle),
});

chrome.runtime.onMessage.addListener((input: unknown, _sender, sendResponse) => {
  if (typeof input === 'object' && input !== null && (input as Record<string, unknown>).type === 'OFFSCREEN_PING') {
    sendResponse({ type: 'OFFSCREEN_PONG' });
    return true;
  }
  const message = parseRuntimeMessage(input);
  if (!message) return;

  if (message.type === 'START_SESSION') {
    void runtime.start({ tabId: message.tabId });
  } else if (message.type === 'STOP_SESSION' && message.tabId === runtime.activeTabId) {
    runtime.stop();
  } else if (message.type === 'PREVIEW_ANSWER' && message.tabId === runtime.activeTabId) {
    void runtime.acceptPreviewAnswer(message.description);
  } else if (message.type === 'PREVIEW_CANDIDATE' && message.tabId === runtime.activeTabId) {
    void runtime.addRemoteCandidate(message.candidate);
  } else if (message.type === 'SESSION_VISIBILITY' && message.tabId === runtime.activeTabId) {
    runtime.setVisibility(message.visible);
  } else if (message.type === 'SETTINGS') {
    machine.configure({
      navigationHoldMs: message.navigationHoldMs,
      playPauseHoldMs: message.playPauseHoldMs,
      accountHoldMs: message.accountHoldMs,
      cooldownMs: message.cooldownMs,
      enabledGestures: message.enabledGestures,
    });
  }
});
