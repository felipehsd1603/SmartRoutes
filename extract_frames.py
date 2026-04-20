import cv2
import os

video = cv2.VideoCapture('video.mp4')
fps = video.get(cv2.CAP_PROP_FPS)
total = int(video.get(cv2.CAP_PROP_FRAME_COUNT))
duration = total / fps if fps else 0

print(f"FPS: {fps:.2f}  frames: {total}  duration: {duration:.1f}s")

os.makedirs('frames', exist_ok=True)
n_samples = 8
step = max(1, total // n_samples)

saved = 0
for i in range(0, total, step):
    if saved >= n_samples:
        break
    video.set(cv2.CAP_PROP_POS_FRAMES, i)
    ok, frame = video.read()
    if not ok:
        continue
    # resize se muito grande
    h, w = frame.shape[:2]
    if w > 1280:
        scale = 1280 / w
        frame = cv2.resize(frame, (1280, int(h * scale)))
    ts = i / fps if fps else 0
    path = f'frames/frame_{saved:02d}_t{ts:05.1f}s.jpg'
    cv2.imwrite(path, frame, [cv2.IMWRITE_JPEG_QUALITY, 85])
    print(f'saved {path}')
    saved += 1

video.release()
print(f'Total saved: {saved}')
