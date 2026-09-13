import { describe, expect, it } from 'vitest';

import { parseRuntimeMessage } from '../../src/contracts/messages';

describe('parseRuntimeMessage', () => {
  it('accepts a boolean session visibility signal', () => {
    expect(parseRuntimeMessage({
      version: 1,
      type: 'SESSION_VISIBILITY',
      tabId: 7,
      visible: false,
    })).toEqual({ version: 1, type: 'SESSION_VISIBILITY', tabId: 7, visible: false });
  });
  it('accepts a valid start request', () => {
    expect(parseRuntimeMessage({ version: 1, type: 'START_SESSION', tabId: 7 })).toEqual({
      version: 1,
      type: 'START_SESSION',
      tabId: 7,
    });
  });

  it('rejects unknown message types', () => {
    expect(parseRuntimeMessage({ version: 1, type: 'DELETE_HISTORY', tabId: 7 })).toBeNull();
  });

  it('rejects extra fields', () => {
    expect(parseRuntimeMessage({
      version: 1,
      type: 'COMMAND',
      tabId: 7,
      command: 'NEXT_VIDEO',
      commandId: 'cmd-1',
      script: 'alert(1)',
    })).toBeNull();
  });

  it('rejects invalid tab IDs', () => {
    expect(parseRuntimeMessage({ version: 1, type: 'START_SESSION', tabId: -1 })).toBeNull();
  });

  it('rejects invalid progress', () => {
    expect(parseRuntimeMessage({
      version: 1,
      type: 'GESTURE_PROGRESS',
      tabId: 1,
      gesture: 'GAZE_UP',
      progress: 2,
    })).toBeNull();
  });

  it('rejects invalid command IDs', () => {
    expect(parseRuntimeMessage({
      version: 1,
      type: 'COMMAND',
      tabId: 1,
      command: 'LIKE_VIDEO',
      commandId: '',
    })).toBeNull();
  });

  it('accepts every supported message variant', () => {
    const messages = [
      { version: 1, type: 'STOP_SESSION', tabId: 1 },
      { version: 1, type: 'START_CALIBRATION', tabId: 1 },
      { version: 1, type: 'GESTURE_CANCELLED', tabId: 1 },
      { version: 1, type: 'STATUS', tabId: 1, status: 'READY' },
      { version: 1, type: 'STATUS', tabId: 1, status: 'ERROR', reason: 'CAMERA_DENIED' },
      {
        version: 1,
        type: 'PREVIEW_OFFER',
        tabId: 1,
        description: { type: 'offer', sdp: 'offer-sdp' },
      },
      {
        version: 1,
        type: 'PREVIEW_ANSWER',
        tabId: 1,
        description: { type: 'answer', sdp: 'answer-sdp' },
      },
      {
        version: 1,
        type: 'PREVIEW_CANDIDATE',
        tabId: 1,
        candidate: {
          candidate: 'candidate:1 1 udp 1 host.local 5000 typ host',
          sdpMid: '0',
          sdpMLineIndex: 0,
          usernameFragment: null,
        },
      },
    ];

    for (const message of messages) {
      expect(parseRuntimeMessage(message)).toEqual(message);
    }
  });

  it('rejects malformed or over-specified preview signaling', () => {
    expect(parseRuntimeMessage({
      version: 1,
      type: 'PREVIEW_OFFER',
      tabId: 1,
      description: { type: 'answer', sdp: 'wrong-kind' },
    })).toBeNull();
    expect(parseRuntimeMessage({
      version: 1,
      type: 'PREVIEW_CANDIDATE',
      tabId: 1,
      candidate: {
        candidate: 'candidate:1 1 udp 1 host.local 5000 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0,
        injected: true,
      },
    })).toBeNull();
  });
});
