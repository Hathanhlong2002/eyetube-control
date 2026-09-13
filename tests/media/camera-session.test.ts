import { describe, expect, it, vi } from 'vitest';

import { CameraSession } from '../../src/media/camera-session';

function createStream(trackStops: Array<ReturnType<typeof vi.fn>>): MediaStream {
  return {
    getTracks: () => trackStops.map((stop) => ({ kind: 'video', stop })),
  } as unknown as MediaStream;
}

describe('CameraSession', () => {
  it('requests the selected video device without audio', async () => {
    const stream = createStream([vi.fn()]);
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    const session = new CameraSession({ getUserMedia });

    await session.start('camera-1');

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: {
        deviceId: { exact: 'camera-1' },
        width: { ideal: 640 },
        height: { ideal: 480 },
      },
    });
  });

  it('uses a camera-independent constraint when no device is selected', async () => {
    const getUserMedia = vi.fn().mockResolvedValue(createStream([vi.fn()]));
    const session = new CameraSession({ getUserMedia });

    await session.start();

    expect(getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: { width: { ideal: 640 }, height: { ideal: 480 } },
    });
  });

  it('stops every owned track', async () => {
    const firstStop = vi.fn();
    const secondStop = vi.fn();
    const session = new CameraSession({
      getUserMedia: vi.fn().mockResolvedValue(createStream([firstStop, secondStop])),
    });

    await session.start();
    session.stop();

    expect(firstStop).toHaveBeenCalledOnce();
    expect(secondStop).toHaveBeenCalledOnce();
    expect(session.stream).toBeNull();
  });

  it('stops the previous stream before replacing it', async () => {
    const firstStop = vi.fn();
    const secondStop = vi.fn();
    const getUserMedia = vi.fn()
      .mockResolvedValueOnce(createStream([firstStop]))
      .mockResolvedValueOnce(createStream([secondStop]));
    const session = new CameraSession({ getUserMedia });

    await session.start();
    await session.start();

    expect(firstStop).toHaveBeenCalledOnce();
    expect(secondStop).not.toHaveBeenCalled();
  });

  it('has no active stream after permission failure', async () => {
    const session = new CameraSession({
      getUserMedia: vi.fn().mockRejectedValue(new DOMException('Denied', 'NotAllowedError')),
    });

    await expect(session.start()).rejects.toMatchObject({ name: 'NotAllowedError' });
    expect(session.stream).toBeNull();
  });
});

