import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium, expect, test, type BrowserContext } from 'playwright/test';

const extensionPath = resolve('.output/chrome-mv3');
const fakeCameraPath = resolve('e2e/fixtures/fake-camera.y4m');

let profilePath: string;
let context: BrowserContext;

test.beforeEach(async () => {
  profilePath = await mkdtemp(join(tmpdir(), 'eyetube-e2e-'));
  context = await chromium.launchPersistentContext(profilePath, {
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
});

test.afterEach(async () => {
  await context.close();
  await rm(profilePath, { recursive: true, force: true });
});

test('extension loads into browser and registers service worker', async () => {
  let worker = context.serviceWorkers()[0];
  worker ??= await context.waitForEvent('serviceworker', { timeout: 15_000 });
  expect(worker).toBeDefined();

  const extensionId = new URL(worker.url()).host;
  expect(extensionId).toMatch(/^[a-z]{32}$/);

  const offscreenDocs = await worker.evaluate(async () => {
    return chrome.runtime.getContexts({
      contextTypes: ['OFFSCREEN_DOCUMENT'],
    }).then((contexts) => contexts.length);
  });
  expect(offscreenDocs).toBe(0);
});

test('popup renders title, controls, status badge and privacy promise', async () => {
  let worker = context.serviceWorkers()[0];
  worker ??= await context.waitForEvent('serviceworker', { timeout: 15_000 });
  const extensionId = new URL(worker.url()).host;

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  await expect(page.locator('h1')).toHaveText('EyeTube Control');
  await expect(page.locator('.status-badge')).toBeVisible();
  await expect(page.getByRole('button', { name: /start eye control/i })).toBeVisible();
  await expect(page.locator('.privacy-notice')).toContainText('100% Local');
});

test('no STUN or TURN network requests during extension lifecycle', async () => {
  let worker = context.serviceWorkers()[0];
  worker ??= await context.waitForEvent('serviceworker', { timeout: 15_000 });
  const extensionId = new URL(worker.url()).host;

  const networkLeaks: string[] = [];
  context.on('request', (req) => {
    if (/\b(?:stun|turns?):/i.test(req.url())) {
      networkLeaks.push(req.url());
    }
  });

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await page.waitForTimeout(1_000);

  expect(networkLeaks).toHaveLength(0);
});
