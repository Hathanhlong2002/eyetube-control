export type TileGeometry = { x: number; y: number; width: number; height: number };
export type Viewport = { width: number; height: number };

const MIN_WIDTH = 160;
const MIN_HEIGHT = 120;
const MAX_WIDTH = 360;
const MAX_HEIGHT = 270;
const EDGE_GAP = 16;

function finite(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value));
}

export function clampTileGeometry(geometry: TileGeometry, viewport: Viewport): TileGeometry {
  const viewportWidth = Math.max(0, finite(viewport.width, 0));
  const viewportHeight = Math.max(0, finite(viewport.height, 0));
  const width = clamp(finite(geometry.width, 240), Math.min(MIN_WIDTH, viewportWidth), Math.min(MAX_WIDTH, viewportWidth));
  const height = clamp(finite(geometry.height, 180), Math.min(MIN_HEIGHT, viewportHeight), Math.min(MAX_HEIGHT, viewportHeight));
  return {
    x: clamp(finite(geometry.x, 0), 0, Math.max(0, viewportWidth - width)),
    y: clamp(finite(geometry.y, 0), 0, Math.max(0, viewportHeight - height)),
    width,
    height,
  };
}

export function defaultTileGeometry(viewport: Viewport): TileGeometry {
  return clampTileGeometry({
    x: EDGE_GAP,
    y: viewport.height - 180 - EDGE_GAP,
    width: 240,
    height: 180,
  }, viewport);
}

export function moveTile(
  geometry: TileGeometry,
  deltaX: number,
  deltaY: number,
  viewport: Viewport,
): TileGeometry {
  return clampTileGeometry({ ...geometry, x: geometry.x + deltaX, y: geometry.y + deltaY }, viewport);
}

export function resizeTile(
  geometry: TileGeometry,
  deltaWidth: number,
  deltaHeight: number,
  viewport: Viewport,
): TileGeometry {
  return clampTileGeometry({
    ...geometry,
    width: geometry.width + deltaWidth,
    height: geometry.height + deltaHeight,
  }, viewport);
}
