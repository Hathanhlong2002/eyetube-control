import { parseRuntimeMessage, type RuntimeMessage } from '../contracts/messages';
import { classify, DEFAULT_CALIBRATION_PROFILE } from '../gesture/classifier';
import { DEFAULT_MACHINE_SETTINGS, GestureMachine } from '../gesture/machine';
import { CameraSession } from '../media/camera-session';
import { createFaceLandmarkerAdapter } from '../media/face-landmarker';
import { createPreviewSender } from '../media/local-preview-peer';
import { OffscreenRuntime } from './runtime';

const cameraElement = document.querySelector<HTMLVideoElement>('#camera');
if (!cameraElement) {
  throw new Error('Camera preview element missing');
}

const runtime = new OffscreenRuntime({
  camera: new CameraSession(),
  createPreviewSender,
  createFaceLandmarker: () => createFaceLandmarkerAdapter(),
  classifier: (features) => classify(features, DEFAULT_CALIBRATION_PROFILE),
  machine: new GestureMachine(DEFAULT_MACHINE_SETTINGS),
  video: cameraElement,
  send: (message: RuntimeMessage) => {
    void chrome.runtime.sendMessage(message);
  },
  scheduleFrame: (callback: FrameRequestCallback) => requestAnimationFrame(callback),
  cancelFrame: (handle: number) => cancelAnimationFrame(handle),
});

chrome.runtime.onMessage.addListener((input: unknown) => {
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
  }
});
