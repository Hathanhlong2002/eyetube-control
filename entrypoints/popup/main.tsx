import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';

import type { RuntimeMessage } from '../../src/contracts/messages';
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
  const [activeTab, setActiveTab] = useState<chrome.tabs.Tab | null>(null);
  const [status, setStatus] = useState<RuntimeStatus>('OFF');
  const [statusReason, setStatusReason] = useState<StatusReason | undefined>();
  const [settings, setSettings] = useState<EyeControlSettings>(DEFAULT_SETTINGS);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);

  useEffect(() => {
    async function init() {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id && isYouTubeUrl(tab.url)) {
        setActiveTab(tab);
        const sessionRes = await chrome.storage.session?.get(SESSION_STORAGE_KEY);
        const metadata = sessionRes?.[SESSION_STORAGE_KEY] as { activeTabId?: number | null } | undefined;
        if (metadata?.activeTabId === tab.id) {
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
      }
    };

    chrome.runtime.onMessage.addListener(listener);
    return () => {
      chrome.runtime.onMessage.removeListener(listener);
    };
  }, []);

  const handleStart = async (deviceId?: string) => {
    let target = activeTab;
    if (!target?.id) {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      if (tab?.id && isYouTubeUrl(tab.url)) {
        target = tab;
        setActiveTab(tab);
      }
    }

    if (!target?.id) {
      setStatus('WARNING');
      setStatusReason('YOUTUBE_COMMAND_UNAVAILABLE');
      return;
    }

    setStatus('REQUESTING_PERMISSION');

    // Prompt user for camera permission directly in the popup extension context
    try {
      if (navigator.mediaDevices?.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: deviceId ? { deviceId: { exact: deviceId } } : true,
          audio: false,
        });
        stream.getTracks().forEach((track) => track.stop());
      }
    } catch {
      setStatus('ERROR');
      setStatusReason('CAMERA_DENIED');
      return;
    }

    await chrome.runtime.sendMessage({
      version: 1,
      type: 'START_SESSION',
      tabId: target.id,
    } satisfies RuntimeMessage);
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
