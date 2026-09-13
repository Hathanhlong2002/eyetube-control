import { describe, expect, it, vi } from 'vitest';

import { PreviewRouter } from '../../src/background/preview-router';

function dependencies() {
  return {
    runtimeId: 'extension-id',
    ensureOffscreen: vi.fn().mockResolvedValue(undefined),
    closeOffscreen: vi.fn().mockResolvedValue(undefined),
    sendToRuntime: vi.fn().mockResolvedValue(undefined),
    sendToTab: vi.fn().mockResolvedValue(undefined),
  };
}

describe('PreviewRouter', () => {
  it('accepts a start request only from an extension page', async () => {
    const deps = dependencies();
    const router = new PreviewRouter(deps);

    await router.handle(
      { version: 1, type: 'START_SESSION', tabId: 12 },
      {
        id: 'extension-id',
        url: 'chrome-extension://extension-id/popup.html',
        tab: { id: 99 },
      },
    );

    expect(router.activeTabId).toBe(12);
    expect(deps.ensureOffscreen).toHaveBeenCalledOnce();
  });

  it('rejects a start request from a content script', async () => {
    const deps = dependencies();
    const router = new PreviewRouter(deps);

    await router.handle(
      { version: 1, type: 'START_SESSION', tabId: 12 },
      { id: 'extension-id', tab: { id: 12 } },
    );

    expect(router.activeTabId).toBeNull();
    expect(deps.ensureOffscreen).not.toHaveBeenCalled();
  });

  it('starts one explicitly selected tab', async () => {
    const deps = dependencies();
    const router = new PreviewRouter(deps);

    await router.start(12);

    expect(deps.ensureOffscreen).toHaveBeenCalledOnce();
    expect(deps.sendToRuntime).toHaveBeenCalledWith({ version: 1, type: 'START_SESSION', tabId: 12 });
    expect(deps.sendToTab).toHaveBeenCalledWith(12, {
      version: 1,
      type: 'STATUS',
      tabId: 12,
      status: 'REQUESTING_PERMISSION',
    });
  });

  it('routes an offscreen offer only to the active tab', async () => {
    const deps = dependencies();
    const router = new PreviewRouter(deps);
    await router.start(12);
    deps.sendToTab.mockClear();
    const offer = {
      version: 1,
      type: 'PREVIEW_OFFER',
      tabId: 12,
      description: { type: 'offer', sdp: 'offer-sdp' },
    } as const;

    await router.handle(offer, {
      id: 'extension-id',
      url: 'chrome-extension://extension-id/offscreen.html',
    });

    expect(deps.sendToTab).toHaveBeenCalledWith(12, offer);
  });

  it('rejects an offer from a content script', async () => {
    const deps = dependencies();
    const router = new PreviewRouter(deps);
    await router.start(12);
    deps.sendToTab.mockClear();

    await router.handle({
      version: 1,
      type: 'PREVIEW_OFFER',
      tabId: 12,
      description: { type: 'offer', sdp: 'offer-sdp' },
    }, { id: 'extension-id', tab: { id: 12 } });

    expect(deps.sendToTab).not.toHaveBeenCalled();
  });

  it('routes a content answer to the offscreen context', async () => {
    const deps = dependencies();
    const router = new PreviewRouter(deps);
    await router.start(12);
    deps.sendToRuntime.mockClear();
    const answer = {
      version: 1,
      type: 'PREVIEW_ANSWER',
      tabId: 12,
      description: { type: 'answer', sdp: 'answer-sdp' },
    } as const;

    await router.handle(answer, { id: 'extension-id', tab: { id: 12 } });

    expect(deps.sendToRuntime).toHaveBeenCalledWith(answer);
  });

  it('ignores valid messages for a non-active tab', async () => {
    const deps = dependencies();
    const router = new PreviewRouter(deps);
    await router.start(12);
    deps.sendToRuntime.mockClear();
    deps.sendToTab.mockClear();

    await router.handle({
      version: 1,
      type: 'PREVIEW_CANDIDATE',
      tabId: 13,
      candidate: { candidate: '', sdpMid: null, sdpMLineIndex: null },
    }, { id: 'extension-id', tab: { id: 13 } });

    expect(deps.sendToRuntime).not.toHaveBeenCalled();
    expect(deps.sendToTab).not.toHaveBeenCalled();
  });

  it('stops tracks and closes offscreen only for the active tab', async () => {
    const deps = dependencies();
    const router = new PreviewRouter(deps);
    await router.start(12);
    deps.sendToRuntime.mockClear();
    deps.sendToTab.mockClear();

    await router.handle(
      { version: 1, type: 'STOP_SESSION', tabId: 12 },
      { id: 'extension-id', tab: { id: 12 } },
    );

    expect(deps.sendToRuntime).toHaveBeenCalledWith({ version: 1, type: 'STOP_SESSION', tabId: 12 });
    expect(deps.sendToTab).toHaveBeenCalledWith(12, { version: 1, type: 'STOP_SESSION', tabId: 12 });
    expect(deps.closeOffscreen).toHaveBeenCalledOnce();
    expect(router.activeTabId).toBeNull();
  });
});
