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

export type PreviewDescription = {
  type: 'offer' | 'answer';
  sdp: string;
};

export type PreviewCandidate = {
  candidate: string;
  sdpMid: string | null;
  sdpMLineIndex: number | null;
  usernameFragment?: string | null;
};

export type RuntimeMessage =
  | { version: 1; type: 'START_SESSION'; tabId: number }
  | { version: 1; type: 'STOP_SESSION'; tabId: number }
  | { version: 1; type: 'START_CALIBRATION'; tabId: number }
  | { version: 1; type: 'SESSION_VISIBILITY'; tabId: number; visible: boolean }
  | { version: 1; type: 'GESTURE_PROGRESS'; tabId: number; gesture: Gesture; progress: number }
  | { version: 1; type: 'GESTURE_CANCELLED'; tabId: number }
  | { version: 1; type: 'COMMAND'; tabId: number; command: Command; commandId: string }
  | { version: 1; type: 'STATUS'; tabId: number; status: RuntimeStatus; reason?: StatusReason }
  | { version: 1; type: 'PREVIEW_OFFER'; tabId: number; description: PreviewDescription }
  | { version: 1; type: 'PREVIEW_ANSWER'; tabId: number; description: PreviewDescription }
  | { version: 1; type: 'PREVIEW_CANDIDATE'; tabId: number; candidate: PreviewCandidate };

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
  SESSION_VISIBILITY: new Set(['version', 'type', 'tabId', 'visible']),
  GESTURE_PROGRESS: new Set(['version', 'type', 'tabId', 'gesture', 'progress']),
  GESTURE_CANCELLED: new Set(['version', 'type', 'tabId']),
  COMMAND: new Set(['version', 'type', 'tabId', 'command', 'commandId']),
  STATUS: new Set(['version', 'type', 'tabId', 'status', 'reason']),
  PREVIEW_OFFER: new Set(['version', 'type', 'tabId', 'description']),
  PREVIEW_ANSWER: new Set(['version', 'type', 'tabId', 'description']),
  PREVIEW_CANDIDATE: new Set(['version', 'type', 'tabId', 'candidate']),
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

function isDescription(value: unknown, expectedType: 'offer' | 'answer'): value is PreviewDescription {
  if (!isPlainRecord(value) || !hasOnlyKeys(value, new Set(['type', 'sdp']))) return false;
  return value.type === expectedType
    && typeof value.sdp === 'string'
    && value.sdp.length > 0
    && value.sdp.length <= 1_000_000;
}

function isNullableShortString(value: unknown, maxLength: number): boolean {
  return value === null || (typeof value === 'string' && value.length <= maxLength);
}

function isCandidate(value: unknown): value is PreviewCandidate {
  if (!isPlainRecord(value)
    || !hasOnlyKeys(value, new Set(['candidate', 'sdpMid', 'sdpMLineIndex', 'usernameFragment']))) {
    return false;
  }
  return typeof value.candidate === 'string'
    && value.candidate.length <= 2_048
    && isNullableShortString(value.sdpMid, 32)
    && (value.sdpMLineIndex === null
      || (typeof value.sdpMLineIndex === 'number'
        && Number.isInteger(value.sdpMLineIndex)
        && value.sdpMLineIndex >= 0
        && value.sdpMLineIndex <= 32))
    && (value.usernameFragment === undefined || isNullableShortString(value.usernameFragment, 256));
}

function validateByType(input: PlainRecord): boolean {
  switch (input.type) {
    case 'START_SESSION':
    case 'STOP_SESSION':
    case 'START_CALIBRATION':
    case 'GESTURE_CANCELLED':
      return true;
    case 'SESSION_VISIBILITY':
      return typeof input.visible === 'boolean';
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
    case 'PREVIEW_OFFER':
      return isDescription(input.description, 'offer');
    case 'PREVIEW_ANSWER':
      return isDescription(input.description, 'answer');
    case 'PREVIEW_CANDIDATE':
      return isCandidate(input.candidate);
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
