import { parseRuntimeMessage, type RuntimeMessage } from '../contracts/messages';
import type { MessageSenderLike } from './preview-router';

export type SessionMetadata = {
  activeTabId: number | null;
  recentCommandIds: string[];
};

export interface SessionStore {
  load(): Promise<unknown>;
  save(metadata: SessionMetadata): Promise<void>;
}

export interface SessionCoordinatorDependencies {
  runtimeId: string;
  store: SessionStore;
  ensureOffscreen(): Promise<void>;
  closeOffscreen(): Promise<void>;
  isEligibleTab(tabId: number): Promise<boolean>;
  sendToRuntime(message: RuntimeMessage): Promise<unknown>;
  sendToTab(tabId: number, message: RuntimeMessage): Promise<unknown>;
}

const EMPTY_SESSION: SessionMetadata = { activeTabId: null, recentCommandIds: [] };

function extensionPath(sender: MessageSenderLike, runtimeId: string): string | null {
  if (sender.id !== runtimeId || !sender.url) return null;
  try {
    const url = new URL(sender.url);
    return url.protocol === 'chrome-extension:' && url.hostname === runtimeId ? url.pathname : null;
  } catch {
    return null;
  }
}

function parseMetadata(input: unknown): SessionMetadata {
  if (typeof input !== 'object' || input === null) return { ...EMPTY_SESSION };
  const value = input as Record<string, unknown>;
  const activeTabId = value.activeTabId;
  const recentCommandIds = value.recentCommandIds;
  if (!(activeTabId === null || (typeof activeTabId === 'number' && Number.isInteger(activeTabId) && activeTabId >= 0))
    || !Array.isArray(recentCommandIds)
    || recentCommandIds.some((id) => typeof id !== 'string' || !/^[A-Za-z0-9-]{1,64}$/.test(id))) {
    return { ...EMPTY_SESSION };
  }
  return { activeTabId, recentCommandIds: [...new Set(recentCommandIds)].slice(-100) };
}

export class SessionCoordinator {
  #metadata: SessionMetadata = { ...EMPTY_SESSION };
  #loaded: Promise<void> | null = null;
  #queue: Promise<void> = Promise.resolve();

  constructor(private readonly dependencies: SessionCoordinatorDependencies) {}

  get activeTabId(): number | null {
    return this.#metadata.activeTabId;
  }

  handle(input: unknown, sender: MessageSenderLike): Promise<void> {
    const operation = this.#queue.then(() => this.#handle(input, sender));
    this.#queue = operation.catch(() => undefined);
    return operation;
  }

  async #restore(): Promise<void> {
    this.#loaded ??= this.dependencies.store.load().then((value) => {
      this.#metadata = parseMetadata(value);
    });
    await this.#loaded;
  }

  async #save(): Promise<void> {
    await this.dependencies.store.save({
      activeTabId: this.#metadata.activeTabId,
      recentCommandIds: [...this.#metadata.recentCommandIds],
    });
  }

  async #start(tabId: number): Promise<void> {
    if (!await this.dependencies.isEligibleTab(tabId)) return;
    if (this.#metadata.activeTabId !== null && this.#metadata.activeTabId !== tabId) {
      await this.#stop(this.#metadata.activeTabId);
    }
    try {
      await this.dependencies.ensureOffscreen();
      this.#metadata.activeTabId = tabId;
      await this.#save();
      await this.dependencies.sendToRuntime({ version: 1, type: 'START_SESSION', tabId });
      await this.dependencies.sendToTab(tabId, {
        version: 1,
        type: 'STATUS',
        tabId,
        status: 'REQUESTING_PERMISSION',
      });
    } catch (error) {
      this.#metadata.activeTabId = null;
      await this.#save();
      await this.dependencies.closeOffscreen();
      throw error;
    }
  }

  async #stop(tabId: number): Promise<void> {
    if (this.#metadata.activeTabId !== tabId) return;
    const stop: RuntimeMessage = { version: 1, type: 'STOP_SESSION', tabId };
    await this.dependencies.sendToRuntime(stop);
    await this.dependencies.sendToTab(tabId, stop);
    await this.dependencies.closeOffscreen();
    this.#metadata.activeTabId = null;
    await this.#save();
  }

  async #handle(input: unknown, sender: MessageSenderLike): Promise<void> {
    const message = parseRuntimeMessage(input);
    if (!message || sender.id !== this.dependencies.runtimeId) return;
    await this.#restore();
    const path = extensionPath(sender, this.dependencies.runtimeId);

    if (path === '/popup.html' || path === '/permission.html') {
      if (message.type === 'START_SESSION') await this.#start(message.tabId);
      else if (message.type === 'STOP_SESSION') await this.#stop(message.tabId);
      return;
    }

    if (this.#metadata.activeTabId === null || message.tabId !== this.#metadata.activeTabId) return;

    if (path === '/offscreen.html') {
      if (message.type === 'COMMAND') {
        if (this.#metadata.recentCommandIds.includes(message.commandId)) return;
        this.#metadata.recentCommandIds.push(message.commandId);
        this.#metadata.recentCommandIds = this.#metadata.recentCommandIds.slice(-100);
        await this.#save();
        await this.dependencies.sendToTab(message.tabId, message);
        await this.dependencies.sendToRuntime(message);
      } else if (message.type === 'STATUS') {
        await this.dependencies.sendToTab(message.tabId, message);
        await this.dependencies.sendToRuntime(message);
      } else if (message.type === 'GESTURE_PROGRESS'
        || message.type === 'GESTURE_CANCELLED'
        || message.type === 'DIAGNOSTIC') {
        await this.dependencies.sendToTab(message.tabId, message);
        await this.dependencies.sendToRuntime(message);
      } else if (message.type === 'PREVIEW_OFFER'
        || message.type === 'PREVIEW_CANDIDATE') {
        await this.dependencies.sendToTab(message.tabId, message);
      }
      return;
    }

    if (sender.tab?.id !== this.#metadata.activeTabId) return;
    if (message.type === 'STOP_SESSION') await this.#stop(message.tabId);
    else if (message.type === 'PREVIEW_ANSWER'
      || message.type === 'PREVIEW_CANDIDATE'
      || message.type === 'SESSION_VISIBILITY') {
      await this.dependencies.sendToRuntime(message);
    }
  }
}
