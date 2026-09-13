import { parseRuntimeMessage, type PreviewCandidate, type RuntimeMessage } from '../src/contracts/messages';
import { createPreviewReceiver, type PreviewReceiver } from '../src/media/local-preview-peer';

export default defineContentScript({
  matches: ['https://www.youtube.com/*'],
  main(ctx) {
    let activeTabId: number | null = null;
    let receiver: PreviewReceiver | null = null;
    let hasOffer = false;
    let pendingCandidates: PreviewCandidate[] = [];
    let host: HTMLElement | null = null;
    let statusElement: HTMLElement | null = null;
    let videoElement: HTMLVideoElement | null = null;

    function ensureOverlay(): void {
      if (host) return;
      host = document.createElement('div');
      host.dataset.eyetubeControl = 'preview';
      const shadow = host.attachShadow({ mode: 'closed' });
      const style = document.createElement('style');
      style.textContent = `
        :host { all: initial; }
        .tile { position: fixed; left: 16px; bottom: 16px; z-index: 2147483647; width: 240px;
          border: 2px solid #60a5fa; border-radius: 16px; overflow: hidden; background: #0f172a;
          color: #f8fafc; box-shadow: 0 12px 32px rgba(0,0,0,.45); font: 600 14px/1.4 system-ui,sans-serif; }
        video { display: block; width: 100%; aspect-ratio: 4/3; object-fit: cover; transform: scaleX(-1); background: #020617; }
        .bar { min-height: 44px; display: flex; align-items: center; gap: 8px; padding: 6px 8px 6px 12px; }
        .dot { width: 9px; height: 9px; border-radius: 50%; background: #f59e0b; }
        .ready .dot { background: #22c55e; }
        [role=status] { flex: 1; }
        button { width: 44px; height: 44px; border: 0; border-radius: 10px; color: white; background: #b91c1c;
          font: 700 18px system-ui,sans-serif; cursor: pointer; }
        button:focus-visible { outline: 3px solid white; outline-offset: 2px; }
      `;
      const tile = document.createElement('section');
      tile.className = 'tile';
      tile.setAttribute('aria-label', 'EyeTube Control camera preview');
      videoElement = document.createElement('video');
      videoElement.autoplay = true;
      videoElement.muted = true;
      videoElement.playsInline = true;
      const bar = document.createElement('div');
      bar.className = 'bar';
      const dot = document.createElement('span');
      dot.className = 'dot';
      dot.setAttribute('aria-hidden', 'true');
      statusElement = document.createElement('span');
      statusElement.setAttribute('role', 'status');
      statusElement.setAttribute('aria-live', 'polite');
      statusElement.textContent = 'Starting camera…';
      const stopButton = document.createElement('button');
      stopButton.type = 'button';
      stopButton.setAttribute('aria-label', 'Stop eye control');
      stopButton.textContent = '×';
      stopButton.addEventListener('click', () => {
        if (activeTabId !== null) void chrome.runtime.sendMessage({
          version: 1,
          type: 'STOP_SESSION',
          tabId: activeTabId,
        } satisfies RuntimeMessage);
      });
      bar.append(dot, statusElement, stopButton);
      tile.append(videoElement, bar);
      shadow.append(style, tile);
      document.documentElement.append(host);
    }

    function setStatus(text: string, isReady = false): void {
      ensureOverlay();
      if (statusElement) statusElement.textContent = text;
      const tile = statusElement?.closest('.tile');
      tile?.classList.toggle('ready', isReady);
    }

    function destroy(): void {
      receiver?.close();
      receiver = null;
      if (videoElement) {
        videoElement.pause();
        videoElement.srcObject = null;
      }
      host?.remove();
      host = null;
      statusElement = null;
      videoElement = null;
      activeTabId = null;
      hasOffer = false;
      pendingCandidates = [];
    }

    async function acceptOffer(message: Extract<RuntimeMessage, { type: 'PREVIEW_OFFER' }>): Promise<void> {
      destroy();
      activeTabId = message.tabId;
      ensureOverlay();
      receiver = createPreviewReceiver((stream) => {
        if (videoElement) videoElement.srcObject = stream;
      });
      receiver.onCandidate((candidate) => void chrome.runtime.sendMessage({
        version: 1,
        type: 'PREVIEW_CANDIDATE',
        tabId: message.tabId,
        candidate,
      } satisfies RuntimeMessage));
      const description = await receiver.acceptOfferAndCreateAnswer(message.description);
      hasOffer = true;
      for (const candidate of pendingCandidates) await receiver.addRemoteCandidate(candidate);
      pendingCandidates = [];
      await chrome.runtime.sendMessage({
        version: 1,
        type: 'PREVIEW_ANSWER',
        tabId: message.tabId,
        description,
      } satisfies RuntimeMessage);
    }

    const messageListener = (input: unknown) => {
      const message = parseRuntimeMessage(input);
      if (!message) return;
      if (message.type === 'PREVIEW_OFFER') {
        void acceptOffer(message);
      } else if (message.type === 'PREVIEW_CANDIDATE' && message.tabId === activeTabId && receiver) {
        if (hasOffer) void receiver.addRemoteCandidate(message.candidate);
        else pendingCandidates.push(message.candidate);
      } else if (message.type === 'STATUS') {
        activeTabId = message.tabId;
        if (message.status === 'READY') setStatus('Camera active · Ready', true);
        else if (message.status === 'ERROR') setStatus(`Camera error: ${message.reason ?? 'UNKNOWN'}`);
        else setStatus(message.status === 'SEARCHING' ? 'Finding your face…' : 'Starting camera…');
      } else if (message.type === 'STOP_SESSION' && message.tabId === activeTabId) {
        destroy();
      }
    };

    chrome.runtime.onMessage.addListener(messageListener);
    ctx.onInvalidated(() => {
      chrome.runtime.onMessage.removeListener(messageListener);
      destroy();
    });
  },
});

