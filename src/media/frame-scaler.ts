/**
 * Shared downscaled copy of the camera frame.
 *
 * MediaPipe's palm detector works at 192x192, so handing it a 640x480 video
 * element makes it resize the full frame on every call. Drawing one reduced
 * surface per loop and reusing it for both hand tracking and motion sampling
 * replaces that with a single much smaller copy.
 */
export const SCALED_WIDTH = 320;
export const SCALED_HEIGHT = 240;

export interface FrameScaler {
  /** The current frame at reduced size, or null when the video has no frame yet. */
  surface(video: HTMLVideoElement): TexImageSource | null;
}

export type FrameScalerDependencies = {
  createCanvas(width: number, height: number): OffscreenCanvas;
};

export function createFrameScaler(
  dependencies: FrameScalerDependencies = {
    createCanvas: (width, height) => new OffscreenCanvas(width, height),
  },
): FrameScaler {
  const canvas = dependencies.createCanvas(SCALED_WIDTH, SCALED_HEIGHT);
  const context = canvas.getContext('2d', { willReadFrequently: true });

  return {
    surface(video) {
      if (!context || !video || video.readyState < 2 || video.videoWidth <= 0 || video.videoHeight <= 0) {
        return null;
      }
      try {
        context.drawImage(video, 0, 0, SCALED_WIDTH, SCALED_HEIGHT);
        return canvas;
      } catch {
        return null;
      }
    },
  };
}
