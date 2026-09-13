# EyeTube Control — Product and Technical Specification

- **Status:** Draft for user review
- **Date:** 2026-09-13
- **Target:** Google Chrome desktop, Manifest V3
- **Working name:** EyeTube Control

## 1. Summary

EyeTube Control is a Chrome extension that lets a person control YouTube with deliberate eye gestures while watching a video. A floating, mirrored camera preview appears over the YouTube page like a video-call tile. It shows detection status, the current gesture and progress before an action fires.

All camera frames and facial landmarks are processed locally in the browser. The extension does not record, persist or transmit images, video, landmarks or biometric templates.

## 2. Goals

1. Support hands-free control of common YouTube actions on Chrome desktop.
2. Make accidental commands unlikely during natural blinking or ordinary viewing.
3. Give continuous, understandable feedback through a video-call-style camera overlay.
4. Keep camera processing private, local and explicitly controlled by the user.
5. Remain usable across YouTube's single-page navigation without reloading the extension.

## 3. Non-goals for version 1

- Firefox, Edge, Safari, mobile browsers or the YouTube mobile app.
- Voice, hand, head-pose or full-body gesture control.
- Eye tracking for advertising, analytics, identity, emotion or attention measurement.
- Recording sessions, storing screenshots or synchronizing gesture history.
- Operating on websites other than `youtube.com`.
- Guaranteed support for controls that YouTube does not expose in the current context, such as “previous video” outside a playlist or queue.

## 4. Users and primary flow

The primary user is watching YouTube on a desktop and wants hands-free playback/navigation, including users with temporary or permanent motor limitations.

### First use

1. The user opens a YouTube watch page and clicks the extension action.
2. The popup explains that processing is local and asks the user to start eye control.
3. Chrome requests camera access only after this explicit action.
4. The floating camera tile opens and a short calibration flow asks the user to look naturally, wink each eye, close both eyes, look up and look down.
5. After calibration succeeds, the tile changes to **Ready** and gestures can trigger commands.

### Returning use

1. The extension remembers non-sensitive settings and calibration thresholds locally.
2. Camera processing remains off after browser restart until the user explicitly enables it.
3. Enabling the extension on a YouTube tab restores the last tile position and size for the current viewport.

## 5. Gesture contract

| Gesture | Command | Activation | Safety behavior |
| --- | --- | ---: | --- |
| Hold right-eye wink while left eye remains open | Next video | 700 ms | Requires neutral eyes before another command |
| Hold left-eye wink while right eye remains open | Previous video | 700 ms | No-op with explanation when unavailable |
| Close both eyes | Play/pause | 700 ms | Natural short blinks are ignored |
| Look up with both eyes open | Like current video | 2,000 ms | Visible countdown; does nothing if already liked |
| Look down with both eyes open | Subscribe to current channel | 2,000 ms | Visible countdown; does nothing if already subscribed |

### Gesture state machine

Every frame produces one normalized observation: `NO_FACE`, `NEUTRAL`, `WINK_LEFT`, `WINK_RIGHT`, `BOTH_CLOSED`, `GAZE_UP`, `GAZE_DOWN` or `UNCERTAIN`.

Command recognition uses these states:

```text
DISABLED
  -> SEARCHING when the user starts the camera
SEARCHING
  -> READY after calibration and a valid neutral face
READY
  -> HOLDING when one eligible gesture is stable
HOLDING
  -> READY when confidence falls or the gesture changes
  -> COOLDOWN when the hold threshold is reached and the command is emitted
COOLDOWN
  -> READY only after 300 ms of neutral eyes and at least 1,500 ms since emission
ANY ACTIVE STATE
  -> SEARCHING when the face is lost
  -> DISABLED when the user stops the camera
```

The cooldown minimum is **1,500 ms**. A command must never repeat while the user continues holding the same gesture. `UNCERTAIN` cancels progress instead of guessing.

## 6. User interface

### Floating camera tile

The content script mounts an isolated overlay on YouTube using a Shadow DOM root so YouTube CSS cannot restyle it.

