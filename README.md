# EyeTube Control

<p align="center">
  <img src="public/icon/128.png" alt="EyeTube Control Logo" width="96" height="96" />
</p>

<p align="center">
  <strong>Hands-Free YouTube Playback & Navigation via On-Device Eye & Hand AI Tracking</strong>
</p>

<p align="center">
  <a href="package.json"><img src="https://img.shields.io/badge/version-1.1.0-blue.svg?style=flat-square" alt="Version 1.1.0" /></a>
  <a href="https://developer.chrome.com/docs/extensions/mv3/intro/"><img src="https://img.shields.io/badge/Manifest-V3-emerald.svg?style=flat-square" alt="Manifest V3" /></a>
  <a href="tests/"><img src="https://img.shields.io/badge/tests-230%20passed%20%7C%2019%20suites-brightgreen.svg?style=flat-square" alt="Tests" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-informational.svg?style=flat-square" alt="License MIT" /></a>
  <a href="https://github.com/Hathanhlong2002/eyetube-control"><img src="https://img.shields.io/badge/GitHub-Hathanhlong2002%2Feyetube--control-181717?style=flat-square&logo=github" alt="GitHub Repository" /></a>
</p>

<p align="center">
  <a href="README.md"><strong>English</strong></a> • <a href="README.vi.md"><strong>Tiếng Việt</strong></a>
</p>

---

## Overview

**EyeTube Control** is a high-performance, privacy-first Google Chrome extension (Manifest V3) that empowers users to control YouTube playback, navigation, and sidebar recommendations entirely hands-free. Powered by client-side Google MediaPipe WebAssembly models, EyeTube tracks deliberate **Eye Gestures** and **Finger Counts** via your webcam in real-time, backed by a non-intrusive floating camera HUD.

- **100% Local Inference:** No video frames, audio, facial biometric data, or browsing history ever leave your local browser runtime.
- **Dual AI Architecture:** Combines `FaceLandmarker` (478 3D landmarks + 52 blendshapes) with `HandLandmarker` (21 3D joints) with zero external server dependencies.
- **Ultra-Light CPU Footprint:** Drops to **~7.9% CPU** on idle through adaptive eyelid-velocity inference pacing, motion-gated palm detection, and shared canvas scaling.
- **Anti-False-Positive Guards:** Natural blinks and ambient movements are filtered with sub-second temporal thresholds, boundary margin checks, and gesture arbitration.

---

## 1. Gesture & Command Matrix

All hold durations and gesture toggles can be adjusted dynamically in real time from the extension popup settings:

| Gesture | Default Hold | Action on YouTube | Anti-False-Positive & Safety Guard |
| :--- | :---: | :--- | :--- |
| **Both Eyes Closed** | `700 ms` | **Play / Pause** | Configured well above spontaneous blink duration (100–400 ms). |
| **Right Eye Wink** | `400 ms` | **Next Video** | Navigates to the first related video (or native playlist next button). |
| **Left Eye Wink** | `400 ms` | **Previous Video** | Steps back through browser history. |
| **Look Up** | `1,200 ms` | **Like Video** | Idempotent: checks `aria-pressed`, never triggers an accidental unlike. |
| **Raise 1–5 Fingers** | `900 ms` | **Open Related Video #1–5** | Displays the target video's title live on the HUD before opening. |

> [!NOTE]
> - **Why is "Look Down" omitted?** Video subtitles are displayed at the bottom of the screen. Reading captions causes natural downward gaze and would fire accidental actions. Downward gaze control was deliberately eliminated.
> - **Flexible Hand Shapes:** Finger detection measures individual fingertip extensions beyond pip/dip joints. Any comfortable finger combination works (e.g., thumb + index + middle is recognized as "3").
> - **Hand Arbitration Priority:** When a hand is raised in front of the camera, hand gesture processing takes priority over eye gestures to prevent false blinks while reaching.

---

## 2. Dual-Model Architecture & Pipeline

```
                           Webcam Stream (640x480 @ 15fps)
                                         │
              ┌──────────────────────────┴──────────────────────────┐
              ▼                                                     ▼
┌─────────────────────────┐                             ┌─────────────────────────┐
│  FaceLandmarker (WASM)  │                             │  Shared 320x240 Scaler  │
│  - 478 3D Landmarks     │                             └────────────┬────────────┘
│  - 52 Facial Blendshapes│                                          │
└────────────┬────────────┘                                          ▼
             │                                          ┌─────────────────────────┐
             │                                          │  16x12 Motion Grid      │
             │                                          │  (Excludes face zone)   │
             │                                          └────────────┬────────────┘
             │                                                       │ (Motion > threshold)
             │                                                       ▼
             │                                          ┌─────────────────────────┐
             │                                          │  HandLandmarker (WASM)  │
             │                                          │  - 21 Hand Landmarks    │
             │                                          │  - 5% Frame Margin Test │
             └──────────────────────────┬───────────────────────────┘
                                        ▼
                        Priority State Machine Arbitrator
                      (Raised Hand outranks Eye Gestures)
                                        │
                                        ▼
                  YouTube Controller (`.ytp-play-button.click()`)
```

### Measured CPU Benchmark (Single Core, M-series Mac / Intel i7)

| Execution Profile | CPU Share | Architectural Reason |
| :--- | :---: | :--- |
| Fixed-rate dual-model loop (naive baseline) | **31.4%** | Unconditional palm and face detection every frame |
| Active motion in frame | **16.1%** | Palm detector only wakes on motion outside facial zone |
| **Viewer sitting still (Idle playback)** | **7.9%** | Paces down to ~4.5 fps; jumps to 15 fps on eyelid motion |

