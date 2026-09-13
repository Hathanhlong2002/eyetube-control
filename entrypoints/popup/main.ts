import type { RuntimeMessage } from '../../src/contracts/messages';

import './style.css';

const status = document.querySelector<HTMLParagraphElement>('#status');
const start = document.querySelector<HTMLButtonElement>('#start');
const stop = document.querySelector<HTMLButtonElement>('#stop');

async function activeYouTubeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id !== undefined && tab.url?.startsWith('https://www.youtube.com/') ? tab : null;
}

async function send(type: 'START_SESSION' | 'STOP_SESSION'): Promise<void> {
  const tab = await activeYouTubeTab();
  if (!tab?.id) {
    if (status) status.textContent = 'Open a YouTube video first.';
    return;
  }
  await chrome.runtime.sendMessage({ version: 1, type, tabId: tab.id } satisfies RuntimeMessage);
  if (status) status.textContent = type === 'START_SESSION' ? 'Camera starting…' : 'Camera stopped.';
}

start?.addEventListener('click', () => void send('START_SESSION'));
stop?.addEventListener('click', () => void send('STOP_SESSION'));
