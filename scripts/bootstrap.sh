#!/usr/bin/env bash
# =============================================================================
# 🐚 ShiBei (拾贝) — 远程一键引导
#
# 用法（无需先克隆仓库）:
#   curl -fsSL https://raw.githubusercontent.com/125639/ShellPick/main/scripts/bootstrap.sh | bash
#
# 风格参考: openclaw.ai/install.sh
# 流程: 检查依赖 → git clone → cd → bash scripts/init.sh
# =============================================================================
set -euo pipefail

# ---------- Brand colors -----------------------------------------------------
if [ -t 1 ] && [ "${NO_COLOR:-}" = "" ]; then
  BOLD=$'\033[1m'
  ACCENT=$'\033[38;2;14;165;233m'
  SUCCESS=$'\033[38;2;16;185;129m'
  WARN=$'\033[38;2;245;158;11m'
  ERROR=$'\033[38;2;239;68;68m'
  MUTED=$'\033[38;2;148;163;184m'
  NC=$'\033[0m'
else
  BOLD=""; ACCENT=""; SUCCESS=""; WARN=""; ERROR=""; MUTED=""; NC=""
fi

ui_info()    { printf "${MUTED}·${NC} %s\n" "$*"; }
ui_success() { printf "${SUCCESS}✓${NC} %s\n" "$*"; }
ui_warn()    { printf "${WARN}!${NC} %s\n" "$*"; }
ui_error()   { printf "${ERROR}✗${NC} %s\n" "$*"; }

REPO="${SHIBEI_REPO:-https://github.com/125639/ShellPick.git}"
BRANCH="${SHIBEI_BRANCH:-main}"
TARGET="${SHIBEI_DIR:-$HOME/ShellPick}"

echo
printf "${ACCENT}${BOLD}  🐚 ShiBei Bootstrap${NC}\n"
printf "${MUTED}     抓取 → AI 整理 → 审核发布${NC}\n"
echo

# ---------- 依赖检查 ----------------------------------------------------------
need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    ui_error "缺少依赖: $1。请先安装后重试。"
    exit 1
  fi
}
need git
need bash

if ! command -v openssl >/dev/null 2>&1; then
  ui_warn "未检测到 openssl；init.sh 会回退到 /dev/urandom。"
fi
if ! command -v docker >/dev/null 2>&1; then
  ui_warn "未检测到 docker；安装完后请先安装 Docker + Compose 再启动。"
fi

# ---------- 克隆 / 更新 ------------------------------------------------------
if [ -d "$TARGET/.git" ]; then
  ui_info "已存在 $TARGET，拉取最新代码…"
  git -C "$TARGET" fetch --depth=1 origin "$BRANCH"
  git -C "$TARGET" checkout -q "$BRANCH"
  git -C "$TARGET" reset --hard "origin/$BRANCH"
  ui_success "更新到最新 $BRANCH"
else
  ui_info "克隆 $REPO → $TARGET"
  git clone --depth=1 -b "$BRANCH" "$REPO" "$TARGET"
  ui_success "克隆完成"
fi

cd "$TARGET"

# ---------- 调用 init.sh -----------------------------------------------------
if [ ! -x scripts/init.sh ]; then
  chmod +x scripts/init.sh 2>/dev/null || true
fi
exec bash scripts/init.sh
