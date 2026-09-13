import { parseRuntimeMessage, type PreviewCandidate, type RuntimeMessage } from '../src/contracts/messages';
import type { DetectionBlocker, RuntimeStatus } from '../src/contracts/status';
import { createPreviewReceiver, type PreviewReceiver } from '../src/media/local-preview-peer';
import { mountOverlay, type OverlayHandle } from '../src/overlay/App';
import { clampTileGeometry, type TileGeometry } from '../src/overlay/geometry';
import { createYouTubeController } from '../src/youtube/controller';
import { observeYouTubeNavigation } from '../src/youtube/lifecycle';

const GEOMETRY_KEY = 'tileGeometry';

const BLOCKER_HINT: Record<DetectionBlocker, string | undefined> = {
  NONE: undefined,
  NO_FACE: 'Không thấy khuôn mặt trong camera',
  LOW_CONFIDENCE: 'Tín hiệu khuôn mặt chưa đủ rõ',
  FACE_TOO_SMALL: 'Hãy ngồi gần camera hơn',
  TOO_DARK: 'Phòng quá tối, cần thêm ánh sáng',
  EYES_UNCLEAR: 'Chưa đọc rõ mắt, mở to mắt và nhìn thẳng',
  HEAD_TURNED: 'Hãy quay mặt thẳng vào camera',
  HEAD_TILTED: 'Đầu đang ngửa/cúi quá nhiều',
};


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
    let lastStatus: RuntimeStatus = 'OFF';

    const stopNavigation = observeYouTubeNavigation(() => {
      controller = createYouTubeController(document);
    });

    // Swallow Extension context invalidated errors caused by extension reloads
    if (typeof window !== 'undefined') {
      window.addEventListener('error', (event) => {
        if (event.error?.message?.includes('Extension context invalidated')
          || event.message?.includes('Extension context invalidated')) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }, true);

      window.addEventListener('unhandledrejection', (event) => {
        const msg = (event.reason as { message?: string })?.message ?? String(event.reason);
        if (msg.includes('Extension context invalidated')) {
          event.preventDefault();
          event.stopImmediatePropagation();
        }
      }, true);
    }

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
      lastStatus = 'OFF';
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
      console.log('[EyeTube] 🎯 Executing command:', message.command);
      const result = await controller.execute(message.command, message.commandId);
      console.log('[EyeTube] 🎯 Command result:', result);
      const tile = ensureOverlay();
      if (result.status === 'EXECUTED' || result.status === 'ALREADY_APPLIED') {
        lastStatus = 'COMMAND_COMPLETED';
        tile.update({
          status: 'COMMAND_COMPLETED',
          hint: undefined,
          reason: undefined,
          gesture: undefined,
          progress: undefined,
          completedCommand: message.command,
        });
        if (completionTimer) clearTimeout(completionTimer);
        completionTimer = setTimeout(() => {
          lastStatus = 'READY';
          overlay?.update({ status: 'READY', completedCommand: undefined });
          completionTimer = null;
        }, 1_000);
      } else {
        lastStatus = 'WARNING';
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
        if (message.status === 'READY') {
          console.log(
            '%c[EyeTube AI] ✅ MODEL ĐÃ LOAD THÀNH CÔNG! Trạng thái: READY (Đang nhận diện mắt)',
            'color: #00e676; font-size: 13px; font-weight: bold;'
          );
        } else if (message.status === 'ERROR') {
          console.error(
            `%c[EyeTube AI] ❌ LỖI: ${message.reason ?? 'UNKNOWN'}${message.detail ? ` - ${message.detail}` : ''}`,
            'color: #ff1744; font-size: 13px; font-weight: bold;'
          );
        } else {
          console.log(
            `%c[EyeTube AI] ℹ️ Trạng thái: ${message.status}${message.reason ? ` (${message.reason})` : ''}`,
            'color: #00bcd4; font-weight: bold;'
          );
        }
        activeTabId = message.tabId;
        lastStatus = message.status;
        ensureOverlay().update({
          status: message.status,
          hint: undefined,
          reason: message.reason,
          gesture: undefined,
          progress: undefined,
          completedCommand: undefined,
        });
      } else if (message.type === 'GESTURE_PROGRESS' && message.tabId === activeTabId) {
        console.log(
          `%c[EyeTube AI] 👁️ Phát hiện cử chỉ: %c${message.gesture}%c (giữ ${(message.progress * 100).toFixed(0)}%)`,
          'color: #00bcd4; font-weight: bold;',
          'color: #ffeb3b; font-weight: bold; background: #222; padding: 1px 4px; border-radius: 2px;',
          'color: #aaa;'
        );
        lastStatus = 'HOLDING';
        ensureOverlay().update({
          status: 'HOLDING',
          hint: undefined,
          reason: undefined,
          gesture: message.gesture,
          progress: message.progress,
          completedCommand: undefined,
        });
      } else if (message.type === 'GESTURE_CANCELLED' && message.tabId === activeTabId) {
        console.log('%c[EyeTube AI] ↩️ Huỷ cử chỉ (mắt đã mở lại hoặc đổi hướng nhìn)', 'color: #888; font-style: italic;');
        lastStatus = 'READY';
        ensureOverlay().update({
          status: 'READY',
          gesture: undefined,
          progress: undefined,
          completedCommand: undefined,
        });
      } else if (message.type === 'DIAGNOSTIC' && message.tabId === activeTabId) {
        const hint = BLOCKER_HINT[message.blocker];
        console.log(
          `%c[EyeTube AI] \uD83D\uDD2C ${message.state} | ${message.observation}`
            + `${hint ? ` | \u26A0\uFE0F ${hint}` : ''} | ${message.metrics}`,
          hint ? 'color: #ffb300;' : 'color: #78909c;',
        );
        // Only the idle states may be relabelled: a hold or a just-executed
        // command must keep showing its own feedback.
        ensureOverlay().update({
          metrics: `${message.state} · ${message.observation} · ${message.metrics}`,
          ...(lastStatus === 'READY' || lastStatus === 'SEARCHING' || lastStatus === 'WARNING'
            ? { hint }
            : {}),
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
