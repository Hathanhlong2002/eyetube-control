import { describe, expect, it, vi } from 'vitest';

import { observeYouTubeNavigation } from '../../src/youtube/lifecycle';

describe('observeYouTubeNavigation', () => {
  it('coalesces YouTube, History API and mutation signals into one callback', async () => {
    const callback = vi.fn();
    let notifyMutation: VoidFunction = () => undefined;
    const disconnect = vi.fn();
    class Observer {
      constructor(handler: MutationCallback) {
        notifyMutation = () => handler([], this as unknown as MutationObserver);
      }
      observe = vi.fn();
      disconnect = disconnect;
      takeRecords = vi.fn().mockReturnValue([]);
    }
    const unsubscribe = observeYouTubeNavigation(callback, {
      window,
      document,
      MutationObserver: Observer as unknown as typeof MutationObserver,
      queueMicrotask,
    });

    window.dispatchEvent(new Event('yt-navigate-finish'));
    window.history.pushState({}, '', '#one');
    notifyMutation();
    await Promise.resolve();

    expect(callback).toHaveBeenCalledOnce();
    unsubscribe();
    expect(disconnect).toHaveBeenCalledOnce();
  });

  it('removes listeners and restores History methods when unsubscribed', async () => {
    const callback = vi.fn();
    const originalPush = window.history.pushState;
    const originalReplace = window.history.replaceState;
    const disconnect = vi.fn();
    class Observer {
      observe = vi.fn();
      disconnect = disconnect;
      takeRecords = vi.fn().mockReturnValue([]);
    }
    const unsubscribe = observeYouTubeNavigation(callback, {
      window,
      document,
      MutationObserver: Observer as unknown as typeof MutationObserver,
      queueMicrotask,
    });
    unsubscribe();

    expect(window.history.pushState).toBe(originalPush);
    expect(window.history.replaceState).toBe(originalReplace);
    window.dispatchEvent(new Event('yt-navigate-finish'));
    window.dispatchEvent(new PopStateEvent('popstate'));
    await Promise.resolve();
    expect(callback).not.toHaveBeenCalled();
  });
});
