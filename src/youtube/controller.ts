import type { Command } from '../contracts/messages';
import type { CommandResult } from '../contracts/status';
import {
  isSignedIn,
  isWatchPageReady,
  uniqueUsable,
  YOUTUBE_SELECTORS,
} from './semantics';

export interface YouTubeController {
  execute(command: Command, commandId: string): Promise<CommandResult>;
}

function unavailable(command: Command, reason: 'NO_CONTROL' | 'NOT_SIGNED_IN' | 'PAGE_NOT_READY'): CommandResult {
  return { status: 'UNAVAILABLE', command, reason };
}

function changed(command: Command): CommandResult {
  return { status: 'FAILED', command, reason: 'YOUTUBE_UI_CHANGED' };
}

class LocalYouTubeController implements YouTubeController {
  #results = new Map<string, CommandResult>();

  constructor(private readonly root: Document) {}

  async execute(command: Command, commandId: string): Promise<CommandResult> {
    const previous = this.#results.get(commandId);
    if (previous) return previous;

    let result: CommandResult;
    try {
      result = await this.#executeOnce(command);
    } catch {
      result = changed(command);
    }
    this.#results.set(commandId, result);
    if (this.#results.size > 100) {
      const oldest = this.#results.keys().next().value as string | undefined;
      if (oldest !== undefined) this.#results.delete(oldest);
    }
    return result;
  }

  async #executeOnce(command: Command): Promise<CommandResult> {
    if (!isWatchPageReady(this.root)) return unavailable(command, 'PAGE_NOT_READY');

    if (command === 'TOGGLE_PLAYBACK') {
      const videos = uniqueUsable<HTMLVideoElement>(this.root, YOUTUBE_SELECTORS.video);
      if (videos.length === 0) return unavailable(command, 'NO_CONTROL');
      if (videos.length !== 1) return changed(command);
      const video = videos[0]!;
      if (video.paused) await video.play();
      else video.pause();
      return { status: 'EXECUTED', command };
    }

    if (command === 'NEXT_VIDEO' || command === 'PREVIOUS_VIDEO') {
      const selector = command === 'NEXT_VIDEO' ? YOUTUBE_SELECTORS.next : YOUTUBE_SELECTORS.previous;
      const controls = uniqueUsable<HTMLElement>(this.root, selector);
      if (controls.length === 0) return unavailable(command, 'NO_CONTROL');
      if (controls.length !== 1) return changed(command);
      controls[0]!.click();
      return { status: 'EXECUTED', command };
    }

    if (!isSignedIn(this.root)) return unavailable(command, 'NOT_SIGNED_IN');

    if (command === 'LIKE_VIDEO') {
      const containers = uniqueUsable<HTMLElement>(this.root, YOUTUBE_SELECTORS.likeContainer);
      if (containers.length !== 1) return containers.length === 0
        ? unavailable(command, 'NO_CONTROL')
        : changed(command);
      const buttons = uniqueUsable<HTMLButtonElement>(containers[0]!, 'button');
      if (buttons.length !== 1) return buttons.length === 0 ? unavailable(command, 'NO_CONTROL') : changed(command);
      const pressed = buttons[0]!.getAttribute('aria-pressed');
      if (pressed === 'true') return { status: 'ALREADY_APPLIED', command };
      if (pressed !== 'false') return changed(command);
      buttons[0]!.click();
      return { status: 'EXECUTED', command };
    }

    const renderers = uniqueUsable<HTMLElement>(this.root, YOUTUBE_SELECTORS.subscribeRenderer);
    if (renderers.length !== 1) return renderers.length === 0
      ? unavailable(command, 'NO_CONTROL')
      : changed(command);
    const renderer = renderers[0]!;
    if (renderer.hasAttribute('subscribed')) return { status: 'ALREADY_APPLIED', command };
    const buttons = uniqueUsable<HTMLButtonElement>(renderer, 'button');
    if (buttons.length !== 1) return buttons.length === 0 ? unavailable(command, 'NO_CONTROL') : changed(command);
    buttons[0]!.click();
    return { status: 'EXECUTED', command };
  }
}

export function createYouTubeController(root: Document = document): YouTubeController {
  return new LocalYouTubeController(root);
}
