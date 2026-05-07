#!/usr/bin/env bash
# =============================================================================
# 🐚 ShiBei (拾贝) Init Wizard
#
# 用法: bash scripts/init.sh
# 风格参考: openclaw.ai/install.sh （RGB 配色、Install Plan、ui_celebrate）
# =============================================================================
set -euo pipefail

# ---------- Brand colors (RGB true-color，参考 OpenClaw) ----------------------
if [ -t 1 ] && [ "${NO_COLOR:-}" = "" ]; then
  BOLD=$'\033[1m'
  DIM=$'\033[2m'
  ACCENT=$'\033[38;2;14;165;233m'        # sky-500   #0ea5e9 — 拾贝主色
  ACCENT_BRIGHT=$'\033[38;2;56;189;248m' # sky-400   #38bdf8
  SUCCESS=$'\033[38;2;16;185;129m'       # emerald-500 #10b981
  INFO=$'\033[38;2;100;116;139m'         # slate-500 #64748b
  WARN=$'\033[38;2;245;158;11m'          # amber-500 #f59e0b
  ERROR=$'\033[38;2;239;68;68m'          # red-500   #ef4444
  MUTED=$'\033[38;2;148;163;184m'        # slate-400 #94a3b8
  NC=$'\033[0m'
else
  BOLD=""; DIM=""; ACCENT=""; ACCENT_BRIGHT=""; SUCCESS=""; INFO=""; WARN=""; ERROR=""; MUTED=""; NC=""
fi

# ---------- UI helpers (镜像 OpenClaw 的 ui_*) -------------------------------
ui_info()    { printf "${MUTED}·${NC} %s\n" "$*"; }
ui_success() { printf "${SUCCESS}✓${NC} %s\n" "$*"; }
ui_warn()    { printf "${WARN}!${NC} %s\n" "$*"; }
ui_error()   { printf "${ERROR}✗${NC} %s\n" "$*"; }

ui_section() {
  printf "\n${ACCENT}${BOLD}%s${NC}\n" "$*"
}

ui_kv() {
  # ui_kv "key" "value"
  printf "${MUTED}%-22s${NC} ${BOLD}%s${NC}\n" "$1" "$2"
}

ui_kv_secret() {
  printf "${MUTED}%-22s${NC} ${BOLD}%s${NC}${MUTED}…(hidden)${NC}\n" "$1" "${2:0:8}"
}

ui_panel() {
  # 单行加圆角边框
  local content="$1"
  printf "${MUTED}╭─────────────────────────────────────────────────────────╮${NC}\n"
  printf "${MUTED}│${NC} %s ${MUTED}│${NC}\n" "$content"
  printf "${MUTED}╰─────────────────────────────────────────────────────────╯${NC}\n"
}

ui_celebrate() {
  printf "${SUCCESS}${BOLD}%s${NC}\n" "$*"
}

INSTALL_STAGE_TOTAL=6
INSTALL_STAGE_CURRENT=0
ui_stage() {
  INSTALL_STAGE_CURRENT=$((INSTALL_STAGE_CURRENT + 1))
  ui_section "[${INSTALL_STAGE_CURRENT}/${INSTALL_STAGE_TOTAL}] $*"
}

print_installer_banner() {
  echo
  printf "${ACCENT}${BOLD}  🐚 ShiBei Init Wizard${NC}\n"
  printf "${MUTED}     抓取 → AI 整理 → 审核发布；单机 / 前后端分离均可一键起步${NC}\n"
  printf "${DIM}${MUTED}     modern setup mode${NC}\n"
  echo
}

# ---------- Prompts -----------------------------------------------------------
ask_default() {
  local __var="$1" prompt="$2" default="$3" reply
  if [ -n "$default" ]; then
    printf "  %s ${MUTED}[%s]${NC}: " "$prompt" "$default"
  else
    printf "  %s: " "$prompt"
  fi
  if ! read -r reply; then
    _attach_tty_or_fail
    read -r reply || reply=""
  fi
  [ -z "$reply" ] && reply="$default"
  printf -v "$__var" '%s' "$reply"
}

