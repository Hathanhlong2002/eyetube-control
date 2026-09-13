import { parseRuntimeMessage, type PreviewCandidate, type RuntimeMessage } from '../contracts/messages';
import { CameraSession } from '../media/camera-session';
import { createPreviewSender, type PreviewSender } from '../media/local-preview-peer';

const camera = new CameraSession();
const cameraElement = document.querySelector<HTMLVideoElement>('#camera');
let activeTabId: number | null = null;
let sender: PreviewSender | null = null;
let isAnswerAccepted = false;
let pendingCandidates: PreviewCandidate[] = [];

function send(message: RuntimeMessage): void {
  void chrome.runtime.sendMessage(message);
}

function stop(): void {
  sender?.close();
  sender = null;
  camera.stop();
  if (cameraElement) cameraElement.srcObject = null;
  activeTabId = null;
  isAnswerAccepted = false;
  pendingCandidates = [];
}

async function start(tabId: number): Promise<void> {
  stop();
  activeTabId = tabId;
  try {
    const stream = await camera.start();
    if (cameraElement) cameraElement.srcObject = stream;
    sender = createPreviewSender(stream);
    sender.onCandidate((candidate) => send({
      version: 1,
      type: 'PREVIEW_CANDIDATE',
      tabId,
      candidate,
    }));
    const description = await sender.createOffer();
    send({ version: 1, type: 'PREVIEW_OFFER', tabId, description });
    send({ version: 1, type: 'STATUS', tabId, status: 'SEARCHING' });
  } catch (error) {
    stop();
    const reason = error instanceof DOMException && error.name === 'NotAllowedError'
      ? 'CAMERA_DENIED'
      : 'CAMERA_UNAVAILABLE';
    send({ version: 1, type: 'STATUS', tabId, status: 'ERROR', reason });
  }
}

async function acceptAnswer(message: Extract<RuntimeMessage, { type: 'PREVIEW_ANSWER' }>): Promise<void> {
  if (!sender || message.tabId !== activeTabId) return;
  await sender.acceptAnswer(message.description);
  isAnswerAccepted = true;
  for (const candidate of pendingCandidates) await sender.addRemoteCandidate(candidate);
  pendingCandidates = [];
  send({ version: 1, type: 'STATUS', tabId: message.tabId, status: 'READY' });
}

chrome.runtime.onMessage.addListener((input: unknown) => {
  const message = parseRuntimeMessage(input);
  if (!message) return;
  if (message.type === 'START_SESSION') {
    void start(message.tabId);
  } else if (message.type === 'STOP_SESSION' && message.tabId === activeTabId) {
    stop();
  } else if (message.type === 'PREVIEW_ANSWER') {
    void acceptAnswer(message);
  } else if (message.type === 'PREVIEW_CANDIDATE' && message.tabId === activeTabId && sender) {
    if (isAnswerAccepted) void sender.addRemoteCandidate(message.candidate);
    else pendingCandidates.push(message.candidate);
  }
});

