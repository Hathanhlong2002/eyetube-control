import type { Gesture } from '../contracts/messages';
import { parseSettings, type EyeControlSettings } from '../contracts/settings';
import type { DetectionBlocker } from '../contracts/status';
import {
  classifyDetailed,
  DEFAULT_CALIBRATION_PROFILE,
  type FaceFeatures,
} from '../gesture/classifier';
import { DEFAULT_MACHINE_SETTINGS, GestureMachine } from '../gesture/machine';
import { CameraSession } from '../media/camera-session';
import { createFaceLandmarkerAdapter, type FaceLandmarkerAdapter } from '../media/face-landmarker';

const SETTINGS_STORAGE_KEY = 'eyetube_settings';

const BLOCKER_TEXT: Record<DetectionBlocker, string> = {
  NONE: 'Điều kiện nhận diện tốt',
  NO_FACE: 'Không thấy khuôn mặt trong khung hình',
  LOW_CONFIDENCE: 'Tín hiệu khuôn mặt chưa đủ rõ',
  FACE_TOO_SMALL: 'Mặt quá nhỏ trong khung — hãy ngồi gần camera hơn',
  TOO_DARK: 'Khung hình quá tối — cần thêm ánh sáng chiếu vào mặt',
  EYES_UNCLEAR: 'Chưa đọc rõ mắt — mở to mắt và nhìn thẳng vào camera',
  HEAD_TURNED: 'Đầu đang quay sang bên — hãy nhìn thẳng camera',
  HEAD_TILTED: 'Đầu đang ngửa hoặc cúi quá nhiều',
};

const GESTURE_TEXT: Record<Gesture, string> = {
  BOTH_CLOSED: 'Nhắm hai mắt → Play/Pause',
  WINK_RIGHT: 'Nháy mắt phải → Video kế tiếp',
  WINK_LEFT: 'Nháy mắt trái → Video trước đó',
  GAZE_UP: 'Nhìn lên → Thích video',
};

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing element #${id}`);
  return node as T;
}

const video = el<HTMLVideoElement>('preview');
const hud = el<HTMLCanvasElement>('hud');
const startButton = el<HTMLButtonElement>('start');
const stopButton = el<HTMLButtonElement>('stop');
const deviceSelect = el<HTMLSelectElement>('device');
const copyButton = el<HTMLButtonElement>('copy');
const note = el('note');
const verdict = el('verdict');
const verdictMain = el('verdict-main');
const verdictSub = el('verdict-sub');
const holdLabel = el('hold-label');
const holdValue = el('hold-val');
const holdFill = el('hold-fill');
const logList = el<HTMLUListElement>('log');
const raw = el('raw');

const meters = {
  l: { value: el('l-val'), fill: el('l-fill'), mark: el('l-mark') },
  r: { value: el('r-val'), fill: el('r-fill'), mark: el('r-mark') },
  g: { value: el('g-val'), fill: el('g-fill') },
  size: { value: el('size-val'), fill: el('size-fill'), mark: el('size-mark') },
  light: { value: el('light-val'), fill: el('light-fill'), mark: el('light-mark') },
  fps: { value: el('fps-val'), fill: el('fps-fill') },
};

const profile = DEFAULT_CALIBRATION_PROFILE;
// Face size and brightness are tiny numbers; plot them against 4x the floor so
// the threshold marker sits in a readable place on the track.
const SIZE_SCALE = profile.faceSizeFloor * 6;
const LIGHT_SCALE = profile.brightnessFloor * 6;

meters.l.mark.style.left = `${profile.closedThreshold * 100}%`;
meters.r.mark.style.left = `${profile.closedThreshold * 100}%`;
meters.size.mark.style.left = `${Math.min(100, (profile.faceSizeFloor / SIZE_SCALE) * 100)}%`;
meters.light.mark.style.left = `${Math.min(100, (profile.brightnessFloor / LIGHT_SCALE) * 100)}%`;

const camera = new CameraSession();
const machine = new GestureMachine(DEFAULT_MACHINE_SETTINGS);
let landmarker: FaceLandmarkerAdapter | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
let running = false;
let busy = false;
let frameCount = 0;
let fpsWindowStart = 0;
let fps = 0;
let lastFeatures: FaceFeatures | null = null;
let lastBlocker: DetectionBlocker = 'NO_FACE';

function setMeter(
  meter: { value: HTMLElement; fill: HTMLElement },
  text: string,
  ratio: number,
  passing: boolean,
): void {
  meter.value.textContent = text;
  meter.fill.style.width = `${Math.min(100, Math.max(0, ratio * 100))}%`;
  meter.fill.classList.toggle('pass', passing);
}

