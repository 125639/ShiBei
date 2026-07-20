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

detect_public_ip() {
  local ip=""
  if command -v curl >/dev/null 2>&1; then
    # Cloud metadata is preferable to a third-party lookup and cannot be
    # influenced by DNS. Fall back to the routable interface address offline.
    ip="$(curl -fsS --max-time 2 -H 'Metadata-Flavor: Google' \
      'http://metadata.google.internal/computeMetadata/v1/instance/network-interfaces/0/access-configs/0/external-ip' \
      2>/dev/null || true)"
  fi
  if [[ ! "$ip" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
    ip="$(detect_ip)"
  fi
  printf '%s\n' "$ip"
}

detect_os() {
  case "$(uname -s 2>/dev/null || true)" in
    Darwin) echo "macos" ;;
    Linux)  echo "linux" ;;
    *)      echo "unknown" ;;
  esac
}

escape_dq() { printf '%s' "${1//\"/\\\"}"; }

is_secure_backend_url() {
  local value="${1%/}"
  local host=""
  [ -z "$value" ] && return 0
  is_public_url "$value" || return 1
  [[ "$value" == https://* ]] && return 0
  [[ "$value" =~ ^http://(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(:[0-9]+)?$ ]] || return 1
  host="${BASH_REMATCH[1]}"
  host="${host#[}"
  host="${host%]}"
  is_private_backend_host "$host"
}

is_private_backend_host() {
  local host="${1,,}"
  local a b c d
  if [ "$host" = "localhost" ] || [[ "$host" == *.localhost ]]; then
    return 0
  fi
  if [[ "$host" =~ ^([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})\.([0-9]{1,3})$ ]]; then
    a=$((10#${BASH_REMATCH[1]})); b=$((10#${BASH_REMATCH[2]}))
    c=$((10#${BASH_REMATCH[3]})); d=$((10#${BASH_REMATCH[4]}))
    ((a <= 255 && b <= 255 && c <= 255 && d <= 255)) || return 1
    ((a == 10 || a == 127)) && return 0
    ((a == 100 && b >= 64 && b <= 127)) && return 0
    ((a == 172 && b >= 16 && b <= 31)) && return 0
    ((a == 192 && b == 168)) && return 0
    return 1
  fi
  [ "$host" = "::1" ] && return 0
  [[ "$host" =~ ^f[cd][0-9a-f]{2}(:|$) ]] && return 0
  # Docker Compose service names and conventional LAN aliases are single-label.
  [[ "$host" =~ ^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$ ]]
}

is_public_url() {
  local value="${1%/}"
  local port=""
  # PUBLIC_URL is an origin, not a route: credentials, paths, queries and
  # fragments are deliberately rejected. Both HTTP (the default application
  # endpoint) and HTTPS (when the user supplies an external proxy) are valid.
  if [[ ! "$value" =~ ^https?://(\[[0-9A-Fa-f:.]+\]|[A-Za-z0-9.-]+)(:([0-9]+))?$ ]]; then
    return 1
  fi
  port="${BASH_REMATCH[3]:-}"
  [ -z "$port" ] || ((10#$port >= 1 && 10#$port <= 65535))
}

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

# ---------- [2/6] HTTP 服务 --------------------------------------------------
ui_stage "HTTP 服务与公开访问地址"
DETECTED_IP="$(detect_public_ip)"
APP_BIND_IP="0.0.0.0"
APP_PORT="3000"
TRUST_PROXY_HOPS="0"
DEFAULT_URL="http://${DETECTED_IP}:${APP_PORT}"
ui_info "应用默认在 ${BOLD}${APP_BIND_IP}:${APP_PORT}${NC} 提供 HTTP，不占用 80/443，也不管理证书。"
ui_info "以后使用 Nginx / Caddy / Traefik 配域名时，只需修改 PUBLIC_URL 并重启，无需重建镜像。"
ask_default PUBLIC_URL "公开访问 URL" "$DEFAULT_URL"
PUBLIC_URL="${PUBLIC_URL%/}"
if ! is_public_url "$PUBLIC_URL"; then
  ui_error "公开访问 URL 必须是无路径的 HTTP/HTTPS origin，例如 http://192.0.2.10:3000 或 https://blog.example.com。"
  exit 1
fi
if [[ "$PUBLIC_URL" == https://* ]]; then
  # The secure default assumes the user's reverse proxy runs on this host or
  # joins the Compose network. A remote load balancer needs an explicit bind /
  # firewall policy and should be configured manually after the wizard.
  APP_BIND_IP="127.0.0.1"
  TRUST_PROXY_HOPS="1"
  ui_info "已按同机/同网络单层反代收紧为 127.0.0.1:3000，并信任 1 层代理。"
  ui_info "若 TLS 在远程负载均衡器终止，请按实际网络与代理层数修改 APP_BIND_IP / TRUST_PROXY_HOPS。"
fi
ui_success "PUBLIC_URL = $PUBLIC_URL"

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
  ui_info "跨公网必须使用 HTTPS；受保护私网可填私网 IP，Docker 网络可填单标签服务名。"
  ask_default BACKEND_API_URL "Backend 入口 URL" "https://api.example.com"
  BACKEND_API_URL="${BACKEND_API_URL%/}"
  if ! is_secure_backend_url "$BACKEND_API_URL"; then
    ui_error "Backend 入口会携带 SYNC_TOKEN：公网必须 HTTPS；HTTP 仅允许 localhost、私网 IP 或单标签内网服务名。"
    exit 1
  fi
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
    if [[ ! "$INIT_AI_BASE_URL" =~ ^https:// ]]; then
      ui_error "模型 Base URL 必须使用 HTTPS，以免 API Key 通过明文连接泄露。"
      exit 1
    fi
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
ui_kv "HTTP 监听"              "$APP_BIND_IP:$APP_PORT"
ui_kv "PUBLIC_URL"            "$PUBLIC_URL"
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

# --- HTTP 服务与公开 URL ------------------------------------------------------
# 默认直接暴露 3000/HTTP。使用外部反向代理时可把 APP_BIND_IP 改为 127.0.0.1，
# 把 PUBLIC_URL 改成 HTTPS 域名，并按实际代理层数设置 TRUST_PROXY_HOPS。
PUBLIC_URL="$(escape_dq "$PUBLIC_URL")"
APP_BIND_IP="$(escape_dq "$APP_BIND_IP")"
APP_PORT="$(escape_dq "$APP_PORT")"
TRUST_PROXY_HOPS="$(escape_dq "$TRUST_PROXY_HOPS")"

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

# 缺 Docker 时，征得同意后自动安装。装成功且 docker 命令可用返回 0，否则返回 1
# （调用方回退到手动安装指引）。控制开关 SHIBEI_AUTO_INSTALL_DOCKER：
#   y = 免询问直接装（curl|bash 等非交互场景）；n = 直接跳过（测试/受管环境）；
#   未设 = 交互询问。安装走各平台官方渠道，不引入第三方脚本。
maybe_install_docker() {
  local choice="${SHIBEI_AUTO_INSTALL_DOCKER:-}"
  case "$choice" in
    n|N|no|NO|0|false) return 1 ;;
    y|Y|yes|YES|1|true) : ;;  # 免询问，直接进入安装
    *)
      ui_warn "未检测到 Docker。"
      local ans=""
      case "$OS" in
        linux)
          ask_default ans "现在自动安装 Docker？（官方脚本 get.docker.com，需要 sudo）(Y/n)" "y" ;;
        macos)
          if command -v brew >/dev/null 2>&1; then
            ask_default ans "用 Homebrew 安装 Docker Desktop？(Y/n)" "y"
          else
            return 1  # 无 brew，交回手动指引（引导装 Docker Desktop）
          fi ;;
        *) return 1 ;;
      esac
      case "$ans" in n|N|no|NO|0|false) return 1 ;; esac
      ;;
  esac

  # 非 root 且有 sudo 才加 sudo 前缀；非 root 又没 sudo 直接放弃。
  local sudo=""
  if [ "$(id -u 2>/dev/null || echo 0)" != "0" ]; then
    if command -v sudo >/dev/null 2>&1; then
      sudo="sudo"
    else
      ui_error "安装 Docker 需要 root 权限，但当前非 root 且没有 sudo。"
      return 1
    fi
  fi

  case "$OS" in
    linux)
      local fetch=""
      if command -v curl >/dev/null 2>&1; then fetch="curl -fsSL"
      elif command -v wget >/dev/null 2>&1; then fetch="wget -qO-"
      else ui_error "缺少 curl / wget，无法下载 Docker 安装脚本。"; return 1; fi
      ui_info "下载并运行 Docker 官方安装脚本（get.docker.com）…"
      if ! $fetch https://get.docker.com | ${sudo:+$sudo }sh; then
        ui_error "Docker 安装脚本执行失败，请看上方输出。"
        return 1
      fi
      # 启动 daemon 并设开机自启；把当前用户加进 docker 组（下次登录免 sudo）。
      if command -v systemctl >/dev/null 2>&1; then
        ${sudo:+$sudo }systemctl enable --now docker >/dev/null 2>&1 || true
      fi
      if [ -n "$sudo" ] && [ -n "${USER:-}" ] && [ "$USER" != "root" ]; then
        $sudo usermod -aG docker "$USER" >/dev/null 2>&1 || true
      fi ;;
    macos)
      ui_info "用 Homebrew 安装 Docker Desktop…"
      if ! brew install --cask docker; then
        ui_error "Homebrew 安装 Docker 失败。"
        return 1
      fi
      ui_warn "Docker Desktop 已安装；请先启动 Docker.app、等菜单栏图标变绿后再继续。" ;;
  esac

  if ! command -v docker >/dev/null 2>&1; then
    ui_error "安装流程结束，但仍未找到 docker 命令，请检查上方安装输出。"
    return 1
  fi
  ui_success "Docker 已就绪。"
  return 0
}

# 低内存机器上 docker build（Next.js 构建）容易 OOM 把整机拖死。内存 + 现有
# swap 合计偏低时，征得同意后创建一个 swap 文件兜底。仅 Linux。控制开关
# SHIBEI_AUTO_SWAP：y=免询问直接建、n=跳过、未设=询问。
# SHIBEI_SWAP_TEST_MEM_MB / _SWAP_MB 仅供测试伪造内存，正常留空。
ensure_swap() {
  [ "$OS" = "linux" ] || return 0
  case "${SHIBEI_AUTO_SWAP:-}" in n|N|no|NO|0|false) return 0 ;; esac

  local mem_mb swap_mb
  mem_mb="${SHIBEI_SWAP_TEST_MEM_MB:-$(awk '/^MemTotal:/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 0)}"
  swap_mb="${SHIBEI_SWAP_TEST_SWAP_MB:-$(awk '/^SwapTotal:/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 0)}"
  [ -n "$mem_mb" ] || mem_mb=0
  [ -n "$swap_mb" ] || swap_mb=0

  # 内存 + swap 合计已达 ~3GB 就不折腾。
  local total_mb=$(( mem_mb + swap_mb ))
  [ "$total_mb" -ge 3072 ] && return 0

  # 目标：补到约 3GB，区间 [2GB, 4GB]。
  local want_mb=$(( 3072 - total_mb ))
  [ "$want_mb" -lt 2048 ] && want_mb=2048
  [ "$want_mb" -gt 4096 ] && want_mb=4096

  # 小磁盘缩水：swap 别吃掉镜像/数据/更新期新旧镜像并存要用的空间。可用
  # <15GB 时上限降为 1GB——pull 部署的运行期兜底 1GB 足够，2GB 是为本地构建
  # 准备的（10G 盘曾因 2GB swap + 镜像解压直接打满,拉取失败 no space left）。
  local avail_mb=""
  if command -v df >/dev/null 2>&1; then
    avail_mb=$(df -Pm / 2>/dev/null | awk 'NR==2 {print $4}') || avail_mb=""
  fi
  if [ -n "$avail_mb" ] && [ "$avail_mb" -lt 15360 ] && [ "$want_mb" -gt 1024 ]; then
    want_mb=1024
  fi

  case "${SHIBEI_AUTO_SWAP:-}" in
    y|Y|yes|YES|1|true) : ;;  # 免询问
    *)
      local ans=""
      ask_default ans "内存偏低（RAM ${mem_mb}MB / swap ${swap_mb}MB），构建/运行时可能 OOM 死机。现在创建 ${want_mb}MB swap 兜底？(Y/n)" "y"
      case "$ans" in n|N|no|NO|0|false) ui_info "跳过创建 swap。"; return 0 ;; esac
      ;;
  esac

  local sudo=""
  if [ "$(id -u 2>/dev/null || echo 0)" != "0" ]; then
    if command -v sudo >/dev/null 2>&1; then sudo="sudo"; else
      ui_warn "创建 swap 需要 root，但当前非 root 且没有 sudo，已跳过。"; return 0
    fi
  fi

  # 不覆盖任何已存在的 swap 文件。
  local swapfile="/swapfile"
  [ -e "$swapfile" ] && swapfile="/swapfile.shibei"
  if [ -e "$swapfile" ]; then ui_warn "已存在 swap 文件，已跳过创建。"; return 0; fi

  # 磁盘要有 want_mb + 512MB 余量，别把根分区也撑满。
  if [ -n "$avail_mb" ] && [ "$avail_mb" -lt $(( want_mb + 512 )) ]; then
    ui_warn "磁盘可用空间不足（${avail_mb}MB < 需要约 $(( want_mb + 512 ))MB），已跳过创建 swap。"
    return 0
  fi

  ui_info "创建 ${want_mb}MB swap 文件 ${swapfile}（分配可能要几十秒）…"
  # fallocate 快但稀疏文件在部分文件系统上 swapon 会失败；失败即回退到 dd 写实。
  if ! { command -v fallocate >/dev/null 2>&1 && $sudo fallocate -l "${want_mb}M" "$swapfile" 2>/dev/null; }; then
    $sudo rm -f "$swapfile" 2>/dev/null || true
    if ! $sudo dd if=/dev/zero of="$swapfile" bs=1M count="$want_mb" status=none 2>/dev/null; then
      ui_warn "swap 文件分配失败，已跳过（不影响其余安装）。"; $sudo rm -f "$swapfile" 2>/dev/null || true; return 0
    fi
  fi
  if ! { $sudo chmod 600 "$swapfile" 2>/dev/null && $sudo mkswap "$swapfile" >/dev/null 2>&1 && $sudo swapon "$swapfile" 2>/dev/null; }; then
    $sudo swapoff "$swapfile" 2>/dev/null || true
    $sudo rm -f "$swapfile" 2>/dev/null || true
    if $sudo dd if=/dev/zero of="$swapfile" bs=1M count="$want_mb" status=none 2>/dev/null \
      && $sudo chmod 600 "$swapfile" 2>/dev/null \
      && $sudo mkswap "$swapfile" >/dev/null 2>&1 \
      && $sudo swapon "$swapfile" 2>/dev/null; then :; else
      ui_warn "启用 swap 失败，已跳过（不影响其余安装）。"; $sudo rm -f "$swapfile" 2>/dev/null || true; return 0
    fi
  fi

  # 持久化到 fstab（重启后仍在）+ 调高 swappiness，低内存下更早用 swap 减少卡死。
  if ! grep -qs "^[^#]*${swapfile}[[:space:]]" /etc/fstab 2>/dev/null; then
    printf '%s none swap sw 0 0\n' "$swapfile" | $sudo tee -a /etc/fstab >/dev/null 2>&1 || true
  fi
  $sudo sysctl -w vm.swappiness=60 >/dev/null 2>&1 || true

  ui_success "已启用 ${want_mb}MB swap（${swapfile}），并写入 /etc/fstab 持久化。"
  return 0
}

# ---------- 启动后健康等待 ---------------------------------------------------
# `up -d` 返回 ≠ 应用可用:首次启动要跑数据库迁移+种子,低配机可能要一两分钟。
# 之前的版本容器一起来就打 Setup complete,应用起没起来全靠用户自己访问发现。
# 轮询本机健康端点给出明确结论;SHIBEI_HEALTH_WAIT_SECS=0 跳过(测试/脚本用)。
wait_app_health() {
  local wait_secs="${SHIBEI_HEALTH_WAIT_SECS:-120}"
  case "$wait_secs" in ''|*[!0-9]*) wait_secs=120 ;; esac
  [ "$wait_secs" -gt 0 ] || return 0
  command -v curl >/dev/null 2>&1 || return 0
  local url="http://127.0.0.1:${APP_PORT:-3000}/api/health"
  ui_info "等待应用就绪（首次启动含数据库迁移与种子，低配机可能要 1-2 分钟）…"
  local waited=0
  while [ "$waited" -lt "$wait_secs" ]; do
    if curl -sf --max-time 3 "$url" >/dev/null 2>&1; then
      ui_success "应用已就绪（${url} 健康检查通过）。"
      return 0
    fi
    sleep 3
    waited=$(( waited + 3 ))
  done
  ui_warn "等了 ${wait_secs}s 应用还没就绪——多半仍在初始化，但也可能启动失败了。先看日志："
  printf "    ${MUTED}cd %s && %s logs --tail=50 app${NC}\n" "$PROJECT_DIR" "$COMPOSE_CMD_DISPLAY"
  return 0
}

# ---------- 启动 docker compose（可跳过）-------------------------------------
# 选择对应模式的 compose 参数。后续 ui_section "Next steps" 也复用。
case "$APP_MODE" in
  full)     COMPOSE_ARGS=() ;;
  backend)  COMPOSE_ARGS=(-f docker-compose.backend.yml) ;;
  frontend) COMPOSE_ARGS=(-f docker-compose.frontend.yml) ;;
