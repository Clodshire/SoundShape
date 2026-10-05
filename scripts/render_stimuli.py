"""실험 자극 영상을 굽는다 — 자막만 / 자막+SoundShape 두 벌.

헤드리스 크롬으로 `/stimulus` 페이지를 열고, 영상을 **실시간으로 재생하면서**
CDP 스크린캐스트로 화면을 받아 ffmpeg 로 인코딩한다.

실시간으로 재생하는 이유: 감정 필드는 벽시계 시간으로 애니메이션한다. 프레임을
하나씩 멈춰 가며 찍으면 영상 시간은 1/30초씩 가는데 필드는 그 사이 실제로 흐른
시간만큼(수백 ms) 움직여, 결과물에서 필드만 몇 배 빠르게 떨린다.

    python scripts/render_stimuli.py --out ~/Desktop/자극영상

프론트 개발 서버(:3000)가 켜져 있어야 한다. 백엔드는 필요 없다 —
감정은 페이지가 질문지의 정답에서 직접 만든다.
"""
from __future__ import annotations

import argparse
import base64
import json
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import urllib.request
from pathlib import Path

import websocket  # websocket-client

CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
BASE = "http://localhost:3000"
REPO = Path(__file__).resolve().parent.parent
SRC_DIR = REPO / "frontend" / "public" / "stimuli"
W, H, FPS = 1920, 1080, 30


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


def page_target(port: int, timeout: float = 40.0) -> str:
    end = time.time() + timeout
    while time.time() < end:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=2) as r:
                for t in json.load(r):
                    if t.get("type") == "page" and t.get("webSocketDebuggerUrl"):
                        return t["webSocketDebuggerUrl"]
        except Exception:
            pass
        time.sleep(0.3)
    raise RuntimeError("크롬 디버그 포트를 열지 못했습니다")


