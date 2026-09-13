import type { RuntimeMessage } from '../src/contracts/messages';
import { parseSettings } from '../src/contracts/settings';
import { SessionCoordinator, type SessionStore } from '../src/background/session-coordinator';

const SESSION_KEY = 'eyetube_session';
const SETTINGS_KEY = 'eyetube_settings';

export default defineBackground(() => {
  const offscreenUrl = chrome.runtime.getURL('offscreen.html');
  let creatingOffscreen: Promise<void> | null = null;

  async function hasOffscreenDocument(): Promise<boolean> {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
      documentUrls: [offscreenUrl],
    });
    return contexts.length > 0;
  }

  async function ensureOffscreen(): Promise<void> {
    if (await hasOffscreenDocument()) return;
    creatingOffscreen ??= (async () => {
      await chrome.offscreen.createDocument({
        url: 'offscreen.html',
        reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.WEB_RTC],
        justification: 'Process eye gestures locally and show the active camera preview.',
      });
      for (let attempt = 0; attempt < 50; attempt++) {
        try {
          const res = await chrome.runtime.sendMessage({ type: 'OFFSCREEN_PING' });
          if (res?.type === 'OFFSCREEN_PONG') break;
        } catch {
          // Offscreen still evaluating
        }
        await new Promise((resolve) => setTimeout(resolve, 30));
      }
    })().finally(() => {
      creatingOffscreen = null;
    });
    await creatingOffscreen;
  }

  /**
   * Offscreen documents cannot read chrome.storage, so the popup's settings are
   * pushed to the gesture engine from here.
   */
  async function pushSettings(tabId: number): Promise<void> {
    try {
      const stored = await chrome.storage.local.get(SETTINGS_KEY);
      const settings = parseSettings(stored[SETTINGS_KEY]);
      await chrome.runtime.sendMessage({
        version: 1,
        type: 'SETTINGS',
        tabId,
        navigationHoldMs: settings.navigationHoldMs,
        playPauseHoldMs: settings.playPauseHoldMs,
        accountHoldMs: settings.accountHoldMs,
        cooldownMs: settings.cooldownMs,
        enabledGestures: settings.enabledGestures,
      } satisfies RuntimeMessage);
    } catch {
      // No offscreen listener yet, or the session already stopped
    }
  }

  async function closeOffscreen(): Promise<void> {
    if (await hasOffscreenDocument()) await chrome.offscreen.closeDocument();
  }

  const store: SessionStore = {
    async load() {
      try {
        const res = await chrome.storage.session.get(SESSION_KEY);
        return res[SESSION_KEY];
      } catch {
        return null;
      }
    },
    async save(metadata) {
      try {
        await chrome.storage.session.set({ [SESSION_KEY]: metadata });
      } catch {
        // storage.session write failure should not crash coordinator
      }
    },
  };

  async function isEligibleTab(tabId: number): Promise<boolean> {
    try {
      const tab = await chrome.tabs.get(tabId);
      return Boolean(tab.url && /^https?:\/\/(www\.)?youtube\.com\//.test(tab.url));
    } catch {
      return false;
    }
  }

  // A PING before every single message doubled the tab traffic, so liveness is
  // remembered and only re-checked when a real send fails.
  const liveContentScripts = new Set<number>();

  async function injectContentScript(tabId: number): Promise<void> {
    try {
      const res = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
      if (res?.type === 'PONG') {
        liveContentScripts.add(tabId);
        return;
      }
    } catch {
      // Content script not yet active
    }
    try {
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content-scripts/youtube.js'],
      });
      await new Promise((resolve) => setTimeout(resolve, 60));
      liveContentScripts.add(tabId);
    } catch (err) {
      console.warn('[EyeTube Background] Auto-inject content script notice:', err);
    }
  }

  async function sendToTab(tabId: number, message: RuntimeMessage): Promise<unknown> {
    if (!liveContentScripts.has(tabId)) await injectContentScript(tabId);
    try {
      return await chrome.tabs.sendMessage(tabId, message);
    } catch (error) {
      // The tab reloaded or navigated away from under us: re-inject once.
      liveContentScripts.delete(tabId);
      await injectContentScript(tabId);
      return chrome.tabs.sendMessage(tabId, message);
    }
  }

  const coordinator = new SessionCoordinator({
    runtimeId: chrome.runtime.id,
    store,
    ensureOffscreen,
    closeOffscreen,
    isEligibleTab,
    sendToRuntime: async (message) => {
      const result = await chrome.runtime.sendMessage(message);
      if (message.type === 'START_SESSION') await pushSettings(message.tabId);
      return result;
    },
    sendToTab,
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    const tabId = coordinator.activeTabId;
    if (area !== 'local' || !changes[SETTINGS_KEY] || tabId === null) return;
    void pushSettings(tabId);
  });

  const fakePopupSender = {
    id: chrome.runtime.id,
    url: chrome.runtime.getURL('popup.html'),
  };

  chrome.action.onClicked.addListener((tab) => {
    if (tab.id === undefined || !tab.url || !/^https?:\/\/(www\.)?youtube\.com\//.test(tab.url)) return;
    const tabId = tab.id;
    const isStopping = coordinator.activeTabId === tabId;
    const operation = coordinator.handle(
      {
        version: 1,
        type: isStopping ? 'STOP_SESSION' : 'START_SESSION',
        tabId,
      },
      fakePopupSender,
    );
    void operation.then(() => chrome.action.setBadgeText({
      tabId,
      text: coordinator.activeTabId === tabId ? 'ON' : '',
    }));
  });

  chrome.tabs.onRemoved.addListener((tabId) => {
    liveContentScripts.delete(tabId);
    if (coordinator.activeTabId === tabId) {
      void coordinator.handle(
        { version: 1, type: 'STOP_SESSION', tabId },
        fakePopupSender,
      );
    }
  });

  chrome.runtime.onMessage.addListener((message: unknown, sender) => {
    void coordinator.handle(message, sender);
  });
});
