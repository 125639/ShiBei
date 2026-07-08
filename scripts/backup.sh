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
# cron（每天 04:30，已由安装脚本写入 root crontab）：
#   30 4 * * * /home/app/ShiBei/scripts/backup.sh >> /home/app/backups/backup.log 2>&1
#
# 恢复方法见 DEPLOY_NOTES.md「备份与恢复」。
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${SHIBEI_BACKUP_DIR:-/home/app/backups}"
RETENTION_DAYS="${SHIBEI_BACKUP_RETENTION_DAYS:-14}"
UPLOADS_VOLUME="${SHIBEI_UPLOADS_VOLUME:-shibei_app-uploads}"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"
exec 9>"$BACKUP_DIR/.lock"
flock -n 9 || { echo "[backup] 已有备份在运行，跳过"; exit 0; }

echo "[backup] $STAMP 开始"

# 1. Postgres 全库（custom 格式，恢复用 pg_restore）
docker compose -f "$PROJECT_DIR/docker-compose.yml" exec -T postgres \
  pg_dump -U shibei -d shibei_blog --format=custom \
  > "$BACKUP_DIR/db-$STAMP.dump"

# 2. 文章配图卷（独立容器只读挂载，不依赖 app 容器是否存活）
#    先确认卷存在：docker run -v 会把不存在的卷名当新卷创建，导致"备份成功但内容为空"。
if ! docker volume inspect "$UPLOADS_VOLUME" >/dev/null 2>&1; then
  echo "[backup] 错误：找不到卷 '$UPLOADS_VOLUME'。用 SHIBEI_UPLOADS_VOLUME 指定正确卷名（docker volume ls 查看）。" >&2
  exit 1
fi
docker run --rm -v "$UPLOADS_VOLUME":/uploads:ro alpine \
  tar -czf - -C / uploads > "$BACKUP_DIR/uploads-$STAMP.tar.gz"

# 3. 清理保留期外的旧备份
find "$BACKUP_DIR" -maxdepth 1 -name 'db-*.dump' -mtime +"$RETENTION_DAYS" -delete
find "$BACKUP_DIR" -maxdepth 1 -name 'uploads-*.tar.gz' -mtime +"$RETENTION_DAYS" -delete

# 4. 可选异地同步
if [ -n "${SHIBEI_BACKUP_SYNC_CMD:-}" ]; then
  echo "[backup] 异地同步：$SHIBEI_BACKUP_SYNC_CMD"
  sh -c "$SHIBEI_BACKUP_SYNC_CMD"
fi

echo "[backup] 完成：db $(du -h "$BACKUP_DIR/db-$STAMP.dump" | cut -f1)，uploads $(du -h "$BACKUP_DIR/uploads-$STAMP.tar.gz" | cut -f1)"