esac

# Compose build args are also the runtime /api/health version identity. Export
# them for wizard-driven builds just like scripts/deploy.sh and the updater do.
GIT_COMMIT="$(git -C "$PROJECT_DIR" rev-parse --short HEAD 2>/dev/null || printf 'source')"
if ! git -C "$PROJECT_DIR" diff --quiet HEAD 2>/dev/null; then
  GIT_COMMIT="${GIT_COMMIT}-dirty"
fi
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export GIT_COMMIT BUILD_TIME
COMPOSE_CMD_DISPLAY="docker compose"
if [ "${#COMPOSE_ARGS[@]}" -gt 0 ]; then
  COMPOSE_CMD_DISPLAY="docker compose ${COMPOSE_ARGS[*]}"
fi

# SHIBEI_AUTO_START=y/n 用于非交互场景与单元测试；空值走交互提问。
AUTO_START="${SHIBEI_AUTO_START:-}"

# ---------- 部署方式：本地构建 vs 拉预构建镜像 -------------------------------
# 低配机上 Next.js 本地构建必死：builder 阶段没有 NODE_OPTIONS 时，V8 按物理内
# 存推算的默认堆上限只有 ~300MB，够不到 Next 构建的胃口，而且这个上限只看物理
# 内存——加 swap 也救不了。所以物理内存 <3500MB 时默认改拉 Docker Hub 预构建镜
# 像（safg/shibei，四种 tag 与三形态一一对应）；内存充足维持本地构建（能包含
# 本地改动）。SHIBEI_DEPLOY_SOURCE=build|pull 显式覆盖则不做检测；
# SHIBEI_SWAP_TEST_MEM_MB 供测试伪造内存（与 ensure_swap 共用同一个开关）。
DEPLOY_SOURCE="${SHIBEI_DEPLOY_SOURCE:-}"
case "$DEPLOY_SOURCE" in build|pull) : ;; *) DEPLOY_SOURCE="" ;; esac
if [ -z "$DEPLOY_SOURCE" ]; then
  DEPLOY_MEM_MB="${SHIBEI_SWAP_TEST_MEM_MB:-$(awk '/^MemTotal:/ {printf "%d", $2/1024}' /proc/meminfo 2>/dev/null || echo 0)}"
  [ -n "$DEPLOY_MEM_MB" ] || DEPLOY_MEM_MB=0
  if [ "$DEPLOY_MEM_MB" -gt 0 ] && [ "$DEPLOY_MEM_MB" -lt 3500 ]; then
    if [ -z "$AUTO_START" ]; then
      # 交互场景：说明原因并征求意见，默认拉取。
      echo
      ui_warn "内存 ${DEPLOY_MEM_MB}MB 不足以本地构建 Next.js（需 4GB+，构建必然 OOM）。"
      DEPLOY_ANS=""
      ask_default DEPLOY_ANS "改为拉取 Docker Hub 预构建镜像（safg/shibei）？(Y=拉取/n=坚持本地构建)" "y"
      case "$DEPLOY_ANS" in n|N|no|NO|0|false) DEPLOY_SOURCE="build" ;; *) DEPLOY_SOURCE="pull" ;; esac
    else
      # 非交互（curl|bash / SHIBEI_AUTO_START 已设）：不能提问，直接选拉取。
      DEPLOY_SOURCE="pull"
      ui_info "内存 ${DEPLOY_MEM_MB}MB 偏低，改为拉取预构建镜像；要强制本地构建请设 SHIBEI_DEPLOY_SOURCE=build。"
    fi
  else
    DEPLOY_SOURCE="build"
  fi
