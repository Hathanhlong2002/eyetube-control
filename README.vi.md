# EyeTube Control

<p align="center">
  <img src="public/icon/128.png" alt="EyeTube Control Logo" width="96" height="96" />
</p>

<p align="center">
  <strong>Điều khiển phát và chuyển video YouTube rảnh tay qua nhận diện Mắt & Cử chỉ ngón tay AI trực tiếp trên trình duyệt</strong>
</p>

<p align="center">
  <a href="package.json"><img src="https://img.shields.io/badge/phiên%20bản-1.1.0-blue.svg?style=flat-square" alt="Phiên bản 1.1.0" /></a>
  <a href="https://developer.chrome.com/docs/extensions/mv3/intro/"><img src="https://img.shields.io/badge/Manifest-V3-emerald.svg?style=flat-square" alt="Manifest V3" /></a>
  <a href="tests/"><img src="https://img.shields.io/badge/tests-230%20passed%20%7C%2019%20suites-brightgreen.svg?style=flat-square" alt="Tests" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/giấy%20phép-MIT-informational.svg?style=flat-square" alt="Giấy phép MIT" /></a>
  <a href="https://github.com/Hathanhlong2002/eyetube-control"><img src="https://img.shields.io/badge/GitHub-Hathanhlong2002%2Feyetube--control-181717?style=flat-square&logo=github" alt="GitHub Repository" /></a>
</p>

<p align="center">
  <a href="README.md"><strong>English</strong></a> • <a href="README.vi.md"><strong>Tiếng Việt</strong></a>
</p>

---

## Giới thiệu tổng quan

**EyeTube Control** là tiện ích mở rộng Google Chrome (Manifest V3) hiệu năng cao, bảo mật quyền riêng tư tuyệt đối, cho phép người dùng điều khiển phát/tạm dừng video, chuyển bài, thích video và chọn danh sách đề xuất trên YouTube hoàn toàn **không cần chạm bàn phím hay chuột**. Tiện ích vận hành nhờ hai mô hình Google MediaPipe WebAssembly chạy trực tiếp trên máy client, nhận diện **Cử chỉ mắt** và **Đếm số ngón tay** qua webcam theo thời gian thực cùng màn hình HUD camera nổi tiện dụng.

- **100% Xử lý nội bộ (On-Device):** Không có bất kỳ khung hình webcam, âm thanh, dữ liệu sinh trắc học khuôn mặt hay lịch sử duyệt web nào bị gửi ra ngoài trình duyệt.
- **Kiến trúc AI kép (Dual-Model):** Kết hợp đồng thời `FaceLandmarker` (478 điểm 3D + 52 biểu cảm blendshape) và `HandLandmarker` (21 khớp xương bàn tay).
- **Tối ưu hóa CPU & Pin:** Tiêu thụ chỉ **~7.9% CPU** ở trạng thái nghỉ nhờ cơ chế điều tốc suy luận theo vận tốc mi mắt, kích hoạt nhận diện bàn tay theo chuyển động và chia sẻ bộ đệm canvas 320x240.
- **Cơ chế chống kích hoạt nhầm (Anti-False-Positive):** Lọc chớp mắt tự nhiên bằng ngưỡng thời gian giữ (hold duration), kiểm tra viền khung hình (margin boundary) và phân xử độ ưu tiên cử chỉ.

---

## 1. Bảng cử chỉ & Lệnh điều khiển

Mọi thời gian giữ (hold ms) và bật/tắt từng cử chỉ đều có thể tùy chỉnh trực tiếp trong popup cài đặt:

