import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createYouTubeController } from '../../src/youtube/controller';

function loadFixture(name: string): void {
  document.body.innerHTML = readFileSync(resolve(`tests/fixtures/youtube/${name}.html`), 'utf8');
}

function mockVideo(paused: boolean) {
  const video = document.querySelector('video');
  if (!(video instanceof HTMLVideoElement)) throw new Error('fixture has no video');
  Object.defineProperty(video, 'paused', { configurable: true, value: paused });
  video.play = vi.fn().mockResolvedValue(undefined);
  video.pause = vi.fn();
  return video;
}

describe('YouTubeController', () => {
  beforeEach(() => loadFixture('watch'));

  it('toggles the real video element without clicking unrelated DOM', async () => {
    const video = mockVideo(true);
    const unrelated = document.createElement('button');
    unrelated.click = vi.fn();
    document.body.append(unrelated);

    const result = await createYouTubeController(document).execute('TOGGLE_PLAYBACK', 'cmd-1');

    expect(video.play).toHaveBeenCalledOnce();
    expect(unrelated.click).not.toHaveBeenCalled();
    expect(result).toEqual({ status: 'EXECUTED', command: 'TOGGLE_PLAYBACK' });
  });

  it('pauses a playing video', async () => {
    const video = mockVideo(false);
    await createYouTubeController(document).execute('TOGGLE_PLAYBACK', 'cmd-2');
    expect(video.pause).toHaveBeenCalledOnce();
  });

  it('opens the first video in the right-hand column for NEXT_VIDEO', async () => {
    const links = [...document.querySelectorAll<HTMLAnchorElement>('#related a')];
    links.forEach((link) => { link.click = vi.fn(); });
    const playerNext = document.querySelector<HTMLButtonElement>('.ytp-next-button')!;
    playerNext.click = vi.fn();

    await expect(createYouTubeController(document).execute('NEXT_VIDEO', 'cmd-next')).resolves.toEqual({
      status: 'EXECUTED', command: 'NEXT_VIDEO',
    });
    expect(links[0]!.click).toHaveBeenCalledOnce();
    links.slice(1).forEach((link) => expect(link.click).not.toHaveBeenCalled());
    // The player's own next button is display:none on an ordinary watch page.
    expect(playerNext.click).not.toHaveBeenCalled();
  });

  it('skips sidebar links that are not watch links', async () => {
    const related = document.querySelector('#related')!;
    related.insertAdjacentHTML('afterbegin', '<a href="/results?search_query=x">search</a>');
    const watchLink = document.querySelector<HTMLAnchorElement>('#related a[href*="/watch"]')!;
    watchLink.click = vi.fn();

    await createYouTubeController(document).execute('NEXT_VIDEO', 'cmd-next-skip');
    expect(watchLink.click).toHaveBeenCalledOnce();
  });

  it('ignores a CSS-hidden sidebar entry', async () => {
    const hidden = document.querySelector<HTMLAnchorElement>('#related a')!;
    hidden.style.display = 'none';
    hidden.click = vi.fn();
    const visible = [...document.querySelectorAll<HTMLAnchorElement>('#related a')][1]!;
    visible.click = vi.fn();

    await expect(createYouTubeController(document).execute('NEXT_VIDEO', 'cmd-visible')).resolves.toEqual({
      status: 'EXECUTED', command: 'NEXT_VIDEO',
    });
    expect(visible.click).toHaveBeenCalledOnce();
    expect(hidden.click).not.toHaveBeenCalled();
  });

  it('falls back to the player next button when a playlist is running', async () => {
    loadFixture('playlist');
    const button = document.querySelector<HTMLButtonElement>('.ytp-next-button')!;
    button.click = vi.fn();

    await expect(createYouTubeController(document).execute('NEXT_VIDEO', 'cmd-playlist-next')).resolves.toEqual({
      status: 'EXECUTED', command: 'NEXT_VIDEO',
    });
    expect(button.click).toHaveBeenCalledOnce();
  });

  it('steps back through history for PREVIOUS_VIDEO', async () => {
    const back = vi.fn();
    Object.defineProperty(window.history, 'length', { configurable: true, value: 3 });
    Object.defineProperty(window.history, 'back', { configurable: true, value: back });

    await expect(createYouTubeController(document).execute('PREVIOUS_VIDEO', 'cmd-prev')).resolves.toEqual({
      status: 'EXECUTED', command: 'PREVIOUS_VIDEO',
    });
    expect(back).toHaveBeenCalledOnce();
  });

  it('returns unavailable when there is nothing to go back to', async () => {
    const back = vi.fn();
    Object.defineProperty(window.history, 'length', { configurable: true, value: 1 });
    Object.defineProperty(window.history, 'back', { configurable: true, value: back });

    await expect(createYouTubeController(document).execute('PREVIOUS_VIDEO', 'cmd-prev-none')).resolves.toEqual({
      status: 'UNAVAILABLE', command: 'PREVIOUS_VIDEO', reason: 'NO_CONTROL',
    });
    expect(back).not.toHaveBeenCalled();
  });

  it('reports PAGE_NOT_READY outside a watch page', async () => {
    document.body.innerHTML = '';
    await expect(createYouTubeController(document).execute('NEXT_VIDEO', 'cmd-not-ready')).resolves.toEqual({
      status: 'UNAVAILABLE', command: 'NEXT_VIDEO', reason: 'PAGE_NOT_READY',
    });
  });

  it('does not click an already pressed Like button', async () => {
    const like = document.querySelector<HTMLButtonElement>('like-button-view-model button')!;
    like.setAttribute('aria-pressed', 'true');
    like.click = vi.fn();

    await expect(createYouTubeController(document).execute('LIKE_VIDEO', 'cmd-like')).resolves.toEqual({
      status: 'ALREADY_APPLIED', command: 'LIKE_VIDEO',
    });
    expect(like.click).not.toHaveBeenCalled();
  });

  it('clicks Like once only when aria-pressed is explicitly false', async () => {
    const like = document.querySelector<HTMLButtonElement>('like-button-view-model button')!;
    like.click = vi.fn();
    const controller = createYouTubeController(document);

    const first = await controller.execute('LIKE_VIDEO', 'cmd-like-once');
    const duplicate = await controller.execute('LIKE_VIDEO', 'cmd-like-once');

    expect(first).toEqual({ status: 'EXECUTED', command: 'LIKE_VIDEO' });
    expect(duplicate).toEqual(first);
    expect(like.click).toHaveBeenCalledOnce();
  });

  it('fails closed when Like has no semantic pressed state', async () => {
    const like = document.querySelector<HTMLButtonElement>('like-button-view-model button')!;
    like.removeAttribute('aria-pressed');
    like.click = vi.fn();

    await expect(createYouTubeController(document).execute('LIKE_VIDEO', 'cmd-like-state')).resolves.toEqual({
      status: 'FAILED', command: 'LIKE_VIDEO', reason: 'YOUTUBE_UI_CHANGED',
    });
    expect(like.click).not.toHaveBeenCalled();
  });

  it('does not click account controls while signed out', async () => {
    loadFixture('signed-out');
    const accountButtons = [...document.querySelectorAll<HTMLButtonElement>('button')];
    accountButtons.forEach((button) => { button.click = vi.fn(); });
    const controller = createYouTubeController(document);

    await expect(controller.execute('LIKE_VIDEO', 'cmd-out-like')).resolves.toEqual({
      status: 'UNAVAILABLE', command: 'LIKE_VIDEO', reason: 'NOT_SIGNED_IN',
    });
    accountButtons.forEach((button) => expect(button.click).not.toHaveBeenCalled());
  });

  it('never touches the subscribe button, which is no longer eye controlled', async () => {
    const renderer = document.querySelector('ytd-subscribe-button-renderer')!;
    const subscribe = renderer.querySelector<HTMLButtonElement>('button')!;
    subscribe.click = vi.fn();

    document.querySelectorAll<HTMLAnchorElement>('#related a').forEach((link) => { link.click = vi.fn(); });
    const controller = createYouTubeController(document);
    for (const command of ['TOGGLE_PLAYBACK', 'NEXT_VIDEO', 'PREVIOUS_VIDEO', 'LIKE_VIDEO'] as const) {
      await controller.execute(command, `cmd-${command}`);
    }
    expect(subscribe.click).not.toHaveBeenCalled();
  });

  it('keeps duplicate results in a bounded 100-command cache', async () => {
    const next = document.querySelector<HTMLAnchorElement>('#related a[href*="/watch"]')!;
    next.click = vi.fn();
    const controller = createYouTubeController(document);
    for (let index = 0; index < 101; index += 1) {
      await controller.execute('NEXT_VIDEO', `cmd-${index}`);
    }
    await controller.execute('NEXT_VIDEO', 'cmd-100');
    expect(next.click).toHaveBeenCalledTimes(101);
  });
});
