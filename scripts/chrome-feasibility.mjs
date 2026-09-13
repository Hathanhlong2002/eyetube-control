import { chromium } from 'playwright';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const extensionPath = resolve('.output/chrome-mv3');
const fakeCameraPath = process.env.EYETUBE_FAKE_CAMERA;
if (!fakeCameraPath) throw new Error('EYETUBE_FAKE_CAMERA must point to a Y4M file');

const profilePath = await mkdtemp(join(tmpdir(), 'eyetube-chrome-'));
const context = await chromium.launchPersistentContext(profilePath, {
  headless: false,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${fakeCameraPath}`,
    '--autoplay-policy=no-user-gesture-required',
    '--no-first-run',
    '--no-default-browser-check',
  ],
});

try {
  const page = context.pages()[0] ?? await context.newPage();
  await page.goto('chrome://extensions');
  await page.waitForTimeout(1_000);
  const installedExtensions = await page.locator('extensions-item').evaluateAll((items) => items.map((item) => ({
    id: item.getAttribute('id'),
    text: item.textContent?.replace(/\s+/g, ' ').trim(),
  })));
  console.log(JSON.stringify({ installedExtensions }));
  await page.close();

  let worker = context.serviceWorkers()[0];
  worker ??= await context.waitForEvent('serviceworker', { timeout: 15_000 });
  const extensionId = new URL(worker.url()).host;
  console.log(JSON.stringify({ extensionId, workerUrl: worker.url() }));

  const extensionErrors = [];
  worker.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') {
      extensionErrors.push(`${message.type()}: ${message.text()}`);
    }
  });
  worker.on('close', () => extensionErrors.push('service worker closed during probe'));

  const networkLeaks = [];
  context.on('request', (request) => {
    if (/\b(?:stun|turns?):/i.test(request.url())) networkLeaks.push(request.url());
  });

  const webrtcInternals = await context.newPage();
  await webrtcInternals.goto('chrome://webrtc-internals');

  const youtube = await context.newPage();
  await youtube.goto('https://www.youtube.com/watch?v=jNQXAC9IVRw', {
    waitUntil: 'domcontentloaded',
    timeout: 30_000,
  });
  await youtube.bringToFront();
  const tabId = await worker.evaluate(async () => {
    const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return tabs[0]?.id ?? null;
  });
  if (tabId === null) throw new Error('Could not resolve the YouTube tab id');
  console.log(JSON.stringify({ youtubeUrl: youtube.url(), tabId }));

  const offscreenBeforeStart = await worker.evaluate(async () => chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  }).then((contexts) => contexts.length));

  const control = await context.newPage();
  await control.goto(`chrome-extension://${extensionId}/popup.html`);
  await control.evaluate(async (activeTabId) => {
    await chrome.runtime.sendMessage({ version: 1, type: 'START_SESSION', tabId: activeTabId });
  }, tabId);
  await youtube.waitForTimeout(1_000);
  const contextsAfterStart = await worker.evaluate(async () => chrome.runtime.getContexts({}).then(
    (contexts) => contexts.map((item) => ({ type: item.contextType, tabId: item.tabId, url: item.documentUrl })),
  ));
  console.log(JSON.stringify({ contextsAfterStart, extensionErrors }));
  try {
    await youtube.locator('[data-eyetube-control="preview"]').waitFor({ state: 'attached', timeout: 15_000 });
  } catch (error) {
    const contentReceiver = await control.evaluate(async (activeTabId) => {
      try {
        await chrome.tabs.sendMessage(activeTabId, {
          version: 1,
          type: 'STATUS',
          tabId: activeTabId,
          status: 'SEARCHING',
        });
        return 'reachable';
      } catch (sendError) {
        return sendError instanceof Error ? sendError.message : String(sendError);
      }
    }, tabId);
    throw new Error(`Preview missing; content receiver: ${contentReceiver}; extension errors: ${extensionErrors.join(' | ')}`, {
      cause: error,
    });
  }
  await youtube.waitForTimeout(2_000);
  await youtube.screenshot({ path: '/private/tmp/eyetube-preview.png' });

  const webrtcText = await webrtcInternals.locator('body').innerText();
  await webrtcInternals.screenshot({ path: '/private/tmp/eyetube-webrtc-internals.png' });
  const iceConfigurationEvidence = webrtcText
    .split('\n')
    .filter((line) => /iceServers|stun:|turns?:/i.test(line))
    .slice(0, 10);

  const offscreenDuringSession = await worker.evaluate(async () => chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  }).then((contexts) => contexts.length));

  await control.evaluate(async (activeTabId) => {
    await chrome.runtime.sendMessage({ version: 1, type: 'STOP_SESSION', tabId: activeTabId });
  }, tabId);
  await youtube.locator('[data-eyetube-control="preview"]').waitFor({ state: 'detached', timeout: 10_000 });
  const offscreenAfterStop = await worker.evaluate(async () => chrome.runtime.getContexts({
    contextTypes: ['OFFSCREEN_DOCUMENT'],
  }).then((contexts) => contexts.length));

  console.log(JSON.stringify({
    tabId,
    offscreenBeforeStart,
    offscreenDuringSession,
    offscreenAfterStop,
    iceConfigurationEvidence,
    networkLeaks,
    extensionErrors,
    screenshot: '/private/tmp/eyetube-preview.png',
    webrtcScreenshot: '/private/tmp/eyetube-webrtc-internals.png',
  }));
} finally {
  await context.close();
}
