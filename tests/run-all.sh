#!/usr/bin/env bash
# 统一测试入口: bash tests/run-all.sh
# 跑三组测试套并汇总:
#   1. tests/test-init.sh       — bash 纯函数单元测试
#   2. tests/test-init-e2e.sh   — 用预设 stdin 驱动 init.sh，断言 .env 内容
#   3. tests/test-seed.mjs      — node:test，覆盖 prisma/seed-helpers.mjs
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
TSX_CMD="node node_modules/tsx/dist/cli.mjs"

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
run_suite "article image cache" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-article-image-cache.ts"
run_suite "article image mounting" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-article-images.ts"
run_suite "content style prompts" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-content-style.ts"
run_suite "post title + summary derivation" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-post-derive.ts"
run_suite "AI publication policy" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-publication-policy.ts"
run_suite "queue artifact idempotency" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-job-artifact.ts"
run_suite "worker queue recovery" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-queue-recovery.ts"
run_suite "source quality gate" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-source-quality.ts"
run_suite "evidence claim consistency" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-evidence-claim-consistency.ts"
run_suite "topic classification" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-topic-classify.ts"
run_suite "content model benchmark" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-content-benchmark.ts"
run_suite "alarm schedule controls" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-alarm-schedule.ts"
run_suite "url safety" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-url-safety.ts"
run_suite "pinned browser + video egress" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-egress-security.ts"
run_suite "request origin + JSON security" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-request-security.ts"
run_suite "host-only auth cookie security" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-auth-cookies.ts"
run_suite "stable private-list pagination" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-list-pagination.ts"
run_suite "model configuration" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-model-config.ts"
run_suite "model outage failover" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-model-fallback.ts"
run_suite "sync limits" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-sync-limits.ts"
run_suite "trusted client IP boundary" bash -c "cd '$PROJECT_DIR' && node --test tests/test-trusted-client-ip.mjs"
run_suite "signed client IP handoff" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-client-ip.ts"
run_suite "video policy + default sources" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-video-policy.ts"
run_suite "media upload signatures" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-upload-signatures.ts"
run_suite "video display + distribution" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-video-display.ts"
run_suite "markdown embed security" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-markdown-security.ts"
run_suite "creation studio scoring" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-creation.ts"
run_suite "creation publication integrity" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-creation-integrity.ts"
run_suite "creation AI verification" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-creation-ai.ts"
run_suite "admin AI planning" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-admin-ai.ts"
run_suite "admin mode + credential safety" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-admin-safety.ts"
run_suite "invites + visit stats" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-invites-visits.ts"
run_suite "member credential security" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-member-credentials.ts"
run_suite "anonymous bootstrap security" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-anon-bootstrap.ts"
run_suite "writing docs ownership" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-writing-docs.ts"
run_suite "creation ownership security" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-ownership-security.ts"
run_suite "community moderation security" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-community-moderation.ts"
run_suite "writing client state" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-writing-client-state.ts"
run_suite "writing editor mutation guards" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-writing-editor-guards.ts"
run_suite "admin Markdown workspace" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-admin-markdown-editor.ts"
run_suite "AI post publication repair" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-post-repair.ts"
run_suite "signed internal cache revalidation" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-internal-revalidation.ts"
run_suite "task progress" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-task-progress.ts"
run_suite "manual writing handoff" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-manual-writing.ts"
run_suite "storage cleanup policy" bash -c "cd '$PROJECT_DIR' && $TSX_CMD --test tests/test-storage-cleanup.ts"

echo
echo "============================================="
if [ "${#failures[@]}" -eq 0 ]; then
  printf "${GRN}${BLD}All suites passed${NC}\n"
  exit 0
else
  printf "${RED}${BLD}%d suite(s) failed:${NC} %s\n" "${#failures[@]}" "${failures[*]}"
  exit 1
fi