fi

if [ "$DEPLOY_SOURCE" = "pull" ]; then
  COMPOSE_UP_ARGS=(up -d --force-recreate)
  COMPOSE_UP_DISPLAY="${COMPOSE_CMD_DISPLAY} pull && ${COMPOSE_CMD_DISPLAY} up -d --force-recreate"
else
  COMPOSE_UP_ARGS=(up -d --build --force-recreate)
  COMPOSE_UP_DISPLAY="${COMPOSE_CMD_DISPLAY} ${COMPOSE_UP_ARGS[*]}"
fi

# 把部署方式记进 .env：updater 的网页一键更新按它决定 build 还是 pull——
# 低配机上 build 必然 OOM，不记下来的话点一次更新就把机器打死。
# 纯 bash 内建实现：极简环境（curl|bash 的精简容器、测试沙箱）没有 grep/sed/mv。
if [ -f "$PROJECT_DIR/.env" ]; then
  ENV_FILTERED=""
  while IFS= read -r ENV_LINE || [ -n "$ENV_LINE" ]; do
    case "$ENV_LINE" in DEPLOY_SOURCE=*) : ;; *) ENV_FILTERED="${ENV_FILTERED}${ENV_LINE}
" ;; esac
  done < "$PROJECT_DIR/.env"
  printf '%sDEPLOY_SOURCE="%s"\n' "$ENV_FILTERED" "$DEPLOY_SOURCE" > "$PROJECT_DIR/.env"
