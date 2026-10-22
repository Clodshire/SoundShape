#!/bin/bash
# 발표 당일 더블클릭 한 번으로 시연 환경을 올린다.
#
# 심사위원 앞에서 터미널을 띄우지 않으려면 **판정 시작 10분 전에** 이걸 실행하고,
# 준비 완료가 뜨면 터미널을 ⌘H 로 숨기십시오.
#
# 하는 일
#   1. 3000·8000 포트에 남아 있는 서버를 정리
#   2. 백엔드 실행 — 뜰 때 모델을 미리 데운다 (첫 분석이 30초 걸리는 걸 막는다)
#   3. 프론트엔드를 **프로덕션 빌드로** 실행 (개발 배지가 화면에 안 찍힌다)
#   4. 백엔드가 준비될 때까지 기다렸다가 크롬에 시연용 탭 3개를 연다
#
# 행사장 와이파이가 끊겨도 1~4 는 전부 로컬이라 그대로 됩니다.

set -u
cd "$(dirname "$0")" || exit 1
REPO="$PWD"
VENV="$HOME/.soundshape_venv/bin"
LOG="$REPO/.시연로그"
mkdir -p "$LOG"

# 허깅페이스에 나가지 않는다. 모델은 전부 받아 둔 상태라 캐시로 뜨고, 와이파이가
# 나쁠 때 네트워크 타임아웃으로 멈추는 것을 막아 준다.
export HF_HUB_OFFLINE=1
export TRANSFORMERS_OFFLINE=1

say() { printf "\n\033[1m%s\033[0m\n" "$1"; }

say "1/4  남아 있는 서버 정리"
lsof -ti tcp:8000 | xargs kill -9 2>/dev/null
lsof -ti tcp:3000 | xargs kill -9 2>/dev/null
sleep 1

say "2/4  분석 서버 시작 (모델 예열 포함 — 30초쯤 걸립니다)"
# nohup + disown 으로 떼어 놓는다. 이렇게 해야 이 터미널 창을 닫아도 서버가
# 계속 떠 있다. 발표 중에 창을 잘못 닫는 사고는 한 번이면 충분하다.
nohup "$VENV/uvicorn" backend.api.main:app --port 8000 > "$LOG/backend.log" 2>&1 &
disown

say "3/4  웹사이트 시작"
# 빌드가 없거나, 소스가 빌드보다 새로우면 다시 빌드한다. 빌드가 낡은 채로
# 시연에 들어가면 화면이 어제 것이고, 무대에서는 그걸 알아챌 방법이 없다.
stale=0
[ -f "$REPO/frontend/.next/BUILD_ID" ] || stale=1
if [ "$stale" = 0 ]; then
  newer=$(find "$REPO/frontend/src" "$REPO/frontend/package.json" \
            -newer "$REPO/frontend/.next/BUILD_ID" -print -quit 2>/dev/null)
  [ -n "$newer" ] && stale=1
fi
if [ "$stale" = 1 ]; then
  echo "    빌드가 없거나 낡아서 다시 빌드합니다 (1분쯤)…"
  (cd "$REPO/frontend" && npm run build > "$LOG/build.log" 2>&1) \
    || { echo "    ❌ 빌드 실패 — $LOG/build.log 를 보십시오"; exit 1; }
fi
(cd "$REPO/frontend" && nohup npm run start > "$LOG/frontend.log" 2>&1) &
disown

# 시연에 쓰는 파일이 실제로 있는지 본다. 없으면 무대에서 빈 화면이 뜬다.
for f in demo1.mp4 demo1.srt demo2.mp4 demo2.srt; do
  [ -f "$REPO/frontend/public/stimuli/$f" ] || echo "    ⚠️  없음: stimuli/$f"
done

say "4/4  준비될 때까지 기다리는 중"
for i in $(seq 1 90); do
  front=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:3000/ 2>/dev/null)
  back=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8000/health 2>/dev/null)
  [ "$front" = "200" ] && [ "$back" = "200" ] && break
  printf "."
  sleep 1
done
echo

if [ "${back:-}" != "200" ]; then
  echo "    ⚠️  분석 서버가 안 떴습니다. $LOG/backend.log 를 보십시오."
  echo "       대본 시연(①②)은 분석 서버 없이도 됩니다. 그대로 진행하십시오."
fi

# 탭 순서가 곧 시연 순서다. ⌘1 ⌘2 ⌘3 으로만 움직이면 다른 창이 안 보인다.
open -a "Google Chrome" "http://localhost:3000/"
sleep 1
open -a "Google Chrome" "http://localhost:3000/?script=demo1"
sleep 1
open -a "Google Chrome" "http://localhost:3000/?script=demo2"

cat <<'EOF'

────────────────────────────────────────────────
 준비 완료

 이제 이 터미널 창을 ⌘H 로 숨기거나 그냥 닫으셔도 됩니다.
 서버는 떼어 놓았으므로 창을 닫아도 계속 떠 있습니다.

 크롬 탭        ⌘1 소개   ⌘2 데모 1 (변호사)   ⌘3 데모 2 (저금통)
 전체화면       ⌃⌘F  (메뉴 막대까지 사라집니다)
 끝낸 뒤 정리    터미널에서  lsof -ti tcp:3000 tcp:8000 | xargs kill
────────────────────────────────────────────────
EOF
