import React, { useState } from 'react';

import type { Gesture } from '../contracts/messages';
import {
  DEFAULT_SETTINGS,
  SETTINGS_LIMITS,
  type EyeControlSettings,
} from '../contracts/settings';
import type { RuntimeStatus, StatusReason } from '../contracts/status';

export interface PopupAppProps {
  status: RuntimeStatus;
  statusReason?: StatusReason | undefined;
  settings?: EyeControlSettings | undefined;
  devices?: MediaDeviceInfo[] | undefined;
  selectedDeviceId?: string | undefined;
  onStart: (deviceId?: string) => Promise<void> | void;
  onStop: () => Promise<void> | void;
  onSettingsChange: (settings: EyeControlSettings) => Promise<void> | void;
  onRecalibrate?: (() => Promise<void> | void) | undefined;
  onResetGeometry?: (() => Promise<void> | void) | undefined;
}

const GESTURE_LABELS: Record<Gesture, { label: string; action: string }> = {
  WINK_LEFT: { label: 'Wink Left', action: 'Previous video' },
  WINK_RIGHT: { label: 'Wink Right', action: 'Next video' },
  BOTH_CLOSED: { label: 'Both Eyes Closed', action: 'Play / Pause' },
  GAZE_UP: { label: 'Look Up', action: 'Like video' },
  GAZE_DOWN: { label: 'Look Down', action: 'Subscribe channel' },
};

function statusLabel(status: RuntimeStatus, reason?: StatusReason): string {
  switch (status) {
    case 'OFF':
      return 'Eye control is off';
    case 'REQUESTING_PERMISSION':
      return 'Requesting camera permission…';
    case 'SEARCHING':
      return 'Searching: Center your face';
    case 'CALIBRATING':
      return 'Calibrating eye gestures…';
    case 'READY':
      return 'Ready for eye gestures';
    case 'HOLDING':
      return 'Holding gesture…';
    case 'COMMAND_COMPLETED':
      return 'Command executed';
    case 'WARNING':
      return reason === 'YOUTUBE_COMMAND_UNAVAILABLE'
        ? 'Action currently unavailable on this page'
        : 'Warning: Detection uncertain';
    case 'ERROR':
      if (reason === 'CAMERA_DENIED') return 'Camera permission was denied';
      if (reason === 'CAMERA_UNAVAILABLE') return 'Camera device unavailable';
      if (reason === 'MODEL_LOAD_FAILED') return 'Failed to load local vision model';
      return 'An error occurred with eye control';
    default:
      return status;
  }
}

