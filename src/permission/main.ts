import type { RuntimeMessage } from '../contracts/messages';

const btn = document.querySelector<HTMLButtonElement>('#allow-btn');
const status = document.querySelector<HTMLDivElement>('#status-msg');

async function requestPermission() {
  if (status) {
    status.className = 'status';
    status.textContent = 'Prompting for camera permission…';
  }

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
    stream.getTracks().forEach((track) => track.stop());

    if (status) {
      status.className = 'status success';
      status.textContent = '✓ Permission granted! Activating eye control…';
    }

    const params = new URLSearchParams(window.location.search);
    const tabId = Number(params.get('tabId'));

    if (Number.isInteger(tabId) && tabId > 0) {
      await chrome.runtime.sendMessage({
        version: 1,
        type: 'START_SESSION',
        tabId,
      } satisfies RuntimeMessage);
    }

    setTimeout(() => {
      window.close();
    }, 600);
  } catch {
    if (status) {
      status.className = 'status error';
      status.textContent = "Camera permission was denied or dismissed. Please click the lock icon in Chrome's address bar and set Camera to Allow, then click 'Request Camera Access' again.";
    }
  }
}

btn?.addEventListener('click', () => {
  void requestPermission();
});

void requestPermission();