### Core Performance Engineering

1. **Adaptive Eyelid-Velocity Pacing:** Idle video watching runs inference at ~4.5 fps. The instant an eyelid velocity threshold is exceeded, the loop accelerates immediately to 15 fps for smooth, responsive detection.
2. **Motion-Gated Hand Tracking:** Running palm detection across every video frame is computationally expensive. A lightweight 16x12 grid monitors inter-frame pixel differences outside the face bounding box, waking the `HandLandmarker` only when hands move into view.
3. **Shared 320x240 Surface:** Both the motion analyzer and the hand landmark detector share a single hardware-scaled 320x240 canvas buffer, avoiding duplicate memory allocations.
4. **Bandwidth-Optimized WebRTC Preview:** The floating camera HUD streams over a zero-STUN/TURN local WebRTC loopback capped at 15 fps and half resolution. When the YouTube tab is hidden or minimized, video encoding pauses entirely.
5. **Frame Boundary Exclusion & Lockout:** Hands within 5% of the frame edges are ignored to prevent partial/wandering hand triggers. Once a hand gesture executes, it is locked until the hand fully exits the camera frame.

---

## 3. Project Structure

```
eyetube-control/
├── entrypoints/                 # Extension entrypoints (WXT)
│   ├── background.ts            # Extension service worker
│   ├── offscreen.html           # Offscreen document host (AI models)
│   ├── popup/                   # Extension toolbar settings popup
│   ├── test.html                # Standalone AI diagnostic & calibration page
│   └── youtube.content.tsx      # Content script injected into YouTube
├── src/
│   ├── background/              # Session coordinator & preview router
│   ├── contracts/               # Type definitions, message schemas & settings
│   ├── gesture/                 # Classifier, calibration & state machine
│   ├── media/                   # Camera session, frame scaler, motion grid & models
│   ├── offscreen/               # Offscreen runtime, AI inference loop
│   ├── overlay/                 # Floating Shadow DOM camera HUD
│   ├── popup/                   # Settings UI (React 19)
│   ├── test/                    # Diagnostic page logic
│   └── youtube/                 # YouTube DOM controller & lifecycle
├── public/                      # Static assets & bundled MediaPipe models
│   └── models/                  # face_landmarker.task & hand_landmarker.task
└── tests/                       # 230 automated unit & integration tests
```

---

## 4. Requirements & Compatibility

- **Browser:** Google Chrome version 116 or higher (desktop).
- **Runtime:** Node.js v20+ with npm 10+.
- **Hardware:** Any standard USB or built-in webcam (720p @ 30fps recommended).
- **Operating System:** macOS, Windows, or Linux (WebAssembly SIMD supported).

---

## 5. Quick Start & Installation

### Step 1: Clone Repository & Install Dependencies
```bash
git clone https://github.com/Hathanhlong2002/eyetube-control.git
cd eyetube-control
npm ci --ignore-scripts
```

### Step 2: Build Extension
```bash
npm run build
```
The compiled, production-ready extension will be emitted to `output/chrome-mv3`.

### Step 3: Load Unpacked Extension into Chrome
1. Open Google Chrome and navigate to `chrome://extensions`.
2. Toggle on **Developer mode** in the upper-right corner.
3. Click **Load unpacked** and select the folder:
   ```
   <path-to-repository>/output/chrome-mv3
   ```

### Step 4: Control YouTube
1. Open any video on [YouTube](https://www.youtube.com).
2. Click the **EyeTube Control** icon in the extensions toolbar.
3. Click **Start Eye Control** (grant camera permission when prompted).
4. The floating HUD appears in the bottom-right corner. Close both eyes for 700 ms to pause/play, or raise fingers to pick related videos!

---

## 6. Built-in AI Diagnostic Test Page

Calibrate your camera, adjust lighting, and test gesture detection without loading YouTube:

1. Open `chrome-extension://<extension-id>/test.html` in Chrome (or click the test link in the popup).
2. The diagnostic dashboard displays:
   - Real-time head pitch, yaw, and face bounding box coverage.
   - Left & Right eye blink coefficients ($0.00 \to 1.00$).
   - Active extended finger count ($0 \to 5$) with boundary margin status.
   - Live hold-duration progress bars and gesture arbitration verdicts.
   - Detailed rejection telemetry (e.g. `face too small`, `low light`, `hand near edge`).

---

## 7. Development & Testing

EyeTube Control enforces strict type safety and 100% automated test coverage across all subsystems:

```bash
# Run all 230 unit and integration tests (Vitest)
npm test

# Run tests in watch mode
npm run test:watch

# Strict TypeScript typechecking without emit
npm run typecheck

# End-to-end browser automation testing (Playwright)
npx playwright test

# Development server with automatic hot-reloading
npm run dev

# Package production release zip for Chrome Web Store
npm run zip
```

---

## 8. Security & Privacy Guarantees

- **No Remote Code Execution (RCE):** Content Security Policy strictly enforces `script-src 'self' 'wasm-unsafe-eval'`. No remote scripts, analytics trackers, or third-party CDNs are loaded.
- **Zero Telemetry Leaks:** All biometric landmarks and camera pixels remain in browser memory and are discarded after inference.
- **Model Cryptographic Verification:** Bundled MediaPipe task bundles are verified against SHA256 checksums in `public/models/SHA256SUMS`.
- **Fail-Closed DOM Controller:** Dispatches commands only after verifying YouTube player state (`aria-pressed`, button disabled attributes), preventing double-toggles or unintended actions.

---

## 9. License

Distributed under the [MIT License](LICENSE).

Copyright (c) 2026 **Hathanhlong2002**.