ask_secret() {
  local __var="$1" prompt="$2" reply
  printf "  %s ${MUTED}(不回显，回车跳过)${NC}: " "$prompt"
  stty -echo 2>/dev/null || true
  if ! read -r reply; then
    _attach_tty_or_fail
    read -r reply || reply=""
  fi
  stty echo 2>/dev/null || true
  echo
  printf -v "$__var" '%s' "$reply"
}

# 当 stdin 提早 EOF（典型场景: curl ... | bash 启动子进程，子进程继承的
# stdin 是已关闭的 curl 管道）时，把整条进程的 fd 0 一次性接到真实终端，
# 之后所有 read 都从 /dev/tty 读。SHIBEI_TTY_DEV 留给单元测试覆盖。
_attach_tty_or_fail() {
  if [ "${_TTY_ATTACHED:-0}" = "1" ]; then return 0; fi
  local tty_dev="${SHIBEI_TTY_DEV:-/dev/tty}"
  if [ -r "$tty_dev" ]; then
    exec <"$tty_dev"
    _TTY_ATTACHED=1
  fi
}

# ---------- Random / detection ------------------------------------------------
rand_hex() {
  local bytes="${1:-32}"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$bytes"
  elif [ -r /dev/urandom ] && command -v xxd >/dev/null 2>&1; then
    head -c "$bytes" /dev/urandom | xxd -p -c "$((bytes*2))"
  elif [ -r /dev/urandom ] && command -v od >/dev/null 2>&1; then
    head -c "$bytes" /dev/urandom | od -An -tx1 | tr -d ' \n'
  else
    ui_error "找不到 openssl / xxd / od，无法生成随机密钥"; exit 1
  fi
}

rand_password() {
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 24 | tr -dc 'A-Za-z0-9' | head -c 16
  else
    head -c 64 /dev/urandom | tr -dc 'A-Za-z0-9' | head -c 16
  fi
  echo
}

detect_ip() {
  local ip=""
  if command -v ip >/dev/null 2>&1; then
    ip="$(ip route get 1.1.1.1 2>/dev/null | awk '{for(i=1;i<=NF;i++) if($i=="src"){print $(i+1); exit}}')"
  fi
  if [ -z "$ip" ] && command -v hostname >/dev/null 2>&1; then
    ip="$(hostname -I 2>/dev/null | awk '{print $1}')"
  fi
  if [ -z "$ip" ] && command -v ifconfig >/dev/null 2>&1; then
    ip="$(ifconfig 2>/dev/null | awk '/inet /{print $2; exit}')"
  fi
  echo "${ip:-127.0.0.1}"
}

detect_os() {
  case "$(uname -s 2>/dev/null || true)" in
    Darwin) echo "macos" ;;
    Linux)  echo "linux" ;;
    *)      echo "unknown" ;;
  esac
}

escape_dq() { printf '%s' "${1//\"/\\\"}"; }

# ---------- 主流程（包进函数以便单元测试 source 该文件时不触发） --------------
_run_wizard() {
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$PROJECT_DIR/.env"
ENV_EXAMPLE="$PROJECT_DIR/.env.example"

clear || true
print_installer_banner

OS="$(detect_os)"
ui_success "Detected: $OS"

if [ ! -f "$ENV_EXAMPLE" ]; then
  ui_error "找不到 $ENV_EXAMPLE，请在项目根目录运行该脚本。"
  exit 1
fi

if [ -f "$ENV_FILE" ]; then
  ui_warn ".env 已存在。"
  ask_default OVERWRITE "覆盖现有 .env？(y/N)" "n"
  case "$OVERWRITE" in
    y|Y|yes|YES)
      backup="$ENV_FILE.bak.$(date +%Y%m%d-%H%M%S)"
      cp "$ENV_FILE" "$backup"
      ui_success "已备份到 $(basename "$backup")"
      ;;
    *)
      ui_info "已取消。如需修改请直接编辑 .env 或先删除它。"
      exit 0
      ;;
  esac
fi