- Default position: bottom-left of the viewport, avoiding YouTube's player controls.
- Default size: 240 × 180 CSS pixels; minimum 160 × 120; maximum 360 × 270.
- The user can drag the tile, resize it from a visible handle, minimize it to a compact status pill or close it to stop the camera.
- The preview is mirrored horizontally so movement feels like a video call. Recognition uses consistently transformed coordinates and is not affected by the visual mirror.
- Position and size are clamped into the viewport after resize, theater/fullscreen changes and YouTube navigation.
- In fullscreen, the overlay remains visible only when Chrome and YouTube permit the extension element in that fullscreen subtree; otherwise it falls back to the minimized status shown before entering fullscreen.

### Tile states

| State | Visual and text feedback |
| --- | --- |
| Camera off | Camera-off icon and “Eye control off” |
| Requesting permission | Spinner and “Waiting for camera permission” |
| Searching | Neutral border and “Center your face” |
| Calibrating | One instruction at a time with progress `n/5` |
| Ready | Green border, status dot and “Ready” |
| Holding | Blue progress ring, gesture name and remaining duration |
| Command completed | Check icon plus action name for 1 second |
| Warning/error | Amber/red icon and a specific recovery message |

Color is never the only signal; every state includes an icon and text. Interactive controls have at least a 44 × 44 pixel target, keyboard focus is visible, buttons have accessible names, and status/error changes use an appropriate `aria-live` region. Motion uses short 150–300 ms transitions and is removed when `prefers-reduced-motion: reduce` is active.

### Popup

The popup provides:

- Start/stop eye control for the current YouTube tab.
- Camera selector when more than one video input exists.
- Current permission and runtime status.
- Recalibrate action.
- Gesture enable/disable toggles and adjustable hold durations within safe ranges.
- “Show camera”, “Minimize camera” and “Reset tile position” controls.
- A privacy summary linking to the full local-processing policy.

No remote font, icon, script or stylesheet is loaded. Icons are bundled SVG assets. The UI uses Chrome/system fonts to minimize bundle size and external requests.

## 7. Architecture

The extension uses WXT, TypeScript, React for the popup/overlay UI and Chrome Manifest V3.

The manifest sets `minimum_chrome_version` to `116` so session code can use `chrome.runtime.getContexts()` to manage offscreen-document lifecycle consistently.

```text
Popup / overlay controls
        |
        v
Manifest V3 service worker ---- chrome.storage.local
        |
        +---- Offscreen document
        |       - getUserMedia camera stream
        |       - bundled MediaPipe/WASM/model
        |       - calibration and gesture state machine
        |       - local WebRTC preview sender (no STUN/TURN)
        |
        +---- YouTube content script
                - Shadow DOM camera/status overlay
                - local WebRTC preview receiver
                - YouTube player adapter
                - SPA navigation lifecycle
```

### Responsibilities

- **Service worker:** owns session state, creates/closes the offscreen document, validates and routes messages, and ensures only the currently enabled YouTube tab receives commands.
- **Offscreen document:** owns the media stream and inference loop. Runtime messages contain only semantic states/progress. For the visible preview, it sends the same camera track directly to the enabled tab through a local WebRTC peer connection with no ICE servers; frames are never serialized into runtime messages.
- **Content script:** renders the tile, receives the local preview track and invokes commands through a dedicated YouTube adapter. It contains no model/inference code and never reads pixels from the preview.
- **Popup:** displays settings and issues explicit start, stop and calibration requests.
- **Storage adapter:** persists only preferences, safe threshold values and tile geometry. It does not persist camera data, landmarks, video identifiers or browsing history.

## 8. Internal message contracts

All runtime messages use a discriminated union with an explicit schema version. Receivers reject unknown types, invalid fields and messages from unexpected extension contexts.

