import { describe, expect, it } from 'vitest';

import {
  clampTileGeometry,
  defaultTileGeometry,
  moveTile,
  resizeTile,
} from '../../src/overlay/geometry';

describe('tile geometry', () => {
  it('places a 240×180 tile at bottom-left by default', () => {
    expect(defaultTileGeometry({ width: 1280, height: 720 })).toEqual({
      x: 16, y: 524, width: 240, height: 180,
    });
  });

  it('clamps a restored tile inside a smaller viewport', () => {
    expect(clampTileGeometry(
      { x: 1800, y: 900, width: 500, height: 400 },
      { width: 1280, height: 720 },
    )).toEqual({ x: 920, y: 450, width: 360, height: 270 });
  });

  it('enforces the 160×120 minimum size and viewport boundaries', () => {
    expect(clampTileGeometry(
      { x: -50, y: -20, width: 20, height: 30 },
      { width: 800, height: 600 },
    )).toEqual({ x: 0, y: 0, width: 160, height: 120 });
  });

  it('moves without allowing any edge outside the viewport', () => {
    expect(moveTile(
      { x: 16, y: 404, width: 240, height: 180 },
      -100,
      500,
      { width: 800, height: 600 },
    )).toEqual({ x: 0, y: 420, width: 240, height: 180 });
  });

  it('resizes within the maximum and reclamps the position', () => {
    expect(resizeTile(
      { x: 700, y: 500, width: 240, height: 180 },
      500,
      500,
      { width: 1000, height: 700 },
    )).toEqual({ x: 640, y: 430, width: 360, height: 270 });
  });

  it('fits safely in a viewport smaller than the nominal minimum', () => {
    expect(clampTileGeometry(
      { x: 10, y: 10, width: 240, height: 180 },
      { width: 120, height: 90 },
    )).toEqual({ x: 0, y: 0, width: 120, height: 90 });
  });
});
