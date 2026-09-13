import { describe, expect, it } from 'vitest';

import {
  changedFraction,
  createMotionSampler,
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
