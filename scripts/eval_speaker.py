"""Does the turn dash appear where the speaker actually changes?

⚠️ RESULT: this experiment CANNOT answer that question, and the finding is
itself the point. RAVDESS contains only two sentences, so any conversation
built from it repeats them, and Whisper's repetition suppression drops
utterances rather than transcribing them — 56-60% survive as segments no matter
how short the conversation is made. Everything measured downstream then
reflects transcription loss, not turn detection.

What IS measured cleanly, without Whisper in the path, lives in the module's
own numbers: turn-change AUC 0.958 on 4000 RAVDESS pairs, and 92.9% accuracy
on real utterance sequences. The integration remains unvalidated until it can
be run on genuine multi-speaker material with varied dialogue.

Kept in the repository because re-running it on a real two-person clip is
exactly how that gap gets closed.


The caption marks a change of speaker with a leading dash. That mark is only
worth adding if it is right often enough — a dash where nobody changed tells
the viewer someone else spoke, which is worse than the silence it replaces.

RAVDESS gives clips labelled by actor, so conversations can be built with the
turns known exactly, run through the real pipeline (Whisper segments, then the
turn tracker), and scored.

One construction detail is load-bearing. RAVDESS contains only two sentences,
and stacking the same one twice in a row makes Whisper's repetition suppression
DROP utterances — an earlier version of this experiment lost more than half the
audio and was misread as Whisper merging speakers. Speaker and sentence are
therefore alternated together, so no two neighbouring lines share text.

    python scripts/eval_speaker.py [n_conversations]

⚠️ Turns here are separated by a clean pause. Real dialogue overlaps and cuts
in, which is harder; these numbers are an upper bound.
"""

from __future__ import annotations

import csv
import glob
import sys
from collections import defaultdict
from pathlib import Path

import numpy as np

REPO = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO))

OUT = REPO / "results" / "speaker_turns.csv"
WORK = REPO / "data" / "timelines" / "_speaker_eval"
GAP_SECONDS = 0.5
# RAVDESS contains only two sentences. The more lines a conversation has, the
# more each one repeats, and Whisper's repetition suppression starts DROPPING
# utterances — at 8 lines only 60% survived as segments, unevenly (1 to 8 per
# conversation), which contaminates any end-to-end number measured on it. Short
# conversations keep each sentence to two appearances.
LINES_PER_CONVERSATION = int(sys.argv[2]) if len(sys.argv) > 2 else 4


def build_conversation(by_actor, actors, rng, path: Path):
    """Alternate speaker AND sentence, so adjacent lines never share text."""
    import soundfile as sf

    chunks, marks, t, sr = [], [], 0.0, None
    for i in range(LINES_PER_CONVERSATION):
        actor = actors[i % 2] if rng.random() < 0.75 else actors[(i + 1) % 2]
        sentence = "01" if i % 2 == 0 else "02"
        pool = by_actor[actor].get(sentence)
        if not pool:
            continue
        x, s = sf.read(pool[int(rng.integers(0, len(pool)))], dtype="float32")
        if x.ndim > 1:
            x = x.mean(axis=1)
        sr = s
        marks.append({"speaker": actor, "start": t, "end": t + len(x) / s})
        chunks += [x, np.zeros(int(GAP_SECONDS * s), dtype=np.float32)]
        t += len(x) / s + GAP_SECONDS
    sf.write(path, np.concatenate(chunks), sr)
    return marks


def speaker_at(marks, t: float):
    """Whose utterance covers time `t`, with a little tolerance at the edges."""
    for m in marks:
        if m["start"] - 0.4 <= t <= m["end"] + 0.2:
            return m["speaker"]
    return None


