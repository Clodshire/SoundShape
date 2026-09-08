#!/usr/bin/env bash
# Overnight runner: P2 (Korean ablation) → P3 (embedding swap), in order.
# Wraps itself in caffeinate so the Mac stays awake for the whole run.
# NOTE: keep the lid OPEN and the charger plugged in — caffeinate cannot
# prevent lid-close sleep.
#
#   bash scripts/run_experiments.sh
#
# Both scripts checkpoint incrementally, so if anything dies overnight,
# re-running this resumes instead of starting over.

set -u

if [[ "${1:-}" != "--caffeinated" ]]; then
    exec caffeinate -is "$0" --caffeinated
fi

PY=/Users/birdhouse/.soundshape_venv/bin/python
cd "$(dirname "$0")/.."
mkdir -p results
LOG="results/overnight_$(date +%Y%m%d_%H%M).log"

run() {
    local name="$1"; shift
    echo "===== [$name] start $(date '+%F %T') =====" | tee -a "$LOG"
    "$@" 2>&1 | tee -a "$LOG"
    local rc=${PIPESTATUS[0]}
    echo "===== [$name] exit $rc $(date '+%F %T') =====" | tee -a "$LOG"
    return "$rc"
}

# P2 — ablation (already complete → resumes/reprints in seconds)
run "P2 ablation" "$PY" scripts/ablation_korean.py
p2=$?

# P3 — embedding swap (runs even if P2 failed; they're independent)
run "P3 embedding swap" "$PY" scripts/embedding_swap_ko.py
p3=$?

echo "===== DONE: P2 exit $p2, P3 exit $p3 — log: $LOG ====="| tee -a "$LOG"
exit $(( p2 || p3 ))
