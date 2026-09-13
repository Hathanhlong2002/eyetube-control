# EyeTube Control

[![Version](https://img.shields.io/badge/version-1.1.0-blue.svg)](package.json)
[![Manifest V3](https://img.shields.io/badge/Manifest-V3-success.svg)](https://developer.chrome.com/docs/extensions/mv3/intro/)
[![Tests](https://img.shields.io/badge/tests-230%20passed-brightgreen.svg)](tests/)
[![License](https://img.shields.io/badge/license-MIT-informational.svg)](LICENSE)
[![GitHub](https://img.shields.io/badge/GitHub-Hathanhlong2002%2Feyetube--control-black?logo=github)](https://github.com/Hathanhlong2002/eyetube-control)

**EyeTube Control** is a high-performance, privacy-first Google Chrome extension (Manifest V3) that enables hands-free control of YouTube video playback, navigation, and sidebar recommendations using deliberate **Eye Gestures** and **Finger Counts**, backed by a floating, mirrored camera HUD.

---

## 1. Gesture & Command Map

All hold durations and gesture toggles can be configured in real time from the popup settings:

| Gesture | Default Hold | Action on YouTube | Safety & Anti-False-Positive Guard |
| :--- | :--- | :--- | :--- |
| **Both Eyes Closed** | `700 ms` | **Play / Pause** | Held well beyond natural blink duration (100–400 ms). |
| **Right Eye Wink** | `400 ms` | **Next Video** | Opens 1st related video (or native playlist next). |
| **Left Eye Wink** | `400 ms` | **Previous Video** | Steps back through browser video history. |
| **Look Up** | `1,200 ms` | **Like Video** | Idempotent: checks `aria-pressed`, never unlikes. |
| **Raise 1–5 Fingers** | `900 ms` | **Open Related Video #1–5** | Displays target video title live on HUD before opening. |

> [!NOTE]
> - **Why no "Look Down" gesture?** Subtitles naturally sit at the bottom of the video frame. Reading subtitles would trigger accidental commands, so downward gaze is deliberately excluded.
> - **Finger count flexibility:** Any comfortable hand shape works (e.g. thumb + index + middle is equivalent to index + middle + ring for "3").

---

## 2. Dual AI Architecture & Performance

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
             │                                          │  - Margin check (>=5%)  │
             └──────────────────────────┬───────────────────────────┘
                                        ▼
                        Priority State Machine Arbitrator
                      (Raised Hand outranks Eye Gestures)
                                        │
                                        ▼
                  YouTube Controller (`.ytp-play-button.click()`)
```

### Measured CPU Footprint (Single Core)
| Execution Profile | CPU Share | Notes |
| :--- | :--- | :--- |
| Fixed-rate loop, ungated hand tracking | **31.4%** | Naive dual-model baseline |
| Active motion in frame | **16.1%** | Palm detector only wakes on non-facial motion |
| **Viewer sitting still (Idle)** | **7.9%** | Drops to ~4.5 fps; rises immediately on eyelid movement |

### Key Optimizations
1. **Dynamic Inference Pacing:** Idles at ~4.5 fps and accelerates to capture rate the millisecond an eyelid moves.
2. **Motion-Gated Hand Tracking:** MediaPipe palm detection is CPU-intensive when no hand is present. A 16x12 motion grid (excluding the face zone) keeps it asleep until real movement happens.
3. **Shared 320x240 Surface:** Both motion grid and Hand Landmarker operate on a single downscaled canvas, avoiding repeated full-frame buffer resizes.
4. **Bandwidth-Capped Local WebRTC Preview:** Floating camera HUD encodes from a cloned track at 15 fps and half resolution, and stops encoding entirely when the tab is hidden. Zero external network/STUN/TURN traffic.
5. **Edge Exclusion & Lockout:** Hands clipping within 5% of the frame edges are ignored to prevent accidental triggers. Once fired, hand gestures lock out until the hand leaves the frame completely.

---

## 3. Requirements & System Compatibility

- **Browser:** Google Chrome version 116+ (Manifest V3 required).
- **Node.js:** v20+ with npm 10+.
- **Hardware:** Any standard internal or external USB webcam.
- **Platform:** macOS, Windows, or Linux (SIMD WebAssembly enabled by default).

---

## 4. Installation & Setup

### 1. Clone & Install Dependencies
```bash
git clone https://github.com/Hathanhlong2002/eyetube-control.git
cd eyetube-control
npm ci --ignore-scripts
```

### 2. Build Extension Bundle
```bash
npm run build
```
The compiled, production-ready extension is emitted to `output/chrome-mv3`.

### 3. Load into Google Chrome
1. Open `chrome://extensions` in Chrome.
2. Toggle on **Developer mode** in the upper-right corner.
3. Click **Load unpacked** and select the directory:
   `<path-to-project>/output/chrome-mv3`

### 4. Activate on YouTube
1. Navigate to any video on [YouTube](https://www.youtube.com).
2. Click the **EyeTube Control** icon in the extensions toolbar.
3. Click **Start Eye Control** (grant camera permission when prompted).
4. A floating camera HUD will appear with real-time target markers and detection state.

---

## 5. Built-in AI Diagnostic Test Page

The extension includes a standalone diagnostic interface for camera calibration and model inspection without needing to navigate to YouTube:

- Open `chrome-extension://<extension-id>/test.html` in Chrome (or navigate via popup).
- Provides live visual metrics for:
  - Face bounding box and head pitch/yaw.
  - Left & Right eye blink coefficients ($0.00 \to 1.00$).
  - Live extended finger count ($0 \to 5$) with boundary margin indicators.
  - Interactive hold progress bars and instant gesture verdicts.

---

## 6. Testing & Code Quality

The codebase enforces strict type safety and maintains 100% test coverage across all subsystems:

```bash
# Run all 230 unit and integration tests (Vitest)
npm test

# Typecheck TypeScript without emitting
npm run typecheck

# Run end-to-end browser tests (Playwright)
npx playwright test

# Launch development watcher with hot-reloading
npm run dev
```

---

## 7. Security & Privacy Guarantees

- **Zero Remote Code Execution (RCE):** Content Security Policy strictly enforces `script-src 'self' 'wasm-unsafe-eval'`. No remote scripts, analytics trackers, or third-party CDNs are loaded.
- **100% Local Inference:** Biometric landmarks and camera pixels never leave the browser process.
- **Cryptographic Model Verification:** All MediaPipe model binaries are validated against `public/models/SHA256SUMS`.
- **Fail-Closed DOM Controller:** Validates YouTube internal semantic player state (`aria-pressed`, disabled attributes) before dispatching simulated interactions.

---

## 8. License

Distributed under the MIT License. See `LICENSE` for more information.
