#!/usr/bin/env bash
# ShiBei 生产备份：Postgres 全库 dump（pg_dump custom 格式，自带压缩）+ 文章配图卷打包。
#
# 用法：直接运行即可；环境变量可覆盖：
#   SHIBEI_BACKUP_DIR             备份目录（默认 /home/app/backups）
#   SHIBEI_BACKUP_RETENTION_DAYS  本地保留天数（默认 14）
#   SHIBEI_UPLOADS_VOLUME         配图卷名（默认 shibei_app-uploads）。compose 项目名
#                                 不是 shibei 时（如 -p video / COMPOSE_PROJECT_NAME），
#                                 卷名前缀会变，须在此覆盖，否则会备份到一个空的新卷。
#   SHIBEI_BACKUP_SYNC_CMD        可选异地同步命令，备份完成后执行
#                                 （例：rclone copy /home/app/backups remote:shibei-backups）
#
# 安装每日 systemd timer（本脚本不假设 cron/timer 已安装）：
#   sudo scripts/install-backup-timer.sh
#
# 恢复方法见 DEPLOY_NOTES.md「备份与恢复」。
set -euo pipefail

# Backup files contain the whole database and must never be group/world
# readable, including during the interval while they are still being written.
umask 077

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${SHIBEI_BACKUP_DIR:-/home/app/backups}"
RETENTION_DAYS="${SHIBEI_BACKUP_RETENTION_DAYS:-14}"
UPLOADS_VOLUME="${SHIBEI_UPLOADS_VOLUME:-shibei_app-uploads}"
STAMP="$(date +%Y%m%d-%H%M%S)"
DB_FINAL="$BACKUP_DIR/db-$STAMP.dump"
UPLOADS_FINAL="$BACKUP_DIR/uploads-$STAMP.tar.gz"
DB_PART="$DB_FINAL.partial"
UPLOADS_PART="$UPLOADS_FINAL.partial"

if ! [[ "$RETENTION_DAYS" =~ ^[0-9]+$ ]]; then
  echo "[backup] 错误：SHIBEI_BACKUP_RETENTION_DAYS 必须是非负整数" >&2
  exit 2
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
exec 9>"$BACKUP_DIR/.lock"
flock -n 9 || { echo "[backup] 已有备份在运行，跳过"; exit 0; }

cleanup_partial() {
  rm -f -- "$DB_PART" "$UPLOADS_PART"
}
trap cleanup_partial EXIT HUP INT TERM

echo "[backup] $STAMP 开始"

# 1. Postgres 全库（custom 格式，恢复用 pg_restore）
docker compose -f "$PROJECT_DIR/docker-compose.yml" exec -T postgres \
  pg_dump -U shibei -d shibei_blog --format=custom \
  > "$DB_PART"
if [ ! -s "$DB_PART" ]; then
  echo "[backup] 错误：数据库备份为空" >&2
  exit 1
fi
# Verify that pg_restore can parse the custom-format archive before publishing
# it under its final name. The validation runs inside the existing Postgres
# service, so the host does not need a matching pg_restore package.
if ! docker compose -f "$PROJECT_DIR/docker-compose.yml" exec -T postgres \
  pg_restore --list < "$DB_PART" >/dev/null; then
  echo "[backup] 错误：数据库备份校验失败" >&2
  exit 1
fi

# 2. 文章配图卷（独立容器只读挂载，不依赖 app 容器是否存活）
#    先确认卷存在：docker run -v 会把不存在的卷名当新卷创建，导致"备份成功但内容为空"。
if ! docker volume inspect "$UPLOADS_VOLUME" >/dev/null 2>&1; then
  echo "[backup] 错误：找不到卷 '$UPLOADS_VOLUME'。用 SHIBEI_UPLOADS_VOLUME 指定正确卷名（docker volume ls 查看）。" >&2
  exit 1
fi
docker run --rm -v "$UPLOADS_VOLUME":/uploads:ro alpine \
  tar -czf - -C / uploads > "$UPLOADS_PART"
if [ ! -s "$UPLOADS_PART" ] || ! gzip -t "$UPLOADS_PART"; then
  echo "[backup] 错误：上传文件备份为空或压缩包损坏" >&2
  exit 1
fi

chmod 600 "$DB_PART" "$UPLOADS_PART"
mv -- "$DB_PART" "$DB_FINAL"
mv -- "$UPLOADS_PART" "$UPLOADS_FINAL"

# 3. 清理保留期外的旧备份
find "$BACKUP_DIR" -maxdepth 1 -name 'db-*.dump' -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -maxdepth 1 -name 'uploads-*.tar.gz' -mtime +"$RETENTION_DAYS" -delete

# 4. 可选异地同步
if [ -n "${SHIBEI_BACKUP_SYNC_CMD:-}" ]; then
  # The command may contain a storage credential; never echo its value.
  echo "[backup] 开始异地同步"
  sh -c "$SHIBEI_BACKUP_SYNC_CMD"
fi

trap - EXIT HUP INT TERM
echo "[backup] 完成：db $(du -h "$DB_FINAL" | cut -f1)，uploads $(du -h "$UPLOADS_FINAL" | cut -f1)"
