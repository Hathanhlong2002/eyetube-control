import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';

import type { Gesture, RuntimeMessage } from '../../src/contracts/messages';
import {
  DEFAULT_SETTINGS,
  parseSettings,
  type EyeControlSettings,
} from '../../src/contracts/settings';
import type { RuntimeStatus, StatusReason } from '../../src/contracts/status';
import { PopupApp } from '../../src/popup/App';
import './style.css';

const SETTINGS_STORAGE_KEY = 'eyetube_settings';
const SESSION_STORAGE_KEY = 'eyetube_session';

function isYouTubeUrl(url: string | undefined): boolean {
  if (!url) return false;
  return /^https?:\/\/(www\.)?youtube\.com\//.test(url);
}

const Root: React.FC = () => {
  const isStandalone = typeof window !== 'undefined'
    && new URLSearchParams(window.location.search).get('standalone') === 'true';

  const [activeTab, setActiveTab] = useState<chrome.tabs.Tab | null>(null);
  const [status, setStatus] = useState<RuntimeStatus>('OFF');
  const [statusReason, setStatusReason] = useState<StatusReason | undefined>();
  const [settings, setSettings] = useState<EyeControlSettings>(DEFAULT_SETTINGS);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [lastGesture, setLastGesture] = useState<Gesture | undefined>();

  useEffect(() => {
    if (isStandalone) {
      document.body.classList.add('standalone');
    }

    async function init() {
      // Find active tab, or any open YouTube tab if opened in standalone window/tab
      let targetTab: chrome.tabs.Tab | null = null;
      try {
        const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
        if (current?.id && isYouTubeUrl(current.url)) {
          targetTab = current;
        } else {
          const allTabs = await chrome.tabs.query({});
          targetTab = allTabs.find((t) => Boolean(t.id && isYouTubeUrl(t.url))) ?? null;
        }
      } catch {
        // Query error
      }

      if (targetTab?.id) {
        setActiveTab(targetTab);
        const sessionRes = await chrome.storage.session?.get(SESSION_STORAGE_KEY);
        const metadata = sessionRes?.[SESSION_STORAGE_KEY] as { activeTabId?: number | null } | undefined;
        if (metadata?.activeTabId === targetTab.id) {
          setStatus('READY');
        }
      } else {
        setStatus('WARNING');
        setStatusReason('YOUTUBE_COMMAND_UNAVAILABLE');
      }

      const storedSettings = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
      if (storedSettings[SETTINGS_STORAGE_KEY]) {
        setSettings(parseSettings(storedSettings[SETTINGS_STORAGE_KEY]));
      }

      if (navigator.mediaDevices?.enumerateDevices) {
        try {
          const all = await navigator.mediaDevices.enumerateDevices();
          setDevices(all.filter((d) => d.kind === 'videoinput'));
        } catch {
          // ignore enumeration error
        }
      }
    }

    void init();

    let gestureTimeout: ReturnType<typeof setTimeout> | null = null;
    const listener = (input: unknown) => {
      if (typeof input !== 'object' || input === null) return;
      const msg = input as Record<string, unknown>;
      if (msg.type === 'STATUS' && typeof msg.status === 'string') {
        setStatus(msg.status as RuntimeStatus);
        if (typeof msg.reason === 'string') {
          setStatusReason(msg.reason as StatusReason);
        } else {
          setStatusReason(undefined);
        }
      } else if (msg.type === 'COMMAND') {
        setLastGesture('WINK_LEFT');
        if (gestureTimeout) clearTimeout(gestureTimeout);
        gestureTimeout = setTimeout(() => setLastGesture(undefined), 1800);
      } else if (msg.type === 'GESTURE_PROGRESS' && typeof msg.gesture === 'string') {
        setLastGesture(msg.gesture as Gesture);
      } else if (msg.type === 'GESTURE_CANCELLED') {
        if (gestureTimeout) clearTimeout(gestureTimeout);
        gestureTimeout = setTimeout(() => setLastGesture(undefined), 600);
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => {
      if (gestureTimeout) clearTimeout(gestureTimeout);
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, [isStandalone]);

  const handleOpenStandalone = async () => {
    const url = chrome.runtime.getURL('popup.html?standalone=true');
    try {
      if (chrome.windows?.create) {
        await chrome.windows.create({
          url,
          type: 'popup',
          width: 420,
          height: 700,
        });
      } else {
        await chrome.tabs.create({ url, active: true });
      }
    } catch {
      await chrome.tabs.create({ url, active: true });
    }
  };

  const handleStart = async (deviceId?: string) => {
    let target = activeTab;
    if (!target?.id) {
      const [current] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (current?.id && isYouTubeUrl(current.url)) {
        target = current;
        setActiveTab(current);
      } else {
        const allTabs = await chrome.tabs.query({});
        const ytTab = allTabs.find((t) => Boolean(t.id && isYouTubeUrl(t.url)));
        if (ytTab?.id) {
          target = ytTab;
          setActiveTab(ytTab);
        }
      }
    }

    if (!target?.id) {
      setStatus('WARNING');
      setStatusReason('YOUTUBE_COMMAND_UNAVAILABLE');
      return;
    }

    // Check if camera permission has already been granted to extension origin
    let isGranted = false;
    try {
      if (navigator.permissions?.query) {
        const queryRes = await navigator.permissions.query({ name: 'camera' as PermissionName });
        isGranted = queryRes.state === 'granted';
      }
    } catch {
      isGranted = false;
    }

    if (isGranted && statusReason !== 'CAMERA_DENIED') {
      setStatus('READY');
      await chrome.runtime.sendMessage({
        version: 1,
        type: 'START_SESSION',
        tabId: target.id,
      } satisfies RuntimeMessage);
    } else {
      // Open dedicated tab to reliably show the Chrome permission prompt
      const permissionUrl = chrome.runtime.getURL(`permission.html?tabId=${target.id}`);
      await chrome.tabs.create({ url: permissionUrl, active: true });
    }
  };

  const handleStop = async () => {
    if (!activeTab?.id) return;
    setStatus('OFF');
    await chrome.runtime.sendMessage({
      version: 1,
      type: 'STOP_SESSION',
      tabId: activeTab.id,
    } satisfies RuntimeMessage);
  };

  const handleSettingsChange = async (newSettings: EyeControlSettings) => {
    setSettings(newSettings);
    await chrome.storage.local.set({ [SETTINGS_STORAGE_KEY]: newSettings });
  };

  const handleResetGeometry = async () => {
    await chrome.storage.local.remove('tileGeometry');
  };

  const handleRecalibrate = async () => {
    if (!activeTab?.id) return;
    await chrome.runtime.sendMessage({
      version: 1,
      type: 'START_CALIBRATION',
      tabId: activeTab.id,
    } satisfies RuntimeMessage);
  };

  return (
    <PopupApp
      status={status}
      statusReason={statusReason}
      settings={settings}
      devices={devices}
      activeTabTitle={activeTab?.title}
      isStandalone={isStandalone}
      lastGesture={lastGesture}
      onOpenStandalone={handleOpenStandalone}
      onStart={handleStart}
      onStop={handleStop}
      onSettingsChange={handleSettingsChange}
      onRecalibrate={handleRecalibrate}
      onResetGeometry={handleResetGeometry}
    />
  );
};

const rootEl = document.getElementById('root');
if (rootEl) {
  ReactDOM.createRoot(rootEl).render(
    <React.StrictMode>
      <Root />
    </React.StrictMode>,
  );
}
