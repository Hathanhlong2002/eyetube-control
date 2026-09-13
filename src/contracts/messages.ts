import type { RuntimeStatus, StatusReason } from './status';

export type Gesture =
  | 'WINK_LEFT'
  | 'WINK_RIGHT'
  | 'BOTH_CLOSED'
  | 'GAZE_UP'
  | 'GAZE_DOWN';

export type Command =
  | 'NEXT_VIDEO'
  | 'PREVIOUS_VIDEO'
  | 'TOGGLE_PLAYBACK'
  | 'LIKE_VIDEO'
  | 'SUBSCRIBE_CHANNEL';

export type RuntimeMessage =
  | { version: 1; type: 'START_SESSION'; tabId: number }
  | { version: 1; type: 'STOP_SESSION'; tabId: number }
  | { version: 1; type: 'START_CALIBRATION'; tabId: number }
  | { version: 1; type: 'GESTURE_PROGRESS'; tabId: number; gesture: Gesture; progress: number }
  | { version: 1; type: 'GESTURE_CANCELLED'; tabId: number }
  | { version: 1; type: 'COMMAND'; tabId: number; command: Command; commandId: string }
  | { version: 1; type: 'STATUS'; tabId: number; status: RuntimeStatus; reason?: StatusReason };

type PlainRecord = Record<string, unknown>;

const GESTURES = new Set<Gesture>([
  'WINK_LEFT',
  'WINK_RIGHT',
  'BOTH_CLOSED',
  'GAZE_UP',
  'GAZE_DOWN',
]);

const COMMANDS = new Set<Command>([
  'NEXT_VIDEO',
  'PREVIOUS_VIDEO',
  'TOGGLE_PLAYBACK',
  'LIKE_VIDEO',
  'SUBSCRIBE_CHANNEL',
]);

const STATUSES = new Set<RuntimeStatus>([
  'OFF',
  'REQUESTING_PERMISSION',
  'SEARCHING',
  'CALIBRATING',
  'READY',
  'HOLDING',
  'COMMAND_COMPLETED',
  'WARNING',
  'ERROR',
]);

const STATUS_REASONS = new Set<StatusReason>([
  'CAMERA_DENIED',
  'CAMERA_UNAVAILABLE',
  'FACE_NOT_FOUND',
  'LOW_CONFIDENCE',
  'MODEL_LOAD_FAILED',
  'PREVIEW_FAILED',
  'YOUTUBE_COMMAND_UNAVAILABLE',
]);

const MESSAGE_KEYS: Record<string, ReadonlySet<string>> = {
  START_SESSION: new Set(['version', 'type', 'tabId']),
  STOP_SESSION: new Set(['version', 'type', 'tabId']),
  START_CALIBRATION: new Set(['version', 'type', 'tabId']),
  GESTURE_PROGRESS: new Set(['version', 'type', 'tabId', 'gesture', 'progress']),
  GESTURE_CANCELLED: new Set(['version', 'type', 'tabId']),
  COMMAND: new Set(['version', 'type', 'tabId', 'command', 'commandId']),
  STATUS: new Set(['version', 'type', 'tabId', 'status', 'reason']),
};

function isPlainRecord(value: unknown): value is PlainRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value) as object | null;
  return prototype === Object.prototype || prototype === null;
}

function isTabId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function hasOnlyKeys(input: PlainRecord, keys: ReadonlySet<string>): boolean {
  return Object.keys(input).every((key) => keys.has(key));
}

function validateByType(input: PlainRecord): boolean {
  switch (input.type) {
    case 'START_SESSION':
    case 'STOP_SESSION':
    case 'START_CALIBRATION':
    case 'GESTURE_CANCELLED':
      return true;
    case 'GESTURE_PROGRESS':
      return typeof input.gesture === 'string'
        && GESTURES.has(input.gesture as Gesture)
        && typeof input.progress === 'number'
        && Number.isFinite(input.progress)
        && input.progress >= 0
        && input.progress <= 1;
    case 'COMMAND':
      return typeof input.command === 'string'
        && COMMANDS.has(input.command as Command)
        && typeof input.commandId === 'string'
        && /^[A-Za-z0-9-]{1,64}$/.test(input.commandId);
    case 'STATUS':
      return typeof input.status === 'string'
        && STATUSES.has(input.status as RuntimeStatus)
        && (input.reason === undefined
          || (typeof input.reason === 'string' && STATUS_REASONS.has(input.reason as StatusReason)));
    default:
      return false;
  }
}

export function parseRuntimeMessage(input: unknown): RuntimeMessage | null {
  if (!isPlainRecord(input) || input.version !== 1 || !isTabId(input.tabId)) return null;
  if (typeof input.type !== 'string') return null;
  const allowedKeys = MESSAGE_KEYS[input.type];
  if (!allowedKeys || !hasOnlyKeys(input, allowedKeys) || !validateByType(input)) return null;
  return input as RuntimeMessage;
}