# ---------- [1/6] 部署模式 ---------------------------------------------------
ui_stage "选择部署模式"
cat <<MODES
  ${BOLD}1)${NC} 完整版 ${MUTED}(full)${NC}       单机自给自足，最常用；含 worker / Playwright / yt-dlp
  ${BOLD}2)${NC} 后端  ${MUTED}(backend)${NC}    只做抓取/AI/调度，给 frontend 提供数据
  ${BOLD}3)${NC} 前端  ${MUTED}(frontend)${NC}   只做展示和同步，AI 透明转发到 backend
MODES
ask_default MODE_CHOICE "选择 [1-3]" "1"
case "$MODE_CHOICE" in
  1|full)     APP_MODE="full" ;;
  2|backend)  APP_MODE="backend" ;;
  3|frontend) APP_MODE="frontend" ;;
  *) APP_MODE="full"; ui_warn "未识别的选项，默认 full。" ;;
esac
ui_success "APP_MODE = ${BOLD}${APP_MODE}${NC}"

# ---------- [2/6] 站点 URL ---------------------------------------------------
ui_stage "公开访问地址 (NEXT_PUBLIC_SITE_URL)"
DETECTED_IP="$(detect_ip)"
DEFAULT_URL="http://${DETECTED_IP}:3000"
ui_info "检测到本机 IP：${BOLD}${DETECTED_IP}${NC}"
ui_info "正式部署建议改为带 HTTPS 的域名（如 https://shibei.example.com）"
ask_default SITE_URL "站点 URL" "$DEFAULT_URL"
ui_success "NEXT_PUBLIC_SITE_URL = $SITE_URL"

# ---------- [3/6] 管理员账号 -------------------------------------------------
ui_stage "管理员账号"
ask_default ADMIN_USERNAME "用户名" "admin"
ask_secret ADMIN_PASSWORD "密码（留空自动生成 16 位强密码）"
if [ -z "$ADMIN_PASSWORD" ]; then
  ADMIN_PASSWORD="$(rand_password)"
  ui_success "自动生成密码：${BOLD}${ADMIN_PASSWORD}${NC}  ${WARN}（请立即记录！）${NC}"
else
  ui_success "密码已设置（隐藏）"
fi

# ---------- [4/6] 安全密钥 ---------------------------------------------------
ui_stage "安全密钥（自动生成）"
AUTH_SECRET="$(rand_hex 32)"
ENCRYPTION_KEY="$(rand_hex 32)"
SYNC_TOKEN="$(rand_hex 32)"
ui_success "AUTH_SECRET     已生成 ${MUTED}(${AUTH_SECRET:0:12}…)${NC}"
ui_success "ENCRYPTION_KEY  已生成 ${MUTED}(${ENCRYPTION_KEY:0:12}…)${NC}"
if [ "$APP_MODE" != "full" ]; then
  ui_success "SYNC_TOKEN      已生成 ${MUTED}(${SYNC_TOKEN:0:12}…)${NC}  ${WARN}两台机器必须填同一串${NC}"
else
  ui_info "完整版预生成 SYNC_TOKEN 以备将来扩展（不影响单机）。"
fi

# ---------- [5/6] 同步 / AI 模型 ---------------------------------------------
BACKEND_API_URL=""
SYNC_MODE="auto"
SYNC_INTERVAL_MINUTES="15"
INIT_AI_PROVIDER=""
INIT_AI_NAME=""
INIT_AI_BASE_URL=""
INIT_AI_MODEL=""
INIT_AI_API_KEY=""

if [ "$APP_MODE" = "frontend" ]; then
  ui_stage "前端 → 后端 同步参数"
  ui_info "也可以现在留空，启动后在 /admin/sync 网页端填写。"
  ask_default BACKEND_API_URL "Backend 入口 URL" "https://api.example.com"
  ask_default SYNC_MODE "同步模式 (auto/manual)" "auto"
  ask_default SYNC_INTERVAL_MINUTES "自动拉取间隔（分钟）" "15"
