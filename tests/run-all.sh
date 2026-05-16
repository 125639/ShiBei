#!/usr/bin/env bash
# 统一测试入口: bash tests/run-all.sh
# 跑三组测试套并汇总:
#   1. tests/test-init.sh       — bash 纯函数单元测试
#   2. tests/test-init-e2e.sh   — 用预设 stdin 驱动 init.sh，断言 .env 内容
#   3. tests/test-seed.mjs      — node:test，覆盖 prisma/seed-helpers.mjs
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

if [ -t 1 ]; then
  RED=$'\033[0;31m'; GRN=$'\033[0;32m'; CYA=$'\033[0;36m'; BLD=$'\033[1m'; NC=$'\033[0m'
else
  RED=""; GRN=""; CYA=""; BLD=""; NC=""
fi

failures=()

run_suite() {
  local label="$1"; shift
  echo
  printf "${CYA}${BLD}▶ %s${NC}\n" "$label"
  echo "─────────────────────────────────────────────"
  if "$@"; then
    printf "${GRN}✓ %s passed${NC}\n" "$label"
  else
    printf "${RED}✗ %s failed${NC}\n" "$label"
    failures+=("$label")
  fi
}

run_suite "bash unit tests"      bash "$SCRIPT_DIR/test-init.sh"
run_suite "bash e2e tests"       bash "$SCRIPT_DIR/test-init-e2e.sh"
run_suite "bootstrap.sh syntax"  bash -n "$PROJECT_DIR/scripts/bootstrap.sh"
run_suite "init.sh syntax"       bash -n "$PROJECT_DIR/scripts/init.sh"
run_suite "node seed-helpers"    bash -c "cd '$PROJECT_DIR' && node --test tests/test-seed.mjs"
run_suite "node seed integration" bash -c "cd '$PROJECT_DIR' && [ -d node_modules/bcryptjs ] && node --test tests/test-seed-integration.mjs || echo '  (skipped: bcryptjs not installed; run npm i bcryptjs)'"
run_suite "article image cache" bash -c "cd '$PROJECT_DIR' && npx tsx --test tests/test-article-image-cache.ts"
run_suite "article image mounting" bash -c "cd '$PROJECT_DIR' && npx tsx --test tests/test-article-images.ts"
run_suite "content style prompts" bash -c "cd '$PROJECT_DIR' && npx tsx --test tests/test-content-style.ts"
run_suite "video policy + default sources" bash -c "cd '$PROJECT_DIR' && npx tsx --test tests/test-video-policy.ts"

echo
echo "============================================="
if [ "${#failures[@]}" -eq 0 ]; then
  printf "${GRN}${BLD}All suites passed${NC}\n"
  exit 0
else
  printf "${RED}${BLD}%d suite(s) failed:${NC} %s\n" "${#failures[@]}" "${failures[*]}"
  exit 1
fi
