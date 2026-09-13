import type { PreviewCandidate, PreviewDescription } from '../contracts/messages';

export type SerializableDescription = PreviewDescription;
export type SerializableCandidate = PreviewCandidate;

export type PeerConnectionFactory = (configuration: RTCConfiguration) => RTCPeerConnection;

export interface PreviewSender {
  createOffer(): Promise<SerializableDescription>;
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
  for (const track of stream.getVideoTracks()) {
    peer.addTrack(track, stream);
  }

  return {
    async createOffer() {
      const offer = await peer.createOffer();
      await peer.setLocalDescription(offer);
      return serializeDescription(offer);
    },
    async acceptAnswer(answer) {
      await peer.setRemoteDescription(answer);
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