```ts
type RuntimeMessage =
  | { version: 1; type: 'START_SESSION'; tabId: number }
  | { version: 1; type: 'STOP_SESSION'; tabId: number }
  | { version: 1; type: 'START_CALIBRATION'; tabId: number }
  | { version: 1; type: 'GESTURE_PROGRESS'; tabId: number; gesture: Gesture; progress: number }
  | { version: 1; type: 'GESTURE_CANCELLED'; tabId: number }
  | { version: 1; type: 'COMMAND'; tabId: number; command: Command; commandId: string }
  | { version: 1; type: 'STATUS'; tabId: number; status: RuntimeStatus; reason?: StatusReason };

type Gesture =
  | 'WINK_LEFT'
  | 'WINK_RIGHT'
  | 'BOTH_CLOSED'
  | 'GAZE_UP'
  | 'GAZE_DOWN';

type Command =
  | 'NEXT_VIDEO'
  | 'PREVIOUS_VIDEO'
  | 'TOGGLE_PLAYBACK'
  | 'LIKE_VIDEO'
  | 'SUBSCRIBE_CHANNEL';
```

`progress` is finite and clamped to `[0, 1]`. A `commandId` is processed at most once per tab to prevent duplicate account actions after retries or service-worker wakeups.

## 9. Eye detection and calibration

### Model

MediaPipe Face Landmarker runs locally in video/live-stream mode with a bundled model and WASM runtime. Only one face is evaluated. Eye-blink blendshape scores and normalized iris/eye landmarks provide the features for classification.

The extension must not fetch model code or weights from a CDN at runtime. Exact dependency/model versions are pinned in the lockfile and documented with their licenses.

### Calibration

Calibration records numeric thresholds, not images or landmark sequences:

1. Neutral gaze baseline for 2 seconds.
2. Right-eye wink sample.
3. Left-eye wink sample.
4. Both-eyes-closed sample.
5. Up/down gaze samples.

Thresholds are derived from the user's baseline with bounded defaults. Calibration fails with a clear explanation when lighting is insufficient, the face is too small, confidence is unstable or the gestures cannot be distinguished reliably. The user can skip personalized calibration and use conservative defaults, but the UI warns that accuracy may be lower.

### Runtime filtering

- Target inference rate: 10–15 FPS, adaptive to device performance.
- Use smoothing over recent observations and require continuous qualifying confidence for the full hold duration.
- Cancel progress when the face is lost, head pose exceeds the supported range, eyes are occluded or confidence is uncertain.
- Pause inference when the YouTube tab is hidden; stop the media tracks when the user disables the extension or closes the tile.
- Target gesture feedback latency: under 150 ms on a representative supported laptop, excluding the intentional hold duration.

## 10. YouTube command adapter

The content script exposes one narrow interface:

```ts
interface YouTubeController {
  execute(command: Command, commandId: string): Promise<CommandResult>;
}

type CommandResult =
  | { status: 'EXECUTED'; command: Command }
  | { status: 'ALREADY_APPLIED'; command: 'LIKE_VIDEO' | 'SUBSCRIBE_CHANNEL' }
  | { status: 'UNAVAILABLE'; command: Command; reason: 'NO_CONTROL' | 'NOT_SIGNED_IN' | 'PAGE_NOT_READY' }
  | { status: 'FAILED'; command: Command; reason: 'YOUTUBE_UI_CHANGED' };
```

- Playback uses the page's `HTMLVideoElement` when possible.
- Next/previous uses controls exposed by the current player/playlist. It does not invent browser-history navigation when a control is unavailable.
- Like and subscribe inspect current semantic state first and are idempotent: the extension never toggles an already-applied state off.
- The adapter centralizes YouTube selectors and accessibility-state interpretation so DOM changes require updates in one module.
- A `MutationObserver` detects YouTube SPA navigation and rebinds the adapter without duplicating listeners or overlay roots.
- Failures are reported in the tile; the extension never repeatedly clicks in an attempt to recover.

## 11. Permissions and privacy

### Manifest scope

Required extension capabilities are limited to:

- `offscreen` for the hidden document that owns user media and inference.
- `storage` for settings and numeric calibration thresholds.
- Content-script access only to `https://www.youtube.com/*`.

The offscreen document is created with the `USER_MEDIA` and `WEB_RTC` reasons and a user-facing justification. These are lifecycle reasons passed to `chrome.offscreen.createDocument`, not additional broad site permissions.