function addLog(text: string, fired = false): void {
  const item = document.createElement('li');
  if (fired) item.className = 'fire';
  item.textContent = `${new Date().toLocaleTimeString('vi-VN')}  ${text}`;
  logList.prepend(item);
  while (logList.children.length > 40) logList.lastElementChild?.remove();
}

function drawHud(features: FaceFeatures | null): void {
  const context = hud.getContext('2d');
  if (!context) return;
  if (hud.width !== video.videoWidth || hud.height !== video.videoHeight) {
    hud.width = video.videoWidth || 640;
    hud.height = video.videoHeight || 480;
  }
  context.clearRect(0, 0, hud.width, hud.height);
  if (!features?.faceDetected) return;
  // faceSize is a normalised area; its square root approximates the box edge.
  const edge = Math.min(1, Math.sqrt(features.faceSize));
  const width = edge * hud.width;
  const height = edge * hud.height;
  const x = (hud.width - width) / 2 + features.headYaw * width;
  const y = (hud.height - height) / 2 + features.headPitch * height;
  context.strokeStyle = lastBlocker === 'NONE' ? '#22c55e' : '#f59e0b';
  context.lineWidth = 3;
  context.setLineDash([10, 8]);
  context.strokeRect(x, y, width, height);
}

function setVerdict(kind: 'idle' | 'ok' | 'warn' | 'bad', main: string, sub: string): void {
  verdict.className = `verdict${kind === 'idle' ? '' : ` ${kind}`}`;
  verdictMain.textContent = main;
  verdictSub.textContent = sub;
}

function render(features: FaceFeatures, observation: string, blocker: DetectionBlocker): void {
  setMeter(meters.l, features.leftEyeClosed.toFixed(2), features.leftEyeClosed,
    features.leftEyeClosed >= profile.closedThreshold);
  setMeter(meters.r, features.rightEyeClosed.toFixed(2), features.rightEyeClosed,
    features.rightEyeClosed >= profile.closedThreshold);
  setMeter(meters.g, features.gazeVertical.toFixed(2), Math.abs(features.gazeVertical),
    Math.abs(features.gazeVertical) >= profile.gazeUpThreshold);
  setMeter(meters.size, features.faceSize.toFixed(3), features.faceSize / SIZE_SCALE,
    features.faceSize >= profile.faceSizeFloor);
  setMeter(meters.light, features.brightness.toFixed(2), features.brightness / LIGHT_SCALE,
    features.brightness >= profile.brightnessFloor);
  setMeter(meters.fps, `${fps} fps`, fps / 20, fps >= 8);

  if (!features.faceDetected) {
    setVerdict('bad', 'Không thấy khuôn mặt', BLOCKER_TEXT.NO_FACE);
  } else if (blocker !== 'NONE') {
    setVerdict('warn', 'Thấy mặt nhưng chưa dùng được', BLOCKER_TEXT[blocker]);
  } else {
    setVerdict('ok', `AI đọc được: ${observation}`, `Trạng thái máy: ${machine.stateName}`);
  }

  raw.textContent = `state=${machine.stateName} obs=${observation} blocker=${blocker}`
    + ` size=${features.faceSize.toFixed(3)} light=${features.brightness.toFixed(2)}`
    + ` L=${features.leftEyeClosed.toFixed(2)} R=${features.rightEyeClosed.toFixed(2)}`
    + ` gaze=${features.gazeVertical.toFixed(2)} yaw=${features.headYaw.toFixed(2)}`
    + ` pitch=${features.headPitch.toFixed(2)} fps=${fps}`;
}

function resetHold(): void {
  holdLabel.textContent = 'Chưa có cử chỉ';
  holdValue.textContent = '0%';
  holdFill.style.width = '0%';
}

async function tick(): Promise<void> {
  if (!running || !landmarker || busy) return;
  busy = true;
  const now = performance.now();
  try {
    const features = await landmarker.detect(video, now);
    const { observation, blocker } = classifyDetailed(features, profile);
    lastFeatures = features;
    lastBlocker = blocker;

    frameCount += 1;
    if (now - fpsWindowStart >= 1_000) {
      fps = Math.round((frameCount * 1_000) / (now - fpsWindowStart));
      frameCount = 0;
      fpsWindowStart = now;
    }

    for (const event of machine.update(observation, now)) {
      if (event.type === 'PROGRESS') {
        holdLabel.textContent = GESTURE_TEXT[event.gesture];
        holdValue.textContent = `${Math.round(event.progress * 100)}%`;
        holdFill.style.width = `${event.progress * 100}%`;
      } else if (event.type === 'CANCELLED') {
        resetHold();
      } else {
        addLog(`✅ ${GESTURE_TEXT[event.gesture]} — lệnh ${event.command}`, true);
        resetHold();
      }
    }

    render(features, observation, blocker);
    drawHud(features);
  } catch (error) {
    addLog(`Lỗi nhận diện: ${(error as Error).message}`);
  } finally {
    busy = false;
    if (running) timer = setTimeout(() => void tick(), 30);
  }
}