| Cử chỉ | Thời gian giữ mặc định | Hành động trên YouTube | Cơ chế an toàn & Chống kích hoạt nhầm |
| :--- | :---: | :--- | :--- |
| **Nhắm cả 2 mắt** | `700 ms` | **Phát / Tạm dừng (Play/Pause)** | Cao hơn hẳn thời gian chớp mắt tự nhiên (100–400 ms). |
| **Nháy mắt phải** | `400 ms` | **Video tiếp theo (Next Video)** | Mở video đề xuất đầu tiên ở cột bên phải (hoặc nút Next của playlist). |
| **Nháy mắt trái** | `400 ms` | **Video trước (Previous Video)** | Quay lại video trước đó qua lịch sử trình duyệt. |
| **Nhìn lên trên** | `1,200 ms` | **Thích video (Like)** | Kiểm tra trạng thái `aria-pressed`, không bao giờ hủy thích ngoài ý muốn. |
| **Giơ 1–5 ngón tay** | `900 ms` | **Mở video liên quan #1–5** | Hiển thị tiêu đề video mục tiêu trực tiếp trên HUD trước khi mở. |

> [!NOTE]
> - **Tại sao không có cử chỉ "Nhìn xuống"?** Phụ đề video luôn nằm ở đáy màn hình. Khi đọc phụ đề mắt tự nhiên nhìn xuống, nếu gán cử chỉ này sẽ gây kích hoạt nhầm liên tục. Do đó cử chỉ nhìn xuống đã được loại bỏ hoàn toàn.
> - **Linh hoạt thế tay:** Thuật toán đo độ mở độc lập của từng đầu ngón tay vượt qua khớp ngón. Bạn có thể giơ bất kỳ ngón nào thuận tiện (ví dụ: ngón cái + trỏ + giữa đều được tính là số "3").
> - **Ưu tiên bàn tay:** Khi giơ tay lên trước camera, nhận diện bàn tay sẽ chiếm quyền ưu tiên so với cử chỉ mắt để tránh kích hoạt nhầm khi đưa tay lên.

---

## 2. Kiến trúc AI & Tối ưu hiệu năng

```
                           Webcam Stream (640x480 @ 15fps)
                                         │
              ┌──────────────────────────┴──────────────────────────┐
              ▼                                                     ▼
┌─────────────────────────┐                             ┌─────────────────────────┐
│  FaceLandmarker (WASM)  │                             │  Shared 320x240 Scaler  │
│  - 478 Điểm 3D          │                             └────────────┬────────────┘
│  - 52 Blendshapes       │                                          │
└────────────┬────────────┘                                          ▼
             │                                          ┌─────────────────────────┐
             │                                          │  Lưới chuyển động 16x12 │
             │                                          │  (Loại trừ vùng mặt)    │
             │                                          └────────────┬────────────┘
             │                                                       │ (Chuyển động > ngưỡng)
             │                                                       ▼
             │                                          ┌─────────────────────────┐
             │                                          │  HandLandmarker (WASM)  │
             │                                          │  - 21 Điểm bàn tay      │
             │                                          │  - Kiểm tra viền 5%     │
             └──────────────────────────┬───────────────────────────┘
                                        ▼
                         Bộ phân xử máy trạng thái ưu tiên
                        (Cử chỉ tay ưu tiên hơn cử chỉ mắt)
                                        │
                                        ▼
                  Điều khiển YouTube (`.ytp-play-button.click()`)
```

### Điểm chuẩn CPU đo thực tế (Đơn nhân, M-series Mac / Intel i7)

| Trạng thái hoạt động | Mức chiếm dụng CPU | Giải thích kiến trúc |
| :--- | :---: | :--- |
| Vòng lặp cố định 2 model (chưa tối ưu) | **31.4%** | Chạy liên tục nhận diện lòng bàn tay và mặt mỗi frame |
| Có chuyển động trong khung hình | **16.1%** | Bộ nhận diện tay chỉ thức dậy khi có chuyển động ngoài vùng mặt |
| **Người xem ngồi yên (Trạng thái nghỉ)** | **7.9%** | Giảm chu kỳ xuống ~4.5 fps; tự động tăng lên 15 fps khi mi mắt cử động |

### Các kỹ thuật tối ưu hóa trọng tâm

