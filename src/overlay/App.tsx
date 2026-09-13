import { useEffect, useRef, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import type { Command, Gesture } from '../contracts/messages';
import type { RuntimeStatus, StatusReason } from '../contracts/status';
import { clampTileGeometry, defaultTileGeometry, moveTile, resizeTile, type TileGeometry } from './geometry';
import styles from './style.css?inline';

const GESTURE_TEXT: Record<Gesture, string> = {
  WINK_LEFT: 'Hold left wink for previous video',
  WINK_RIGHT: 'Hold right wink for next video',
  BOTH_CLOSED: 'Hold both eyes closed to play or pause',
  GAZE_UP: 'Hold look up to like',
  GAZE_DOWN: 'Hold look down to subscribe',
};

const GESTURE_ACTION: Record<Gesture, string> = {
  WINK_LEFT: 'Previous video',
  WINK_RIGHT: 'Next video',
  BOTH_CLOSED: 'Play or pause',
  GAZE_UP: 'Like video',
  GAZE_DOWN: 'Subscribe',
};

const COMMAND_TEXT: Record<Command, string> = {
  NEXT_VIDEO: 'Next video',
  PREVIOUS_VIDEO: 'Previous video',
  TOGGLE_PLAYBACK: 'Play or pause',
  LIKE_VIDEO: 'Like video',
  SUBSCRIBE_CHANNEL: 'Subscribe',
};

const STATUS_TEXT: Record<RuntimeStatus, string> = {
  OFF: 'Eye control off',
  REQUESTING_PERMISSION: 'Waiting for camera permission',
  SEARCHING: 'Center your face',
  CALIBRATING: 'Calibration in progress',
  READY: 'Ready',
  HOLDING: 'Keep holding the gesture',
  COMMAND_COMPLETED: 'Command completed',
  WARNING: 'Check camera position and lighting',
  ERROR: 'Eye control stopped',
};

const ERROR_TEXT: Partial<Record<StatusReason, string>> = {
  CAMERA_DENIED: 'Camera permission was denied',
  CAMERA_UNAVAILABLE: 'Camera is unavailable',
  FACE_NOT_FOUND: 'Face not found',
  LOW_CONFIDENCE: 'Eye signal is unclear',
  MODEL_LOAD_FAILED: 'Eye model could not load',
  PREVIEW_FAILED: 'Camera preview could not start',
  YOUTUBE_COMMAND_UNAVAILABLE: 'This YouTube action is unavailable',
};

export interface EyeControlOverlayProps {
  status: RuntimeStatus;
  reason: StatusReason | undefined;
  preview: MediaStream | null;
  geometry: TileGeometry;
  minimized: boolean;
  gesture: Gesture | undefined;
  progress: number | undefined;
  completedCommand: Command | undefined;
  calibrationStep: number | undefined;
  onGeometryChange(geometry: TileGeometry): void;
  onMinimizedChange(minimized: boolean): void;
  onStop(): void;
}

function announcedText(props: EyeControlOverlayProps): string {
  if (props.completedCommand) return `${COMMAND_TEXT[props.completedCommand]} completed`;
  if (props.status === 'CALIBRATING' && props.calibrationStep) return `Calibration ${props.calibrationStep} of 5`;
  if (props.gesture && props.progress !== undefined) return GESTURE_TEXT[props.gesture];
  if (props.reason && ERROR_TEXT[props.reason]) return ERROR_TEXT[props.reason]!;
  return STATUS_TEXT[props.status];
}

export function EyeControlOverlay(props: EyeControlOverlayProps) {
  const video = useRef<HTMLVideoElement>(null);
  const drag = useRef<{ x: number; y: number; geometry: TileGeometry } | null>(null);
  const resize = useRef<{ x: number; y: number; geometry: TileGeometry } | null>(null);
  const viewport = () => ({ width: window.innerWidth, height: window.innerHeight });

  useEffect(() => {
    if (!video.current) return;
    video.current.srcObject = props.preview;
    return () => {
      if (video.current) video.current.srcObject = null;
    };
  }, [props.preview, props.minimized]);

  const beginDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if ((event.target as Element).closest('button')) return;
    drag.current = { x: event.clientX, y: event.clientY, geometry: props.geometry };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const updateDrag = (event: ReactPointerEvent<HTMLElement>) => {
    if (!drag.current) return;
    props.onGeometryChange(moveTile(
      drag.current.geometry,
      event.clientX - drag.current.x,
      event.clientY - drag.current.y,
      viewport(),
    ));
  };
  const beginResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    resize.current = { x: event.clientX, y: event.clientY, geometry: props.geometry };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  };
  const updateResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
    if (!resize.current) return;
    props.onGeometryChange(resizeTile(
      resize.current.geometry,
      event.clientX - resize.current.x,
      event.clientY - resize.current.y,
      viewport(),
    ));
  };

  if (props.minimized) {
    return <section className="eyetube-pill" aria-label="EyeTube Control">
      <span className="eyetube-dot" aria-hidden="true" />
      <span role="status" aria-live="polite">Camera active</span>
      <button type="button" aria-label="Show camera preview" onClick={() => props.onMinimizedChange(false)}>Show</button>
      <button type="button" aria-label="Stop eye control" onClick={props.onStop}>Stop</button>
    </section>;
  }

  const tileStyle: CSSProperties = {
    left: props.geometry.x,
    top: props.geometry.y,
    width: props.geometry.width,
    height: props.geometry.height,
  };
  const progress = Math.round(Math.min(1, Math.max(0, props.progress ?? 0)) * 100);
  return <section className={`eyetube-tile state-${props.status.toLowerCase()}`} style={tileStyle} aria-label="EyeTube Control camera preview">
    <div
      className="eyetube-preview"
      onPointerDown={beginDrag}
      onPointerMove={updateDrag}
      onPointerUp={() => { drag.current = null; }}
    >
      <video ref={video} autoPlay muted playsInline aria-label="Mirrored camera preview" />
      {props.gesture && props.progress !== undefined && <div
        className="eyetube-progress"
        role="progressbar"
        aria-label={`${GESTURE_ACTION[props.gesture]} progress`}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={progress}
        style={{ '--progress': `${progress}%` } as CSSProperties}
      />}
    </div>
    <div className="eyetube-bar">
      <span className="eyetube-dot" aria-hidden="true" />
      <span className="eyetube-status" role="status" aria-live="polite">{announcedText(props)}</span>
      <button type="button" aria-label="Minimize camera preview" onClick={() => props.onMinimizedChange(true)}>−</button>
      <button type="button" aria-label="Stop eye control" onClick={props.onStop}>×</button>
    </div>
    <button
      type="button"
      className="eyetube-resize"
      aria-label="Resize camera preview"
      onPointerDown={beginResize}
      onPointerMove={updateResize}
      onPointerUp={() => { resize.current = null; }}
    >↘</button>
  </section>;
}

