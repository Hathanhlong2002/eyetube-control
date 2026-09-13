import { PreviewRouter } from '../src/background/preview-router';

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
    creatingOffscreen ??= chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.WEB_RTC],
      justification: 'Process eye gestures locally and show the active camera preview.',
    }).finally(() => {
      creatingOffscreen = null;
    });
    await creatingOffscreen;
  }

  async function closeOffscreen(): Promise<void> {
    if (await hasOffscreenDocument()) await chrome.offscreen.closeDocument();
  }

  const router = new PreviewRouter({
    runtimeId: chrome.runtime.id,
    ensureOffscreen,
    closeOffscreen,
    sendToRuntime: (message) => chrome.runtime.sendMessage(message),
    sendToTab: (tabId, message) => chrome.tabs.sendMessage(tabId, message),
  });

  chrome.action.onClicked.addListener((tab) => {
    if (tab.id === undefined || !tab.url?.startsWith('https://www.youtube.com/')) return;
    const operation = router.activeTabId === tab.id ? router.stop(tab.id) : router.start(tab.id);
    void operation.then(() => chrome.action.setBadgeText({
      tabId: tab.id,
      text: router.activeTabId === tab.id ? 'ON' : '',
    }));
  });

  chrome.runtime.onMessage.addListener((message: unknown, sender) => {
    void router.handle(message, sender);
  });
});

