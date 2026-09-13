import { describe, expect, it } from 'vitest';

import {
  changedFraction,
  createMotionSampler,
  isCellExcluded,
  luminanceGrid,
  MOTION_GRID_HEIGHT,
  MOTION_GRID_WIDTH,
} from '../../src/media/frame-motion';

function grid(values: number[]): Uint8ClampedArray {
  return new Uint8ClampedArray(values);
}

describe('changedFraction', () => {
  it('treats the very first sample as fully changed so tracking is never missed', () => {
    expect(changedFraction(null, grid([10, 20, 30]))).toBe(1);
  });

  it('ignores drift below the per-cell threshold', () => {
    expect(changedFraction(grid([100, 100, 100, 100]), grid([104, 96, 100, 107]))).toBe(0);
  });

  it('counts only the cells that moved past the threshold', () => {
    expect(changedFraction(grid([100, 100, 100, 100]), grid([200, 100, 100, 30]))).toBe(0.5);
  });

  it('reports a full change when the grid size changes underneath it', () => {
    expect(changedFraction(grid([1, 2]), grid([1, 2, 3]))).toBe(1);
  });
});

describe('luminanceGrid', () => {
  it('collapses RGBA pixels to one luma value each', () => {
    const pixels = grid([255, 255, 255, 255, 0, 0, 0, 255]);
    const luma = luminanceGrid(pixels);
    expect(luma).toHaveLength(2);
    expect(luma[0]).toBe(255);
    expect(luma[1]).toBe(0);
  });
});

describe('createMotionSampler', () => {
  function fakeCanvas(frames: number[][]) {
    let frame = 0;
    return {
      createCanvas: () => ({
        getContext: () => ({
          drawImage: () => { frame += 1; },
          getImageData: () => ({
            data: new Uint8ClampedArray(
              (frames[Math.min(frame, frames.length) - 1] ?? []).flatMap((value) => [value, value, value, 255]),
            ),
          }),
        }),
      }),
    } as never;
  }

  const video = {} as HTMLVideoElement;

  it('reports stillness between identical frames', () => {
    const sampler = createMotionSampler(fakeCanvas([[10, 10, 10, 10], [10, 10, 10, 10]]));
    expect(sampler.sample(video)).toBe(1);
    expect(sampler.sample(video)).toBe(0);
  });

  it('reports movement when the frame changes', () => {
    const sampler = createMotionSampler(fakeCanvas([[10, 10, 10, 10], [200, 200, 10, 10]]));
    sampler.sample(video);
    expect(sampler.sample(video)).toBe(0.5);
  });

  it('treats the next frame as fully changed after a reset', () => {
    const sampler = createMotionSampler(fakeCanvas([[10, 10], [10, 10], [10, 10]]));
    sampler.sample(video);
    expect(sampler.sample(video)).toBe(0);
    sampler.reset();
    expect(sampler.sample(video)).toBe(1);
  });

  it('uses a grid small enough to average sensor noise away', () => {
    expect(MOTION_GRID_WIDTH * MOTION_GRID_HEIGHT).toBeLessThanOrEqual(256);
  });
});

describe('excluding the face region', () => {
  const face = { x: 0.25, y: 0.25, width: 0.5, height: 0.5 };

  it('skips cells whose centre falls inside the region', () => {
    // Middle of the grid is inside a centred half-width box; a corner is not.
    const middle = Math.floor(MOTION_GRID_HEIGHT / 2) * MOTION_GRID_WIDTH
      + Math.floor(MOTION_GRID_WIDTH / 2);
    expect(isCellExcluded(middle, face)).toBe(true);
    expect(isCellExcluded(0, face)).toBe(false);
    expect(isCellExcluded(MOTION_GRID_WIDTH * MOTION_GRID_HEIGHT - 1, face)).toBe(false);
  });

  it('compares nothing and reports stillness when the face fills the frame', () => {
    const size = MOTION_GRID_WIDTH * MOTION_GRID_HEIGHT;
    const before = new Uint8ClampedArray(size).fill(10);
    const after = new Uint8ClampedArray(size).fill(200);
    expect(changedFraction(before, after, { x: 0, y: 0, width: 1, height: 1 })).toBe(0);
  });

  it('ignores a face that moves while the rest of the frame is still', () => {
    const size = MOTION_GRID_WIDTH * MOTION_GRID_HEIGHT;
    const before = new Uint8ClampedArray(size).fill(10);
    const after = new Uint8ClampedArray(before);
    for (let index = 0; index < size; index += 1) {
      if (isCellExcluded(index, face)) after[index] = 250;
    }
    expect(changedFraction(before, after)).toBeGreaterThan(0.1);
    expect(changedFraction(before, after, face)).toBe(0);
  });

  it('still sees a hand raised outside the face box', () => {
    const size = MOTION_GRID_WIDTH * MOTION_GRID_HEIGHT;
    const before = new Uint8ClampedArray(size).fill(10);
    const after = new Uint8ClampedArray(before);
    // A block of cells along the bottom-left, clear of the centred face box.
    for (let index = 0; index < size; index += 1) {
      const column = index % MOTION_GRID_WIDTH;
      const row = Math.floor(index / MOTION_GRID_WIDTH);
      if (column < 4 && row > MOTION_GRID_HEIGHT - 4) after[index] = 250;
    }
    expect(changedFraction(before, after, face)).toBeGreaterThan(0.08);
  });
});
