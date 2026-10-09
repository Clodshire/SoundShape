"""HTML 포스터 → 원하는 종이 크기의 벡터 PDF.

    python scripts/poster/html_to_pdf.py 입력.html 출력.pdf [--paper a0]

크롬의 `--print-to-pdf` 옵션은 종이 크기를 무조건 레터로 고정해 버린다.
그래서 DevTools 프로토콜의 Page.printToPDF 를 직접 불러 크기를 지정한다.
결과는 글꼴이 박힌 벡터 PDF라 A0 로 뽑아도 글자가 뭉개지지 않는다.
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

# 인치 (세로 기준)
PAPERS = {
    "a0": (33.110, 46.811), "a1": (23.386, 33.110), "a2": (16.535, 23.386),
    "a3": (11.693, 16.535), "a4": (8.268, 11.693),
    # 16:9 슬라이드 — 구글 슬라이드·파워포인트 기본 크기
    "slide": (7.5, 13.333),
}


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def wait_for_page_target(port: int, timeout: float = 40.0) -> str:
    """탭(page) 타깃의 웹소켓 주소. /json/version 이 주는 것은 브라우저 타깃이라
    Page.printToPDF 를 받지 못한다."""
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(f"http://127.0.0.1:{port}/json/list", timeout=2) as r:
                for t in json.load(r):
                    if t.get("type") == "page" and t.get("webSocketDebuggerUrl"):
                        return t["webSocketDebuggerUrl"]
        except Exception:  # noqa: BLE001
            pass
        time.sleep(0.4)
    raise RuntimeError("크롬 탭 타깃에 연결하지 못했습니다.")


def render(html: Path, out: Path, paper: str, landscape: bool, wait_ms: int,
           stack: bool = True, min_board: int = 1500) -> None:
    if not Path(CHROME).exists():
        raise RuntimeError(f"크롬을 찾지 못했습니다: {CHROME}")

    w_in, h_in = PAPERS[paper]
    if landscape:
        w_in, h_in = h_in, w_in

    port = free_port()
    profile = Path(tempfile.mkdtemp(prefix="poster-chrome-"))
    proc = subprocess.Popen(
        [
            CHROME, "--headless=new", "--disable-gpu", "--no-sandbox",
            "--hide-scrollbars", "--force-device-scale-factor=1",
            # 크롬 111+ 은 DevTools 웹소켓의 Origin 을 검사한다. 로컬 프로세스끼리라 안전하다.
            "--remote-allow-origins=*",
            f"--remote-debugging-port={port}", f"--user-data-dir={profile}",
            "about:blank",
        ],
        stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
    )

    try:
        ws = websocket.create_connection(wait_for_page_target(port), timeout=300,
                                        suppress_origin=True)
        n = 0

        def cmd(method: str, params: dict | None = None) -> dict:
            nonlocal n
            n += 1
            ws.send(json.dumps({"id": n, "method": method, "params": params or {}}))
            while True:
                msg = json.loads(ws.recv())
                if msg.get("id") == n:
                    if "error" in msg:
                        raise RuntimeError(f"{method}: {msg['error']}")
                    return msg.get("result", {})

        cmd("Page.enable")
        cmd("Runtime.enable")
        url = html.resolve().as_uri()
        print(f"여는 중… {html.name}")
        cmd("Page.navigate", {"url": url})

        # 번들된 페이지는 자바스크립트가 내용을 그린 뒤라야 인쇄할 수 있다.
        print(f"렌더링 대기 {wait_ms/1000:.0f}초…")
        time.sleep(wait_ms / 1000)

        # 아트보드가 가로로 나란히 놓여 있으면 첫 장만 인쇄된다. 세로로 쌓고
        # 장마다 페이지를 끊어 준다.
        board_px = 0
        if stack:
            # 종이 비율과 거의 같은 크기의 요소가 곧 아트보드다. 둘을 감싸는
            # 바깥 컨테이너는 비율이 달라 자연히 걸러진다.
            js = """(() => {
              for (const id of ['__bundler_loading','__bundler_thumbnail'])\n                document.getElementById(id)?.remove();\n              const TARGET = %f, MIN = %d, TOL = 0.06;
              const boards = [...document.querySelectorAll('body *')].filter(e => {
                const w = e.offsetWidth, h = e.offsetHeight;
                return w >= MIN && h >= MIN && Math.abs(h / w - TARGET) / TARGET < TOL;
              }).filter((e, _, arr) => !arr.some(o => o !== e && o.contains(e)));
              if (!boards.length) return 0;
              document.body.style.cssText =
                'margin:0;padding:0;display:block;background:#fff;min-height:0';
              const host = document.createElement('div');
              host.style.cssText = 'margin:0;padding:0;display:block';
              boards.forEach((b, i) => {
                b.style.margin = '0';
                b.style.breakAfter = i < boards.length - 1 ? 'page' : 'auto';
                b.style.pageBreakAfter = i < boards.length - 1 ? 'always' : 'auto';
                host.appendChild(b);
              });
              // 로딩 오버레이·썸네일·바깥 껍데기가 조금이라도 남으면 아트보드가
              // 아래로 밀려 페이지가 하나 더 생긴다. 본문을 통째로 갈아 끼운다.
              document.body.replaceChildren(host);
              return boards[0].offsetWidth;   // 배율 계산에 쓴다
            })()""" % (h_in / w_in, min_board)
            res = cmd("Runtime.evaluate", {"expression": js, "returnByValue": True})
            board_px = res.get("result", {}).get("value", 0) or 0
            print(f"아트보드 감지 — 폭 {board_px}px" if board_px else "아트보드를 못 찾음 — 원본 그대로 인쇄")
            time.sleep(1.5)

        # 크롬은 CSS 픽셀을 96dpi 로, PDF 는 72dpi 로 다룬다. 아트보드가 종이를
        # 정확히 채우도록 배율을 계산한다 (2384px → A0 면 정확히 4/3 이 된다).
        scale = 1.0
        if board_px:
            scale = (w_in * 96.0) / board_px
            if not 0.1 <= scale <= 2.0:
                print(f"  배율 {scale:.3f} 이 크롬 허용 범위를 벗어나 1.0 으로 둡니다.")
                scale = 1.0
            else:
                print(f"  배율 {scale:.4f} ({board_px}px → {w_in:.2f}인치)")

        print(f"인쇄 중… {w_in:.2f} × {h_in:.2f} 인치 ({paper.upper()})")
        result = cmd(
            "Page.printToPDF",
            {
                "paperWidth": w_in,
                "paperHeight": h_in,
                "marginTop": 0, "marginBottom": 0, "marginLeft": 0, "marginRight": 0,
                "printBackground": True,
                "preferCSSPageSize": False,
                "scale": scale,
                "transferMode": "ReturnAsBase64",
            },
        )
        out.parent.mkdir(parents=True, exist_ok=True)
        out.write_bytes(base64.b64decode(result["data"]))
        ws.close()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except subprocess.TimeoutExpired:
            proc.kill()
        shutil.rmtree(profile, ignore_errors=True)

    print(f"저장됨: {out}  ({out.stat().st_size / 1_048_576:.1f} MB)")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("html", type=Path)
    ap.add_argument("out", type=Path)
    ap.add_argument("--paper", default="a0", choices=sorted(PAPERS))
    ap.add_argument("--landscape", action="store_true")
    ap.add_argument("--wait", type=int, default=15000, help="렌더링 대기 시간(ms)")
    ap.add_argument("--no-stack", action="store_true", help="아트보드 재배치를 하지 않는다")
    ap.add_argument("--min-board", type=int, default=1500, help="아트보드로 볼 최소 픽셀 크기")
    a = ap.parse_args()
    if not a.html.exists():
        print(f"입력 파일이 없습니다: {a.html}")
        return 1
    render(a.html, a.out, a.paper, a.landscape, a.wait, not a.no_stack, a.min_board)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
