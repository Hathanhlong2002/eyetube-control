/**
 * Cheap motion detector over a heavily downscaled frame.
 *
 * Hand tracking costs more than everything else in the pipeline combined,
 * because with no hand on screen MediaPipe re-runs palm detection on every
 * frame - which is exactly the state someone sits in while watching a video.
 * Downscaling to a few hundred cells averages away sensor noise, so a hand
 * entering the frame stands out from a person sitting still.
 *
 * The face region is excluded from the comparison: a viewer breathing, talking
 * or blinking moves those cells constantly, and none of it says anything about
 * whether a hand has been raised.
 */
export const MOTION_GRID_WIDTH = 16;
export const MOTION_GRID_HEIGHT = 12;
/** A cell must shift by more than this (of 255) to count as changed. */
export const MOTION_CELL_DELTA = 8;

/** Normalised rectangle, 0-1 in each axis. */
export type ExcludedRegion = { x: number; y: number; width: number; height: number };

export interface MotionSampler {
  /** Fraction of compared cells that changed since the previous sample, 0-1. */
  sample(source: TexImageSource, exclude?: ExcludedRegion | undefined): number;
  reset(): void;
}

export type MotionSamplerDependencies = {
  createCanvas(width: number, height: number): {
    getContext(type: '2d', options?: { willReadFrequently?: boolean }): {
      drawImage(image: TexImageSource, dx: number, dy: number, dw: number, dh: number): void;
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

export function isCellExcluded(index: number, exclude: ExcludedRegion | undefined): boolean {
  if (!exclude) return false;
  const column = index % MOTION_GRID_WIDTH;
  const row = Math.floor(index / MOTION_GRID_WIDTH);
  const x = (column + 0.5) / MOTION_GRID_WIDTH;
  const y = (row + 0.5) / MOTION_GRID_HEIGHT;
  return x >= exclude.x && x <= exclude.x + exclude.width
    && y >= exclude.y && y <= exclude.y + exclude.height;
}

export function changedFraction(
  previous: Uint8ClampedArray | null,
  current: Uint8ClampedArray,
  exclude?: ExcludedRegion | undefined,
): number {
  if (!previous || previous.length !== current.length || current.length === 0) return 1;
  let changed = 0;
  let compared = 0;
  for (let index = 0; index < current.length; index += 1) {
    if (isCellExcluded(index, exclude)) continue;
    compared += 1;
    if (Math.abs((current[index] ?? 0) - (previous[index] ?? 0)) > MOTION_CELL_DELTA) changed += 1;
  }
  // A face filling the whole grid leaves nothing to compare; treat that as still
  // rather than as constant motion, since the cost gate is the thing at stake.
  return compared === 0 ? 0 : changed / compared;
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
    sample(source, exclude) {
      if (!context) return 1;
      try {
        context.drawImage(source, 0, 0, MOTION_GRID_WIDTH, MOTION_GRID_HEIGHT);
        const current = luminanceGrid(
          context.getImageData(0, 0, MOTION_GRID_WIDTH, MOTION_GRID_HEIGHT).data,
        );
        const fraction = changedFraction(previous, current, exclude);
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
