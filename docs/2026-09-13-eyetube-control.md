# EyeTube Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a privacy-first Chrome desktop extension that recognizes deliberate eye gestures locally and controls YouTube while showing a draggable video-call-style camera tile.

**Architecture:** A Manifest V3 service worker coordinates one enabled YouTube tab and an offscreen document. The offscreen document owns `getUserMedia`, bundled MediaPipe inference, calibration and the gesture state machine; semantic events use validated runtime messages, while a no-STUN/TURN local WebRTC peer carries only the transient camera preview to a Shadow DOM overlay. A narrow YouTube adapter performs idempotent player/account commands and fails closed when the page is ambiguous.

**Tech Stack:** WXT, TypeScript, React, Chrome Manifest V3, MediaPipe Tasks Vision, Vitest, Testing Library, jsdom, Playwright for extension integration, Chrome DevTools MCP for real-browser verification, npm with an exact lockfile.

**Spec:** `docs/superpowers/specs/2026-09-13-eyetube-control-design.md`

## Global Constraints

- Target Google Chrome desktop only; set `minimum_chrome_version` to `116`.
- Create the independent tool at `Tool dev/EyeTube Control`; initialize its own Git repository because the workspace root is not a Git repository.
- Keep `private: true` and `license: UNLICENSED` until the user explicitly chooses a distribution license.
- Run only on `https://www.youtube.com/*`; never request `<all_urls>`, cookies, history, microphone, `tabCapture`, downloads or remote-code permissions.
- Request `getUserMedia({ video: true, audio: false })` only after an explicit Start action.
- Bundle and pin JavaScript, WASM and model assets; make no application network requests and use no STUN/TURN server.
- Never persist or log frames, face crops, landmarks, biometric templates, video IDs or gesture history.
- Navigation/playback hold defaults to 700 ms and stays within 600–1,500 ms.
- Like/subscribe hold defaults to 2,000 ms and never goes below 1,500 ms; commands are idempotent.
- Cooldown defaults to 1,500 ms and requires 300 ms neutral eyes before rearming.
- Target 10–15 inference FPS and under 150 ms feedback latency, excluding intentional hold time.
- Every production behavior follows red-green-refactor; configuration and generated scaffold contain no production behavior.
- Use an isolated Chrome test profile; never automate Like or Subscribe on a personal/production account.

## File Structure

```text
Tool dev/EyeTube Control/
├── README.md                         # purpose, local setup, privacy and limitations
├── SECURITY.md                       # threat model and vulnerability reporting
├── package.json                      # private package and exact scripts
├── package-lock.json                 # committed exact dependency graph
├── tsconfig.json                     # strict TypeScript settings
├── vitest.config.ts                  # jsdom and unit-test setup
├── wxt.config.ts                     # MV3 permissions, CSP and web assets
├── entrypoints/
│   ├── background.ts                 # service-worker composition root
│   ├── offscreen.html                # static extension page for media/inference
│   ├── popup/
│   │   ├── index.html
│   │   ├── main.tsx                  # popup composition root
│   │   └── style.css
│   └── youtube.content.tsx           # content-script composition root
├── public/
│   ├── icons/                        # bundled SVG/PNG extension icons
│   └── models/
│       ├── face_landmarker.task      # pinned MediaPipe model artifact
│       └── SHA256SUMS                 # model integrity record
├── src/
│   ├── contracts/
│   │   ├── messages.ts               # runtime discriminated union and validator
│   │   ├── settings.ts               # safe defaults, limits and validator
│   │   └── status.ts                 # shared runtime/status result types
│   ├── gesture/
│   │   ├── types.ts                  # observations and thresholds
│   │   ├── machine.ts                # hold/neutral/cooldown state machine
│   │   ├── classifier.ts             # frame features to observation
│   │   └── calibration.ts            # samples to bounded thresholds
│   ├── media/
│   │   ├── camera-session.ts         # media-track lifecycle
│   │   ├── face-landmarker.ts        # MediaPipe adapter
│   │   └── local-preview-peer.ts     # no-STUN/TURN WebRTC sender/receiver helpers
│   ├── offscreen/
│   │   └── runtime.ts                # inference loop and semantic event publishing
│   ├── background/
│   │   └── session-coordinator.ts    # per-tab state, validation and deduplication
│   ├── youtube/
│   │   ├── controller.ts             # narrow YouTubeController implementation
│   │   ├── semantics.ts              # centralized semantic selectors/state readers
│   │   └── lifecycle.ts              # SPA navigation rebinding
│   ├── overlay/
│   │   ├── App.tsx                   # accessible camera/status tile
│   │   ├── style.css                 # isolated high-contrast visual system
│   │   └── geometry.ts               # viewport-safe drag/resize persistence
│   └── popup/
│       └── App.tsx                   # start/stop, settings and calibration UI
├── tests/
│   ├── setup.ts
│   ├── contracts/
│   ├── gesture/
│   ├── media/
│   ├── background/
│   ├── youtube/
│   ├── overlay/
│   ├── popup/
│   └── fixtures/youtube/             # signed-in/out and playlist DOM fixtures
└── e2e/
    ├── extension.spec.ts             # isolated-profile browser tests
    └── fixtures/fake-camera.y4m      # deterministic non-person camera input
```

---

### Task 1: Secure scaffold and typed contracts

**Files:**
- Create: `Tool dev/EyeTube Control/package.json`
- Create: `Tool dev/EyeTube Control/tsconfig.json`
- Create: `Tool dev/EyeTube Control/vitest.config.ts`
- Create: `Tool dev/EyeTube Control/wxt.config.ts`
- Create: `Tool dev/EyeTube Control/tests/setup.ts`
- Create: `Tool dev/EyeTube Control/tests/contracts/messages.test.ts`
- Create: `Tool dev/EyeTube Control/src/contracts/messages.ts`
- Create: `Tool dev/EyeTube Control/src/contracts/status.ts`