fi

if [ -z "$AUTO_START" ]; then
  echo
  ask_default AUTO_START "现在用 ${COMPOSE_UP_DISPLAY} 启动？(Y/n)" "y"
fi

case "$AUTO_START" in
  n|N|no|NO|0|false)
    AUTO_STARTED=0
    DOCKER_FAILED=0
    DOCKER_MISSING=0
    ;;
  *)
    AUTO_STARTED=0
    DOCKER_FAILED=0
    DOCKER_MISSING=0
    # 没装 docker 就先征得同意后尝试自动安装；不成功再走"缺 Docker"兜底指引。
    if ! command -v docker >/dev/null 2>&1; then
      maybe_install_docker || true
    fi
    if ! command -v docker >/dev/null 2>&1; then
      DOCKER_MISSING=1
    else
      # 刚装完 docker 时，当前会话可能还不在 docker 组、访问不了 daemon；
      # 非 root + 有 sudo 就用 sudo 兜住这次启动（下次登录后免 sudo）。
      DOCKER_SUDO=""
      if ! docker info >/dev/null 2>&1 && [ "$(id -u 2>/dev/null || echo 0)" != "0" ] && command -v sudo >/dev/null 2>&1; then
        DOCKER_SUDO="sudo"
      fi
      # 端口预检:APP_PORT 已被占用时 up 大概率失败,提前把话说明白。只提醒
      # 不阻断——占用者若是旧 ShiBei 容器,up 会正常顶替它。/dev/tcp 是 bash
      # 内建,极简环境没有 lsof/ss 也能用。
      if (exec 3<>"/dev/tcp/127.0.0.1/${APP_PORT:-3000}") 2>/dev/null; then
        ui_warn "端口 ${APP_PORT:-3000} 当前已被占用。若是旧 ShiBei 容器会被顶替,否则启动会失败(可改 .env 的 APP_PORT)。"
      fi
      # 低配机兜底 swap：build 模式防构建 OOM 拖死整机；pull 模式运行期同样受益。
      ensure_swap
      echo
      ui_info "切到 $PROJECT_DIR 并运行 ${DOCKER_SUDO:+sudo }${COMPOSE_UP_DISPLAY} ..."
      START_OK=0
      if [ "$DEPLOY_SOURCE" = "pull" ]; then
        ui_info "镜像来源：hub.docker.com/r/safg/shibei（预构建）；本地未推送的改动不会包含在内。"
        # 预警：拉取+解压 frontend 三件套(app/updater/postgres)约需 2.5-3GB 空闲。
        PULL_AVAIL_MB=""
        if command -v df >/dev/null 2>&1; then
          PULL_AVAIL_MB=$(df -Pm / 2>/dev/null | awk 'NR==2 {print $4}') || PULL_AVAIL_MB=""
        fi
        if [ -n "$PULL_AVAIL_MB" ] && [ "$PULL_AVAIL_MB" -lt 3072 ]; then
          ui_warn "磁盘可用仅 ${PULL_AVAIL_MB}MB，拉取+解压镜像可能不够；建议先 docker system prune -af 清理旧缓存。"
        fi
        if (cd "$PROJECT_DIR" \
            && ${DOCKER_SUDO:+sudo }docker compose "${COMPOSE_ARGS[@]}" pull \
            && ${DOCKER_SUDO:+sudo }docker compose "${COMPOSE_ARGS[@]}" "${COMPOSE_UP_ARGS[@]}"); then
          START_OK=1
        fi
      else
        ui_info "本地 build；改用预构建镜像可设 SHIBEI_DEPLOY_SOURCE=pull 重跑本向导。"
        if (cd "$PROJECT_DIR" && ${DOCKER_SUDO:+sudo }docker compose "${COMPOSE_ARGS[@]}" "${COMPOSE_UP_ARGS[@]}"); then
          START_OK=1
        fi
      fi
      if [ "$START_OK" = "1" ]; then
        AUTO_STARTED=1
        echo
        ui_success "容器已启动；用 ${COMPOSE_CMD_DISPLAY} ps 看状态、logs -f 看日志。"
        wait_app_health
      else
        DOCKER_FAILED=1
        echo
        if [ "$DEPLOY_SOURCE" = "pull" ]; then
          ui_error "${COMPOSE_UP_DISPLAY} 退出非零；常见原因：磁盘空间不足 / 网络拉取失败 / Docker Hub 限流 / 端口占用 / .env 缺项。"
        else
          ui_error "${COMPOSE_UP_DISPLAY} 退出非零；常见原因：build 失败(内存不足) / 端口占用 / .env 缺项。"
        fi
      fi
    fi
    ;;
