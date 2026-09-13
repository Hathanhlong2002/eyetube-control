/**
 * Cheap motion detector over a heavily downscaled frame.
 *
 * Hand tracking costs more than everything else in the pipeline combined,
 * because with no hand on screen MediaPipe re-runs palm detection on every
 * frame - which is exactly the state someone sits in while watching a video.
 * Downscaling to a few hundred cells averages away sensor noise, so a hand
 * entering the frame stands out from a person sitting still.
 */
export const MOTION_GRID_WIDTH = 16;
export const MOTION_GRID_HEIGHT = 12;
/** A cell must shift by more than this (of 255) to count as changed. */
export const MOTION_CELL_DELTA = 8;

export interface MotionSampler {
  /** Fraction of cells that changed since the previous sample, 0-1. */
  sample(video: HTMLVideoElement): number;
  reset(): void;
}

export type MotionSamplerDependencies = {
  createCanvas(width: number, height: number): {
    getContext(type: '2d', options?: { willReadFrequently?: boolean }): {
      drawImage(image: CanvasImageSource, dx: number, dy: number, dw: number, dh: number): void;
      getImageData(sx: number, sy: number, sw: number, sh: number): { data: Uint8ClampedArray };
    } | null;
  };
};

export function luminanceGrid(pixels: Uint8ClampedArray): Uint8ClampedArray {
  const cells = new Uint8ClampedArray(pixels.length / 4);
  for (let index = 0; index < cells.length; index += 1) {
    const offset = index * 4;
    cells[index] = 0.2126 * (pixels[offset] ?? 0)
      + 0.7152 * (pixels[offset + 1] ?? 0)
      + 0.0722 * (pixels[offset + 2] ?? 0);
  }
  return cells;
}

export function changedFraction(
  previous: Uint8ClampedArray | null,
  current: Uint8ClampedArray,
): number {
  if (!previous || previous.length !== current.length || current.length === 0) return 1;
  let changed = 0;
  for (let index = 0; index < current.length; index += 1) {
    if (Math.abs((current[index] ?? 0) - (previous[index] ?? 0)) > MOTION_CELL_DELTA) changed += 1;
  }
  return changed / current.length;
}

export function createMotionSampler(
  dependencies: MotionSamplerDependencies = {
    createCanvas: (width, height) => new OffscreenCanvas(width, height) as never,
  },
): MotionSampler {
  const canvas = dependencies.createCanvas(MOTION_GRID_WIDTH, MOTION_GRID_HEIGHT);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  let previous: Uint8ClampedArray | null = null;

  return {
    sample(video) {
      if (!context) return 1;
      try {
        context.drawImage(video, 0, 0, MOTION_GRID_WIDTH, MOTION_GRID_HEIGHT);
        const current = luminanceGrid(
          context.getImageData(0, 0, MOTION_GRID_WIDTH, MOTION_GRID_HEIGHT).data,
        );
        const fraction = changedFraction(previous, current);
        previous = current;
        return fraction;
      } catch {
        // A frame that cannot be read must not suppress hand tracking.
        return 1;
      }
    },
    reset() {
      previous = null;
    },
  };
}