1. **Điều tốc thích ứng theo vận tốc mi mắt (Adaptive Eyelid Pacing):** Khi ngồi xem video ổn định, tốc độ nhận diện giảm xuống ~4.5 fps. Ngay khi mi mắt bắt đầu chuyển động, vòng lặp lập tức tăng tốc lên 15 fps để phản hồi tức thì.
2. **Kích hoạt nhận diện tay bằng chuyển động (Motion Gating):** Chạy thuật toán tìm lòng bàn tay liên tục rất nặng máy. Hệ thống sử dụng lưới 16x12 pixel theo dõi sai khác giữa các khung hình (loại trừ vùng khuôn mặt), chỉ đánh thức `HandLandmarker` khi có chuyển động thực tế.
3. **Bộ đệm Canvas 320x240 dùng chung:** Cả lưới chuyển động và bộ nhận diện ngón tay cùng thao tác trên một canvas 320x240 duy nhất được co tỷ lệ bằng phần cứng.
4. **Luồng WebRTC cục bộ tiết kiệm băng thông:** HUD camera truyền hình ảnh qua WebRTC cục bộ (không cần server STUN/TURN), giới hạn ở 15 fps và độ phân giải một nửa. Khi tab YouTube bị ẩn, luồng mã hóa video lập tức dừng hoàn toàn.
5. **Khóa cử chỉ & Loại trừ viền mép 5%:** Bàn tay chạm vào mép ngoài khung hình trong phạm vi 5% sẽ bị bỏ qua để tránh kích hoạt ngoài ý muốn khi di chuyển tay qua camera. Sau khi lệnh thực thi, cử chỉ tay bị khóa cho đến khi tay rời hẳn khỏi khung hình.

---

## 3. Cấu trúc thư mục dự án

```
eyetube-control/
├── entrypoints/                 # Các điểm vào của Chrome Extension (WXT)
│   ├── background.ts            # Extension Service Worker
│   ├── offscreen.html           # Tài liệu Offscreen (nơi chạy các model AI)
│   ├── popup/                   # Giao diện popup cài đặt trên thanh công cụ
│   ├── test.html                # Trang kiểm thử chẩn đoán AI độc lập
│   └── youtube.content.tsx      # Content script nhúng vào trang YouTube
├── src/
│   ├── background/              # Bộ điều phối phiên (Session Coordinator) & WebRTC router
│   ├── contracts/               # Định nghĩa TypeScript kiểu dữ liệu, thông điệp & cài đặt
│   ├── gesture/                 # Bộ phân loại cử chỉ, hiệu chuẩn & máy trạng thái
│   ├── media/                   # Phiên camera, bộ co giãn khung hình, lưới chuyển động & model
│   ├── offscreen/               # Offscreen runtime, vòng lặp suy luận AI kép
│   ├── overlay/                 # HUD camera nổi trong Shadow DOM biệt lập
│   ├── popup/                   # Giao diện cài đặt React 19
│   ├── test/                    # Logic trang chẩn đoán test.html
│   └── youtube/                 # Bộ điều khiển DOM YouTube & theo dõi vòng đời trang
├── public/                      # Tài nguyên tĩnh & mô hình MediaPipe đã nén
│   └── models/                  # face_landmarker.task & hand_landmarker.task
└── tests/                       # 230 bài kiểm thử tự động (Unit & Integration tests)
```

---

## 4. Yêu cầu hệ thống

- **Trình duyệt:** Google Chrome phiên bản 116 trở lên.
- **Môi trường phát triển:** Node.js v20+ và npm 10+.
- **Phần cứng:** Webcam tích hợp hoặc USB thông thường (khuyến nghị 720p @ 30fps).
- **Hệ điều hành:** macOS, Windows hoặc Linux (hỗ trợ WebAssembly SIMD mặc định).

---

## 5. Hướng dẫn cài đặt & Chạy ứng dụng

### Bước 1: Clone mã nguồn & Cài đặt thư viện
```bash
git clone https://github.com/Hathanhlong2002/eyetube-control.git
cd eyetube-control
npm ci --ignore-scripts
```

### Bước 2: Build tiện ích mở rộng
```bash
npm run build
```
Thư mục build hoàn chỉnh phục vụ sản xuất sẽ được tạo tại `output/chrome-mv3`.

