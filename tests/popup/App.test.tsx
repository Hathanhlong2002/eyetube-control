import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DEFAULT_SETTINGS } from '../../src/contracts/settings';
import { PopupApp } from '../../src/popup/App';

describe('PopupApp', () => {
  it('starts only after an explicit button click', () => {
    const start = vi.fn();
    render(<PopupApp status="OFF" settings={DEFAULT_SETTINGS} onStart={start} onStop={vi.fn()} onSettingsChange={vi.fn()} />);
    expect(start).not.toHaveBeenCalled();

    const startButton = screen.getByRole('button', { name: /start eye control/i });
    fireEvent.click(startButton);
    expect(start).toHaveBeenCalledOnce();
  });

  it('stops eye control on explicit stop button click', () => {
    const stop = vi.fn();
    render(<PopupApp status="READY" settings={DEFAULT_SETTINGS} onStart={vi.fn()} onStop={stop} onSettingsChange={vi.fn()} />);

    const stopButton = screen.getByRole('button', { name: /stop eye control/i });
    fireEvent.click(stopButton);
    expect(stop).toHaveBeenCalledOnce();
  });

  it('announces current status with accessible role', () => {
    render(<PopupApp status="READY" settings={DEFAULT_SETTINGS} onStart={vi.fn()} onStop={vi.fn()} onSettingsChange={vi.fn()} />);
    const statusEl = screen.getByRole('status');
    expect(statusEl).toHaveTextContent(/ready/i);
  });

  it('allows toggling gesture enablement', () => {
    const updateSettings = vi.fn();
    render(<PopupApp status="READY" settings={DEFAULT_SETTINGS} onStart={vi.fn()} onStop={vi.fn()} onSettingsChange={updateSettings} />);

    const winkLeftCheckbox = screen.getByRole('checkbox', { name: /wink left/i });
    fireEvent.click(winkLeftCheckbox);
    expect(updateSettings).toHaveBeenCalledWith(expect.objectContaining({
      enabledGestures: expect.objectContaining({ WINK_LEFT: false }),
    }));
  });

  it('provides reset tile position control', () => {
    const reset = vi.fn();
    render(<PopupApp status="READY" settings={DEFAULT_SETTINGS} onStart={vi.fn()} onStop={vi.fn()} onSettingsChange={vi.fn()} onResetGeometry={reset} />);

    const resetButton = screen.getByRole('button', { name: /reset tile position/i });
    fireEvent.click(resetButton);
    expect(reset).toHaveBeenCalledOnce();
  });

  it('displays local privacy guarantee notice', () => {
    render(<PopupApp status="OFF" settings={DEFAULT_SETTINGS} onStart={vi.fn()} onStop={vi.fn()} onSettingsChange={vi.fn()} />);
    expect(screen.getByText(/local/i)).toBeInTheDocument();
  });
});