The extension does not request `<all_urls>`, cookies, browsing history, tab capture, microphone, downloads or remote-code permissions. Camera access is requested through `getUserMedia({ video: true, audio: false })` only after an explicit user action.

### Privacy requirements

- Raw frames remain in the offscreen inference pipeline and are discarded immediately after inference. The only copy outside that document is the transient preview track rendered in the current enabled tab.
- The preview uses a local WebRTC peer connection with no STUN/TURN server. Signaling crosses extension runtime messaging, but encoded frames do not pass through the service worker, extension storage or an external network service.
- No raw frames, face crops, landmarks, biometric templates or gesture history are written to disk or extension storage.
- No telemetry or analytics in version 1.
- No outbound application network requests. YouTube's own page traffic is outside the extension's processing pipeline.
- The camera indicator is visible whenever tracks are active, even when the preview is minimized.
- Stopping the session calls `stop()` on every media track and closes the offscreen document when no session remains.
- Uninstalling removes all locally stored extension settings through Chrome's normal extension-data lifecycle.

## 12. Threat model

| Boundary/asset | Abuse case | Required mitigation |
| --- | --- | --- |
| Camera stream | Frames are leaked or retained | Local-only inference; no frame messages, logs or persistence; preview uses a no-STUN/TURN local WebRTC connection only |
| YouTube content script | Page script spoofs a command | Accept commands only through `chrome.runtime` from the extension; never use page `postMessage` for privileged actions |
| Runtime messaging | Stale/duplicate command fires twice | Validate schemas, bind to enabled `tabId`, use unique `commandId` and per-tab deduplication |
| Like/subscribe | Natural gaze changes account state | 2-second stable hold, visible countdown, neutral reset, cooldown and idempotent state check |
| DOM integration | YouTube UI change clicks the wrong element | Semantic state checks, centralized allowlisted adapter, fail closed when ambiguous |
| Dependencies/model | Compromised package runs in extension | Pin versions, review lockfile/scripts/licenses, bundle assets, run package audit and signature/provenance checks before release |
| Overlay | YouTube CSS hides warnings or controls | Closed Shadow DOM where compatible, high stacking context, text/icon feedback and keyboard-accessible stop control |
| Resource exhaustion | Inference overheats or freezes playback | 10–15 FPS cap, single-face model, adaptive throttling, hidden-tab pause and performance budget tests |

## 13. Error handling

- **Permission denied:** keep the session off, explain how to grant camera access and offer retry only after a new user gesture.
- **No camera/device busy:** show the specific state and allow choosing another input device.
- **Local preview connection failed:** keep gesture processing off, tear down both peers and offer a fresh restart; do not silently run the camera without its visible indicator.
- **Model load failure:** stop processing, keep account actions disabled and offer reload; do not fall back to unverified remote code.
- **No face/poor lighting:** cancel any pending gesture and show corrective guidance.
- **YouTube command unavailable:** show a non-destructive notice; do not substitute another action.
- **YouTube DOM incompatible:** disable the affected command for the page and identify it as temporarily unsupported.
- **Service worker restart:** recover settings but do not emit or replay an old command.

## 14. Settings and safe ranges

| Setting | Default | Allowed range |
| --- | ---: | ---: |
| Navigation/playback hold | 700 ms | 600–1,500 ms |
| Like/subscribe hold | 2,000 ms | 1,500–4,000 ms |
| Cooldown | 1,500 ms | 1,000–3,000 ms |
| Preview | Shown | Shown / minimized |
| Preview mirror | On | On / off |
| Enabled gestures | All | Per-command toggle |

The UI never permits account actions below a 1,500 ms hold. Reset restores conservative defaults and deletes personalized calibration thresholds.

## 15. Testing strategy

### Unit tests

- Gesture classifier boundaries and smoothing with synthetic landmark/blendshape fixtures.
- Hold/cancel/cooldown state machine using a fake clock.
- Natural blink shorter than threshold never emits a command.
- One held gesture emits exactly one command until neutral reset.
- Message schema validation, tab binding and command deduplication.
- Settings validation and viewport clamping.
- YouTube adapter results for executed, already-applied, unavailable and changed-DOM states.