**Interfaces:**
- Consumes: none.
- Produces: `RuntimeMessage`, `Gesture`, `Command`, `CommandResult`, `parseRuntimeMessage(input: unknown): RuntimeMessage | null`.

- [ ] **Step 1: Create the independent private project and install dependencies with scripts disabled**

Run from `Tool dev`:

```bash
mkdir "EyeTube Control"
cd "EyeTube Control"
git init -b main
git commit --allow-empty -m "chore: initialize repository"
git switch -c feature/eyetube-control
npm init -y
npm pkg set private=true license=UNLICENSED type=module
npm pkg set "packageManager=npm@$(npm --version)"
npm install --ignore-scripts --save-exact @mediapipe/tasks-vision react react-dom
npm install --ignore-scripts --save-dev --save-exact wxt @wxt-dev/module-react typescript vitest jsdom @testing-library/react @testing-library/jest-dom @types/chrome @types/react @types/react-dom playwright
npm audit signatures
npm audit
```

Inspect package ownership, install scripts and audit output. Approve/rebuild only dependencies whose required scripts have been reviewed. Add scripts `dev: wxt`, `build: wxt build`, `typecheck: tsc --noEmit`, `test: vitest run`, and `test:watch: vitest` to `package.json`. Do not use `npm audit fix --force`.

- [ ] **Step 2: Add strict WXT/Vitest configuration without application behavior**

Create `wxt.config.ts` with the minimum manifest:

```ts
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: {
    minimum_chrome_version: '116',
    permissions: ['offscreen', 'storage'],
    content_security_policy: {
      extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'",
    },
  },
});
```

Configure `tsconfig.json` with `strict`, `noUncheckedIndexedAccess`, and `exactOptionalPropertyTypes`. Configure Vitest for `jsdom`, globals and `tests/setup.ts`.

- [ ] **Step 3: Write the failing runtime-message validation tests**

```ts
import { describe, expect, it } from 'vitest';
import { parseRuntimeMessage } from '../../src/contracts/messages';

describe('parseRuntimeMessage', () => {
  it('accepts a valid start request', () => {
    expect(parseRuntimeMessage({ version: 1, type: 'START_SESSION', tabId: 7 }))
      .toEqual({ version: 1, type: 'START_SESSION', tabId: 7 });
  });

  it('rejects unknown message types and extra command fields', () => {
    expect(parseRuntimeMessage({ version: 1, type: 'DELETE_HISTORY', tabId: 7 })).toBeNull();
    expect(parseRuntimeMessage({
      version: 1,
      type: 'COMMAND',
      tabId: 7,
      command: 'NEXT_VIDEO',
      commandId: 'cmd-1',
      script: 'alert(1)',
    })).toBeNull();
  });

  it('rejects invalid tab IDs, progress and command IDs', () => {
    expect(parseRuntimeMessage({ version: 1, type: 'START_SESSION', tabId: -1 })).toBeNull();
    expect(parseRuntimeMessage({ version: 1, type: 'GESTURE_PROGRESS', tabId: 1, gesture: 'GAZE_UP', progress: 2 })).toBeNull();
    expect(parseRuntimeMessage({ version: 1, type: 'COMMAND', tabId: 1, command: 'LIKE_VIDEO', commandId: '' })).toBeNull();
  });
});
```

- [ ] **Step 4: Run the contract test and verify RED**

Run: `npm test -- tests/contracts/messages.test.ts`

Expected: FAIL because `src/contracts/messages.ts` does not exist.

- [ ] **Step 5: Implement the exact discriminated union and fail-closed parser**

```ts
export type Gesture = 'WINK_LEFT' | 'WINK_RIGHT' | 'BOTH_CLOSED' | 'GAZE_UP' | 'GAZE_DOWN';
export type Command = 'NEXT_VIDEO' | 'PREVIOUS_VIDEO' | 'TOGGLE_PLAYBACK' | 'LIKE_VIDEO' | 'SUBSCRIBE_CHANNEL';

export type RuntimeMessage =
  | { version: 1; type: 'START_SESSION'; tabId: number }
  | { version: 1; type: 'STOP_SESSION'; tabId: number }
  | { version: 1; type: 'START_CALIBRATION'; tabId: number }
  | { version: 1; type: 'GESTURE_PROGRESS'; tabId: number; gesture: Gesture; progress: number }
  | { version: 1; type: 'GESTURE_CANCELLED'; tabId: number }
  | { version: 1; type: 'COMMAND'; tabId: number; command: Command; commandId: string }
  | { version: 1; type: 'STATUS'; tabId: number; status: RuntimeStatus; reason?: StatusReason };

export function parseRuntimeMessage(input: unknown): RuntimeMessage | null {
  if (!isPlainRecord(input) || input.version !== 1 || !isPositiveInteger(input.tabId)) return null;
  const allowedKeys = MESSAGE_KEYS[input.type as string];
  if (!allowedKeys || Object.keys(input).some((key) => !allowedKeys.has(key))) return null;
  return validateByType(input) ? input as RuntimeMessage : null;
}
```

Define `MESSAGE_KEYS`, `isPlainRecord`, `isPositiveInteger` and exhaustive `validateByType` in the same file; validate `progress` as finite `[0, 1]` and `commandId` as 1–64 ASCII alphanumeric/hyphen characters.

- [ ] **Step 6: Run verification and commit**

Run:

```bash
npm test -- tests/contracts/messages.test.ts
npm run typecheck
git add package.json package-lock.json tsconfig.json vitest.config.ts wxt.config.ts tests src/contracts
git commit -m "chore: scaffold secure extension contracts"
```

Expected: contract tests PASS, typecheck exits 0, commit contains no generated build output.

---

### Task 2: Prove the private local camera-preview path

