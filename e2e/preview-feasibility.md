# Local camera preview feasibility

Verified on 2026-09-13 with Chrome for Testing 153.0.8010.12, an isolated temporary profile, and a deterministic YUV420 test-pattern camera. No personal Chrome profile or signed-in YouTube account was used.

The probe is `scripts/chrome-feasibility.mjs`. It loads `.output/chrome-mv3`, opens `chrome://webrtc-internals` before starting, opens one public YouTube watch page, starts through the extension's own popup context, captures evidence, stops, and closes the temporary profile.

## Gate results

- Camera is inactive before explicit Start: **PASS**. Offscreen document count was `0` before Start and `1` after Start.
- Mirrored preview is visible in one YouTube tab: **PASS**. The generated YUV test pattern was visible in the closed-Shadow-DOM tile; the preview element applies `scaleX(-1)`.
- No configured STUN/TURN service: **PASS**. Both peer constructors are covered by tests asserting `{ iceServers: [] }`; `chrome://webrtc-internals` showed the extension peer connection and no STUN/TURN service entry.
- No extension STUN/TURN/application request: **PASS**. The browser request observer recorded `networkLeaks: []`; candidate validation rejects `srflx` and `relay` candidates.
- Stop releases the camera session: **PASS**. Offscreen document count returned from `1` to `0`; camera lifecycle tests assert that every track receives `stop()`.
- Extension console errors/warnings: **PASS**. The service-worker observer recorded `extensionErrors: []`.

Representative result:

```json
{
  "offscreenBeforeStart": 0,
  "offscreenDuringSession": 1,
  "offscreenAfterStop": 0,
  "networkLeaks": [],
  "extensionErrors": []
}
```

Screenshots are intentionally kept as temporary local artifacts instead of committed because the underlying YouTube page contains third-party imagery. The fake camera track is identified in `chrome://webrtc-internals` by the label `/private/tmp/eyetube-fake-camera.y4m`.

## Reproduce

Generate a short YUV420 test pattern, build, then run the probe:

```bash
ffmpeg -f lavfi -i testsrc=size=640x480:rate=15 -t 5 -pix_fmt yuv420p /private/tmp/eyetube-fake-camera.y4m
npm run build
EYETUBE_FAKE_CAMERA=/private/tmp/eyetube-fake-camera.y4m node scripts/chrome-feasibility.mjs
```

The probe passes both `--use-fake-device-for-media-stream` and `--use-file-for-fake-video-capture`; omitting the first flag can cause Chromium to select a physical camera even when a file path is supplied.
