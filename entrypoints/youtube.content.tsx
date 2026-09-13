import { parseRuntimeMessage, type PreviewCandidate, type RuntimeMessage } from '../src/contracts/messages';
import { createPreviewReceiver, type PreviewReceiver } from '../src/media/local-preview-peer';
import { mountOverlay, type OverlayHandle } from '../src/overlay/App';
import { clampTileGeometry, type TileGeometry } from '../src/overlay/geometry';
import { createYouTubeController } from '../src/youtube/controller';
import { observeYouTubeNavigation } from '../src/youtube/lifecycle';

const GEOMETRY_KEY = 'tileGeometry';

function isTileGeometry(value: unknown): value is TileGeometry {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return ['x', 'y', 'width', 'height'].every((key) => typeof candidate[key] === 'number'
    && Number.isFinite(candidate[key]));
}

export default defineContentScript({
  matches: ['*://*.youtube.com/*'],
  main(ctx) {
    let activeTabId: number | null = null;
    let receiver: PreviewReceiver | null = null;
    let hasOffer = false;
    let pendingCandidates: PreviewCandidate[] = [];
    let overlay: OverlayHandle | null = null;
    let completionTimer: ReturnType<typeof setTimeout> | null = null;
    let controller = createYouTubeController(document);

    const stopNavigation = observeYouTubeNavigation(() => {
      controller = createYouTubeController(document);
    });

    function safeSendMessage(message: RuntimeMessage): void {
      try {
        if (!chrome.runtime?.id) return;
        void chrome.runtime.sendMessage(message).catch(() => {});
      } catch {
        // Extension context invalidated
      }
    }

    function ensureOverlay(): OverlayHandle {
      if (overlay) return overlay;
      overlay = mountOverlay({
        onStop: () => {
          if (activeTabId !== null) safeSendMessage({
            version: 1,
            type: 'STOP_SESSION',
            tabId: activeTabId,
          });
        },
        onGeometryChange: (geometry) => {
          try {
            if (chrome.runtime?.id) void chrome.storage.local.set({ [GEOMETRY_KEY]: geometry }).catch(() => {});
          } catch {
            // Extension context invalidated
          }
        },
      });
      try {
        if (chrome.runtime?.id) {
          void chrome.storage.local.get(GEOMETRY_KEY).then((stored) => {
            if (!overlay || !isTileGeometry(stored[GEOMETRY_KEY])) return;
            overlay.update({
              geometry: clampTileGeometry(stored[GEOMETRY_KEY], {
                width: window.innerWidth,
                height: window.innerHeight,
              }),
            });
          }).catch(() => {});
        }
      } catch {
        // Storage unavailable
      }
      return overlay;
    }

    function closePeer(): void {
      receiver?.close();
      receiver = null;
      hasOffer = false;
      pendingCandidates = [];
    }

    function destroy(): void {
      closePeer();
      if (completionTimer) clearTimeout(completionTimer);
      completionTimer = null;
      overlay?.destroy();
      overlay = null;
      activeTabId = null;
    }

    async function acceptOffer(message: Extract<RuntimeMessage, { type: 'PREVIEW_OFFER' }>): Promise<void> {
      closePeer();
      activeTabId = message.tabId;
      const tile = ensureOverlay();
      receiver = createPreviewReceiver((stream) => tile.update({ preview: stream }));
      receiver.onCandidate((candidate) => safeSendMessage({
        version: 1,
        type: 'PREVIEW_CANDIDATE',
        tabId: message.tabId,
        candidate,
      }));
      const description = await receiver.acceptOfferAndCreateAnswer(message.description);
      hasOffer = true;
      for (const candidate of pendingCandidates) await receiver.addRemoteCandidate(candidate);
      pendingCandidates = [];
      safeSendMessage({
        version: 1,
        type: 'PREVIEW_ANSWER',
        tabId: message.tabId,
        description,
      });
    }

    async function executeCommand(message: Extract<RuntimeMessage, { type: 'COMMAND' }>): Promise<void> {
      if (message.tabId !== activeTabId) return;
      const result = await controller.execute(message.command, message.commandId);
      const tile = ensureOverlay();
      if (result.status === 'EXECUTED' || result.status === 'ALREADY_APPLIED') {
        tile.update({
          status: 'COMMAND_COMPLETED',
          reason: undefined,
          gesture: undefined,
          progress: undefined,
          completedCommand: message.command,
        });
        if (completionTimer) clearTimeout(completionTimer);
        completionTimer = setTimeout(() => {
          overlay?.update({ status: 'READY', completedCommand: undefined });
          completionTimer = null;
        }, 1_000);
      } else {
        tile.update({
          status: 'WARNING',
          reason: 'YOUTUBE_COMMAND_UNAVAILABLE',
          gesture: undefined,
          progress: undefined,
          completedCommand: undefined,
        });
      }
    }

    const messageListener = (input: unknown, _sender: unknown, sendResponse?: (response?: unknown) => void) => {
      if (typeof input === 'object' && input !== null && (input as Record<string, unknown>).type === 'PING') {
        sendResponse?.({ type: 'PONG' });
        return true;
      }
      const message = parseRuntimeMessage(input);
      if (!message) return;
      if (message.type === 'PREVIEW_OFFER') {
        void acceptOffer(message);
      } else if (message.type === 'PREVIEW_CANDIDATE' && message.tabId === activeTabId && receiver) {
        if (hasOffer) void receiver.addRemoteCandidate(message.candidate);
        else pendingCandidates.push(message.candidate);
      } else if (message.type === 'STATUS') {
        console.log('[EyeTube Content] STATUS received:', message.status, message.reason, message.detail);
        activeTabId = message.tabId;
        ensureOverlay().update({
          status: message.status,
          reason: message.reason,
          gesture: undefined,
          progress: undefined,
          completedCommand: undefined,
        });
      } else if (message.type === 'GESTURE_PROGRESS' && message.tabId === activeTabId) {
        ensureOverlay().update({
          status: 'HOLDING',
          reason: undefined,
          gesture: message.gesture,
          progress: message.progress,
          completedCommand: undefined,
        });
      } else if (message.type === 'GESTURE_CANCELLED' && message.tabId === activeTabId) {
        ensureOverlay().update({
          status: 'READY',
          gesture: undefined,
          progress: undefined,
          completedCommand: undefined,
        });
      } else if (message.type === 'COMMAND') {
        void executeCommand(message);
      } else if (message.type === 'STOP_SESSION' && message.tabId === activeTabId) {
        destroy();
      }
    };

    const handleVisibilityChange = () => {
      if (activeTabId !== null) {
        safeSendMessage({
          version: 1,
          type: 'SESSION_VISIBILITY',
          tabId: activeTabId,
          visible: !document.hidden,
        });
      }
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    chrome.runtime.onMessage.addListener(messageListener);
    ctx.onInvalidated(() => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      chrome.runtime.onMessage.removeListener(messageListener);
      stopNavigation();
      destroy();
    });
  },
});