**Files:**
- Create: `Tool dev/EyeTube Control/entrypoints/offscreen.html`
- Create: `Tool dev/EyeTube Control/entrypoints/background.ts`
- Create: `Tool dev/EyeTube Control/entrypoints/youtube.content.tsx`
- Create: `Tool dev/EyeTube Control/src/media/camera-session.ts`
- Create: `Tool dev/EyeTube Control/src/media/local-preview-peer.ts`
- Create: `Tool dev/EyeTube Control/tests/media/camera-session.test.ts`
- Create: `Tool dev/EyeTube Control/tests/media/local-preview-peer.test.ts`
- Create: `Tool dev/EyeTube Control/e2e/preview-feasibility.md`

**Interfaces:**
- Consumes: `RuntimeMessage`, `parseRuntimeMessage` from Task 1.
- Produces: `CameraSession.start(deviceId?: string): Promise<MediaStream>`, `CameraSession.stop(): void`, `createPreviewSender(stream: MediaStream): PreviewSender`, `createPreviewReceiver(): PreviewReceiver`.

- [ ] **Step 1: Write failing camera lifecycle tests**

```ts
it('requests video without audio and stops every track', async () => {
  const stop = vi.fn();
  const stream = { getTracks: () => [{ stop }] } as unknown as MediaStream;
  const getUserMedia = vi.fn().mockResolvedValue(stream);
  const session = new CameraSession({ getUserMedia });

  await session.start('camera-1');
  expect(getUserMedia).toHaveBeenCalledWith({
    audio: false,
    video: { deviceId: { exact: 'camera-1' }, width: { ideal: 640 }, height: { ideal: 480 } },
  });

  session.stop();
  expect(stop).toHaveBeenCalledOnce();
});
```

Add tests that a second `start()` stops the first stream and a failed request leaves no active stream.

- [ ] **Step 2: Run the camera test and verify RED**

Run: `npm test -- tests/media/camera-session.test.ts`

Expected: FAIL because `CameraSession` is missing.

- [ ] **Step 3: Implement minimal camera ownership**

```ts
export class CameraSession {
  #stream: MediaStream | null = null;

  constructor(private readonly media: Pick<MediaDevices, 'getUserMedia'> = navigator.mediaDevices) {}

  async start(deviceId?: string): Promise<MediaStream> {
    this.stop();
    const video = deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: 640 }, height: { ideal: 480 } }
      : { width: { ideal: 640 }, height: { ideal: 480 } };
    this.#stream = await this.media.getUserMedia({ audio: false, video });
    return this.#stream;
  }

  stop(): void {
    this.#stream?.getTracks().forEach((track) => track.stop());
    this.#stream = null;
  }
}
```

- [ ] **Step 4: Write failing local-peer tests**

Inject an `RTCPeerConnection` factory. Assert both peers use `{ iceServers: [] }`, sender adds only video tracks, signaling descriptions/candidates are JSON-safe, `close()` closes both peers, and no candidate containing `typ srflx` or `typ relay` is accepted.

```ts
it('creates a no-STUN/TURN video-only sender', () => {
  const peer = fakePeerConnection();
  const stream = fakeVideoOnlyStream();
  createPreviewSender(stream, () => peer);
  expect(peer.configuration).toEqual({ iceServers: [] });
  expect(peer.addedTracks.map(({ track }) => track.kind)).toEqual(['video']);
});
```

- [ ] **Step 5: Run peer tests RED, implement helpers, then run GREEN**

Run RED: `npm test -- tests/media/local-preview-peer.test.ts`

Implement `PreviewSender`/`PreviewReceiver` with offer/answer/candidate methods and explicit `close()`. Reject non-host candidate types. Do not use `window.postMessage`, data channels, public ICE servers or frame serialization.

Run GREEN: `npm test -- tests/media`

- [ ] **Step 6: Wire a feasibility-only extension path**

Create the offscreen document with:

```ts
await chrome.offscreen.createDocument({
  url: 'offscreen.html',
  reasons: [chrome.offscreen.Reason.USER_MEDIA, chrome.offscreen.Reason.WEB_RTC],
  justification: 'Process eye gestures locally and show the active camera preview.',
});
```

The content script must match only `https://www.youtube.com/*`, mount one closed Shadow DOM host, attach the received stream to `<video autoplay muted playsInline>`, and show a persistent camera-active label. The service worker routes only validated signaling messages between the offscreen context and the initiating `sender.tab.id`.

- [ ] **Step 7: Verify the feasibility gate in isolated Chrome**

Build with `npm run build`, load `.output/chrome-mv3` into an isolated Chrome profile, use the deterministic fake camera, and record evidence in `e2e/preview-feasibility.md`:

```text
- Camera prompt occurs only after Start: PASS/FAIL
- Mirrored preview visible in one YouTube tab: PASS/FAIL
- chrome://webrtc-internals shows no configured ICE servers: PASS/FAIL
- Network panel shows no STUN/TURN/application request: PASS/FAIL
- Closing tile stops camera indicator and every track: PASS/FAIL
- Console errors/warnings: 0 required
```

If any privacy or lifecycle item fails, stop execution and report the blocker; do not continue to Task 3.

- [ ] **Step 8: Commit the proven feasibility slice**

```bash
npm test -- tests/media
npm run typecheck
git add entrypoints src/media tests/media e2e/preview-feasibility.md
git commit -m "feat: prove local camera preview path"
```

---

### Task 3: Gesture hold/cancel/cooldown state machine

**Files:**
- Create: `Tool dev/EyeTube Control/src/gesture/types.ts`
- Create: `Tool dev/EyeTube Control/src/gesture/machine.ts`
- Create: `Tool dev/EyeTube Control/tests/gesture/machine.test.ts`

**Interfaces:**
- Consumes: `Gesture`, `Command` from Task 1.
- Produces: `Observation`, `GestureMachine`, `GestureMachine.update(observation, timestampMs): GestureEvent[]`, `GestureMachine.reset(): void`.

