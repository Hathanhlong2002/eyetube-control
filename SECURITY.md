# Security Policy

## 1. Threat Model & Boundaries

EyeTube Control processes video input to identify deliberate eye gestures. Due to the sensitive nature of webcam data, the extension is built with hard boundaries:

| Asset / Boundary | Risk | Mitigation |
|---|---|---|
| **Camera Feed** | Eavesdropping or data leakage | Processed 100% locally in an isolated offscreen document; discarded immediately after inference. Zero persistent storage of images or landmarks. |
| **Local Preview Track** | Network exfiltration | Emits solely through local WebRTC peer connection configured with `iceServers: []`. Rejects all `srflx` and `relay` candidates. |
| **YouTube Content Script** | Malicious injection or clickjacking | Isolated closed Shadow DOM. Commands accepted only via typed `chrome.runtime` messages from the background service worker. |
| **Account Actions** | Accidental like/subscribe | Requires 2,000 ms stable hold, visible countdown, neutral reset, 1,500 ms cooldown, and idempotent state verification. |
| **Third-Party Model** | Malicious model tampering | MediaPipe Face Landmarker model artifact is pinned and checked against `public/models/SHA256SUMS`. |

---

## 2. Reporting a Vulnerability

As this project is an internal prototype:
- **Do not** file public issues containing potential security vulnerabilities or exploit code.
- Report any security concerns directly to the project maintainer via internal channels.
- Critical vulnerabilities will be investigated and patched promptly.