else
  ui_stage "默认 AI 模型 (可选)"
  ui_info "留空可启动后在 /admin/settings 网页配置；选定后会在首次 db:seed 写入。"
  cat <<AIMODELS
  ${BOLD}1)${NC} CanopyWave    ${MUTED}(Kimi K2.6)         国内代理 / 长上下文${NC}
  ${BOLD}2)${NC} OpenAI        ${MUTED}(gpt-4o-mini)       通用首选${NC}
  ${BOLD}3)${NC} DeepSeek      ${MUTED}(deepseek-chat)     中文长文本性价比${NC}
  ${BOLD}4)${NC} Moonshot      ${MUTED}(moonshot-v1-32k)   长上下文中文${NC}
  ${BOLD}5)${NC} 通义千问       ${MUTED}(qwen-plus)         国内部署友好${NC}
  ${BOLD}6)${NC} SiliconFlow   ${MUTED}(DeepSeek-V3)       聚合多模型${NC}
  ${BOLD}7)${NC} OpenRouter    ${MUTED}(gpt-4o-mini)       多模型路由${NC}
  ${BOLD}8)${NC} 自定义         ${MUTED}OpenAI 兼容服务${NC}
  ${BOLD}s)${NC} 跳过           ${MUTED}启动后再配置（默认）${NC}
AIMODELS
  ask_default AI_CHOICE "选择 [1-8/s]" "s"
  case "$AI_CHOICE" in
    1) INIT_AI_PROVIDER="canopywave"; INIT_AI_NAME="CanopyWave Kimi";  INIT_AI_BASE_URL="https://inference.canopywave.io/v1";          INIT_AI_MODEL="moonshotai/kimi-k2.6" ;;
    2) INIT_AI_PROVIDER="openai";     INIT_AI_NAME="OpenAI GPT-4o mini"; INIT_AI_BASE_URL="https://api.openai.com/v1";                  INIT_AI_MODEL="gpt-4o-mini" ;;
    3) INIT_AI_PROVIDER="deepseek";   INIT_AI_NAME="DeepSeek Chat";    INIT_AI_BASE_URL="https://api.deepseek.com/v1";                  INIT_AI_MODEL="deepseek-chat" ;;
    4) INIT_AI_PROVIDER="moonshot";   INIT_AI_NAME="Moonshot 32k";     INIT_AI_BASE_URL="https://api.moonshot.cn/v1";                   INIT_AI_MODEL="moonshot-v1-32k" ;;
    5) INIT_AI_PROVIDER="qwen";       INIT_AI_NAME="通义千问 Plus";    INIT_AI_BASE_URL="https://dashscope.aliyuncs.com/compatible-mode/v1"; INIT_AI_MODEL="qwen-plus" ;;
    6) INIT_AI_PROVIDER="siliconflow";INIT_AI_NAME="SiliconFlow DSv3"; INIT_AI_BASE_URL="https://api.siliconflow.cn/v1";                 INIT_AI_MODEL="deepseek-ai/DeepSeek-V3" ;;
    7) INIT_AI_PROVIDER="openrouter"; INIT_AI_NAME="OpenRouter";       INIT_AI_BASE_URL="https://openrouter.ai/api/v1";                 INIT_AI_MODEL="openai/gpt-4o-mini" ;;
    8) INIT_AI_PROVIDER="custom"
       ask_default INIT_AI_NAME     "模型名称（展示用）" "自定义模型"
       ask_default INIT_AI_BASE_URL "Base URL"            "https://example.com/v1"
       ask_default INIT_AI_MODEL    "模型 ID"             "your-model-name" ;;
    *) ui_info "已跳过 AI 模型配置，可在 /admin/settings 网页端添加。" ;;
  esac
  if [ -n "$INIT_AI_PROVIDER" ]; then
    ask_secret INIT_AI_API_KEY "API Key（留空可稍后在网页填）"
    if [ -z "$INIT_AI_API_KEY" ]; then
      ui_warn "未填写 API Key；首次启动后请到 /admin/settings 修改。"
    else
      ui_success "API Key 已记录（首次 db:seed 时写入并加密存储）"
    fi
  fi
fi

