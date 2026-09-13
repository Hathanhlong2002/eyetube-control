import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EyeControlOverlay, type EyeControlOverlayProps } from '../../src/overlay/App';

function props(overrides: Partial<EyeControlOverlayProps> = {}): EyeControlOverlayProps {
  return {
    status: 'READY',
    reason: undefined,
    preview: null,
    geometry: { x: 16, y: 16, width: 240, height: 180 },
    minimized: false,
    gesture: undefined,
    progress: undefined,
    completedCommand: undefined,
    calibrationStep: undefined,
    hint: undefined,
    metrics: undefined,
    onGeometryChange: vi.fn(),
    onMinimizedChange: vi.fn(),
    onStop: vi.fn(),
    ...overrides,
  };
}

describe('EyeControlOverlay', () => {
  it.each([
    ['SEARCHING', undefined, 'Center your face'],
    ['READY', undefined, 'Ready'],
    ['ERROR', 'CAMERA_DENIED', 'Camera permission was denied'],
  ] as const)('announces %s with text, not color alone', (status, reason, text) => {
    render(<EyeControlOverlay {...props({ status, reason })} />);
    expect(screen.getByRole('status')).toHaveTextContent(text);
  });

  it('offers keyboard-accessible minimize and stop controls in focus order', () => {
    render(<EyeControlOverlay {...props()} />);
    const minimize = screen.getByRole('button', { name: 'Minimize camera preview' });
    const stop = screen.getByRole('button', { name: 'Stop eye control' });
    expect(minimize).toBeVisible();
    expect(stop).toBeVisible();
    expect([...screen.getAllByRole('button')]).toEqual([minimize, stop, expect.any(HTMLButtonElement)]);
  });

  it('shows a labelled progress bar for a held gesture', () => {
    render(<EyeControlOverlay {...props({ gesture: 'GAZE_UP', progress: 0.4 })} />);
    expect(screen.getByRole('progressbar', { name: 'Like video progress' })).toHaveAttribute('aria-valuenow', '40');
    expect(screen.getByRole('status')).toHaveTextContent('Hold look up to like');
  });

  it('announces completed commands and calibration progress', () => {
    const { rerender } = render(<EyeControlOverlay {...props({ completedCommand: 'NEXT_VIDEO' })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Next video completed');
    rerender(<EyeControlOverlay {...props({ status: 'CALIBRATING', calibrationStep: 2 })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Calibration 2 of 5');
  });

  it('keeps a text camera-active indicator and controls when minimized', () => {
    render(<EyeControlOverlay {...props({ minimized: true })} />);
    expect(screen.getByRole('status')).toHaveTextContent('Camera active');
    expect(screen.getByRole('button', { name: 'Show camera preview' })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Stop eye control' })).toBeVisible();
  });

  it('calls explicit minimize and stop actions', () => {
    const onMinimizedChange = vi.fn();
    const onStop = vi.fn();
    render(<EyeControlOverlay {...props({ onMinimizedChange, onStop })} />);
    fireEvent.click(screen.getByRole('button', { name: 'Minimize camera preview' }));
    fireEvent.click(screen.getByRole('button', { name: 'Stop eye control' }));
    expect(onMinimizedChange).toHaveBeenCalledWith(true);
    expect(onStop).toHaveBeenCalledOnce();
  });
});
