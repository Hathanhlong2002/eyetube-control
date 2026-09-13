export const YOUTUBE_SELECTORS = {
  watchRoot: 'ytd-watch-flexy',
  video: 'video.html5-main-video',
  next: '.ytp-next-button',
  previous: '.ytp-prev-button',
  like: 'like-button-view-model button[aria-pressed], #segmented-like-button button[aria-pressed]',
  likeContainer: 'like-button-view-model, #segmented-like-button',
  subscribeRenderer: 'ytd-subscribe-button-renderer',
  signedInAvatar: '#avatar-btn',
  signInLink: 'a[href^="https://accounts.google.com/ServiceLogin"]',
} as const;

function isUsable(element: Element): boolean {
  if (!(element instanceof HTMLElement)) return false;
  if (element.hidden || element.closest('[hidden], [aria-hidden="true"]')) return false;
  const style = element.ownerDocument.defaultView?.getComputedStyle(element);
  if (style?.display === 'none' || style?.visibility === 'hidden') return false;
  if (element.getAttribute('aria-disabled') === 'true') return false;
  return !(element instanceof HTMLButtonElement) || !element.disabled;
}

export function uniqueUsable<T extends Element>(root: ParentNode, selector: string): T[] {
  return [...new Set(root.querySelectorAll<T>(selector))].filter(isUsable);
}

export function isWatchPageReady(root: ParentNode): boolean {
  return root.querySelector(YOUTUBE_SELECTORS.watchRoot) !== null;
}

export function isSignedIn(root: ParentNode): boolean {
  if (root.querySelector(YOUTUBE_SELECTORS.signInLink)) return false;
  return root.querySelector(YOUTUBE_SELECTORS.signedInAvatar) !== null;
}
