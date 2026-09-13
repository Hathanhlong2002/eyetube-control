export const YOUTUBE_SELECTORS = {
  watchRoot: 'ytd-watch-flexy',
  video: 'video.html5-main-video',
  next: '.ytp-next-button',
  // The player's next button is display:none unless a playlist or queue is
  // active, so the right-hand column is the reliable source of "next video".
  relatedVideo: '#related a[href*="/watch?v="], ytd-watch-next-secondary-results-renderer a[href*="/watch?v="]',
  like: 'like-button-view-model button[aria-pressed], #segmented-like-button button[aria-pressed]',
  likeContainer: 'like-button-view-model, #segmented-like-button',
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

/**
 * The sidebar renders two anchors per entry (thumbnail and title), so the Nth
 * anchor is not the Nth video. Collapse them by video id, keeping DOM order.
 */
export function relatedVideoLinks(root: ParentNode): HTMLAnchorElement[] {
  const seen = new Set<string>();
  const links: HTMLAnchorElement[] = [];
  for (const link of uniqueUsable<HTMLAnchorElement>(root, YOUTUBE_SELECTORS.relatedVideo)) {
    const match = /[?&]v=([\w-]+)/.exec(link.getAttribute('href') ?? '');
    if (!match?.[1] || seen.has(match[1])) continue;
    seen.add(match[1]);
    links.push(link);
  }
  return links;
}

/** Title of the sidebar entry at a 1-based position, when it can be read. */
export function relatedVideoTitle(root: ParentNode, position: number): string | null {
  const link = relatedVideoLinks(root)[position - 1];
  if (!link) return null;
  const lockup = link.closest('yt-lockup-view-model, ytd-compact-video-renderer') ?? link.parentElement;
  const title = lockup?.querySelector('span[role="text"], #video-title, h3')?.textContent?.trim();
  return title && title.length > 0 ? title : null;
}

export function isWatchPageReady(root: ParentNode): boolean {
  return root.querySelector(YOUTUBE_SELECTORS.watchRoot) !== null
    || root.querySelector('video') !== null
    || root.querySelector('#movie_player') !== null;
}

export function isSignedIn(root: ParentNode): boolean {
  if (root.querySelector(YOUTUBE_SELECTORS.signInLink)) return false;
  return root.querySelector(YOUTUBE_SELECTORS.signedInAvatar) !== null;
}
