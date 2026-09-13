import type { Command } from './messages';

export type RuntimeStatus =
  | 'OFF'
  | 'REQUESTING_PERMISSION'
  | 'SEARCHING'
  | 'CALIBRATING'
  | 'READY'
  | 'HOLDING'
  | 'COMMAND_COMPLETED'
  | 'WARNING'
  | 'ERROR';

export type StatusReason =
  | 'CAMERA_DENIED'
  | 'CAMERA_UNAVAILABLE'
  | 'FACE_NOT_FOUND'
  | 'LOW_CONFIDENCE'
  | 'MODEL_LOAD_FAILED'
  | 'PREVIEW_FAILED'
  | 'YOUTUBE_COMMAND_UNAVAILABLE';

export type CommandResult =
  | { status: 'EXECUTED'; command: Command }
  | { status: 'ALREADY_APPLIED'; command: 'LIKE_VIDEO' | 'SUBSCRIBE_CHANNEL' }
  | {
      status: 'UNAVAILABLE';
      command: Command;
      reason: 'NO_CONTROL' | 'NOT_SIGNED_IN' | 'PAGE_NOT_READY';
    }
  | { status: 'FAILED'; command: Command; reason: 'YOUTUBE_UI_CHANGED' };