export const PopupApp: React.FC<PopupAppProps> = ({
  status,
  statusReason,
  settings = DEFAULT_SETTINGS,
  devices = [],
  selectedDeviceId,
  onStart,
  onStop,
  onSettingsChange,
  onRecalibrate,
  onResetGeometry,
}) => {
  const [currentDeviceId, setCurrentDeviceId] = useState<string | undefined>(selectedDeviceId);
  const isRunning = status !== 'OFF' && status !== 'ERROR';

  const handleToggleGesture = (gesture: Gesture, enabled: boolean) => {
    onSettingsChange({
      ...settings,
      enabledGestures: {
        ...settings.enabledGestures,
        [gesture]: enabled,
      },
    });
  };

  const handleDurationChange = (key: 'navigationHoldMs' | 'accountHoldMs' | 'cooldownMs', value: number) => {
    onSettingsChange({
      ...settings,
      [key]: value,
    });
  };

  const handlePreviewStateChange = (minimized: boolean) => {
    onSettingsChange({
      ...settings,
      previewState: minimized ? 'MINIMIZED' : 'SHOWN',
    });
  };

  return (
    <div className="eyetube-popup">
      <header className="popup-header">
        <div className="title-row">
          <svg className="app-icon" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          <h1>EyeTube Control</h1>
        </div>
        <div
          role="status"
          aria-live="polite"
          className={`status-badge status-${status.toLowerCase()}`}
        >
          <span className="status-dot" aria-hidden="true" />
          <span className="status-text">{statusLabel(status, statusReason)}</span>
        </div>
      </header>

      <section className="popup-main-actions">
        {isRunning ? (
          <button
            type="button"
            className="action-btn stop-btn"
            onClick={() => void onStop()}
          >
            Stop eye control
          </button>
        ) : (
          <button
            type="button"
            className="action-btn start-btn"
            onClick={() => void onStart(currentDeviceId)}
          >
            Start eye control
          </button>
        )}

        {onRecalibrate && isRunning && (
          <button
            type="button"
            className="secondary-btn"
            onClick={() => void onRecalibrate()}
          >
            Recalibrate gestures
          </button>
        )}
      </section>

      {devices.length > 1 && (
        <section className="setting-group">
          <label htmlFor="camera-select" className="group-label">Camera device</label>
          <select
            id="camera-select"
            className="select-input"
            value={currentDeviceId ?? ''}
            onChange={(e) => setCurrentDeviceId(e.target.value || undefined)}
          >
            {devices.map((device, idx) => (
              <option key={device.deviceId || idx} value={device.deviceId}>
                {device.label || `Camera ${idx + 1}`}
              </option>
            ))}
          </select>
        </section>
      )}

      <section className="setting-group">
        <h2 className="group-label">Overlay & Tile</h2>
        <div className="button-row">
          <button
            type="button"
            className="pill-btn"
            onClick={() => handlePreviewStateChange(settings.previewState !== 'MINIMIZED')}
          >
            {settings.previewState === 'MINIMIZED' ? 'Show camera tile' : 'Minimize to pill'}
          </button>
          {onResetGeometry && (
            <button
              type="button"
              className="pill-btn"
              onClick={() => void onResetGeometry()}
            >
              Reset tile position
            </button>
          )}
        </div>
      </section>

      <section className="setting-group">
        <h2 className="group-label">Gestures & Actions</h2>
        <div className="gesture-list">
          {(Object.keys(GESTURE_LABELS) as Gesture[]).map((gesture) => {
            const { label, action } = GESTURE_LABELS[gesture];
            const isEnabled = settings.enabledGestures[gesture] ?? true;
            return (
              <label key={gesture} className="gesture-toggle-item">
                <input
                  type="checkbox"
                  checked={isEnabled}
                  onChange={(e) => handleToggleGesture(gesture, e.target.checked)}
                />
                <div className="gesture-info">
                  <span className="gesture-name">{label}</span>
                  <span className="gesture-action">{action}</span>
                </div>
              </label>
            );
          })}
        </div>
      </section>

      <section className="setting-group">
        <h2 className="group-label">Hold Durations</h2>
        <div className="range-item">
          <label htmlFor="nav-hold">Navigation Hold: {settings.navigationHoldMs} ms</label>
          <input
            id="nav-hold"
            type="range"
            min={SETTINGS_LIMITS.navigationHoldMs.min}
            max={SETTINGS_LIMITS.navigationHoldMs.max}
            step={50}
            value={settings.navigationHoldMs}
            onChange={(e) => handleDurationChange('navigationHoldMs', Number(e.target.value))}
          />
        </div>
        <div className="range-item">
          <label htmlFor="acc-hold">Like / Subscribe Hold: {settings.accountHoldMs} ms</label>
          <input
            id="acc-hold"
            type="range"
            min={SETTINGS_LIMITS.accountHoldMs.min}
            max={SETTINGS_LIMITS.accountHoldMs.max}
            step={100}
            value={settings.accountHoldMs}
            onChange={(e) => handleDurationChange('accountHoldMs', Number(e.target.value))}
          />
        </div>
      </section>

      <footer className="popup-footer">
        <p className="privacy-notice">
          <strong>100% Local:</strong> Camera frames and landmarks are processed strictly on your device. No video or biometric data is ever saved or transmitted.
        </p>
      </footer>
    </div>
  );
};