# ---------- [6/6] Install Plan + 写入 ---------------------------------------
ui_stage "Install Plan"
ui_kv "OS"                    "$OS"
ui_kv "APP_MODE"              "$APP_MODE"
ui_kv "NEXT_PUBLIC_SITE_URL"  "$SITE_URL"
ui_kv "ADMIN_USERNAME"        "$ADMIN_USERNAME"
ui_kv "ADMIN_PASSWORD"        "$ADMIN_PASSWORD"
ui_kv_secret "AUTH_SECRET"    "$AUTH_SECRET"
ui_kv_secret "ENCRYPTION_KEY" "$ENCRYPTION_KEY"
if [ "$APP_MODE" != "full" ]; then
  ui_kv_secret "SYNC_TOKEN"   "$SYNC_TOKEN"
fi
if [ "$APP_MODE" = "frontend" ]; then
  ui_kv "BACKEND_API_URL"     "${BACKEND_API_URL:-(留空，启动后到 /admin/sync 填)}"
  ui_kv "SYNC_MODE"           "$SYNC_MODE"
  ui_kv "SYNC_INTERVAL_MINUTES" "$SYNC_INTERVAL_MINUTES"
fi
if [ -n "$INIT_AI_PROVIDER" ]; then
  ui_kv "AI 默认模型"          "$INIT_AI_NAME ($INIT_AI_PROVIDER)"
fi

echo
ask_default CONFIRM "确认写入？(Y/n)" "y"
case "$CONFIRM" in
  n|N|no|NO) ui_info "已取消，未写入 .env。"; exit 0 ;;
esac

cat > "$ENV_FILE" <<EOF
# =============================================================================
# 🐚 ShiBei (拾贝) — 由 scripts/init.sh 在 $(date '+%Y-%m-%d %H:%M:%S') 自动生成
# 重新生成请运行: bash scripts/init.sh
# =============================================================================

# --- 数据库与缓存（compose 默认值，单机部署不要改）-----------------------------
DATABASE_URL="postgresql://shibei:shibei@postgres:5432/shibei_blog?schema=public"
REDIS_URL="redis://redis:6379"

# --- 安全密钥（init.sh 自动生成，长度 64 hex）---------------------------------
# 改 ENCRYPTION_KEY 会让已加密的 AI Key 失效，需要在 /admin/settings 重填。
AUTH_SECRET="$(escape_dq "$AUTH_SECRET")"
ENCRYPTION_KEY="$(escape_dq "$ENCRYPTION_KEY")"

# --- 公开访问 URL（影响 cookie secure 标志）-----------------------------------
NEXT_PUBLIC_SITE_URL="$(escape_dq "$SITE_URL")"

# --- 初始管理员账号（首次启动 seed 时写入；登录后请到 /admin/settings 改密码）---
ADMIN_USERNAME="$(escape_dq "$ADMIN_USERNAME")"
ADMIN_PASSWORD="$(escape_dq "$ADMIN_PASSWORD")"

# --- 部署形态：full / frontend / backend ------------------------------------
APP_MODE="$APP_MODE"

# --- 跨服务器同步参数（前后端分离才需要）-----------------------------------
SYNC_MODE="$SYNC_MODE"
SYNC_INTERVAL_MINUTES="$SYNC_INTERVAL_MINUTES"
BACKEND_API_URL="$(escape_dq "$BACKEND_API_URL")"
# 前后端共用密钥；另一台机器的 .env 必须填同一串
SYNC_TOKEN="$(escape_dq "$SYNC_TOKEN")"
EOF

if [ -n "$INIT_AI_PROVIDER" ]; then
  cat >> "$ENV_FILE" <<EOF

# =============================================================================
# 首次启动 AI 模型 seed（仅 db:seed 第一次会读取；之后请到 /admin/settings 维护）
# =============================================================================
INIT_AI_PROVIDER="$(escape_dq "$INIT_AI_PROVIDER")"
INIT_AI_NAME="$(escape_dq "$INIT_AI_NAME")"
INIT_AI_BASE_URL="$(escape_dq "$INIT_AI_BASE_URL")"
INIT_AI_MODEL="$(escape_dq "$INIT_AI_MODEL")"
INIT_AI_API_KEY="$(escape_dq "$INIT_AI_API_KEY")"
EOF
fi

chmod 600 "$ENV_FILE" 2>/dev/null || true
ui_success ".env 已写入：$ENV_FILE"

