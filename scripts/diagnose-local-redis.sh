#!/usr/bin/env bash
# Local systemd deployment only. Back up and diagnose; NEVER truncate/repair AOF.
# Run manually with sudo after reviewing the stopped-service effects below.
set -euo pipefail
umask 077

if [[ "${EUID}" -ne 0 ]]; then
  echo '需要管理员权限：本脚本会停止故障 worker/Redis、备份 Redis，再执行只读 AOF 检查。' >&2
  echo '不会执行 redis-check-aof --fix，也不会删除或重建 Redis 数据。' >&2
  exit 1
fi

config=/etc/redis/redis.conf
read_setting() {
  awk -v key="$1" '$1 == key { $1=""; sub(/^[[:space:]]+/, ""); sub(/[[:space:]]+#.*/, ""); gsub(/^"|"$/, ""); value=$0 } END { print value }' "$config"
}
data_dir=$(read_setting dir)
aof_dir=$(read_setting appenddirname)
aof_name=$(read_setting appendfilename)
aof_dir=${aof_dir:-appendonlydir}
aof_name=${aof_name:-appendonly.aof}
[[ -n "$data_dir" && "$data_dir" == /* && "$data_dir" != / && -d "$data_dir" ]] || { echo 'Redis dir 配置无效，拒绝操作' >&2; exit 1; }
[[ "$aof_dir" != */* && "$aof_dir" != .. && "$aof_name" != */* ]] || { echo 'AOF 配置需人工检查' >&2; exit 1; }
manifest="$data_dir/$aof_dir/$aof_name.manifest"
[[ -f "$manifest" ]] || { echo "找不到 Redis 多文件 AOF manifest：$manifest" >&2; exit 1; }
command -v redis-check-aof >/dev/null

backup_root=/var/backups/shibei-redis
mkdir -p "$backup_root"
bytes=$(du -sb "$data_dir" | cut -f1)
available=$(df -B1 --output=avail "$backup_root" | tail -1 | tr -d ' ')
(( available > bytes * 2 + 67108864 )) || { echo '空间不足以安全备份，请先清理空间' >&2; exit 1; }

echo '停止 shibei-worker 与 redis-server；它们不会由本诊断脚本自动重启。'
systemctl stop shibei-worker.service redis-server.service
backup=$(mktemp -d "$backup_root/$(date +%Y%m%d-%H%M%S)-XXXXXX")
# Preserve owner/mode and all RDB/AOF parts together. Do not repair the original.
tar -C "$data_dir" -czpf "$backup/redis-data.tar.gz" .
tar -tzf "$backup/redis-data.tar.gz" >/dev/null
sha256sum "$backup/redis-data.tar.gz" > "$backup/SHA256SUMS"
cp -a "$config" "$backup/redis.conf"
echo "备份已验证：$backup"
echo "开始只读检查：$manifest"
set +e
redis-check-aof "$manifest" 2>&1 | tee "$backup/aof-check.log"
result=${PIPESTATUS[0]}
set -e
echo "检查退出码：$result"
echo '未执行 --fix，原始 AOF 未被修改。请先根据报告评估可能丢失的尾部范围，再决定恢复方案。'
echo '请把 aof-check.log 的检查结论发回来；不要发送 redis.conf（可能包含密码）。'
exit "$result"
