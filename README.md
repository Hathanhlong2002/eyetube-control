# EyeTube Control

EyeTube Control is a privacy-first Google Chrome extension (Manifest V3) that allows hands-free control of YouTube playback and navigation using deliberate eye gestures, accompanied by a floating, mirrored camera preview tile.

---

## 1. Key Features

- **Hands-Free YouTube Playback:**
  - **Both eyes closed (700 ms):** Play / Pause video.
  - **Right eye wink (700 ms):** Next video (playlist/queue).
  - **Left eye wink (700 ms):** Previous video (playlist/queue).
  - **Look up (2,000 ms):** Like current video (idempotent, never unlikes).
  - **Look down (2,000 ms):** Subscribe to channel (idempotent, never unsubscribes).
- **100% Local & Private Processing:**
  - MediaPipe Face Landmarker model runs strictly client-side via bundled WebAssembly.
  - No camera frames, landmarks, biometric templates, or video viewing history leave your machine.
  - The floating preview uses a zero-STUN/TURN local WebRTC peer connection; zero network calls.
- **Floating Accessible Overlay:**
  - Draggable, resizable, minimizable camera tile mounted inside an isolated closed Shadow DOM.
  - Clear text and icon indicators (accessible contrast, screen-reader friendly `role="status"`).
  - High-precision cooldown (1,500 ms) and neutral-eye re-arming prevents accidental activations.

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
   The compiled unpacked extension is generated in `.output/chrome-mv3`.

3. **Load into Chrome:**
   - Navigate to `chrome://extensions` in Google Chrome.
   - Enable **Developer mode** (top-right switch).
   - Click **Load unpacked** and select the folder:
     `.../Tool dev/EyeTube Control/.output/chrome-mv3`

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

---

## 5. Security & Privacy Guarantees

- **No Remote Code Execution:** CSP enforces `script-src 'self' 'wasm-unsafe-eval'`. No external CDN scripts or remote weights are ever fetched.
- **Model Integrity:** The MediaPipe Face Landmarker model asset is verified against `public/models/SHA256SUMS`.
- **Fail-Closed DOM Adapter:** Does not simulate blind clicks; checks YouTube semantic state (`aria-pressed`, disabled state) before firing commands.

---

## 6. License

`UNLICENSED` — Internal prototype.