def main() -> int:
    from backend.pipeline import asr, speaker

    n_conv = int(sys.argv[1]) if len(sys.argv) > 1 else 10

    files = sorted(glob.glob(str(REPO / "data/datasets/RAVDESS/Actor_*/*.wav")))
    if not files:
        print("RAVDESS 클립이 없습니다.")
        return 1
    by_actor = defaultdict(lambda: defaultdict(list))
    for f in files:
        parts = Path(f).stem.split("-")
        by_actor[parts[6]][parts[4]].append(f)
    names = sorted(by_actor)

    WORK.mkdir(parents=True, exist_ok=True)
    rng = np.random.default_rng(0)
    rows = []
    tp = fp = fn = tn = buried = total_changes = 0

    for c in range(n_conv):
        pair = list(rng.choice(names, 2, replace=False))
        path = WORK / f"conv_{c:02d}.wav"
        marks = build_conversation(by_actor, pair, rng, path)
        truth_changes = [
            m["start"] for p, m in zip(marks, marks[1:])
            if p["speaker"] != m["speaker"]
        ]
        total_changes += len(truth_changes)

        tr = asr.transcribe(str(path), model_size="small")
        tracker = speaker.TurnTracker()
        prev_speaker = None
        for seg in tr.segments:
            dur = seg.end - seg.start
            if dur < 0.1:
                continue
            import soundfile as sf

            audio, sr = sf.read(str(path), dtype="float32", always_2d=False)
            if audio.ndim > 1:
                audio = audio.mean(axis=1)
            piece = audio[int(seg.start * sr): int(seg.end * sr)]
            turn = tracker.update(piece, sr, dur)

            who = speaker_at(marks, (seg.start + seg.end) / 2)
            # A change hidden INSIDE a segment can never be marked; counted
            # separately so the limitation is measured rather than assumed.
            buried += sum(
                1 for ch in truth_changes if seg.start + 0.3 < ch < seg.end - 0.3
            )
            expected = prev_speaker is not None and who is not None and who != prev_speaker
            got = bool(turn.changed)
            if prev_speaker is not None and who is not None:
                if expected and got: tp += 1
                elif not expected and got: fp += 1
                elif expected and not got: fn += 1
                else: tn += 1
            rows.append({
                "conversation": c, "t": round(seg.start, 2),
                "true_speaker": who, "expected_change": int(expected),
                "marked_change": int(got),
                "distance": round(turn.distance, 4) if turn.distance else "",
                "text": seg.text.strip()[:40],
            })
            if who is not None:
                prev_speaker = who
        path.unlink(missing_ok=True)
        print(f"  대화 {c+1}/{n_conv} 완료")

    survival = len(rows) / (n_conv * LINES_PER_CONVERSATION)
    print(f"\n전사 품질: 발화 {n_conv * LINES_PER_CONVERSATION}개 → 구간 {len(rows)}개 "
          f"({survival:.0%} 생존)")
    if survival < 0.9:
        print("  ⚠️ 상당수 발화가 구간으로 살아남지 못했습니다. 아래 수치는 "
              "화자 감지가 아니라 전사 누락을 반영합니다.")

    judged = tp + fp + fn + tn
    prec = tp / (tp + fp) if tp + fp else 0.0
    rec = tp / (tp + fn) if tp + fn else 0.0
    print(f"\n대화 {n_conv}개 · 판단 {judged}건")
    print(f"  정확도  {(tp+tn)/judged:.1%}" if judged else "")
    print(f"  정밀도  {prec:.1%}   (대시를 붙인 것 중 실제로 바뀐 비율)")
    print(f"  재현율  {rec:.1%}   (실제 전환 중 대시가 붙은 비율)")
    print(f"  잘못된 대시 {fp}건 · 놓친 대시 {fn}건")
    print(f"\n구간 내부에 묻힌 전환: {buried} / {total_changes}회 "
          f"({buried/total_changes:.0%})" if total_changes else "")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    with open(OUT, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0]))
        w.writeheader(); w.writerows(rows)
    print(f"\n저장 → {OUT.relative_to(REPO)}")
    print("\n⚠️ 발화 사이에 깨끗한 공백이 있는 대화입니다. 실제 드라마는 말이 겹치고 "
          "턴이 빨라 더 어려우므로 상한으로 해석해야 합니다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