### Integration tests

- Offscreen document lifecycle, local WebRTC preview negotiation and media-track cleanup with mocked `getUserMedia`.
- Service worker restart does not replay commands.
- YouTube SPA navigation produces one overlay and one adapter instance.
- Like/subscribe remain idempotent against representative YouTube DOM fixtures.
- Camera tile remains draggable/resizable and keyboard operable inside its Shadow DOM.

### Manual Chrome tests

- Fresh install, permission grant/deny/retry and uninstall behavior.
- Standard watch page, playlist, queue, autoplay, theater mode and fullscreen.
- Signed-in and signed-out YouTube sessions.
- Webcam in normal/low light, with glasses, and with moderate head movement.
- Single and multiple camera devices.
- Reduced-motion mode, keyboard-only use, zoom at 200% and screen-reader status announcements.
- CPU use and YouTube playback quality during a 30-minute session.

No automated end-to-end test may Like or Subscribe using a real personal/production account. Account-action tests use DOM fixtures or an explicitly isolated test account with cleanup procedures.

## 16. Acceptance criteria for version 1

1. The extension can be installed unpacked in current Chrome desktop as a Manifest V3 extension.
2. It runs only on YouTube and asks for camera access only after the user presses Start.
3. A mirrored, floating camera tile can be dragged, resized, minimized and used to stop the camera.
4. The tile visibly and accessibly reports camera, face, gesture progress, completion and error states.
5. All five configured gestures follow their hold, neutral-reset and cooldown rules.
6. A natural blink shorter than 600 ms never triggers a command in the deterministic classifier tests.
7. Like and subscribe require at least 1,500 ms, show countdown progress and never undo an already-applied state.
8. Losing the face or confidence cancels a pending command.
9. YouTube SPA navigation does not duplicate overlays, listeners or commands.
10. Stopping the session ends all camera tracks; no camera data or gesture history is persisted or transmitted.
11. Tests cover the gesture state machine, runtime message validation, YouTube adapter and offscreen lifecycle.
12. Release verification includes type checking, unit/integration tests, production build and the package manager's native security audit.

## 17. Delivery sequence

1. Scaffold a separate WXT extension directory under `Tool dev/` with README, upstream/source note and license decision.
2. Prove the offscreen-to-content-script local WebRTC preview path in Chrome with no STUN/TURN traffic; stop if frames leave the browser or the camera indicator is ambiguous.
3. Define typed message, settings and command contracts with failing tests first.
4. Implement the YouTube adapter and Shadow DOM overlay against fixtures.
5. Implement offscreen camera lifecycle and local MediaPipe loading.
6. Implement calibration, classification and the hold/cooldown state machine.
7. Connect popup, service worker, offscreen document and content script.
8. Run accessibility, privacy, performance and real-browser acceptance checks.
9. Document installation, limitations, tested Chrome version and any workspace-specific changes.

## 18. Known limitations

- Eye gesture accuracy varies with camera quality, lighting, glasses, eye anatomy and user ability; calibration improves but cannot guarantee reliable use for everyone.
- Holding a wink for 700 ms may be uncomfortable. Every gesture can be disabled and the extension must always retain mouse/keyboard controls.
- Gaze direction is relative to calibrated neutral gaze and may be confused by substantial head movement.
- Previous/next depend on controls present in the current YouTube playlist or queue.
- YouTube DOM updates can temporarily disable commands until the adapter is updated.
- This extension is an assistive convenience, not a medical device or a replacement for established accessibility hardware/software.

## 19. Source references

- [Chrome: Offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)
- [Chrome: Declare permissions](https://developer.chrome.com/docs/extensions/develop/concepts/declare-permissions)
- [Chrome: Protect user privacy](https://developer.chrome.com/docs/extensions/develop/security-privacy/user-privacy)
- [Google AI: MediaPipe Face Landmarker options](https://ai.google.dev/edge/api/mediapipe/python/mp/tasks/vision/FaceLandmarkerOptions)
