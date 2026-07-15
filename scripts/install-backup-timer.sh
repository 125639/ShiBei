#!/usr/bin/env bash
# Install (or update) the daily ShiBei backup systemd service and timer.
set -euo pipefail
umask 077

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  echo "[backup-install] 请使用 sudo/root 运行" >&2
  exit 1
fi
if ! command -v systemctl >/dev/null 2>&1; then
  echo "[backup-install] 当前系统没有 systemd；未安装任何定时任务" >&2
  exit 1
fi

PROJECT_DIR="${SHIBEI_PROJECT_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
BACKUP_DIR="${SHIBEI_BACKUP_DIR:-/home/app/backups}"
SERVICE_TEMPLATE="$PROJECT_DIR/ops/systemd/shibei-backup.service.in"
TIMER_SOURCE="$PROJECT_DIR/ops/systemd/shibei-backup.timer"

for required in "$PROJECT_DIR/scripts/backup.sh" "$SERVICE_TEMPLATE" "$TIMER_SOURCE"; do
  if [ ! -f "$required" ]; then
    echo "[backup-install] 缺少文件：$required" >&2
    exit 1
  fi
done
if [[ "$PROJECT_DIR" == *$'\n'* || "$BACKUP_DIR" == *$'\n'* ]]; then
  echo "[backup-install] 路径不能包含换行符" >&2
  exit 1
fi

install -d -m 700 "$BACKUP_DIR"
service_tmp="$(mktemp)"
trap 'rm -f -- "$service_tmp"' EXIT
# systemd specifier escaping uses %, while sed replacement needs \ and &
# escaped. Keep the generated unit deterministic and do not use a shell in
# ExecStart, so paths cannot become command injection.
escape_sed_replacement() { printf '%s' "$1" | sed -e 's/[\\&|]/\\&/g' -e 's/%/%%/g'; }
project_escaped="$(escape_sed_replacement "$PROJECT_DIR")"
backup_escaped="$(escape_sed_replacement "$BACKUP_DIR")"
sed -e "s|@PROJECT_DIR@|$project_escaped|g" -e "s|@BACKUP_DIR@|$backup_escaped|g" \
  "$SERVICE_TEMPLATE" > "$service_tmp"

install -m 644 "$service_tmp" /etc/systemd/system/shibei-backup.service
install -m 644 "$TIMER_SOURCE" /etc/systemd/system/shibei-backup.timer
systemctl daemon-reload
systemctl enable --now shibei-backup.timer

echo "[backup-install] 已安装：shibei-backup.timer"
systemctl list-timers shibei-backup.timer --no-pager
echo "[backup-install] 建议先手动校验：systemctl start shibei-backup.service"
