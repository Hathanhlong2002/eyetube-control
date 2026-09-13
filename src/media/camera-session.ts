/** Matches the peak inference rate; see OffscreenRuntime frame pacing. */
export const CAPTURE_FPS = 15;

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
    // Capturing at 30 fps when inference peaks at 15 fps costs capture, encode
    // and decode work on threads nobody profiles, for frames that are dropped.
    const shape: MediaTrackConstraints = {
      width: { ideal: 640 },
      height: { ideal: 480 },
      frameRate: { ideal: CAPTURE_FPS, max: CAPTURE_FPS },
    };
    const video: MediaTrackConstraints = deviceId
      ? { ...shape, deviceId: { exact: deviceId } }
      : shape;

    const stream = await this.media.getUserMedia({ audio: false, video });
    this.#stream = stream;
    return stream;
  }

  stop(): void {
    this.#stream?.getTracks().forEach((track) => track.stop());
    this.#stream = null;
  }
}

