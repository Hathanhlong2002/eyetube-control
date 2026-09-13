import { describe, expect, it, vi } from 'vitest';

import { createFrameScaler, SCALED_HEIGHT, SCALED_WIDTH } from '../../src/media/frame-scaler';

function scalerWith(drawImage = vi.fn()) {
  const canvas = { getContext: () => ({ drawImage }) } as unknown as OffscreenCanvas;
  return { scaler: createFrameScaler({ createCanvas: () => canvas }), drawImage, canvas };
}

const readyVideo = { readyState: 4, videoWidth: 640, videoHeight: 480 } as HTMLVideoElement;

describe('createFrameScaler', () => {
  it('draws the frame down to the shared inference size', () => {
    const { scaler, drawImage, canvas } = scalerWith();
    expect(scaler.surface(readyVideo)).toBe(canvas);
    expect(drawImage).toHaveBeenCalledWith(readyVideo, 0, 0, SCALED_WIDTH, SCALED_HEIGHT);
  });

  it('is smaller than the capture resolution it replaces', () => {
    expect(SCALED_WIDTH * SCALED_HEIGHT).toBeLessThan(640 * 480);
  });

  it.each([
    { readyState: 0, videoWidth: 640, videoHeight: 480 },
    { readyState: 4, videoWidth: 0, videoHeight: 480 },
    { readyState: 4, videoWidth: 640, videoHeight: 0 },
  ])('returns null for a video that has no frame yet (%j)', (video) => {
    const { scaler, drawImage } = scalerWith();
    expect(scaler.surface(video as HTMLVideoElement)).toBeNull();
    expect(drawImage).not.toHaveBeenCalled();
  });

  it('returns null instead of throwing when the frame cannot be drawn', () => {
    const { scaler } = scalerWith(vi.fn(() => { throw new Error('detached'); }));
    expect(scaler.surface(readyVideo)).toBeNull();
  });
});
