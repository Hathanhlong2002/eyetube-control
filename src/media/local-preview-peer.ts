import type { PreviewCandidate, PreviewDescription } from '../contracts/messages';

export type SerializableDescription = PreviewDescription;
export type SerializableCandidate = PreviewCandidate;

export type PeerConnectionFactory = (configuration: RTCConfiguration) => RTCPeerConnection;

export interface PreviewSender {
  createOffer(): Promise<SerializableDescription>;
  /** Pauses or resumes the preview encode without touching the inference feed. */
  setEnabled(enabled: boolean): void;
  acceptAnswer(answer: SerializableDescription): Promise<void>;
  addRemoteCandidate(candidate: SerializableCandidate): Promise<boolean>;
  onCandidate(callback: (candidate: SerializableCandidate) => void): void;
  close(): void;
}

export interface PreviewReceiver {
  acceptOfferAndCreateAnswer(offer: SerializableDescription): Promise<SerializableDescription>;
  addRemoteCandidate(candidate: SerializableCandidate): Promise<boolean>;
  onCandidate(callback: (candidate: SerializableCandidate) => void): void;
  close(): void;
}

const defaultFactory: PeerConnectionFactory = (configuration) => new RTCPeerConnection(configuration);

/**
 * The preview tile is a few hundred CSS pixels, so encoding the full camera
 * resolution at full rate would burn CPU that nobody can see. Inference still
 * runs on the untouched stream; only the preview copy is scaled down.
 */
const PREVIEW_SCALE_DOWN_BY = 2;
const PREVIEW_MAX_FRAMERATE = 15;

async function capPreviewEncoding(sender: RTCRtpSender | undefined): Promise<void> {
  if (!sender?.getParameters || !sender.setParameters) return;
  try {
    const parameters = sender.getParameters();
    const encodings = parameters.encodings?.length ? parameters.encodings : [{}];
    await sender.setParameters({
      ...parameters,
      encodings: encodings.map((encoding) => ({
        ...encoding,
        scaleResolutionDownBy: PREVIEW_SCALE_DOWN_BY,
        maxFramerate: PREVIEW_MAX_FRAMERATE,
      })),
    });
  } catch {
    // Older Chrome builds reject per-encoding limits; the preview still works.
  }
}

function serializeDescription(description: RTCSessionDescriptionInit): SerializableDescription {
  if ((description.type !== 'offer' && description.type !== 'answer') || description.sdp === undefined) {
    throw new Error('Preview SDP must be a complete offer or answer');
  }
  return { type: description.type, sdp: description.sdp };
}

function serializeCandidate(candidate: RTCIceCandidate): SerializableCandidate {
  const serialized: SerializableCandidate = {
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid,
    sdpMLineIndex: candidate.sdpMLineIndex,
  };
  if (candidate.usernameFragment !== undefined) {
    serialized.usernameFragment = candidate.usernameFragment;
  }
  return serialized;
}

function isHostCandidate(candidate: SerializableCandidate): boolean {
  return candidate.candidate === '' || /\btyp host\b/.test(candidate.candidate);
}

function installCandidateHandler(
  peer: RTCPeerConnection,
  callback: (candidate: SerializableCandidate) => void,
): void {
  peer.onicecandidate = (event) => {
    if (!event.candidate) return;
    const candidate = serializeCandidate(event.candidate);
    if (isHostCandidate(candidate)) callback(candidate);
  };
}

async function addHostCandidate(
  peer: RTCPeerConnection,
  candidate: SerializableCandidate,
): Promise<boolean> {
  if (!isHostCandidate(candidate)) return false;
  await peer.addIceCandidate(candidate);
  return true;
}

export function createPreviewSender(
  stream: MediaStream,
  factory: PeerConnectionFactory = defaultFactory,
): PreviewSender {
  const peer = factory({ iceServers: [] });
  // The preview gets its own clone of the camera track: disabling the preview
  // then costs nothing and leaves the inference feed untouched.
  const previewTracks = stream.getVideoTracks().map((track) => track.clone?.() ?? track);
  for (const track of previewTracks) {
    void capPreviewEncoding(peer.addTrack(track, stream));
  }

  return {
    setEnabled(enabled) {
      for (const track of previewTracks) {
        if ('enabled' in track) track.enabled = enabled;
      }
    },
    async createOffer() {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      return serializeDescription(offer);
    },
    async acceptAnswer(answer) {
      if (peer.signalingState === 'stable' || peer.signalingState === 'closed') {
        return;
      }
      await peer.setRemoteDescription(answer);
    },
    addRemoteCandidate(candidate) {
      if (peer.signalingState === 'closed') {
        return Promise.resolve(false);
      }
      return addHostCandidate(peer, candidate);
    },
    onCandidate(callback) {
      installCandidateHandler(peer, callback);
    },
    close() {
      for (const track of previewTracks) track.stop?.();
      peer.close();
    },
  };
}

export function createPreviewReceiver(
  onStream: (stream: MediaStream) => void,
  factory: PeerConnectionFactory = defaultFactory,
): PreviewReceiver {
  const peer = factory({ iceServers: [] });
  peer.ontrack = (event) => {
    const stream = event.streams[0];
    if (stream) onStream(stream);
  };

  return {
    async acceptOfferAndCreateAnswer(offer) {
      await peer.setRemoteDescription(offer);
      const answer = await peer.createAnswer();
      await peer.setLocalDescription(answer);
      return serializeDescription(answer);
    },
    addRemoteCandidate(candidate) {
      return addHostCandidate(peer, candidate);
    },
    onCandidate(callback) {
      installCandidateHandler(peer, callback);
    },
    close() {
      peer.close();
    },
  };
}