async function listDevices(): Promise<void> {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter((device) => device.kind === 'videoinput');
    deviceSelect.replaceChildren(...cameras.map((device, index) => {
      const option = document.createElement('option');
      option.value = device.deviceId;
      option.textContent = device.label || `Camera ${index + 1}`;
      return option;
    }));
    deviceSelect.hidden = cameras.length < 2;
  } catch {
    deviceSelect.hidden = true;
  }
}

async function loadSettings(): Promise<EyeControlSettings> {
  try {
    const stored = await chrome.storage.local.get(SETTINGS_STORAGE_KEY);
    return parseSettings(stored[SETTINGS_STORAGE_KEY]);
  } catch {
    return parseSettings(undefined);
  }
}

async function start(): Promise<void> {
  startButton.disabled = true;
  setVerdict('idle', 'Đang mở camera…', 'Hãy bấm Cho phép khi Chrome hỏi');
  try {
    const settings = await loadSettings();
    machine.configure({
      navigationHoldMs: settings.navigationHoldMs,
      playPauseHoldMs: settings.playPauseHoldMs,
      accountHoldMs: settings.accountHoldMs,
      cooldownMs: settings.cooldownMs,
      enabledGestures: settings.enabledGestures,
    });

    const stream = await camera.start(deviceSelect.value || undefined);
    video.srcObject = stream;
    await video.play().catch(() => {});
    await listDevices();

    setVerdict('idle', 'Đang tải mô hình AI…', 'Lần đầu có thể mất vài giây');
    landmarker = await createFaceLandmarkerAdapter();
    machine.reset();
    running = true;
    fpsWindowStart = performance.now();
    frameCount = 0;
    stopButton.disabled = false;
    note.textContent = 'Nháy từng mắt và thử nhắm hai mắt. Vạch trắng trên thanh đo là ngưỡng cần vượt.';
    addLog('Bắt đầu phiên kiểm tra');
    void tick();
  } catch (error) {
    startButton.disabled = false;
    const name = (error as Error).name;
    const denied = name === 'NotAllowedError' || name === 'PermissionDeniedError';
    setVerdict('bad', denied ? 'Camera bị từ chối' : 'Không mở được camera',
      denied
        ? 'Bấm biểu tượng ổ khoá trên thanh địa chỉ và đặt Camera thành Allow, rồi thử lại.'
        : (error as Error).message);
    addLog(`Lỗi mở camera: ${(error as Error).message}`);
  }
}

function stop(): void {
  running = false;
  if (timer) clearTimeout(timer);
  timer = null;
  landmarker?.close();
  landmarker = null;
  camera.stop();
  video.srcObject = null;
  drawHud(null);
  resetHold();
  startButton.disabled = false;
  stopButton.disabled = true;
  setVerdict('idle', 'Đã tắt camera', '—');
  addLog('Kết thúc phiên kiểm tra');
}

copyButton.addEventListener('click', () => {
  const lines = [
    `EyeTube Control — chẩn đoán AI (${new Date().toISOString()})`,
    raw.textContent ?? '(chưa có số liệu)',
    `ngưỡng: closed>=${profile.closedThreshold} open<=${profile.openThreshold}`
      + ` faceSize>=${profile.faceSizeFloor} brightness>=${profile.brightnessFloor}`,
    `mặt: ${lastFeatures?.faceDetected ? 'có' : 'không'} | lý do chặn: ${lastBlocker}`,
  ].join('\n');
  void navigator.clipboard.writeText(lines)
    .then(() => { copyButton.textContent = 'Đã sao chép ✓'; })
    .catch(() => { copyButton.textContent = 'Không sao chép được'; })
    .finally(() => {
      setTimeout(() => { copyButton.textContent = 'Sao chép chẩn đoán'; }, 1_800);
    });
});

startButton.addEventListener('click', () => void start());
stopButton.addEventListener('click', stop);
window.addEventListener('beforeunload', stop);
void listDevices();
