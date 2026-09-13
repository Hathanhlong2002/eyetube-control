import { describe, expect, it, vi } from 'vitest';

import {
  createPreviewReceiver,
  createPreviewSender,
  type PeerConnectionFactory,
} from '../../src/media/local-preview-peer';

class FakePeerConnection {
  readonly addIceCandidate = vi.fn().mockResolvedValue(undefined);
  readonly addTrack = vi.fn();
  readonly close = vi.fn();
  readonly createAnswer = vi.fn().mockResolvedValue({ type: 'answer', sdp: 'answer-sdp' });
  readonly createOffer = vi.fn().mockResolvedValue({ type: 'offer', sdp: 'offer-sdp' });
  readonly setLocalDescription = vi.fn().mockResolvedValue(undefined);
  readonly setRemoteDescription = vi.fn().mockResolvedValue(undefined);
  onicecandidate: ((event: RTCPeerConnectionIceEvent) => void) | null = null;
  ontrack: ((event: RTCTrackEvent) => void) | null = null;

  constructor(readonly configuration: RTCConfiguration) {}
}

function createFactory(): { factory: PeerConnectionFactory; peers: FakePeerConnection[] } {
  const peers: FakePeerConnection[] = [];
  const factory: PeerConnectionFactory = (configuration) => {
    const peer = new FakePeerConnection(configuration);
    peers.push(peer);
    return peer as unknown as RTCPeerConnection;
  };
  return { factory, peers };
}

function createMixedStream(): MediaStream {
  const videoTrack = { kind: 'video', id: 'video-1' } as MediaStreamTrack;
  const audioTrack = { kind: 'audio', id: 'audio-1' } as MediaStreamTrack;
  return {
    getVideoTracks: () => [videoTrack],
    getTracks: () => [videoTrack, audioTrack],
  } as unknown as MediaStream;
}

describe('local preview peer', () => {
  it('creates a no-STUN/TURN sender with video tracks only', () => {
    const { factory, peers } = createFactory();
    const stream = createMixedStream();

    createPreviewSender(stream, factory);
    const peer = peers[0];
    if (!peer) throw new Error('Sender did not create a peer');

    expect(peer.configuration).toEqual({ iceServers: [] });
    expect(peer.addTrack).toHaveBeenCalledTimes(1);
    expect(peer.addTrack).toHaveBeenCalledWith(stream.getVideoTracks()[0], stream);
  });

  it('returns a JSON-safe offer after setting it locally', async () => {
    const { factory, peers } = createFactory();
    const sender = createPreviewSender(createMixedStream(), factory);
    const peer = peers[0];
    if (!peer) throw new Error('Sender did not create a peer');

    await expect(sender.createOffer()).resolves.toEqual({ type: 'offer', sdp: 'offer-sdp' });
    expect(peer.setLocalDescription).toHaveBeenCalledWith({ type: 'offer', sdp: 'offer-sdp' });
  });

  it('accepts a remote answer on the sender', async () => {
    const { factory, peers } = createFactory();
    const sender = createPreviewSender(createMixedStream(), factory);
    const peer = peers[0];
    if (!peer) throw new Error('Sender did not create a peer');

    await sender.acceptAnswer({ type: 'answer', sdp: 'answer-sdp' });

    expect(peer.setRemoteDescription).toHaveBeenCalledWith({ type: 'answer', sdp: 'answer-sdp' });
  });

  it('creates a JSON-safe answer after accepting an offer', async () => {
    const { factory, peers } = createFactory();
    const receiver = createPreviewReceiver(vi.fn(), factory);
    const peer = peers[0];
    if (!peer) throw new Error('Receiver did not create a peer');

    await expect(receiver.acceptOfferAndCreateAnswer({ type: 'offer', sdp: 'offer-sdp' }))
      .resolves.toEqual({ type: 'answer', sdp: 'answer-sdp' });
    expect(peer.setRemoteDescription).toHaveBeenCalledWith({ type: 'offer', sdp: 'offer-sdp' });
    expect(peer.setLocalDescription).toHaveBeenCalledWith({ type: 'answer', sdp: 'answer-sdp' });
  });

  it('emits only JSON-safe host candidates', () => {
    const { factory, peers } = createFactory();
    const sender = createPreviewSender(createMixedStream(), factory);
    const peer = peers[0];
    if (!peer) throw new Error('Sender did not create a peer');
    const onCandidate = vi.fn();
    sender.onCandidate(onCandidate);

    peer.onicecandidate?.({
      candidate: {
        candidate: 'candidate:3 1 udp 1 host.local 5002 typ host',
        sdpMid: '0',
        sdpMLineIndex: 0,
        usernameFragment: null,
      },
    } as RTCPeerConnectionIceEvent);

    expect(onCandidate).toHaveBeenCalledWith({
      candidate: 'candidate:3 1 udp 1 host.local 5002 typ host',
      sdpMid: '0',
      sdpMLineIndex: 0,
      usernameFragment: null,
    });
  });

  it.each([
    'candidate:1 1 udp 1 203.0.113.1 5000 typ srflx',
    'candidate:2 1 udp 1 203.0.113.2 5001 typ relay',
  ])('rejects non-host ICE candidate %s', async (candidate) => {
    const { factory, peers } = createFactory();
    const sender = createPreviewSender(createMixedStream(), factory);
    const peer = peers[0];
    if (!peer) throw new Error('Sender did not create a peer');

    await expect(sender.addRemoteCandidate({ candidate, sdpMid: '0', sdpMLineIndex: 0 })).resolves.toBe(false);
    expect(peer.addIceCandidate).not.toHaveBeenCalled();
  });

  it('accepts host ICE candidates', async () => {
    const { factory, peers } = createFactory();
    const receiver = createPreviewReceiver(vi.fn(), factory);
    const peer = peers[0];
    if (!peer) throw new Error('Receiver did not create a peer');
    const candidate = {
      candidate: 'candidate:3 1 udp 1 host.local 5002 typ host',
      sdpMid: '0',
      sdpMLineIndex: 0,
    };

    await expect(receiver.addRemoteCandidate(candidate)).resolves.toBe(true);
    expect(peer.addIceCandidate).toHaveBeenCalledWith(candidate);
  });

  it('delivers the received preview stream and closes cleanly', () => {
    const { factory, peers } = createFactory();
    const onStream = vi.fn();
    const receiver = createPreviewReceiver(onStream, factory);
    const peer = peers[0];
    if (!peer) throw new Error('Receiver did not create a peer');
    const stream = createMixedStream();

    peer.ontrack?.({ streams: [stream] } as unknown as RTCTrackEvent);
    receiver.close();

    expect(onStream).toHaveBeenCalledWith(stream);
    expect(peer.close).toHaveBeenCalledOnce();
  });
});
