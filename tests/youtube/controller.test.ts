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

  it('returns unavailable when previous is absent', async () => {
    await expect(createYouTubeController(document).execute('PREVIOUS_VIDEO', 'cmd-prev')).resolves.toEqual({
      status: 'UNAVAILABLE', command: 'PREVIOUS_VIDEO', reason: 'NO_CONTROL',
    });
  });

  it.each([
    ['NEXT_VIDEO', '.ytp-next-button'],
    ['PREVIOUS_VIDEO', '.ytp-prev-button'],
  ] as const)('clicks one enabled %s control', async (command, selector) => {
    loadFixture('playlist');
    const button = document.querySelector<HTMLButtonElement>(selector)!;
    button.click = vi.fn();

    await expect(createYouTubeController(document).execute(command, `cmd-${command}`)).resolves.toEqual({
      status: 'EXECUTED', command,
    });
    expect(button.click).toHaveBeenCalledOnce();
  });

  it('fails closed when a navigation selector is ambiguous', async () => {
    document.querySelector('ytd-watch-flexy')?.insertAdjacentHTML(
      'beforeend', '<button class="ytp-next-button"></button>',
    );
    const buttons = [...document.querySelectorAll<HTMLButtonElement>('.ytp-next-button')];
    buttons.forEach((button) => { button.click = vi.fn(); });

    await expect(createYouTubeController(document).execute('NEXT_VIDEO', 'cmd-ambiguous')).resolves.toEqual({
      status: 'FAILED', command: 'NEXT_VIDEO', reason: 'YOUTUBE_UI_CHANGED',
    });
    buttons.forEach((button) => expect(button.click).not.toHaveBeenCalled());
  });

  it('ignores a CSS-hidden duplicate control', async () => {
    const hidden = document.createElement('button');
    hidden.className = 'ytp-next-button';
    hidden.style.display = 'none';
    hidden.click = vi.fn();
    document.querySelector('ytd-watch-flexy')?.append(hidden);
    const visible = document.querySelector<HTMLButtonElement>('.ytp-next-button')!;
    visible.click = vi.fn();

    await expect(createYouTubeController(document).execute('NEXT_VIDEO', 'cmd-visible')).resolves.toEqual({
      status: 'EXECUTED', command: 'NEXT_VIDEO',
    });
    expect(visible.click).toHaveBeenCalledOnce();
    expect(hidden.click).not.toHaveBeenCalled();
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
    await expect(controller.execute('SUBSCRIBE_CHANNEL', 'cmd-out-sub')).resolves.toEqual({
      status: 'UNAVAILABLE', command: 'SUBSCRIBE_CHANNEL', reason: 'NOT_SIGNED_IN',
    });
    accountButtons.forEach((button) => expect(button.click).not.toHaveBeenCalled());
  });

  it('does not toggle an already subscribed renderer', async () => {
    const renderer = document.querySelector('ytd-subscribe-button-renderer')!;
    renderer.setAttribute('subscribed', '');
    const subscribe = renderer.querySelector<HTMLButtonElement>('button')!;
    subscribe.click = vi.fn();

    await expect(createYouTubeController(document).execute('SUBSCRIBE_CHANNEL', 'cmd-sub')).resolves.toEqual({
      status: 'ALREADY_APPLIED', command: 'SUBSCRIBE_CHANNEL',
    });
    expect(subscribe.click).not.toHaveBeenCalled();
  });

  it('keeps duplicate results in a bounded 100-command cache', async () => {
    const next = document.querySelector<HTMLButtonElement>('.ytp-next-button')!;
    next.click = vi.fn();
    const controller = createYouTubeController(document);
    for (let index = 0; index < 101; index += 1) {
      await controller.execute('NEXT_VIDEO', `cmd-${index}`);
    }
    await controller.execute('NEXT_VIDEO', 'cmd-100');
    expect(next.click).toHaveBeenCalledTimes(101);
  });
});