### Bước 3: Nạp tiện ích vào Google Chrome
1. Mở Chrome và truy cập địa chỉ `chrome://extensions`.
2. Bật công tắc **Chế độ dành cho nhà phát triển (Developer mode)** ở góc trên bên phải.
3. Nhấp nút **Tải tiện ích đã giải nén (Load unpacked)** và chọn thư mục:
   ```
   <đường-dẫn-dự-án>/output/chrome-mv3
   ```

### Bước 4: Trải nghiệm trên YouTube
1. Mở bất kỳ video nào trên [YouTube](https://www.youtube.com).
2. Nhấp vào biểu tượng **EyeTube Control** trên thanh công cụ tiện ích.
3. Nhấp **Start Eye Control** (cấp quyền truy cập camera khi trình duyệt hỏi).
4. Khung hình HUD camera sẽ hiện ở góc dưới bên phải. Bạn chỉ cần nhắm cả 2 mắt 700 ms để Dừng/Phát, hoặc giơ 1-5 ngón tay để chọn video đề xuất!

---

## 6. Trang kiểm thử & Hiệu chuẩn AI (`test.html`)

Tiện ích tích hợp sẵn một trang chẩn đoán độc lập giúp bạn kiểm tra webcam và kiểm tra độ nhạy của cử chỉ mà không cần vào YouTube:

1. Truy cập: `chrome-extension://<id-tiện-ích>/test.html` (hoặc nhấp link mở trang test trong popup).
2. Trang kiểm thử hiển thị các thông số trực quan theo thời gian thực:
   - Góc ngửa/nghiêng đầu (pitch/yaw) và tỷ lệ diện tích khuôn mặt trong khung hình.
   - Hệ số nhắm mở từng bên mắt ($0.00 \to 1.00$).
   - Số lượng ngón tay đang giơ ($0 \to 5$) cùng cảnh báo phạm vi viền camera.
   - Thanh tiến trình thời gian giữ (hold progress bar) và phán quyết cử chỉ của máy trạng thái.
   - Lý do từ chối nhận diện (ví dụ: `mặt quá xa`, `thiếu sáng`, `tay chạm viền`).

---

## 7. Kiểm thử & Đảm bảo chất lượng mã nguồn

Dự án tuân thủ nghiêm ngặt chuẩn gõ TypeScript và đạt độ bao phủ kiểm thử 100%:

```bash
# Chạy toàn bộ 230 unit & integration tests (Vitest)
npm test

# Chạy kiểm thử ở chế độ watch
npm run test:watch

# Kiểm tra kiểu dữ liệu TypeScript (Strict Typecheck)
npm run typecheck

# Chạy kiểm thử tự động trên trình duyệt (Playwright)
npx playwright test

# Chạy chế độ phát triển (Dev server với Hot Reload)
npm run dev

# Đóng gói file ZIP phát hành cho Chrome Web Store
npm run zip
```

---

## 8. Cam kết bảo mật & Quyền riêng tư

- **Không thực thi mã từ xa (Zero RCE):** Chính sách bảo mật CSP quy định chặt chẽ `script-src 'self' 'wasm-unsafe-eval'`. Không nạp mã từ bên ngoài, không gắn tracker phân tích hay CDN bên thứ ba.
- **Không rò rỉ dữ liệu:** Toàn bộ điểm mốc sinh trắc học và khung hình camera chỉ tồn tại trong bộ nhớ RAM của trình duyệt trong mili-giây xử lý và bị hủy ngay lập tức.
- **Xác thực toàn vẹn mô hình AI:** Hai tệp mô hình MediaPipe đi kèm được kiểm tra mã băm SHA256 đối chiếu tại `public/models/SHA256SUMS`.
- **Bộ điều khiển DOM an toàn (Fail-Closed):** Luôn kiểm tra thuộc tính ngữ nghĩa (`aria-pressed`, trạng thái disabled) của nút bấm YouTube trước khi click mô phỏng, tránh tình trạng click đúp ngoài ý muốn.

---

## 9. Giấy phép bản quyền

Phát hành theo [Giấy phép MIT](LICENSE).

Bản quyền (c) 2026 **Hathanhlong2002**.
