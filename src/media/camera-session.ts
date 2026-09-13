export interface UserMediaProvider {
  getUserMedia(constraints?: MediaStreamConstraints): Promise<MediaStream>;
}

export class CameraSession {
  #stream: MediaStream | null = null;

  constructor(
    private readonly media: UserMediaProvider = navigator.mediaDevices,
  ) {}

  get stream(): MediaStream | null {
    return this.#stream;
  }

  async start(deviceId?: string): Promise<MediaStream> {
    this.stop();
    const video: MediaTrackConstraints = deviceId
      ? {
          deviceId: { exact: deviceId },
          width: { ideal: 640 },
          height: { ideal: 480 },
        }
      : { width: { ideal: 640 }, height: { ideal: 480 } };

    const stream = await this.media.getUserMedia({ audio: false, video });
    this.#stream = stream;
    return stream;
  }

  stop(): void {
    this.#stream?.getTracks().forEach((track) => track.stop());
    this.#stream = null;
  }
}