esac

# ---------- 庆祝 / 排查指引 --------------------------------------------------
# docker compose up -d 失败时不再打 "Setup complete!"——之前的版本即便 up -d
# 退出非零仍然打印"启动 / 健康检查 / 管理后台 / 登录账号"，让用户以为成功，但
# 容器其实没起来，访问 /admin 直接是 connection refused。这里区分四种状态:
#   1) AUTO_STARTED=1                          — 真的成功,正常打 Setup complete
#   2) AUTO_STARTED=0 DOCKER_FAILED=0 DOCKER_MISSING=0 — 用户主动跳过,给手动启动指引
#   3) AUTO_STARTED=0 DOCKER_FAILED=0 DOCKER_MISSING=1 — 用户想启动但 docker 没装,
#                                                       不能打"Setup complete"——配置
#                                                       是完成了,但部署没法继续;给
#                                                       Docker 安装指引 + 手动启动命令
#   4) AUTO_STARTED=0 DOCKER_FAILED=1                  — 启动失败,改打"未完成"+ 排查步骤,exit 1
echo
if [ "${DOCKER_FAILED:-0}" = "1" ]; then
  printf "${WARN}${BOLD}Setup 未完成${NC} — .env 已生成,但 ${COMPOSE_UP_DISPLAY} 失败,容器没起来。\n"
  echo
  ui_section "排查步骤"
  printf "  ${BOLD}1. 看错误：${NC}cd %s && %s logs --tail=100\n" "$PROJECT_DIR" "$COMPOSE_CMD_DISPLAY"
  if [ "${DEPLOY_SOURCE:-build}" = "pull" ]; then
    printf "  ${BOLD}2. 单独拉镜像看报错：${NC}cd %s && %s pull\n" "$PROJECT_DIR" "$COMPOSE_CMD_DISPLAY"
    printf "       ${MUTED}报 no space left 就是磁盘满:df -h / 看空间,docker system prune -af 清掉旧镜像/缓存再重试${NC}\n"
    printf "       ${MUTED}网络问题或 Docker Hub 限流稍候重试;镜像主页 hub.docker.com/r/safg/shibei${NC}\n"
  else
    printf "  ${BOLD}2. 单独 build 看报错：${NC}cd %s && %s build\n" "$PROJECT_DIR" "$COMPOSE_CMD_DISPLAY"
    printf "       ${MUTED}报 OOM/SIGABRT 就是内存不够,改拉预构建镜像(小内存机器别本地 build):${NC}\n"
    printf "       ${MUTED}cd %s && %s pull && %s up -d --force-recreate${NC}\n" "$PROJECT_DIR" "$COMPOSE_CMD_DISPLAY" "$COMPOSE_CMD_DISPLAY"
  fi
  printf "  ${BOLD}3. 检查端口：${NC}sudo lsof -i :%s   ${MUTED}(被占用就修改 .env 的 APP_PORT)${NC}\n" "$APP_PORT"
  printf "  ${BOLD}4. 重新启动：${NC}cd %s && %s\n" "$PROJECT_DIR" "$COMPOSE_UP_DISPLAY"
  echo
  ui_info "排查后容器跑起来,登录信息:${ACCENT_BRIGHT}${PUBLIC_URL%/}/admin${NC}  账号:${BOLD}${ADMIN_USERNAME} / ${ADMIN_PASSWORD}${NC}"
  echo
  ui_panel "Need help? FAQ → README.md#常见问题排查清单"
  exit 1