# ---------- 启动 docker compose（可跳过）-------------------------------------
# 选择对应模式的 compose 参数。后续 ui_section "Next steps" 也复用。
case "$APP_MODE" in
  full)     COMPOSE_ARGS=() ;;
  backend)  COMPOSE_ARGS=(-f docker-compose.backend.yml) ;;
  frontend) COMPOSE_ARGS=(-f docker-compose.frontend.yml) ;;
esac
COMPOSE_CMD_DISPLAY="docker compose"
if [ "${#COMPOSE_ARGS[@]}" -gt 0 ]; then
  COMPOSE_CMD_DISPLAY="docker compose ${COMPOSE_ARGS[*]}"
fi

# SHIBEI_AUTO_START=y/n 用于非交互场景与单元测试；空值走交互提问。
AUTO_START="${SHIBEI_AUTO_START:-}"
if [ -z "$AUTO_START" ]; then
  echo
  ask_default AUTO_START "现在用 ${COMPOSE_CMD_DISPLAY} up -d 启动？(Y/n)" "y"
fi

case "$AUTO_START" in
  n|N|no|NO|0|false)
    AUTO_STARTED=0
    ;;
  *)
    if ! command -v docker >/dev/null 2>&1; then
      ui_warn "未检测到 docker；请先安装后手动运行启动命令（见下方）。"
      AUTO_STARTED=0
    else
      echo
      ui_info "切到 $PROJECT_DIR 并运行 ${COMPOSE_CMD_DISPLAY} up -d ..."
      if (cd "$PROJECT_DIR" && docker compose "${COMPOSE_ARGS[@]}" up -d); then
        AUTO_STARTED=1
        echo
        ui_success "容器已启动；用 ${COMPOSE_CMD_DISPLAY} ps 看状态、logs -f 看日志。"
      else
        AUTO_STARTED=0
        echo
        ui_error "${COMPOSE_CMD_DISPLAY} up -d 退出非零；请按上方报错排查后手动重试。"
      fi
    fi
    ;;
esac

# ---------- 庆祝 + 后续命令 ---------------------------------------------------
echo
ui_celebrate "🎉 Setup complete!"
echo
ui_section "Next steps"
if [ "${AUTO_STARTED:-0}" = "1" ]; then
  printf "  ${BOLD}已启动${NC}（${MUTED}%s up -d 已自动执行${NC}）\n" "$COMPOSE_CMD_DISPLAY"
else
  # 没自动起：完整把 cd + 启动一行写出来，避免用户在错误目录里跑 docker compose。
  printf "  ${BOLD}启动：${NC}cd %s && %s up -d\n" "$PROJECT_DIR" "$COMPOSE_CMD_DISPLAY"
fi
printf "  ${BOLD}健康检查：${NC}curl ${SITE_URL%/}/api/health\n"
printf "  ${BOLD}管理后台：${NC}${ACCENT_BRIGHT}${SITE_URL%/}/admin${NC}\n"
printf "  ${BOLD}登录账号：${NC}${ADMIN_USERNAME} / ${BOLD}${ADMIN_PASSWORD}${NC}\n"

if [ "$APP_MODE" = "backend" ]; then
  echo
  ui_warn "把另一台 frontend 服务器的 SYNC_TOKEN 填成同一串："
  printf "    ${MUTED}%s${NC}\n" "$SYNC_TOKEN"
fi
if [ "$APP_MODE" != "frontend" ] && [ -z "$INIT_AI_PROVIDER" ]; then
  echo
  ui_info "还没配置 AI 模型，登录后到 ${ACCENT_BRIGHT}/admin/settings${NC} 添加。"
fi

echo
ui_panel "Need help? FAQ → README.md#常见问题排查清单"
}

# 直接执行该脚本时才跑向导；被 source 时只暴露函数定义，方便单元测试。
# `return 0` 在被 source 的上下文里成功，直接执行时报错——这是 bash 里区分两者
# 最可靠的方式（比 BASH_SOURCE 比较还稳，能正确处理 `curl … | bash` 这种情况）。
if ! (return 0 2>/dev/null); then
  _run_wizard
fi