- [ ] **Step 1: Write failing tests using a fake monotonic clock**

Cover these independent behaviors:

```ts
it('ignores a natural 200 ms both-eye blink', () => {
  const machine = new GestureMachine(DEFAULT_SETTINGS);
  expect(machine.update('BOTH_CLOSED', 0)).toContainEqual({ type: 'PROGRESS', gesture: 'BOTH_CLOSED', progress: 0 });
  expect(machine.update('NEUTRAL', 200)).toContainEqual({ type: 'CANCELLED' });
  expect(eventsOfType(machine, 'COMMAND')).toHaveLength(0);
});

it('emits play/pause once after 700 ms and requires neutral reset', () => {
  const machine = new GestureMachine(DEFAULT_SETTINGS);
  machine.update('BOTH_CLOSED', 0);
  expect(machine.update('BOTH_CLOSED', 700)).toContainEqual(expect.objectContaining({ type: 'COMMAND', command: 'TOGGLE_PLAYBACK' }));
  expect(machine.update('BOTH_CLOSED', 2500)).not.toContainEqual(expect.objectContaining({ type: 'COMMAND' }));
});
```

Also test wink mapping, 2,000 ms account holds, uncertain/no-face cancellation, 1,500 ms cooldown, 300 ms neutral rearm, non-monotonic timestamps and disabled gestures.

- [ ] **Step 2: Run RED**

Run: `npm test -- tests/gesture/machine.test.ts`

Expected: FAIL because `GestureMachine` is missing.

- [ ] **Step 3: Implement the explicit state machine**

```ts
type MachineState =
  | { type: 'SEARCHING' }
  | { type: 'READY'; neutralSince: number | null }
  | { type: 'HOLDING'; gesture: Gesture; startedAt: number }
  | { type: 'COOLDOWN'; emittedAt: number; neutralSince: number | null };

const COMMAND_BY_GESTURE: Record<Gesture, Command> = {
  WINK_RIGHT: 'NEXT_VIDEO',
  WINK_LEFT: 'PREVIOUS_VIDEO',
  BOTH_CLOSED: 'TOGGLE_PLAYBACK',
  GAZE_UP: 'LIKE_VIDEO',
  GAZE_DOWN: 'SUBSCRIBE_CHANNEL',
};
```

Use pure transitions, clamp progress to `[0, 1]`, reject decreasing timestamps by resetting to `SEARCHING`, and generate `commandId` from `crypto.randomUUID()` only at emission.

- [ ] **Step 4: Verify GREEN and commit**

```bash
npm test -- tests/gesture/machine.test.ts
npm run typecheck
git add src/gesture/types.ts src/gesture/machine.ts tests/gesture/machine.test.ts
git commit -m "feat: add safe eye gesture state machine"
```

---

### Task 4: Calibration, classification and MediaPipe adapter

**Files:**
- Create: `Tool dev/EyeTube Control/src/gesture/calibration.ts`
- Create: `Tool dev/EyeTube Control/src/gesture/classifier.ts`
- Create: `Tool dev/EyeTube Control/src/media/face-landmarker.ts`
- Create: `Tool dev/EyeTube Control/tests/gesture/calibration.test.ts`
- Create: `Tool dev/EyeTube Control/tests/gesture/classifier.test.ts`
- Create: `Tool dev/EyeTube Control/tests/media/face-landmarker.test.ts`
- Create: `Tool dev/EyeTube Control/public/models/face_landmarker.task`
- Create: `Tool dev/EyeTube Control/public/models/SHA256SUMS`

**Interfaces:**
- Consumes: `Observation` from Task 3 and pinned MediaPipe results.
- Produces: `CalibrationProfile`, `deriveCalibration(samples): CalibrationResult`, `classify(features, profile): Observation`, `FaceLandmarkerAdapter.detect(video, timestampMs): Promise<FaceFeatures>`.

- [ ] **Step 1: Write failing calibration tests**

```ts
it('derives bounded thresholds without retaining samples', () => {
  const result = deriveCalibration(validCalibrationSamples());
  expect(result.status).toBe('SUCCESS');
  expect(result.profile).toMatchObject({ version: 1 });
  expect(JSON.stringify(result)).not.toContain('landmarks');
});

it.each(['LOW_LIGHT', 'FACE_TOO_SMALL', 'UNSTABLE', 'INDISTINGUISHABLE'] as const)(
  'fails closed with %s',
  (reason) => expect(deriveCalibration(samplesForFailure(reason))).toEqual({ status: 'FAILED', reason }),
);
```

- [ ] **Step 2: Run calibration tests RED, implement bounded profile, run GREEN**

Run RED: `npm test -- tests/gesture/calibration.test.ts`

Implement a profile containing only blink/gaze thresholds, confidence floors and schema version. Clamp every derived threshold to conservative constants and return a typed failure instead of a partial profile.

Run GREEN: `npm test -- tests/gesture/calibration.test.ts`

- [ ] **Step 3: Write failing classifier tests**

Use numeric `FaceFeatures` fixtures, not image snapshots. Test neutral, left/right wink isolation, both closed, gaze up/down, head-pose rejection, missing face, occlusion and ambiguous signals. Priority must be `NO_FACE/UNCERTAIN` → `BOTH_CLOSED` → wink → gaze → neutral so overlapping signals cannot trigger account actions.

- [ ] **Step 4: Run classifier RED, implement pure classifier, run GREEN**

Run RED: `npm test -- tests/gesture/classifier.test.ts`

Implement `classify(features, profile)` as a pure function with no DOM, MediaPipe or timer dependency.

Run GREEN: `npm test -- tests/gesture/classifier.test.ts`

- [ ] **Step 5: Pin the official model and test the MediaPipe boundary**

Download the versioned official model artifact from:

```text
https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task
```

