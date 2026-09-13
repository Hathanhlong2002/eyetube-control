export type NavigationEnvironment = {
  window: Window;
  document: Document;
  MutationObserver: typeof MutationObserver;
  queueMicrotask(callback: VoidFunction): void;
};

const DEFAULT_ENVIRONMENT: NavigationEnvironment = {
  window,
  document,
  MutationObserver,
  queueMicrotask: (callback) => window.queueMicrotask(callback),
};

export function observeYouTubeNavigation(
  callback: VoidFunction,
  environment: NavigationEnvironment = DEFAULT_ENVIRONMENT,
): VoidFunction {
  let queued = false;
  let active = true;
  const schedule = () => {
    if (!active || queued) return;
    queued = true;
    environment.queueMicrotask(() => {
      queued = false;
      if (active) callback();
    });
  };

  const history = environment.window.history;
  const originalPushState = history.pushState;
  const originalReplaceState = history.replaceState;
  history.pushState = function pushState(...args): void {
    originalPushState.apply(this, args);
    schedule();
  };
  history.replaceState = function replaceState(...args): void {
    originalReplaceState.apply(this, args);
    schedule();
  };

  environment.window.addEventListener('yt-navigate-finish', schedule);
  environment.window.addEventListener('popstate', schedule);
  const observer = new environment.MutationObserver(schedule);
  observer.observe(environment.document.documentElement, { childList: true, subtree: true });

  return () => {
    if (!active) return;
    active = false;
    environment.window.removeEventListener('yt-navigate-finish', schedule);
    environment.window.removeEventListener('popstate', schedule);
    observer.disconnect();
    history.pushState = originalPushState;
    history.replaceState = originalReplaceState;
  };
}