fi

if [ "${DOCKER_MISSING:-0}" = "1" ]; then
  # 用户回 Y 想自动启动,但环境里没 docker。配置文件 OK,但部署被卡住——
  # 不该再打"Setup complete!"，会让用户以为可以直接访问 /admin。
  printf "${WARN}${BOLD}配置已写入,但 Docker 未安装${NC} — 装上 Docker 后再启动。\n"
  echo
  ui_section "下一步"
  case "$OS" in
    linux)
      printf "  ${BOLD}1. 安装 Docker：${NC}curl -fsSL https://get.docker.com | sudo sh\n"
      printf "       ${MUTED}（包含 docker engine + compose 插件;装完可能要 newgrp docker 或重新登录）${NC}\n"
      ;;
    macos)
      printf "  ${BOLD}1. 安装 Docker Desktop：${NC}https://www.docker.com/products/docker-desktop/\n"
      printf "       ${MUTED}（或 brew install --cask docker;装完启动 Docker.app 等图标变绿）${NC}\n"
      ;;
    *)
      printf "  ${BOLD}1. 安装 Docker：${NC}见 https://docs.docker.com/engine/install/\n"
      ;;
  esac
  printf "  ${BOLD}2. 验证：${NC}docker --version && docker compose version\n"
  printf "  ${BOLD}3. 启动：${NC}cd %s && %s\n" "$PROJECT_DIR" "$COMPOSE_UP_DISPLAY"
  printf "  ${BOLD}4. 健康检查：${NC}curl ${PUBLIC_URL%/}/api/health\n"
  echo
  ui_info "启动后管理后台:${ACCENT_BRIGHT}${PUBLIC_URL%/}/admin${NC}  账号:${BOLD}${ADMIN_USERNAME} / ${ADMIN_PASSWORD}${NC}"
  if [ "$APP_MODE" = "backend" ]; then
    echo
    ui_warn "另一台 frontend 服务器的 SYNC_TOKEN 必须填同一串："
    printf "    ${MUTED}%s${NC}\n" "$SYNC_TOKEN"
  fi
  echo
  ui_panel "Need help? FAQ → README.md#常见问题排查清单"
  exit 0
fi

ui_celebrate "🎉 Setup complete!"
echo
ui_section "Next steps"
if [ "${AUTO_STARTED:-0}" = "1" ]; then
  printf "  ${BOLD}已启动${NC}（${MUTED}%s 已自动执行${NC}）\n" "$COMPOSE_UP_DISPLAY"
else
  # 没自动起：完整把 cd + 启动一行写出来，避免用户在错误目录里跑 docker compose。
  printf "  ${BOLD}启动：${NC}cd %s && %s\n" "$PROJECT_DIR" "$COMPOSE_UP_DISPLAY"
fi
printf "  ${BOLD}健康检查：${NC}curl ${PUBLIC_URL%/}/api/health\n"
printf "  ${BOLD}管理后台：${NC}${ACCENT_BRIGHT}${PUBLIC_URL%/}/admin${NC}\n"
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