Record `sha256sum`/`shasum -a 256` output in `public/models/SHA256SUMS`. Test that the adapter requests `numFaces: 1`, `runningMode: 'VIDEO'`, `outputFaceBlendshapes: true`, accepts monotonically increasing timestamps and converts results to the minimal `FaceFeatures` shape without exposing raw landmarks to callers.

- [ ] **Step 6: Implement the adapter and inference throttling**

```ts
export interface FaceLandmarkerAdapter {
  detect(video: HTMLVideoElement, timestampMs: number): Promise<FaceFeatures>;
  close(): void;
}

export const INFERENCE_INTERVAL_MS = 1000 / 15;
export const MIN_INFERENCE_FPS = 10;
```

Load WASM/model only with `chrome.runtime.getURL`, never a CDN URL. Skip frames while a detection is already in flight and adapt down to 10 FPS after repeated budget overruns.

- [ ] **Step 7: Verify and commit**

```bash
npm test -- tests/gesture tests/media/face-landmarker.test.ts
npm run typecheck
git add src/gesture src/media/face-landmarker.ts tests public/models
git commit -m "feat: add calibrated local eye classification"
```

---

### Task 5: Fail-closed YouTube command adapter

**Files:**
- Create: `Tool dev/EyeTube Control/src/youtube/controller.ts`
- Create: `Tool dev/EyeTube Control/src/youtube/semantics.ts`
- Create: `Tool dev/EyeTube Control/src/youtube/lifecycle.ts`
- Create: `Tool dev/EyeTube Control/tests/youtube/controller.test.ts`
- Create: `Tool dev/EyeTube Control/tests/youtube/lifecycle.test.ts`
- Create: `Tool dev/EyeTube Control/tests/fixtures/youtube/watch.html`
- Create: `Tool dev/EyeTube Control/tests/fixtures/youtube/playlist.html`
- Create: `Tool dev/EyeTube Control/tests/fixtures/youtube/signed-out.html`

**Interfaces:**
- Consumes: `Command`, `CommandResult` from Task 1.
- Produces: `YouTubeController.execute(command, commandId): Promise<CommandResult>`, `observeYouTubeNavigation(callback): () => void`.

- [ ] **Step 1: Write fixture-based failing playback/navigation tests**

```ts
it('toggles the real video element without clicking unrelated DOM', async () => {
  const video = installVideoFixture({ paused: true });
  const result = await controller.execute('TOGGLE_PLAYBACK', 'cmd-1');
  expect(video.play).toHaveBeenCalledOnce();
  expect(result).toEqual({ status: 'EXECUTED', command: 'TOGGLE_PLAYBACK' });
});

it('returns unavailable when previous is absent', async () => {
  installWatchFixtureWithoutPlaylist();
  await expect(controller.execute('PREVIOUS_VIDEO', 'cmd-2')).resolves.toEqual({
    status: 'UNAVAILABLE', command: 'PREVIOUS_VIDEO', reason: 'NO_CONTROL',
  });
});
```

Test next/previous availability, page-not-ready and selector ambiguity.

- [ ] **Step 2: Run RED, implement playback/navigation semantics, run GREEN**

Run RED: `npm test -- tests/youtube/controller.test.ts`

Implement one allowlisted semantic lookup per command. Require exactly one visible enabled target; zero is unavailable and more than one is `FAILED/YOUTUBE_UI_CHANGED`.

Run GREEN: `npm test -- tests/youtube/controller.test.ts`

- [ ] **Step 3: Write failing idempotent account-action tests**

```ts
it('does not click an already pressed Like button', async () => {
  const like = installLikeButton({ pressed: true });
  const result = await controller.execute('LIKE_VIDEO', 'cmd-like');
  expect(like.click).not.toHaveBeenCalled();
  expect(result).toEqual({ status: 'ALREADY_APPLIED', command: 'LIKE_VIDEO' });
});

it('does not click Subscribe while signed out', async () => {
  installSignedOutFixture();
  expect(await controller.execute('SUBSCRIBE_CHANNEL', 'cmd-sub')).toEqual({
    status: 'UNAVAILABLE', command: 'SUBSCRIBE_CHANNEL', reason: 'NOT_SIGNED_IN',
  });
});
```

Test ambiguous labels/states fail closed and never infer state from localized visible text alone; prefer stable attributes such as `aria-pressed` and enabled/disabled semantics.

- [ ] **Step 4: Implement account semantics and command deduplication**

Keep a bounded in-memory set of the last 100 `commandId` values per tab. Return the prior result for duplicates. Never toggle an already-applied Like/Subscribe state and never retry a click.

- [ ] **Step 5: Write/implement SPA lifecycle tests**

Test that repeated `yt-navigate-finish`, History API changes and MutationObserver signals collapse into one rebind callback and one overlay/controller instance. `observeYouTubeNavigation` must return an unsubscribe function that removes every listener/observer.

- [ ] **Step 6: Verify and commit**

```bash
npm test -- tests/youtube
npm run typecheck
git add src/youtube tests/youtube tests/fixtures/youtube
git commit -m "feat: add safe YouTube command adapter"
```

---

### Task 6: Accessible floating camera overlay

**Files:**
- Create: `Tool dev/EyeTube Control/src/overlay/App.tsx`
- Create: `Tool dev/EyeTube Control/src/overlay/style.css`
- Create: `Tool dev/EyeTube Control/src/overlay/geometry.ts`
- Create: `Tool dev/EyeTube Control/tests/overlay/App.test.tsx`
- Create: `Tool dev/EyeTube Control/tests/overlay/geometry.test.ts`
- Modify: `Tool dev/EyeTube Control/entrypoints/youtube.content.tsx`

**Interfaces:**
- Consumes: runtime status/progress and preview `MediaStream` from Tasks 1–2; `YouTubeController` from Task 5.
- Produces: `EyeControlOverlay` component, `clampTileGeometry(geometry, viewport): TileGeometry`, `mountOverlay(): OverlayHandle`.

