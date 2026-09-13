import { describe, expect, it, vi } from 'vitest';

import {
  SessionCoordinator,
  type SessionMetadata,
  type SessionStore,
} from '../../src/background/session-coordinator';

function memoryStore(): SessionStore & { value: SessionMetadata } {
  return {
    value: { activeTabId: null, recentCommandIds: [] },
    async load() { return structuredClone(this.value); },
    async save(value) { this.value = structuredClone(value); },
  };
}

function setup(store = memoryStore()) {
  const dependencies = {
    runtimeId: 'extension-id',
    store,
    ensureOffscreen: vi.fn().mockResolvedValue(undefined),
    closeOffscreen: vi.fn().mockResolvedValue(undefined),
    isEligibleTab: vi.fn().mockResolvedValue(true),
    sendToRuntime: vi.fn().mockResolvedValue(undefined),
    sendToTab: vi.fn().mockResolvedValue(undefined),
  };
  return { coordinator: new SessionCoordinator(dependencies), dependencies, store };
}

const popup = { id: 'extension-id', url: 'chrome-extension://extension-id/popup.html' };
const offscreen = { id: 'extension-id', url: 'chrome-extension://extension-id/offscreen.html' };

describe('SessionCoordinator', () => {
  it('starts only an eligible tab from the trusted popup and persists session metadata', async () => {
    const { coordinator, dependencies, store } = setup();
    await coordinator.handle({ version: 1, type: 'START_SESSION', tabId: 12 }, popup);

    expect(dependencies.isEligibleTab).toHaveBeenCalledWith(12);
    expect(dependencies.ensureOffscreen).toHaveBeenCalledOnce();
    expect(dependencies.sendToRuntime).toHaveBeenCalledWith({ version: 1, type: 'START_SESSION', tabId: 12 });
    expect(store.value.activeTabId).toBe(12);
  });

  it('rejects start from content, another extension and an ineligible tab', async () => {
    const first = setup();
    await first.coordinator.handle(
      { version: 1, type: 'START_SESSION', tabId: 12 },
      { id: 'extension-id', tab: { id: 12 }, url: 'https://www.youtube.com/watch?v=x' },
    );
    await first.coordinator.handle(
      { version: 1, type: 'START_SESSION', tabId: 12 },
      { id: 'attacker', url: 'chrome-extension://attacker/popup.html' },
    );
    first.dependencies.isEligibleTab.mockResolvedValue(false);
    await first.coordinator.handle({ version: 1, type: 'START_SESSION', tabId: 12 }, popup);
    expect(first.dependencies.ensureOffscreen).not.toHaveBeenCalled();
  });

  it('binds commands to the explicitly enabled tab', async () => {
    const { coordinator, dependencies } = setup();
    await coordinator.handle({ version: 1, type: 'START_SESSION', tabId: 12 }, popup);
    dependencies.sendToTab.mockClear();

    await coordinator.handle({
      version: 1,
      type: 'COMMAND',
      tabId: 13,
      command: 'NEXT_VIDEO',
      commandId: 'wrong-tab',
    }, offscreen);
    expect(dependencies.sendToTab).not.toHaveBeenCalled();
  });

  it('does not replay a command after coordinator recreation', async () => {
    const store = memoryStore();
    const first = setup(store);
    await first.coordinator.handle({ version: 1, type: 'START_SESSION', tabId: 12 }, popup);
    first.dependencies.sendToTab.mockClear();
    const command = {
      version: 1,
      type: 'COMMAND',
      tabId: 12,
      command: 'LIKE_VIDEO',
      commandId: 'fixed-id',
    } as const;
    await first.coordinator.handle(command, offscreen);

    const restarted = setup(store);
    await restarted.coordinator.handle(command, offscreen);

    expect(first.dependencies.sendToTab).toHaveBeenCalledOnce();
    expect(restarted.dependencies.sendToTab).not.toHaveBeenCalled();
  });

  it('routes signaling by trusted context and visibility only from the active content tab', async () => {
    const { coordinator, dependencies } = setup();
    await coordinator.handle({ version: 1, type: 'START_SESSION', tabId: 12 }, popup);
    dependencies.sendToRuntime.mockClear();
    dependencies.sendToTab.mockClear();

    const offer = {
      version: 1,
      type: 'PREVIEW_OFFER',
      tabId: 12,
      description: { type: 'offer', sdp: 'sdp' },
    } as const;
    await coordinator.handle(offer, offscreen);
    expect(dependencies.sendToTab).toHaveBeenCalledWith(12, offer);

    const visibility = { version: 1, type: 'SESSION_VISIBILITY', tabId: 12, visible: false } as const;
    await coordinator.handle(visibility, { id: 'extension-id', tab: { id: 12 } });
    expect(dependencies.sendToRuntime).toHaveBeenCalledWith(visibility);
  });

  it('stops only the active tab and retains recent IDs in session storage', async () => {
    const { coordinator, dependencies, store } = setup();
    await coordinator.handle({ version: 1, type: 'START_SESSION', tabId: 12 }, popup);
    await coordinator.handle({
      version: 1, type: 'COMMAND', tabId: 12, command: 'NEXT_VIDEO', commandId: 'kept-id',
    }, offscreen);
    await coordinator.handle({ version: 1, type: 'STOP_SESSION', tabId: 12 }, {
      id: 'extension-id', tab: { id: 12 },
    });

    expect(dependencies.closeOffscreen).toHaveBeenCalledOnce();
    expect(store.value).toEqual({ activeTabId: null, recentCommandIds: ['kept-id'] });
  });

  it('rejects malformed payloads before any side effect', async () => {
    const { coordinator, dependencies } = setup();
    await coordinator.handle({ version: 1, type: 'START_SESSION', tabId: 12, extra: true }, popup);
    expect(dependencies.ensureOffscreen).not.toHaveBeenCalled();
  });
});
