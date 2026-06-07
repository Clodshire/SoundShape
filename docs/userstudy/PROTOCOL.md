# SoundShape user study — facilitator protocol (Test C)

**Question we're answering:** *Do people understand a speaker's emotion better
with **captions + SoundShape** than with **captions alone** — when they can't
hear the audio?*

This simulates the deaf/hard-of-hearing experience (you watch with the **sound
off**). Running it with muted hearing participants (e.g. family) is an accepted
stand-in when deaf participants aren't available.

---

## What you need
- The SoundShape web app running (`npm run dev` → http://localhost:3000), backend on :8000.
- **8 short clips** (5–20 s each) with a known "true" emotion. Good mix:
  - 2–3 of your own recordings (incl. the "괜찮아" sincere vs. sarcastic pair),
  - 2–3 RAVDESS clips, 2–3 real clips. Fill them into `clips.csv`.
- 5+ participants (more is better). Family is fine.
- The two data files in this folder: `clips.csv` (you fill the answer key) and
  `responses.csv` (you record answers).

## The two conditions
- **A — Captions only:** in the app, **Captions ON**, **SoundShape OFF**.
- **B — Captions + SoundShape:** **Captions ON**, **SoundShape ON**.
- **In BOTH:** the **sound is OFF** (mute your Mac *and* the video).

## Design (counterbalanced, within-subject)
Every participant sees all 8 clips — **4 in condition A, 4 in condition B** — and
no clip twice. Which clips get which condition alternates by **form**:

| Form | Clips 1–4 | Clips 5–8 |
|---|---|---|
| **Form 1** | B (SoundShape) | A (captions only) |
| **Form 2** | A (captions only) | B (SoundShape) |

Give **Participant 1 → Form 1, Participant 2 → Form 2, Participant 3 → Form 1**,
and so on (alternate). This balances each clip across both conditions and cancels
out "some clips are just easier."

---

## Step by step (per participant, ~15 min)

1. **Setup:** mute everything. Open the app. Have `responses.csv` open to record.
2. **Intro (read aloud):**
   > "You'll watch 8 short clips with the **sound off**. Captions show the words.
   > For some clips you'll also see a glowing shape that represents the
   > speaker's emotion. After each clip, tell me what emotion you think the
   > speaker is feeling, and how sure you are."
3. **Brief SoundShape primer (15 s, once):** before their first **B** clip, open
   the app's **Legend** and say: *"Shape = emotion, color = feeling, more
   movement/brightness = stronger."* (We test whether the language *works once
   shown* — note this is a controlled step.)
4. **For each clip (in the participant's form order):**
   - Set the toggles for that clip's condition (A or B). Sound off. Play once.
   - Ask **Q1 (emotion):** "What emotion is the speaker feeling?"
     → forced choice: **happy / sad / angry / afraid / surprised / neutral**
   - If the clip is marked `incongruent=yes` in `clips.csv`, also ask
     **Q2 (tone):** "Sincere or sarcastic?"
   - Ask **Q3 (confidence):** "How sure, 1 (guess) to 5 (certain)?"
   - Record one row in `responses.csv`:
     `participant_id, form, clip_id, condition, chosen_emotion, tone, confidence`
5. Thank them. Next participant → next form.

## Tips for clean data
- Don't react or hint at the right answer.
- Same single play-through for every clip/participant.
- Keep the clip order fixed within a form (only the *condition* differs by form).
- Aim for ≥ 5 participants → ≥ 40 responses (20 per condition).

## When done
Run the analysis:
```bash
~/.soundshape_venv/bin/python scripts/analyze_userstudy.py
```
It reads `clips.csv` + `responses.csv`, scores each answer against the true
emotion, and reports **accuracy with vs. without SoundShape** (+ a significance
test and a chart in `docs/eval/`). That difference is your headline result.