- [ ] **Step 1: Write failing geometry tests**

```ts
it('clamps a restored tile inside a smaller viewport', () => {
  expect(clampTileGeometry(
    { x: 1800, y: 900, width: 500, height: 400 },
    { width: 1280, height: 720 },
  )).toEqual({ x: 920, y: 450, width: 360, height: 270 });
});
```

Test default 240×180, minimum 160×120, maximum 360×270, bottom-left placement, drag boundaries and viewport resize.

- [ ] **Step 2: Run geometry RED, implement, run GREEN**

Run RED: `npm test -- tests/overlay/geometry.test.ts`

Implement pure geometry functions with no DOM dependency.

Run GREEN: `npm test -- tests/overlay/geometry.test.ts`

- [ ] **Step 3: Write failing accessible-state tests**

```tsx
it.each([
  ['SEARCHING', 'Center your face'],
  ['READY', 'Ready'],
  ['ERROR_PERMISSION_DENIED', 'Camera permission was denied'],
] as const)('announces %s with text, not color alone', (status, text) => {
  render(<EyeControlOverlay status={status} preview={null} />);
  expect(screen.getByRole('status')).toHaveTextContent(text);
});

it('offers keyboard accessible minimize and stop controls', () => {
  render(<EyeControlOverlay status="READY" preview={fakeStream()} />);
  expect(screen.getByRole('button', { name: 'Minimize camera preview' })).toBeVisible();
  expect(screen.getByRole('button', { name: 'Stop eye control' })).toBeVisible();
});
```

Also test progress labels, completed command feedback, calibration `n/5`, focus order and minimized camera-active indicator.

- [ ] **Step 4: Implement the Shadow DOM overlay**

Mount one host marked with an extension-owned data attribute, call `attachShadow({ mode: 'closed' })`, retain the root only in the content-script closure, and render React into it. Use a mirrored `<video autoplay muted playsInline>` and set `srcObject` only from the local peer track.

Implement CSS tokens with YouTube-compatible dark surfaces, at least 4.5:1 text contrast, 44×44 controls, visible focus, 150–300 ms transitions and:

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 5: Implement drag, resize, minimize and cleanup**

Use Pointer Events with pointer capture; never install page-wide mousemove listeners. Persist only clamped geometry through a passed storage callback. `OverlayHandle.destroy()` must unmount React, pause/clear the video `srcObject`, release pointer listeners and remove the host.

- [ ] **Step 6: Verify tests and inspect in Chrome**

```bash
npm test -- tests/overlay
npm run typecheck
npm run build
```

In isolated Chrome, inspect the accessibility tree, tab through controls, zoom to 200%, toggle reduced motion, resize/theater/fullscreen, and capture screenshots for default, holding and minimized states. Require zero console errors/warnings.

- [ ] **Step 7: Commit**

```bash
git add src/overlay tests/overlay entrypoints/youtube.content.tsx
git commit -m "feat: add accessible floating camera overlay"
```

---

### Task 7: Session coordinator and offscreen inference runtime

**Files:**
- Create: `Tool dev/EyeTube Control/src/background/session-coordinator.ts`
- Create: `Tool dev/EyeTube Control/src/offscreen/runtime.ts`
- Create: `Tool dev/EyeTube Control/tests/background/session-coordinator.test.ts`
- Create: `Tool dev/EyeTube Control/tests/offscreen/runtime.test.ts`
- Modify: `Tool dev/EyeTube Control/entrypoints/background.ts`
- Modify: `Tool dev/EyeTube Control/entrypoints/offscreen.html`
- Modify: `Tool dev/EyeTube Control/entrypoints/youtube.content.tsx`

**Interfaces:**
- Consumes: validated messages, camera/peer, classifier/machine, controller and overlay from Tasks 1–6.
- Produces: `SessionCoordinator.handle(message, sender): Promise<void>`, `OffscreenRuntime.start(config): Promise<void>`, `OffscreenRuntime.stop(): void`.

- [ ] **Step 1: Write failing coordinator authorization tests**

```ts
it('binds commands to the explicitly enabled sender tab', async () => {
  await coordinator.handle(startMessage(12), extensionSenderForTab(12));
  await coordinator.handle(commandMessage(13, 'NEXT_VIDEO'), offscreenSender());
  expect(sendToTab).not.toHaveBeenCalled();
});

it('does not replay a command after coordinator recreation', async () => {
  await coordinator.handle(startMessage(12), extensionSenderForTab(12));
  await coordinator.handle(commandMessage(12, 'LIKE_VIDEO', 'fixed-id'), offscreenSender());
  const restarted = createCoordinatorWithSameSessionStore();
  await restarted.handle(commandMessage(12, 'LIKE_VIDEO', 'fixed-id'), offscreenSender());
  expect(sendToTab).toHaveBeenCalledTimes(1);
});
```

Reject messages with no expected `sender.id`, content-script start requests from the wrong tab, offscreen commands for inactive tabs and unvalidated payloads.

- [ ] **Step 2: Run coordinator RED, implement, run GREEN**

Run RED: `npm test -- tests/background/session-coordinator.test.ts`

Implement one active tab in version 1. Store only session metadata and recent command IDs in `chrome.storage.session`; never store them in synced/local persistent storage.

Run GREEN: `npm test -- tests/background/session-coordinator.test.ts`

- [ ] **Step 3: Write failing offscreen runtime tests**

Inject the camera, clock, face adapter, classifier, state machine and messenger. Test Start → camera/peer/inference, hidden tab → paused inference, face loss → cancellation, command emission with semantic-only messages, model failure → stopped tracks, and Stop → closed peer/model/tracks.

- [ ] **Step 4: Implement the runtime composition**

