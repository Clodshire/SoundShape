"""레이아웃 JSON → 편집 가능한 PowerPoint 포스터 한 장.

    python scripts/poster/build_pptx.py layout.json out.pptx [--paper a0]

extract.js 가 뽑아낸 좌표를 그대로 PPTX 도형으로 옮긴다. 모든 글자가 진짜
텍스트 상자가 되므로 파워포인트에서 자유롭게 고칠 수 있다.
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import sys
from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.enum.text import MSO_ANCHOR, PP_ALIGN
from pptx.oxml.ns import qn
from pptx.util import Emu, Pt

EMU_PER_IN = 914400

# 종이 크기(인치, 세로 기준)
PAPERS = {
    "a0": (33.110, 46.811),
    "a1": (23.386, 33.110),
    "a2": (16.535, 23.386),
}

ALIGN = {
    "left": PP_ALIGN.LEFT,
    "start": PP_ALIGN.LEFT,
    "center": PP_ALIGN.CENTER,
    "right": PP_ALIGN.RIGHT,
    "end": PP_ALIGN.RIGHT,
    "justify": PP_ALIGN.JUSTIFY,
}


def rgb(h: str | None) -> RGBColor | None:
    if not h:
        return None
    return RGBColor.from_string(h.upper())


def set_alpha(fill_elm, alpha: float) -> None:
    """python-pptx 에 투명도 API 가 없어 XML 로 직접 넣는다."""
    if alpha >= 0.995:
        return
    srgb = fill_elm.find(qn("a:srgbClr"))
    if srgb is None:
        return
    node = srgb.makeelement(qn("a:alpha"), {"val": str(int(round(alpha * 100000)))})
    srgb.append(node)


def build(layouts: list[dict], out: Path, paper: str, verbose: bool) -> None:
    # 슬라이드 크기는 프레젠테이션 단위라, 첫 장 기준으로 잡는다.
    first = layouts[0]["canvas"]
    pw_in, ph_in = PAPERS[paper]
    if first["width"] > first["height"]:
        pw_in, ph_in = ph_in, pw_in

    px_per_in = first["width"] / pw_in
    emu = lambda v: Emu(int(round(v * EMU_PER_IN / px_per_in)))  # noqa: E731
    pt = lambda v: Pt(v * 72.0 / px_per_in)                      # noqa: E731

    prs = Presentation()
    prs.slide_width = emu(first["width"])
    prs.slide_height = emu(first["height"])

    counts = {"box": 0, "text": 0, "image": 0, "skipped": 0}
    all_warnings: list[str] = []

    for n, layout in enumerate(layouts, 1):
        slide = prs.slides.add_slide(prs.slide_layouts[6])  # 완전 빈 레이아웃
        for w in layout.get("warnings") or []:
            all_warnings.append(f"[{n}장] {w}")
        _place(slide, layout, emu, pt, px_per_in, counts)

    out.parent.mkdir(parents=True, exist_ok=True)
    prs.save(out)

    print(f"저장됨: {out}")
    print(f"  슬라이드 {len(layouts)}장 · {pw_in:.2f} × {ph_in:.2f} 인치 ({paper.upper()})")
    print(f"  도형 {counts['box']}개 · 텍스트 {counts['text']}개 · 그림 {counts['image']}개"
          + (f" · 건너뜀 {counts['skipped']}개" if counts["skipped"] else ""))

    for spot in counts.get("bad_images", []):
        all_warnings.append(f"이미지를 넣지 못함(형식 문제) — {spot}")

    if all_warnings:
        print(f"\n⚠️  파워포인트에서 손봐야 할 곳 {len(all_warnings)}건:")
        shown = all_warnings if verbose else all_warnings[:12]
        for w in shown:
            print(f"   · {w}")
        if len(all_warnings) > len(shown):
            print(f"   … 외 {len(all_warnings) - len(shown)}건 (--verbose 로 전체 보기)")


def _place(slide, layout: dict, emu, pt, px_per_in: float, counts: dict) -> None:
    """레이아웃 하나를 슬라이드 하나에 배치한다. DOM 순서대로 쌓아 z-순서를 맞춘다."""
    for item in sorted(layout["items"], key=lambda i: i["order"]):
        b = item["box"]
        x, y, w, h = emu(b["x"]), emu(b["y"]), emu(b["w"]), emu(b["h"])
        kind = item["kind"]

        if kind == "box":
            radius_px = item.get("radius") or 0
            if radius_px > 1:
                shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, x, y, w, h)
                short = max(1.0, min(b["w"], b["h"]))
                shape.adjustments[0] = max(0.0, min(0.5, radius_px / short))
            else:
                shape = slide.shapes.add_shape(MSO_SHAPE.RECTANGLE, x, y, w, h)

            shape.shadow.inherit = False
            if item.get("fill"):
                shape.fill.solid()
                shape.fill.fore_color.rgb = rgb(item["fill"])
                set_alpha(shape.fill._xPr.find(qn("a:solidFill")), item.get("fillAlpha", 1.0))
            else:
                shape.fill.background()

            line = item.get("line")
            if line:
                shape.line.color.rgb = rgb(line["color"])
                shape.line.width = emu(line["width"])
                if line.get("style") == "dashed":
                    ln = shape.line._get_or_add_ln()
                    ln.append(ln.makeelement(qn("a:prstDash"), {"val": "dash"}))
            else:
                shape.line.fill.background()
            counts["box"] += 1

        elif kind == "image":
            data = item.get("data") or ""
            if "," not in data:
                counts["skipped"] += 1
                continue
            raw = base64.b64decode(data.split(",", 1)[1])
            try:
                slide.shapes.add_picture(io.BytesIO(raw), x, y, w, h)
                counts["image"] += 1
            except Exception:  # noqa: BLE001
                # PPTX 가 못 받는 형식(주로 SVG). 하나 때문에 전체를 버리지 않는다.
                counts["skipped"] += 1
                counts.setdefault("bad_images", []).append(
                    f"{int(b['x'])},{int(b['y'])} {int(b['w'])}×{int(b['h'])}"
                )

        elif kind == "text":
            pad_l = item.get("padLeft", 0)
            pad_t = item.get("padTop", 0)
            tb = slide.shapes.add_textbox(
                emu(b["x"] + pad_l),
                emu(b["y"] + pad_t),
                emu(max(1.0, b["w"] - pad_l - item.get("padRight", 0))),
                emu(max(1.0, b["h"] - pad_t)),
            )
            tf = tb.text_frame
            tf.word_wrap = True
            tf.margin_left = tf.margin_right = tf.margin_top = tf.margin_bottom = 0
            tf.vertical_anchor = MSO_ANCHOR.TOP

            p = tf.paragraphs[0]
            p.alignment = ALIGN.get(item.get("align", "left"), PP_ALIGN.LEFT)
            lh = item.get("lineHeight")
            if lh:
                p.line_spacing = pt(lh)

            run = p.add_run()
            run.text = item["text"]
            f = run.font
            f.size = pt(item["size"])
            f.bold = item.get("weight", 400) >= 600
            f.italic = bool(item.get("italic"))
            f.color.rgb = rgb(item.get("color") or "000000")
            if item.get("font"):
                f.name = item["font"]
                # 한글은 동아시아 글꼴 슬롯에도 같은 이름을 넣어야 파워포인트가
                # 라틴 글꼴로 대체하지 않는다.
                rPr = run._r.get_or_add_rPr()
                for tag in ("a:ea", "a:cs"):
                    rPr.append(rPr.makeelement(qn(tag), {"typeface": item["font"]}))
            spacing = item.get("letterSpacing") or 0
            if abs(spacing) > 0.01:
                run._r.get_or_add_rPr().set("spc", str(int(round(spacing * 100 * 72 / px_per_in))))
            counts["text"] += 1



def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("layouts", type=Path, nargs="+", help="레이아웃 JSON (여러 개면 슬라이드 여러 장)")
    ap.add_argument("-o", "--out", type=Path, default=Path("poster/SoundShape_포스터.pptx"))
    ap.add_argument("--paper", default="a0", choices=sorted(PAPERS))
    ap.add_argument("--verbose", action="store_true")
    a = ap.parse_args()

    layouts = []
    for f in a.layouts:
        if not f.exists():
            print(f"레이아웃 파일이 없습니다: {f}")
            return 1
        layouts.append(json.loads(f.read_text(encoding="utf-8")))
    build(layouts, a.out, a.paper, a.verbose)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