class Chrome:
    def __init__(self) -> None:
        if not Path(CHROME).exists():
            raise RuntimeError(f"크롬을 찾지 못했습니다: {CHROME}")
        self.port = free_port()
        self.profile = tempfile.mkdtemp(prefix="stim_")
        self.proc = subprocess.Popen(
            [CHROME, "--headless=new", "--no-sandbox", "--mute-audio",
             "--autoplay-policy=no-user-gesture-required",
             "--hide-scrollbars", "--force-device-scale-factor=1",
             f"--window-size={W},{H}",
             f"--remote-debugging-port={self.port}",
             f"--user-data-dir={self.profile}", "about:blank"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        self.ws = websocket.create_connection(page_target(self.port), timeout=120,
                                              suppress_origin=True)
        self.n = 0

    def cmd(self, method: str, params: dict | None = None) -> dict:
        self.n += 1
        mid = self.n
        self.ws.send(json.dumps({"id": mid, "method": method, "params": params or {}}))
        while True:
            msg = json.loads(self.ws.recv())
            if msg.get("id") == mid:
                if "error" in msg:
                    raise RuntimeError(f"{method}: {msg['error']}")
                return msg.get("result", {})

    def eval(self, expr: str):
        r = self.cmd("Runtime.evaluate",
                     {"expression": expr, "returnByValue": True, "awaitPromise": True})
        return r.get("result", {}).get("value")

    def close(self) -> None:
        try:
            self.ws.close()
        except Exception:
            pass
        self.proc.terminate()
        try:
            self.proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            self.proc.kill()
        shutil.rmtree(self.profile, ignore_errors=True)


def record(ch: Chrome, clip: str, ss: bool, out: Path, audio_src: Path) -> dict:
    """한 편을 굽는다. 프레임 수와 렌더러 종류를 돌려준다."""
    ch.cmd("Page.enable")
    ch.cmd("Emulation.setDeviceMetricsOverride",
           {"width": W, "height": H, "deviceScaleFactor": 1, "mobile": False})
    ch.cmd("Page.navigate", {"url": f"{BASE}/stimulus?clip={clip}&ss={'1' if ss else '0'}"})

    # 영상과 폰트가 준비될 때까지
    for _ in range(200):
        if ch.eval("window.__stim && window.__stim.ready === true") is True:
            break
        time.sleep(0.1)
    else:
        raise RuntimeError(f"{clip}: 영상이 준비되지 않았습니다")
    ch.eval("document.fonts ? document.fonts.ready.then(()=>1) : 1")
    time.sleep(0.8)   # 필드가 목표값으로 이징할 시간
    renderer = ch.eval("window.__stim.renderer")

    frames: list[tuple[float, bytes]] = []
    dur = float(ch.eval("document.querySelector('video').duration") or 3.0)
    ch.cmd("Page.startScreencast",
           {"format": "jpeg", "quality": 92, "maxWidth": W, "maxHeight": H, "everyNthFrame": 1})
    ch.eval("(()=>{const v=document.querySelector('video'); v.currentTime=0; v.play(); return 1;})()")

    # 프레임을 받는 동안에는 브라우저에 아무것도 묻지 않는다. 질의 한 번이
    # 왕복 수십 ms 라, 매 프레임 확인하면 초당 13장까지 떨어진다.
    t0 = time.time()
    while time.time() - t0 < dur + 0.45:
        try:
            msg = json.loads(ch.ws.recv())
        except Exception:
            break
        if msg.get("method") != "Page.screencastFrame":
            continue
        pr = msg["params"]
        ch.ws.send(json.dumps({"id": 9_000_000 + len(frames), "method":
                               "Page.screencastFrameAck", "params": {"sessionId": pr["sessionId"]}}))
        frames.append((pr["metadata"].get("timestamp", time.time()),
                       base64.b64decode(pr["data"])))
    ch.cmd("Page.stopScreencast")

    if len(frames) < 5:
        raise RuntimeError(f"{clip}: 프레임이 {len(frames)}장뿐입니다")

    # 프레임을 타임스탬프 간격 그대로 이어 붙인다 (재생 속도 보존)
    with tempfile.TemporaryDirectory() as td:
        tdp = Path(td)
        lines = []
        for i, (ts, data) in enumerate(frames):
            f = tdp / f"{i:05d}.jpg"
            f.write_bytes(data)
            nxt = frames[i + 1][0] if i + 1 < len(frames) else ts + 1 / FPS
            lines.append(f"file '{f}'\nduration {max(1/120, nxt - ts):.5f}")
        lines.append(f"file '{tdp / f'{len(frames)-1:05d}.jpg'}'")
        lst = tdp / "list.txt"
        lst.write_text("\n".join(lines), encoding="utf-8")

        out.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(
            ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
             "-f", "concat", "-safe", "0", "-i", str(lst),
             "-i", str(audio_src),
             "-map", "0:v:0", "-map", "1:a:0?",
             "-c:v", "libx264", "-preset", "slow", "-crf", "19",
             "-pix_fmt", "yuv420p", "-r", str(FPS),
             "-c:a", "aac", "-b:a", "128k", "-shortest",
             "-movflags", "+faststart", str(out)],
            check=True)
    return {"frames": len(frames), "renderer": renderer}


def _eval_safe(self: Chrome, expr: str):
    try:
        return self.eval(expr)
    except Exception:
        return None


Chrome.eval_safe = _eval_safe  # type: ignore[attr-defined]


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--out", type=Path, required=True, help="결과를 담을 폴더")
    ap.add_argument("--clips", default="1,2,3,4,5,6,7,8,9,10,11,12,example")
    a = ap.parse_args()

    meta = json.loads((SRC_DIR / "clips.json").read_text(encoding="utf-8"))
    names = {"example": "예시"}
    ch = Chrome()
    bad = []
    try:
        for clip in a.clips.split(","):
            clip = clip.strip()
            if clip not in meta:
                bad.append(f"{clip}: clips.json 에 없습니다"); continue
            label = names.get(clip, clip)
            audio = SRC_DIR / f"{clip}.mp4"
            for ss, folder in ((False, "1_자막만"), (True, "2_자막+SoundShape")):
                out = a.out / folder / f"{label}.mp4"
                try:
                    r = record(ch, clip, ss, out, audio)
                    print(f"  ✅ {folder}/{label}.mp4  ({r['frames']}프레임 · {r['renderer']})")
                except Exception as e:
                    bad.append(f"{folder}/{label}: {e}")
                    print(f"  ❌ {folder}/{label} — {e}")
    finally:
        ch.close()

    if bad:
        print("\n문제:")
        for b in bad:
            print("  " + b)
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
