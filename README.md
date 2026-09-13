# EyeTube Control

EyeTube Control is a privacy-first Google Chrome extension (Manifest V3) that allows hands-free control of YouTube playback and navigation using deliberate eye gestures, accompanied by a floating, mirrored camera preview tile.

---

## 1. Key Features

- **Hands-Free YouTube Playback** (hold durations are adjustable in the popup):
  - **Both eyes closed (700 ms):** Play / Pause video.
  - **Right eye wink (400 ms):** Next video -- the first entry in the right-hand
    column, falling back to the player's next button when a playlist is running.
  - **Left eye wink (400 ms):** Previous video -- one step back through history.
  - **Look up (1,200 ms):** Like current video (idempotent, never unlikes).
  - **Hold up 1-5 fingers (900 ms):** Open that numbered video in the right-hand column.
    Only the count matters, so any comfortable hand shape works -- a "three" made with
    thumb, index and middle reads the same as one made with index, middle and ring.

  The mapping matches effort and risk to the action: the gesture everyone can perform
  carries the most-used, self-correcting command, while the account-touching one needs the
  most deliberate gesture. Play / pause is held for 700 ms so a natural blink (100-400 ms)
  cannot trigger it. Looking down is deliberately not a gesture and subscribing is not eye
  controlled at all -- subtitles sit at the bottom of the frame, so reading them would fire
  a command on every line.
- **Two local models, one camera:**
  - Face gestures come from MediaPipe Face Landmarker, hand gestures from Hand Landmarker;
    both run on the same offscreen camera stream.
  - A raised hand outranks the eyes, so a gesture is never read as a blink mid-reach.
  - A command never repeats while the same gesture is still held: lower the hand (or open
    your eyes) to re-arm.

- **Light on the machine** (measured in the offscreen document, share of one core):

  | | one core |
  |---|---|
  | Fixed-rate loop, ungated hand tracking | 31.4% |
  | Current build, movement in frame | 16.1% |
  | Current build, viewer sitting still | 7.9% |

  - Inference idles at ~4.5 fps and rises to the capture rate the moment an *eyelid*
    starts to move - not once a gesture has been classified - so the slower idle rate
    costs no responsiveness.
  - The camera is asked for 15 fps rather than the default 30: capture, encode and decode
    work for frames that would only be dropped.
  - Hand tracking is the most expensive stage, because with no hand on screen MediaPipe
    re-runs palm detection every call. It is gated behind a 16x12 frame-motion check that
    excludes the face region, so a viewer breathing and blinking does not keep it awake,
    and it reads a 320x240 surface instead of the full frame.
  - The preview tile is encoded at half resolution and 15 fps from its own cloned track,
    and stops encoding entirely while the tab is hidden.
  - Only the SIMD WebAssembly runtime is packaged (Chrome 116+ always has SIMD), which
    keeps the build at ~24 MB rather than ~48 MB.

- **100% Local & Private Processing:**
  - MediaPipe Face Landmarker model runs strictly client-side via bundled WebAssembly.
  - No camera frames, landmarks, biometric templates, or video viewing history leave your machine.
  - The floating preview uses a zero-STUN/TURN local WebRTC peer connection; zero network calls.
- **Floating Accessible Overlay:**
  - Draggable, resizable, minimizable camera tile mounted inside an isolated closed Shadow DOM.
  - Clear text and icon indicators (accessible contrast, screen-reader friendly `role="status"`).
  - Cooldown (800 ms) plus neutral-eye re-arming prevents accidental activations.
  - Live detection telemetry is logged to the YouTube tab console and shown on the tile, so a
    rejected frame always says why (face too small, room too dark, head turned away).

---

## 2. Requirements

- **Google Chrome** version 116 or higher (desktop).
- **Node.js** 20+ and **npm**.
- Built-in or external webcam.

---

## 3. Installation & Setup

1. **Install dependencies:**
   ```bash
   npm ci --ignore-scripts
   ```

2. **Build extension for Chrome (Manifest V3):**
   ```bash
   npm run build
   ```
   The compiled unpacked extension is generated in `output/chrome-mv3`.

3. **Load into Chrome:**
   - Navigate to `chrome://extensions` in Google Chrome.
   - Enable **Developer mode** (top-right switch).
   - Click **Load unpacked** and select the folder:
     `.../Tool dev/EyeTube Control/output/chrome-mv3`

4. **Usage:**
   - Open any video on [YouTube](https://www.youtube.com).
   - Click the **EyeTube Control** extension icon in your Chrome toolbar.
   - Click **Start eye control** and grant camera permissions when prompted.
   - Keep your face centered in the camera preview tile to begin controlling playback.

---

## 4. Development & Testing

- **Run all unit & integration tests:**
  ```bash
  npm test
  ```
- **Typecheck with strict TypeScript:**
  ```bash
  npm run typecheck
  ```
- **Run End-to-End browser tests (Playwright):**
  ```bash
  npx playwright test
  ```
- **Continuous development server:**
  ```bash
  npm run dev
  ```

- **Diagnosing "it starts but no gesture fires":**
  Open the YouTube tab's DevTools console and look for the `[EyeTube AI] 🔬` lines. They report the
  gesture-machine state, the classification, the reason detection is being rejected, and the raw
  metrics (`size` = share of the frame the face covers, `light` = frame brightness, `L`/`R` = per-eye
  blink scores, `gaze` = vertical gaze). A wink needs `L` or `R` above 0.50 while the other eye stays
  below 0.40.

---

## 5. Security & Privacy Guarantees

- **No Remote Code Execution:** CSP enforces `script-src 'self' 'wasm-unsafe-eval'`. No external CDN scripts or remote weights are ever fetched.
- **Model Integrity:** Both MediaPipe model assets are verified against
  `public/models/SHA256SUMS` (`shasum -a 256 -c SHA256SUMS` inside `public/models`). They are
  the official float16 bundles from `storage.googleapis.com/mediapipe-models`.
- **Fail-Closed DOM Adapter:** Does not simulate blind clicks; checks YouTube semantic state (`aria-pressed`, disabled state) before firing commands.

---

## 6. License

`UNLICENSED` — Internal prototype.