export type OverlaySnapshot = Pick<EyeControlOverlayProps,
  'status' | 'reason' | 'preview' | 'geometry' | 'minimized'
  | 'gesture' | 'progress' | 'completedCommand' | 'calibrationStep'>;

export interface OverlayHandle {
  update(patch: Partial<OverlaySnapshot>): void;
  destroy(): void;
}

export function mountOverlay(options: {
  document?: Document;
  initialGeometry?: TileGeometry;
  onGeometryChange?(geometry: TileGeometry): void;
  onStop(): void;
}): OverlayHandle {
  const targetDocument = options.document ?? document;
  const host = targetDocument.createElement('div');
  host.dataset.eyetubeControl = 'preview';
  const shadow = host.attachShadow({ mode: 'open' });
  const style = targetDocument.createElement('style');
  style.textContent = styles;
  const container = targetDocument.createElement('div');
  shadow.append(style, container);
  targetDocument.documentElement.append(host);
  const reactRoot: Root = createRoot(container);
  const currentViewport = () => ({ width: window.innerWidth, height: window.innerHeight });
  let snapshot: OverlaySnapshot = {
    status: 'REQUESTING_PERMISSION',
    reason: undefined,
    preview: null,
    geometry: clampTileGeometry(options.initialGeometry ?? defaultTileGeometry(currentViewport()), currentViewport()),
    minimized: false,
    gesture: undefined,
    progress: undefined,
    completedCommand: undefined,
    calibrationStep: undefined,
  };

  const render = () => reactRoot.render(<EyeControlOverlay
    {...snapshot}
    onGeometryChange={(geometry) => {
      snapshot = { ...snapshot, geometry };
      options.onGeometryChange?.(geometry);
      render();
    }}
    onMinimizedChange={(minimized) => {
      snapshot = { ...snapshot, minimized };
      render();
    }}
    onStop={options.onStop}
  />);
  const resizeWindow = () => {
    snapshot = { ...snapshot, geometry: clampTileGeometry(snapshot.geometry, currentViewport()) };
    render();
  };
  const moveForFullscreen = () => {
    (targetDocument.fullscreenElement ?? targetDocument.documentElement).append(host);
    resizeWindow();
  };
  window.addEventListener('resize', resizeWindow);
  targetDocument.addEventListener('fullscreenchange', moveForFullscreen);
  render();

  return {
    update(patch) {
      snapshot = { ...snapshot, ...patch };
      render();
    },
    destroy() {
      window.removeEventListener('resize', resizeWindow);
      targetDocument.removeEventListener('fullscreenchange', moveForFullscreen);
      reactRoot.unmount();
      host.remove();
    },
  };
}