```ts
export class OffscreenRuntime {
  async start(config: SessionConfig): Promise<void> { /* acquire, negotiate, then infer */ }
  setVisibility(isVisible: boolean): void { /* pause/resume requestAnimationFrame loop */ }
  stop(): void { /* cancel loop, close model/peer, stop every track */ }
}
```

Start order is camera → local peer → model → `READY`; any failure unwinds in reverse order. Never start inference before preview signaling succeeds, because the camera-active indicator must remain visible.

- [ ] **Step 5: Wire entrypoints with validated messaging**

Each `chrome.runtime.onMessage` listener calls `parseRuntimeMessage` first. Content script sends visibility changes on `visibilitychange`, cleans up on page unload, and never accepts `window.postMessage`. Background creates at most one offscreen document using `chrome.runtime.getContexts()`.

- [ ] **Step 6: Verify and commit**

```bash
npm test -- tests/background tests/offscreen
npm run typecheck
npm run build
git add src/background src/offscreen tests/background tests/offscreen entrypoints
git commit -m "feat: coordinate private eye control sessions"
```

---

### Task 8: Safe settings, popup and calibration flow

**Files:**
- Create: `Tool dev/EyeTube Control/src/contracts/settings.ts`
- Create: `Tool dev/EyeTube Control/src/popup/App.tsx`
- Create: `Tool dev/EyeTube Control/entrypoints/popup/index.html`
- Create: `Tool dev/EyeTube Control/entrypoints/popup/main.tsx`
- Create: `Tool dev/EyeTube Control/entrypoints/popup/style.css`
- Create: `Tool dev/EyeTube Control/tests/contracts/settings.test.ts`
- Create: `Tool dev/EyeTube Control/tests/popup/App.test.tsx`

**Interfaces:**
- Consumes: runtime messages/status, calibration results and session coordinator.
- Produces: `EyeControlSettings`, `DEFAULT_SETTINGS`, `parseSettings(input): EyeControlSettings`, popup actions for Start/Stop/Recalibrate.

- [ ] **Step 1: Write failing settings-boundary tests**

```ts
it('clamps unsafe account hold duration to 1500 ms', () => {
  expect(parseSettings({ ...DEFAULT_SETTINGS, accountHoldMs: 100 }).accountHoldMs).toBe(1500);
});

it('drops unknown persisted fields', () => {
  expect(parseSettings({ ...DEFAULT_SETTINGS, uploadFrames: true })).not.toHaveProperty('uploadFrames');
});
```

Test every range from the spec, per-command booleans, tile geometry, mirror/preview setting and corrupt-storage fallback.

- [ ] **Step 2: Run RED, implement safe settings, run GREEN**

Run RED: `npm test -- tests/contracts/settings.test.ts`

Implement allowlisted parsing and write only validated output to `chrome.storage.local`. Calibration reset deletes numeric thresholds; it does not change camera permission.

Run GREEN: `npm test -- tests/contracts/settings.test.ts`

- [ ] **Step 3: Write failing popup flow tests**

Test explicit Start, Stop, permission denied recovery, camera selector, Recalibrate, gesture toggles, safe-range input errors, show/minimize/reset controls and local-processing disclosure.

```tsx
it('starts only after an explicit button click', async () => {
  const start = vi.fn();
  render(<PopupApp status="OFF" onStart={start} />);
  expect(start).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Start eye control' }));
  expect(start).toHaveBeenCalledOnce();
});
```

- [ ] **Step 4: Implement popup and five-step calibration UI**

Use visible labels, inline errors, an `aria-live` status area and a clear camera privacy statement. Calibration order is neutral → right wink → left wink → both closed → up/down gaze; show `n/5` and allow Cancel, which stops the session and discards samples.

- [ ] **Step 5: Verify and commit**

```bash
npm test -- tests/contracts/settings.test.ts tests/popup/App.test.tsx
npm run typecheck
npm run build
git add src/contracts/settings.ts src/popup tests/contracts/settings.test.ts tests/popup entrypoints/popup
git commit -m "feat: add safe settings and calibration popup"
```

---

### Task 9: Full integration, performance and Chrome acceptance

**Files:**
- Create: `Tool dev/EyeTube Control/e2e/extension.spec.ts`
- Create: `Tool dev/EyeTube Control/e2e/fixtures/fake-camera.y4m`
- Create: `Tool dev/EyeTube Control/e2e/ACCEPTANCE.md`
- Modify: integration entrypoints as failures reveal missing wiring.

**Interfaces:**
- Consumes: the complete extension.
- Produces: automated isolated-profile regression suite and recorded manual acceptance evidence.

- [ ] **Step 1: Add a deterministic synthetic camera fixture**

Generate or obtain a non-person test fixture with the five approved eye states and document its source. The fixture contains no real user's face. Launch isolated Chromium with:

```ts
const context = await chromium.launchPersistentContext(tempProfile, {
  headless: false,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-video-capture=${fakeCameraPath}`,
  ],
});
```

- [ ] **Step 2: Write failing end-to-end tests for non-account actions**

Test install/start, one overlay after SPA navigation, camera preview, play/pause, unavailable previous, minimize/restore, stop/track cleanup and service-worker restart. Account actions must use local YouTube DOM fixtures, never live YouTube account state.

- [ ] **Step 3: Run E2E RED, fix only missing integration, then run GREEN**

Run RED: `npm run build && npx playwright test e2e/extension.spec.ts`

Expected: at least one integration assertion fails before final wiring. Make the smallest wiring changes necessary.

Run GREEN: `npm run build && npx playwright test e2e/extension.spec.ts`

- [ ] **Step 4: Verify privacy and network behavior**

Use an isolated Chrome DevTools session. Start/stop the extension and inspect Network plus `chrome://webrtc-internals`. Require no model/CDN/analytics/STUN/TURN request, one local peer only, no audio track and no camera activity after Stop.

- [ ] **Step 5: Verify accessibility and visual behavior**

