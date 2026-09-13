import { parseRuntimeMessage, type RuntimeMessage } from '../contracts/messages';

export type MessageSenderLike = {
  id?: string | undefined;
  url?: string | undefined;
  tab?: { id?: number | undefined } | undefined;
};

export interface PreviewRouterDependencies {
  runtimeId: string;
  ensureOffscreen(): Promise<void>;
  closeOffscreen(): Promise<void>;
  sendToRuntime(message: RuntimeMessage): Promise<unknown>;
  sendToTab(tabId: number, message: RuntimeMessage): Promise<unknown>;
}

function isOffscreenSender(sender: MessageSenderLike, runtimeId: string): boolean {
  if (sender.id !== runtimeId || !sender.url) return false;
  try {
    const url = new URL(sender.url);
    return url.protocol === 'chrome-extension:'
      && url.hostname === runtimeId
      && url.pathname === '/offscreen.html';
  } catch {
    return false;
  }
}

function isExtensionPageSender(sender: MessageSenderLike, runtimeId: string): boolean {
  if (sender.id !== runtimeId || !sender.url) return false;
  try {
    const url = new URL(sender.url);
    return url.protocol === 'chrome-extension:'
      && url.hostname === runtimeId
      && url.pathname === '/popup.html';
  } catch {
    return false;
  }
}

export class PreviewRouter {
  #activeTabId: number | null = null;

  constructor(private readonly dependencies: PreviewRouterDependencies) {}

  get activeTabId(): number | null {
    return this.#activeTabId;
  }

  async start(tabId: number): Promise<void> {
    if (!Number.isInteger(tabId) || tabId < 0) return;
    if (this.#activeTabId !== null && this.#activeTabId !== tabId) {
      await this.stop(this.#activeTabId);
    }
    await this.dependencies.ensureOffscreen();
    this.#activeTabId = tabId;
    await this.dependencies.sendToRuntime({ version: 1, type: 'START_SESSION', tabId });
    await this.dependencies.sendToTab(tabId, {
      version: 1,
      type: 'STATUS',
      tabId,
      status: 'REQUESTING_PERMISSION',
    });
  }

  async stop(tabId: number): Promise<void> {
    if (this.#activeTabId !== tabId) return;
    const message: RuntimeMessage = { version: 1, type: 'STOP_SESSION', tabId };
    await this.dependencies.sendToRuntime(message);
    await this.dependencies.sendToTab(tabId, message);
    await this.dependencies.closeOffscreen();
    this.#activeTabId = null;
  }

  async handle(input: unknown, sender: MessageSenderLike): Promise<void> {
    const message = parseRuntimeMessage(input);
    if (!message || sender.id !== this.dependencies.runtimeId) return;

    if (isExtensionPageSender(sender, this.dependencies.runtimeId)
      && !isOffscreenSender(sender, this.dependencies.runtimeId)) {
      if (message.type === 'START_SESSION') await this.start(message.tabId);
      else if (message.type === 'STOP_SESSION') await this.stop(message.tabId);
      return;
    }

    if (this.#activeTabId === null || message.tabId !== this.#activeTabId) return;

    if (isOffscreenSender(sender, this.dependencies.runtimeId)) {
      if (message.type === 'PREVIEW_OFFER'
        || message.type === 'PREVIEW_CANDIDATE'
        || message.type === 'STATUS'
        || message.type === 'GESTURE_PROGRESS'
        || message.type === 'GESTURE_CANCELLED'
        || message.type === 'COMMAND') {
        await this.dependencies.sendToTab(this.#activeTabId, message);
      }
      return;
    }

    if (sender.tab?.id !== this.#activeTabId) return;
    if (message.type === 'STOP_SESSION') {
      await this.stop(message.tabId);
      return;
    }
    if (message.type === 'PREVIEW_ANSWER' || message.type === 'PREVIEW_CANDIDATE') {
      await this.dependencies.sendToRuntime(message);
    }
  }
}
