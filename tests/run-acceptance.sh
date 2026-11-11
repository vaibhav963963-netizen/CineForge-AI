#!/bin/bash
# Full acceptance sequence (GPU-bound, ~70 min). Every step writes its own evidence file under logs/; this log
# (logs/tests/acceptance-<ts>.log) records the sequence. Needs the studio server running (STUDIO_URL).
#   bash tests/run-acceptance.sh
cd "$(dirname "$0")/.."
export STUDIO_URL="${STUDIO_URL:-http://127.0.0.1:3200}"
TS=$(date +%Y%m%d-%H%M%S); LOG="logs/tests/acceptance-$TS.log"; mkdir -p logs/tests
say() { echo "[$(date +%T)] $*" | tee -a "$LOG"; }
step() { say "▶ $1"; shift; "$@" 2>&1 | grep -v '@@PROGRESS' | tee -a "$LOG"; say "◀ exit ${PIPESTATUS[0]}"; }

step "unit tests" node --test tests/unit.test.mjs
step "ComfyUI benchmark (lean vs hi-res, VRAM)" node tools/benchmark-comfy.mjs
step "Part 9: unsupported combinations + TEST A/B/C with LLM-written scripts (procedural)" node tests/e2e-run.mjs cases UNSUPPORTED A B C --source llm
# hybrid production run with the offline audit watching the network of every studio process
say "▶ Part 5/10: TEST A/B/C hybrid (local AI images) + offline network audit"
node tools/offline-audit.mjs all --url "$STUDIO_URL" > logs/tests/offline-audit-$TS.out 2>&1 &
AUDIT=$!
HYBRID=1 node tests/e2e-run.mjs cases A B C --source llm 2>&1 | grep -v '@@PROGRESS' | tee -a "$LOG"
say "◀ hybrid exit ${PIPESTATUS[0]}"
touch logs/benchmarks/.audit-stop; wait $AUDIT; cat logs/tests/offline-audit-$TS.out | tee -a "$LOG"
step "Part 10: progress acceptance" node tests/e2e-run.mjs progress
say "ACCEPTANCE SEQUENCE FINISHED · evidence in logs/tests and logs/benchmarks"