Inspect the accessibility tree, keyboard focus order, 200% zoom, 4.5:1 text contrast, reduced motion, theater/fullscreen and 1280×720/1920×1080 viewports. Save screenshots and results in `e2e/ACCEPTANCE.md`; do not include a real camera frame in committed screenshots.

- [ ] **Step 6: Measure performance**

Record a 30-minute session with DevTools Performance Monitor. Acceptance thresholds:

```text
Inference sampling: 10–15 FPS
Gesture feedback latency: <150 ms excluding hold duration
Long tasks attributable to extension: no repeated >50 ms task
YouTube playback: no sustained dropped-frame regression caused by extension
Memory: no monotonic growth after repeated Start/Stop cycles
Console: 0 errors, 0 warnings
```

- [ ] **Step 7: Run the complete verification suite and commit**

```bash
npm test
npm run typecheck
npm run build
npx playwright test
git add e2e entrypoints src
git commit -m "test: verify EyeTube Control in Chrome"
```

---

### Task 10: Documentation, security audit and release artifact

**Files:**
- Create: `Tool dev/EyeTube Control/README.md`
- Create: `Tool dev/EyeTube Control/SECURITY.md`
- Modify: `TOOLS.md`
- Verify: `Tool dev/EyeTube Control/package-lock.json`

**Interfaces:**
- Consumes: tested behavior and evidence from Tasks 1–9.
- Produces: team-facing install/use/privacy documentation and a verified unpacked Chrome build.

- [ ] **Step 1: Write README from verified behavior**

Document name/purpose, workspace reason, internal-only `UNLICENSED` status, Chrome requirement, `npm install`/`npm run dev`/`npm run build`/`npm test`, Load unpacked steps, five gesture mappings, camera tile controls, local-only privacy promise, tested status and known limitations. Do not claim Web Store availability.

- [ ] **Step 2: Write SECURITY.md**

Copy the spec threat boundaries into actionable policy: supported versions, no sensitive data in public issues, dependency/model verification, and the promise that camera data is never retained or transmitted externally. Until a private reporting channel is configured, state that the prototype must not be publicly distributed and security findings must go directly to the workspace owner through the team's established private channel.

- [ ] **Step 3: Update the workspace tool catalog**

Add EyeTube Control to `TOOLS.md` with:

```text
Purpose: Local eye-gesture control for YouTube with a visible camera tile
Source: Internal tool; no upstream remote
License: UNLICENSED/internal-only
Run: npm install, npm run dev; production build with npm run build
Status: Chrome desktop prototype, tested version copied from ACCEPTANCE.md
Limitations: calibration variability, YouTube DOM dependency, playlist-only previous action
```

- [ ] **Step 4: Run release security checks**

```bash
npm audit signatures
npm audit
npm ls --all
shasum -a 256 -c public/models/SHA256SUMS
rg -n "https?://|eval\(|new Function|innerHTML|postMessage|console\.(log|debug)" src entrypoints
```

Review every match. The only allowed runtime web origin is YouTube content-script scope; there must be no remote code/model URL, `eval`, unsafe HTML, page messaging or sensitive debug logging. Resolve reachable high/critical advisories before release; document any unreachable lower-severity advisory with rationale and review date.

- [ ] **Step 5: Run final verification from a clean checkout**

```bash
git status --short
npm ci --ignore-scripts
npm audit signatures
npm audit
npm test
npm run typecheck
npm run build
npx playwright test
git status --short
```

Expected: clean before install, audits reviewed with no reachable high/critical issue, all tests/typecheck/build/E2E exit 0, and only expected ignored build/dependency directories remain untracked.

- [ ] **Step 6: Commit documentation and tag the internal milestone**

```bash
git add README.md SECURITY.md package-lock.json
git commit -m "docs: document EyeTube Control prototype"
git tag -a v0.1.0-internal -m "EyeTube Control internal prototype"
```

Update the root `TOOLS.md` separately because it is outside the tool's Git repository and cannot be included in this commit.

## Plan completion checks

### Spec coverage map

| Spec section | Implemented/verified by |
| --- | --- |
| 1. Summary | Tasks 1–10 collectively deliver the described extension |
| 2. Goals | Global Constraints; Tasks 3, 5, 6, 7 and 9 |
| 3. Non-goals | Global Constraints; Tasks 1, 9 and 10 |
| 4. Users and primary flow | Tasks 7 and 8 |
| 5. Gesture contract | Tasks 3 and 4 |
| 6. User interface | Tasks 6 and 8 |
| 7. Architecture | Tasks 1, 2 and 7 |
| 8. Internal message contracts | Tasks 1 and 7 |
| 9. Eye detection and calibration | Tasks 3, 4 and 8 |
| 10. YouTube command adapter | Task 5 |
| 11. Permissions and privacy | Tasks 1, 2, 7, 9 and 10 |
| 12. Threat model | Tasks 1, 2, 5, 7 and 10 |
| 13. Error handling | Tasks 2, 4, 5, 7 and 8 |
| 14. Settings and safe ranges | Tasks 3 and 8 |
| 15. Testing strategy | Test steps in Tasks 1–9 |
| 16. Acceptance criteria | Tasks 9 and 10 |
| 17. Delivery sequence | Task order 1–10 |
| 18. Known limitations | Task 10 README documentation |
| 19. Source references | Tasks 1, 2 and 4 dependency/API choices |

- Each of the spec's 19 sections maps to one or more tasks above.
- The local-preview feasibility gate precedes gesture/model/UI investment.
- Every behavioral module has an explicit RED command, minimal implementation direction and GREEN command.
- Runtime boundaries use the same `Gesture`, `Command`, `RuntimeMessage`, `CommandResult`, `Observation` and settings names throughout.
- Browser acceptance covers privacy, accessibility, performance, SPA lifecycle, camera cleanup and account-action safety.
- No task requires a personal Chrome profile, real-account Like/Subscribe action, remote runtime asset or broad host permission.
